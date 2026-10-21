// Standalone PPT/PPTX/ODP -> PDF converter.
//
// Runs next to LibreOffice (container or VM) and exposes one endpoint:
//   POST /convert   multipart field "file"  ->  application/pdf
//   GET  /health    ->  {"ok":true,"soffice":"..."}
//
// The LectureLens server can proxy to it with REMOTE_CONVERT_URL, so deployments
// never require the end user (or the web server) to install anything.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const PORT = Number(process.env.PORT || 8000);
const SOFFICE = process.env.SOFFICE_PATH || 'soffice';
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024;
const ALLOWED = new Set(['.ppt', '.pptx', '.odp']);
const TIMEOUT_MS = Number(process.env.CONVERT_TIMEOUT_MS || 120000);

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('文件过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Minimal multipart parser: enough for a single file field.
function extractFile(body, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!boundary) throw new Error('缺少 multipart boundary');
  const delimiter = Buffer.from(`--${boundary[1] || boundary[2]}`);
  let start = body.indexOf(delimiter);
  if (start === -1) throw new Error('请求体不是有效的 multipart');

  while (start !== -1) {
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = body.slice(start, headerEnd).toString('utf8');
    const dataStart = headerEnd + 4;
    let next = body.indexOf(delimiter, dataStart);
    if (next === -1) next = body.length;
    const data = body.slice(dataStart, next - 2);
    const nameMatch = /filename="([^"]*)"/i.exec(headers);
    if (nameMatch) return { filename: nameMatch[1], data };
    start = next;
  }
  throw new Error('没有找到上传的文件');
}

async function convert(filename, data) {
  const extension = path.extname(filename).toLowerCase();
  if (!ALLOWED.has(extension)) throw new Error('只支持 PPT、PPTX、ODP 文件');

  const dir = await mkdtemp(path.join(tmpdir(), 'converter-'));
  try {
    const input = path.join(dir, `slides${extension}`);
    await writeFile(input, data);
    await run(
      SOFFICE,
      [
        `-env:UserInstallation=file://${dir}/profile`,
        '--headless',
        '--norestore',
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        input,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    const produced = (await readdir(dir)).find((name) => name.toLowerCase().endsWith('.pdf'));
    if (!produced) throw new Error('转换未生成 PDF');
    return await readFile(path.join(dir, produced));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await run(SOFFICE, ['--version'], { timeout: 20000 });
      return json(res, 200, { ok: true, soffice: SOFFICE });
    } catch (e) {
      return json(res, 503, { ok: false, error: `LibreOffice 不可用：${e.message}` });
    }
  }
  if (req.method !== 'POST' || req.url !== '/convert') return json(res, 404, { error: 'not found' });

  try {
    const body = await readBody(req, MAX_UPLOAD);
    const { filename, data } = extractFile(body, req.headers['content-type']);
    const pdf = await convert(filename, data);
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length });
    res.end(pdf);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`converter listening on :${PORT} (soffice: ${SOFFICE})`);
});
