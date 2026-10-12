# Bar Chart Race Studio

[![CI](https://github.com/javaeer/bar-chart-race/actions/workflows/ci.yml/badge.svg)](https://github.com/javaeer/bar-chart-race/actions/workflows/ci.yml)
[![CodeQL](https://github.com/javaeer/bar-chart-race/actions/workflows/codeql.yml/badge.svg)](https://github.com/javaeer/bar-chart-race/actions/workflows/codeql.yml)
[![Deploy Demo](https://github.com/javaeer/bar-chart-race/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/javaeer/bar-chart-race/actions/workflows/deploy-pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A **zero-dependency, open-source** reimplementation of Flourish's "Bar Chart Race",
built on Mike Bostock's [@d3/bar-chart-race](https://observablehq.com/@d3/bar-chart-race-explained)
(ISC License) with three engineering upgrades: **continuous-time sampling, rank/n
decoupling, and candidate pruning**.

Pure Canvas 2D rendering, no runtime dependencies, runs directly in the browser.
Built for **short-video production**: video recording, PNG frame-sequence export,
and 9:16 vertical output.

## 🎬 Live Demo

Open **[https://javaeer.github.io/bar-chart-race/](https://javaeer.github.io/bar-chart-race/)**
for the zero-install single-file build (deployed via GitHub Pages).

## Quick start

```bash
npm start            # local server → http://localhost:5173
npm test             # 57 engine correctness tests
npm run verify       # headless end-to-end render verification
npm run build:standalone   # bundle into dist/bar-chart-race-standalone.html
```

> The source build must be served over HTTP (ES modules + fetch are blocked under
> `file://`). This project has zero dependencies — `npm install` installs nothing.

### Two ways to run

- **Option A · Zero install (recommended)**: double-click `dist/bar-chart-race-standalone.html`
  (or use the Live Demo above). All JS/CSS/sample data are inlined.
- **Option B · Dev mode**: `npm start` / `npm test` / edit `src/`, then
  `npm run build:standalone` to regenerate the single-file build.

## How it works

The animation is modeled as a **pure function** `f(frameIndex, u) → { date, xMax, bars[] }`,
so seek / speed-change / reverse / loop are all assignments, and every frame is
deterministic (no duration drift when recording). Ranks are computed live with
`rank = min(n, globalRank)`, unifying enter/update/exit. A precomputed candidate
set (top-(n+guard) union across all time points) decouples render cost from total
data size.

See [docs/architecture.md](docs/architecture.md) for the full technical breakdown.

## Data format

Any CSV (long / wide table auto-detected). Columns are auto-recognized:

- `date` / `时间` / `年份`
- `name` / `名称` / `省份`
- `value` / `数值` / `GDP`
- `category` / `分类` / `国家`
- `icon` (optional): emoji or image URL for the bar-head badge

Full spec, alias tables, and dataset licensing: [docs/data-format.md](docs/data-format.md).

## Docs index

- [Architecture](docs/architecture.md) · [Data format](docs/data-format.md)
- [CLI reference](docs/cli-reference.md) · [FAQ](docs/faq.md)
- [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Acknowledgements

- Mike Bostock / Observable — original algorithm (ISC)
- Flourish — product inspiration
- Data: Interbrand (brand value), Chandler (1987) & UN (2018) (city populations)
