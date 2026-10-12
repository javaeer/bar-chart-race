# 常见问题（FAQ）

### 为什么直接双击 `index.html`（源码版）是白屏？

源码版用 ES modules 与 `fetch` 加载 CSV，二者都受浏览器同源策略约束，
`file://` 协议下会被拦截。两种解决方式：

- 用**单文件版** `dist/bar-chart-race-standalone.html`（数据已内联，`file://` 可跑）
- 或开发模式 `npm start` 走 HTTP（`http://localhost:5173`）

### 中文显示成方块 / 乱码？

- 页面 UI 用系统中文字体；Linux 服务器 / CI 需装 `fonts-noto-cjk`
- 自己编辑 CSV 时请用 UTF-8（模板带 BOM，Excel / WPS 打开不乱码）

### 视频录制 / `verify` 失败？

- 浏览器需支持 `MediaRecorder` + `captureStream()`（现代 Chromium / Firefox 均支持）
- `verify` 还需系统安装 `chromium`/`chromium-browser` 与 `ffmpeg`
- CI 用 `npm run verify -- --chrome=chromium-browser`，注意包名

### 数据量很大时卡顿？

- 渲染成本只跟**显示条目数 `n`** 有关，与数据总量解耦（候选集剪枝）
- 调小「显示条目」滑杆可显著降低单帧开销
- 超大数据集建议先用宽表并控制时间点数

### 怎么换成我自己的数据？

- 单文件版：页面顶栏「上传数据」按钮，或直接拖 CSV 进去
- 开发模式：把 CSV 放入 `data/`，并在 `src/main.js` 的 `DATASETS` 注册
- 格式见 [data-format.md](data-format.md)

### 单文件版能改源码吗？

不能。单文件版是 `src/` 打包后的 IIFE。要改代码：开发模式修改 `src/`，
再 `npm run build:standalone` 重新生成。

### CI 红了怎么排查？

- `unit` 失败：`npm test` 本地复现（纯 Node，无需浏览器）
- `qa` 失败：本地装 `chromium-browser + ffmpeg + fonts-noto-cjk`，跑
  `npm run verify -- --chrome=chromium-browser`
- Pages 部署 404：确认仓库 `Settings → Pages → Source` 选 **GitHub Actions**

### 如何发布新版本？

打 `v*` tag 推送即触发 `release.yml`：自动跑测试、构建单文件版，并创建
GitHub Release 附 `dist/bar-chart-race-standalone.html`，Release Notes 从
`CHANGELOG.md` 提取。
