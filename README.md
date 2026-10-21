# LectureLens 课堂学习助手

本地优先的课件学习工具：读 PDF/PPT，选中内容让 AI 用中文讲解，把笔记**写回课件页面**并导出带批注的 PDF。

React 19 + Vite 前端，Go 标准库后端，PDF.js 阅读器，KaTeX 数学渲染，pdf-lib 原生批注导出。

## 本地使用

```bash
npm install
npm run build          # 打包前端到 dist/
go build -o lecturelens .
./start.command        # 或 ./lecturelens，打开 http://127.0.0.1:3001
```

开发模式：一个终端 `npm run server`（Go 服务），另一个终端 `npm run dev`（Vite，http://127.0.0.1:5173，自动代理 `/api`）。

## 使用流程

1. 上传 PDF / PPT / PPTX / ODP（PPT 由本机 LibreOffice 转 PDF）。
2. 「⚙ 模型设置」填写 Base URL、模型名与 API Key，可点「测试连接」验证。
3. 左侧选文字（或在文本框中直接提问），选择概括 / 详细，点「帮我理解」。
4. 编辑生成的学习笔记，点「写入课件」。之后想改：**双击那张批注卡**（或在批注列表点 ✎）重新编辑，保存后原地更新，不会新增一条。
6. 批注卡可以拖动：按住标题栏拖到任意位置；短标题选区的批注默认贴在选区右侧，正文段落的批注贴在选区下方。批注会钉在**你选中的位置**：短标题放右侧、正文段落放正下方，都不遮住被讲的那一行。
5. 「保存到 PDF 文件」把批注作为可见卡片写进原文档；原始文件不受影响，可另行下载。批注页签右上角的下载图标导出 Markdown 清单，用于复习。

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `←` / `→`（或 PageUp / PageDown） | 上一页 / 下一页 |
| `⌘F` / `Ctrl+F` | 打开课件搜索，`Enter` 下一个结果，`Shift+Enter` 上一个 |
| `Esc` | 关闭搜索、设置或侧栏 |
| `⌘↵` / `Ctrl+↵` | 在「追问」中发送 |
| 双击页面空白处 | 在该位置新建批注 |
| 双击批注卡（或点卡片上的 ✎） | 重新编辑这条批注的文字、颜色、字号 |
| 拖动批注卡标题栏 | 移动到别的位置（拖动时按卡片实际大小做边界约束，不会滑出页面；右下角可调整大小） |

## 成本与重复请求

同一段内容 + 同一个问题在同一份文档里只会请求模型一次；再次点击「帮我理解」直接复用上次结果并提示「用了缓存」，不会重复计费。换一份文档或刷新页面后缓存清空。

## 数据与隐私

- 文档、批注、对话都存在浏览器 IndexedDB（`lecturelens`），可以在首页「最近打开」里继续或删除。
- API Key 只保存在页面内存，刷新后需重新填写；地址、模型、主题存在 localStorage。
- 仅监听 `127.0.0.1`，不会对外提供服务；只有被选中的文字或框选截图会发送到你自己配置的模型端点。

## 界面

设计方向是「学者的校勘桌面」：暖纸色底、衬线正文（Songti SC / PT Serif）、发丝级墨线代替圆角卡片，深青墨色作唯一强调色，批注用赭石黄便签纸。没有渐变图标块、点阵背景和胶囊按钮。深色主题是夜间阅读用的暖炭色，批注纸在深色下改成浅沙色以保证可读性。

- 版面：左栏是**目录**（页码 + 缩略图 + 批注数），中间是**纸张版面**，右栏是**页边批注栏**（讲解 / 追问 / 批注）。
- 交互：按钮默认无边框、悬停才浮出底色；选项卡是下划线；翻页与缩放是页码数字，不是控件盒子。
- 动效克制：纸张入场有 0.34s 的轻微落定，其余只有悬停与生成光标；`prefers-reduced-motion` 下全部关闭。

截图见 [docs/screenshots](docs/screenshots)。

## 项目结构

```
src/
  main.jsx                 入口：样式与根渲染
  App.jsx                  应用外壳、状态与流程编排
  components/              PdfPage / Rail / Thumbnail / Assistant / NotesPanel / SearchPanel / Settings / Toasts / Icon
  lib/
    api.js                 转换、流式讲解、连接测试（统一错误文案）
    annotations.js         批注写入 / 读回 PDF
    note-image.js          把批注卡栅格化为 PNG（导出时保持与屏幕一致）
    storage.js             IndexedDB 持久化
    useSearch.js           全文搜索与文本层高亮
    hooks.js               useShortcuts / usePersistentState / useFocusTrap / useMediaQuery
    text.js                纯函数工具
    pptx/                  内置 PowerPoint 渲染器（zip → XML → 排版 → 画布 + PDF）
  styles.css               设计令牌 + 布局 + 组件样式（含深色主题）
server.go                  Go 服务：静态资源、/api/convert、/api/explain、/api/models
deploy/                    转换服务镜像与 App 镜像（自部署用，见下）
test/                      node:test 单元测试（批注往返、PPTX 解析、工具函数）
```

## 测试

```bash
npm test        # 批注导出/读回、PPTX 解析与排版、工具函数
```

测试只使用仓库内的固定样本（`assets/demo-multi.pdf`、`test/fixtures/deck.pptx`），任何机器上都能运行，不需要 LibreOffice。

## PPT / PPTX 的三种处理方式

上传 `.pptx` 时，服务端会**依次尝试**，任何一环可用即可，不需要用户安装任何东西：

| 顺序 | 方式 | 适用场景 | 保真度 |
| --- | --- | --- | --- |
| 1 | `REMOTE_CONVERT_URL` 指向的**转换服务**（本仓库 `deploy/`，容器内跑 LibreOffice） | 线上部署 | 与原文件一致 |
| 2 | 本机 LibreOffice（自动探测常见安装路径，可用 `SOFFICE_PATH` 指定） | 个人电脑已装 | 与原文件一致 |
| 3 | **内置渲染器**（浏览器里直接解析 pptx：zip → XML → 母版继承 → 排版 → 画布 → 含文本层 PDF） | 什么都没装 | 母版/版式的背景、图形、图片、贝塞尔曲线、主题色、占位符位置全部保留；图表、SmartArt、嵌入对象只画占位框 |

内置渲染器产出的仍是**标准 PDF**：文字可选中、可搜索、可批注、可导出。`.ppt`（旧二进制格式）与 `.odp` 只有前两种方式能处理，这时会明确提示。

### 内置渲染器支持到什么程度

已对齐 OOXML 的继承与绘制规则：

- **继承链**：slide → slideLayout → slideMaster，母版在最底层、版式居中、slide 自己的形状在最上层；slide 覆盖的占位符会替换继承版本，版式里那些"Click to edit…"提示型占位符不会绘制。
- **背景**：`p:bg`（在 `p:cSld` 内）的**纯色 / 渐变 / 图片**都支持——模板常把整页照片做成 `a:blipFill` 背景，这是"封面照片不见了"的常见原因；另外全幅内缩的背景板形状也会先铺底。
- **层级**：master → layout → slide 逐层绘制，每层内部"全幅底衬先于该层内容"，所以 slide 的正文不会被自己的底板盖住，继承的照片也不会被继承的底板盖住。
- **透明度**：`a:alpha`（如 70% 的波浪叠在照片上）会解析为 `rgba()` 并正确混合，不再当成不透明纯色把底图盖死。
- **形状**：矩形、圆角矩形、椭圆、任意多边形；`a:custGeom` 的 `moveTo/lnTo/cubicBezTo/quadBezTo/close` 都按贝塞尔曲线绘制（模板的标准波浪、弧形底衬就是靠这个）。
- **颜色**：`srgbClr`、`schemeClr`（含 `tx1/bg1/tx2/bg2` 别名与 tint/shade）、`prstClr`；未指定颜色的描边按"无边框"处理，避免把模板描成黑线。
- **文字**：层级字号/粗斜体/颜色/字体、项目符号、对齐、`bodyPr` 锚点、表格文字。

仍然不画的：图表（`ppt/charts`）、SmartArt 的布局算法、OLE 嵌入对象、动画与切换。这些会在导入提示里明确列出数量，请对照原文件查看。

### 部署（推荐）

```bash
docker compose up -d converter                 # 起一个转换服务 :8000
REMOTE_CONVERT_URL=http://127.0.0.1:8000/convert ./lecturelens
```

整栈也可以直接跑在容器里（App 镜像里**不含** LibreOffice）：

```bash
docker compose --profile app up --build        # http://localhost:3001
```

服务端环境变量：`DIST_DIR`、`ASSETS_DIR`、`ADDR`、`REMOTE_CONVERT_URL`。
转换服务健康检查：`curl http://127.0.0.1:8000/health`。

## 当前边界

- 三种 PPT 路径如上；只有前两种能做到像素级一致，内置渲染器对复杂版式是"可读优先"。
- 仍然**不会回写 .pptx**：批注始终写在 PDF 上，原始 PPTX 可另行下载（顶栏小下载图标）。
- 批注以 PDF 注释对象保存，不会回写可编辑 PPTX，也不包含演示动画；导出文件中的批注卡是图片，因此在阅读器里外观固定、不可再编辑。
- 框选截图需要支持图像的模型；DeepSeek chat 只支持文字。
- 深色主题针对界面；PDF 页面本身保持原色，不做反色。
