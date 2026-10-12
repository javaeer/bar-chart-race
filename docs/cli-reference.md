# CLI / 脚本参考（CLI Reference）

所有脚本位于 `scripts/`，仅依赖 Node.js 内置模块（无需 `npm install`）。
约定：`npm run <script>` 或 `node scripts/<file>.js [参数]`。

## npm 脚本

| 命令 | 对应脚本 | 作用 |
|---|---|---|
| `npm start` | `scripts/serve.js` | 零依赖静态服务器，`http://localhost:5173` |
| `npm test` | `test/model.test.js` | 核心引擎 57 项正确性测试 |
| `npm run verify` | `scripts/verify.js` | 无头浏览器端到端渲染验证 |
| `npm run postprocess` | `scripts/postprocess.js` | 转码 CLI（WebM → MP4 / GIF） |
| `npm run build:standalone` | `scripts/build-standalone.js` | 单文件打包 |

## serve.js

```bash
npm start
# 可选：node scripts/serve.js --port=8080
```
零依赖静态文件服务器，用于以 HTTP 访问源码版（ES modules / fetch 受同源策略约束）。

## verify.js（端到端渲染验证）

无头浏览器按等距时间点渲染 N 帧 → 转 PNG 落盘 → ffmpeg 合成 MP4/WebM/GIF，
并校验「帧非空且随时间变化」。

```bash
node scripts/verify.js                         # 默认 brands 数据集，40 帧
node scripts/verify.js --dataset=cities        # 指定数据集（brands | cities）
node scripts/verify.js --frames=60             # 帧数
node scripts/verify.js --out=/tmp/bcr           # 输出目录（默认 preview/）
node scripts/verify.js --chrome=chromium        # 指定无头浏览器可执行文件
```

> **CI 注意**：`verify.js` 的浏览器可执行文件**只认 `--chrome` 命令行参数**（不读环境变量）。
> Ubuntu 上包名为 `chromium-browser`，故 CI 用 `npm run verify -- --chrome=chromium-browser`。
> 该脚本还依赖 `ffmpeg`（合成视频）与中文字体（`fonts-noto-cjk`，页面 UI 含中文）。

## build-standalone.js（单文件打包）

```bash
npm run build:standalone
# 等价：node scripts/build-standalone.js
# 自定义输出：node scripts/build-standalone.js dist/my-build.html
```

把 `src/` + `styles/main.css` + `data/*.csv` 内联为单文件
`dist/bar-chart-race-standalone.html`，可 `file://` 双击运行。
打包前做完整性校验（缺失模块 / 顶层重名检测）。

## postprocess.js（转码）

```bash
npm run postprocess -- 录制.webm -o 成片.mp4
npm run postprocess -- 录制.webm -o 成片.gif
```

WebM → MP4(H.264) / GIF。编码器按本机 `ffmpeg` 能力自动挑选（见 `ffmpeg-util.js`）。

## ffmpeg-util.js（内部）

编码器探测与回退逻辑（`libx264 → libopenh264 → …`），被 `verify.js` 与
`postprocess.js` 复用，一般不直接调用。
