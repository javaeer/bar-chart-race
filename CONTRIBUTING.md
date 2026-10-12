# 贡献指南（Contributing）

感谢你考虑为 **Bar Chart Race Studio** 做出贡献。本项目是零运行时依赖的纯 Canvas 2D 实现，工程结构刻意保持小而可读，欢迎修复、增强与新数据集。

## 开发环境

- **Node.js ≥ 18**（仅用于本地服务器、测试、打包与验证；运行时本身不依赖任何 npm 包）
- 无需 `npm install`：`package.json` 的 `devDependencies` 为空，所有脚本仅用到 Node 内置模块

## 验证命令

| 命令 | 作用 |
|---|---|
| `npm start` | 启动零依赖静态服务器，打开 `http://localhost:5173`（源码版必须走 HTTP，不能用 `file://`） |
| `npm test` | 核心引擎 57 项正确性测试（保真 / 连续 / 剪枝等价 / 可复现 / 健壮） |
| `npm run verify` | 无头浏览器端到端渲染验证：按等距时间点渲染 40 帧 → 落盘 PNG → ffmpeg 合成 MP4/WebM/GIF |
| `npm run build:standalone` | 把 `src/` + CSS + 示例 CSV 内联成单文件 `dist/bar-chart-race-standalone.html` |
| `npm run postprocess -- 录制.webm -o 成片.mp4` | 转码 CLI（WebM → MP4/GIF） |

`scripts/verify.js` 常用参数：

```bash
node scripts/verify.js --dataset=cities   # 指定数据集（brands | cities）
node scripts/verify.js --frames=60         # 帧数
node scripts/verify.js --chrome=chromium   # 指定无头浏览器可执行文件
```

## 提交规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>
```

常用 `type`：`feat` / `fix` / `docs` / `refactor` / `perf` / `test` / `chore`。
示例：`fix(core): 修复单观测点下剪枝候选集为空的边界`、`feat(export): 支持 9:16 竖版导出`。

## Pull Request 自检清单

- [ ] `npm test` 全绿
- [ ] 若改动渲染/采样逻辑，`npm run verify` 通过（本地有 chromium + ffmpeg 时）
- [ ] 若改动打包逻辑，`npm run build:standalone` 产物可双击在 `file://` 下运行
- [ ] 公开可复现的数据集优先放入 `data/`，并补充来源与授权（见 `docs/data-format.md`）
- [ ] 变更有对应 `CHANGELOG.md` 记录
- [ ] 文档（README / `docs/`）与实际行为一致

## 目录结构速览

```
src/core/   引擎：csv / keyframes / format / color / icons / math / templates / zip
src/render/ Canvas 渲染器
src/        player（虚拟时钟）/ exporter（录制导出）/ main（装配）
scripts/    serve / build-standalone / verify / postprocess / ffmpeg-util
data/       内置 CSV 数据集（长表 / 宽表）
```

提交前无需 `npm install`，但请确保本地已通过 `npm test`。
