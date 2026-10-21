package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type modelConfig struct {
	Base  string `json:"base"`
	Model string `json:"model"`
	Key   string `json:"key"`
}

type explainRequest struct {
	Config  modelConfig `json:"config"`
	Text    string      `json:"text"`
	Image   string      `json:"image"`
	Mode    string      `json:"mode"`
	History []message   `json:"history"`
}

const (
	maxPromptRunes  = 12000
	maxHistoryRunes = 12000
)

var (
	distDir   = flag.String("dist", "dist", "directory holding the built web app")
	assetDir  = flag.String("assets", "assets", "directory holding bundled fonts")
	listenOn  = flag.String("addr", "127.0.0.1:3001", "listen address")
	maxUpload = int64(100 << 20)
)

// Set from REMOTE_CONVERT_URL: when present, slide conversion is delegated to that
// service instead of running LibreOffice on this machine.
var remoteConverter string

func jsonError(w http.ResponseWriter, code int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func main() {
	flag.Parse()
	// Environment first, flag default second: containers configure paths without flags.
	if value := os.Getenv("DIST_DIR"); value != "" && *distDir == "dist" {
		*distDir = value
	}
	if value := os.Getenv("ASSETS_DIR"); value != "" && *assetDir == "assets" {
		*assetDir = value
	}
	if value := os.Getenv("ADDR"); value != "" && *listenOn == "127.0.0.1:3001" {
		*listenOn = value
	}
	remoteConverter = strings.TrimSpace(os.Getenv("REMOTE_CONVERT_URL"))

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		mode := "local"
		if remoteConverter != "" {
			mode = "remote"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "converter": mode, "dist": *distDir})
	})
	mux.HandleFunc("/api/font", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, filepath.Join(*assetDir, "NotoSansSC.ttf"))
	})
	mux.HandleFunc("/api/convert", convertHandler)
	mux.HandleFunc("/api/explain", explainHandler)
	mux.HandleFunc("/api/models", modelsHandler)
	mux.Handle("/", http.FileServer(http.Dir(*distDir)))
	s := &http.Server{
		Addr:              *listenOn,
		Handler:           logging(mux),
		ReadHeaderTimeout: 10 * time.Second,
		// Streaming answers can run long; a hard write deadline would cut them off.
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}
	converter := "内置浏览器渲染 / 本机 LibreOffice"
	if remoteConverter != "" {
		converter = remoteConverter
	}
	fmt.Printf("LectureLens http://%s\n  dist: %s\n  assets: %s\n  converter: %s\n", *listenOn, *distDir, *assetDir, converter)
	if err := s.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}

func logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fmt.Printf("%s %s\n", r.Method, r.URL.Path)
		}
		next.ServeHTTP(w, r)
	})
}

func convertHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		jsonError(w, 400, err)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, h, err := r.FormFile("file")
	if err != nil {
		jsonError(w, 400, err)
		return
	}
	defer f.Close()
	ext := strings.ToLower(filepath.Ext(h.Filename))
	if ext != ".ppt" && ext != ".pptx" && ext != ".odp" {
		jsonError(w, 400, fmt.Errorf("请选择 PPT、PPTX 或 ODP 文件"))
		return
	}
	// A remote converter keeps LibreOffice off the web server entirely: the end
	// user's machine only needs a browser.
	if remoteConverter != "" {
		data, err := io.ReadAll(io.LimitReader(f, maxUpload))
		if err != nil {
			jsonError(w, 500, err)
			return
		}
		pdf, err := callRemoteConverter(r.Context(), data, h.Filename)
		if err != nil {
			jsonError(w, 502, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Write(pdf)
		return
	}
	dir, err := os.MkdirTemp("", "lecture-")
	if err != nil {
		jsonError(w, 500, err)
		return
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "slides"+ext)
	out, err := os.Create(input)
	if err != nil {
		jsonError(w, 500, err)
		return
	}
	if _, err = io.Copy(out, f); err != nil {
		out.Close()
		jsonError(w, 500, err)
		return
	}
	if err = out.Close(); err != nil {
		jsonError(w, 500, err)
		return
	}
	// Try the configured path first, then the usual install locations so a normal
	// LibreOffice install works without extra setup.
	sofficeCandidates := []string{}
	if custom := os.Getenv("SOFFICE_PATH"); custom != "" {
		sofficeCandidates = append(sofficeCandidates, custom)
	}
	sofficeCandidates = append(sofficeCandidates,
		"/Applications/LibreOffice.app/Contents/MacOS/soffice",
		"/opt/homebrew/bin/soffice",
		"/usr/local/bin/soffice",
		"/usr/bin/soffice",
		"/usr/bin/libreoffice",
		"/snap/bin/libreoffice",
	)
	ctx, cancel := context.WithTimeout(r.Context(), 110*time.Second)
	defer cancel()
	var (
		output   []byte
		convErr  error
		launched bool
	)
	for _, soffice := range sofficeCandidates {
		cmd := exec.CommandContext(ctx, soffice,
			"-env:UserInstallation=file://"+filepath.Join(dir, "profile"),
			"--headless", "--convert-to", "pdf", "--outdir", dir, input)
		output, convErr = cmd.CombinedOutput()
		launched = true
		if convErr == nil {
			break
		}
		// A missing binary is worth retrying at the next known location; any other
		// failure means LibreOffice ran and rejected the file.
		if !errors.Is(convErr, exec.ErrNotFound) && !errors.Is(convErr, os.ErrNotExist) {
			break
		}
	}
	if convErr != nil {
		if !launched || errors.Is(convErr, exec.ErrNotFound) || errors.Is(convErr, os.ErrNotExist) {
			convErr = fmt.Errorf("PPT 转换需要本机安装 LibreOffice，或设置 SOFFICE_PATH 指向 soffice。macOS 可执行 brew install --cask libreoffice")
		}
		jsonError(w, 500, fmt.Errorf("%v: %s", convErr, strings.TrimSpace(string(output))))
		return
	}
	data, err := os.ReadFile(filepath.Join(dir, "slides.pdf"))
	if err != nil {
		jsonError(w, 500, err)
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Write(data)
}

// callRemoteConverter posts the upload to the converter service and returns the PDF.
func callRemoteConverter(ctx context.Context, data []byte, filename string) ([]byte, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		return nil, err
	}
	if _, err = part.Write(data); err != nil {
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", remoteConverter, &body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	resp, err := (&http.Client{Timeout: 150 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("转换服务不可用：%v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return nil, fmt.Errorf("转换服务 %d：%s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	pdf, err := io.ReadAll(io.LimitReader(resp.Body, maxUpload*3))
	if err != nil {
		return nil, err
	}
	if len(pdf) == 0 {
		return nil, fmt.Errorf("转换服务返回了空文件")
	}
	return pdf, nil
}

func explainHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	var in explainRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 12<<20)).Decode(&in); err != nil {
		jsonError(w, 400, err)
		return
	}
	if in.Config.Key == "" || in.Config.Model == "" {
		jsonError(w, 400, fmt.Errorf("请先填写 API Key 和模型名称"))
		return
	}
	endpoint, err := chatEndpoint(in.Config.Base)
	if err != nil {
		jsonError(w, 400, err)
		return
	}

	detail := "详细模式：逐步解释概念、公式符号、推导直觉和一个例子。"
	if in.Mode == "brief" {
		detail = "概括模式：用简洁语言解释，最多约 200 字。"
	}
	prompt := fmt.Sprintf(
		"请用中文帮助大学生理解以下课堂内容。%s保留关键英文术语；数学用 LaTeX，行内 $...$，块级 $$...$$。不要编造看不清或缺失的公式。最后给出一句可直接写入文档的学习批注，以“批注：”开头。\n%s",
		detail, truncate(in.Text, maxPromptRunes))

	var content any = prompt
	if in.Image != "" {
		content = []any{
			map[string]string{"type": "text", "text": prompt},
			map[string]any{"type": "image_url", "image_url": map[string]string{"url": in.Image}},
		}
	}

	messages := []any{}
	for _, m := range trimHistory(in.History) {
		messages = append(messages, map[string]string{"role": m.Role, "content": m.Content})
	}
	messages = append(messages, map[string]any{"role": "user", "content": content})

	payload := map[string]any{"model": in.Config.Model, "messages": messages, "stream": true}
	body, err := json.Marshal(payload)
	if err != nil {
		jsonError(w, 500, err)
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), "POST", endpoint, bytes.NewReader(body))
	if err != nil {
		jsonError(w, 500, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+in.Config.Key)
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		jsonError(w, 502, fmt.Errorf("连接模型服务失败：%v", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1000))
		jsonError(w, 502, fmt.Errorf("模型服务 %d：%s", resp.StatusCode, strings.TrimSpace(string(b))))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	if flusher != nil {
		flusher.Flush()
	}
	buf := make([]byte, 32*1024)
	for {
		n, e := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				break
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if e != nil {
			break
		}
	}
}

// modelsHandler checks that the configured endpoint and key actually work.
func modelsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonError(w, 405, fmt.Errorf("method not allowed"))
		return
	}
	var in explainRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		jsonError(w, 400, err)
		return
	}
	if in.Config.Key == "" || in.Config.Model == "" {
		jsonError(w, 400, fmt.Errorf("请先填写 API Key 和模型名称"))
		return
	}
	base, err := normalizeBase(in.Config.Base)
	if err != nil {
		jsonError(w, 400, err)
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}
	req, _ := http.NewRequestWithContext(r.Context(), "GET", base+"/models", nil)
	req.Header.Set("Authorization", "Bearer "+in.Config.Key)
	resp, err := client.Do(req)
	if err != nil {
		jsonError(w, 502, fmt.Errorf("连接失败：%v", err))
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 400))
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			jsonError(w, 400, fmt.Errorf("鉴权失败（HTTP %d），请检查 API Key", resp.StatusCode))
			return
		}
		// Many OpenAI-compatible gateways do not expose /models; that is not fatal.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":     true,
			"detail": fmt.Sprintf("服务可达（/models 返回 %d）%s", resp.StatusCode, strings.TrimSpace(string(b))),
		})
		return
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&parsed)
	ids := make([]string, 0, 6)
	for i, m := range parsed.Data {
		if i >= 6 {
			break
		}
		ids = append(ids, m.ID)
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "models": ids})
}

// normalizeBase trims a trailing slash and rejects anything that is not HTTP(S).
// Both "https://host" and "https://host/v1" are accepted.
func normalizeBase(base string) (string, error) {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		return "", fmt.Errorf("请填写 API Base URL")
	}
	u, err := url.Parse(base)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", fmt.Errorf("地址必须为 HTTP 或 HTTPS")
	}
	return base, nil
}

func chatEndpoint(base string) (string, error) {
	normalized, err := normalizeBase(base)
	if err != nil {
		return "", err
	}
	return normalized + "/chat/completions", nil
}

func trimHistory(history []message) []message {
	kept := make([]message, 0, len(history))
	budget := maxHistoryRunes
	for i := len(history) - 1; i >= 0; i-- {
		m := history[i]
		if m.Role != "user" && m.Role != "assistant" {
			continue
		}
		content := truncate(m.Content, 4000)
		length := len([]rune(content))
		if length > budget {
			break
		}
		budget -= length
		kept = append([]message{{Role: m.Role, Content: content}}, kept...)
	}
	return kept
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}
