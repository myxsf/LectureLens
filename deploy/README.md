# 部署

两个镜像，各自独立：

| 镜像 | 内容 | 作用 |
| --- | --- | --- |
| `deploy/converter.Dockerfile` | Alpine + LibreOffice + 一个 Node 转换服务（`converter-server.mjs`） | 把 PPT/PPTX/ODP 转成 PDF，唯一需要重量级依赖的地方 |
| `deploy/app.Dockerfile` | 前端构建产物 + Go 服务 | 提供网页与 API，**不含 LibreOffice** |

## 用法

```bash
docker compose up -d converter                     # :8000
REMOTE_CONVERT_URL=http://127.0.0.1:8000/convert ./lecturelens
```

或整栈：

```bash
docker compose --profile app up --build             # :3001
```

## 转换服务接口

```
GET  /health   -> {"ok":true,"soffice":"/usr/bin/soffice"}
POST /convert  multipart 字段 file -> application/pdf
```

环境变量：`PORT`、`SOFFICE_PATH`、`MAX_UPLOAD_MB`、`CONVERT_TIMEOUT_MS`。

## 为什么拆开

- 网页服务器保持小体积、快启动、易扩容；LibreOffice 只在转换服务里。
- 转换服务可以单独横向扩容、限流、加鉴权（放在内网或用反向代理挡在前面）。
- 用户端零安装：浏览器上传即可，前三步都不通时前端还有内置渲染器兜底。
