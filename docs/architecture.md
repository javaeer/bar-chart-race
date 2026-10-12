# 架构（Architecture）

本文档说明 `bar-chart-race` 的核心引擎设计与关键工程决策。所有模块位于 `src/`，
零运行时依赖，仅用浏览器 Canvas 2D 与 Node 内置模块。

## 1. 数据管线

```
CSV 文件 → csv.js（解析 + 长宽表识别）→ 观测流 → 稠密矩阵 observations[t][name]
                                                              ↓
                                              keyframes.js（插值 / 名次 / 采样 / 剪枝）
                                                              ↓
                                       player.js（虚拟时钟）→ renderer.js（Canvas 绘制）
                                                              ↓
                                       exporter.js（MediaRecorder / 帧序列 / 截图）
```

### CSV 解析（`src/core/csv.js`）

- 遵循 **RFC 4180**（引号转义、逗号/换行在引号内保留）
- **长表 / 宽表自动识别**：扫描表头判断是按行一条观测（长表 `date,name,category,value`）
  还是一行一个参赛者（宽表 `name,1990,1991,…`）
- **类型推断**：日期列识别为时间轴、数值列识别为 `number`、其余为分类/标签
- **列名中英文别名**：`date/时间/年份`、`name/名称/省份`、`value/数值/GDP`、`category/分类/国家`

## 2. 三大升级

### 2.1 连续时间采样（可 seek 的关键）

D3 原版靠 `d3-transition` 排队推进，只能顺序播放。本实现把动画建模为纯函数：

```
f(frameIndex, u) → { date, xMax, bars[] }
```

- `position` 是浮点帧索引，`floor` 出帧号、小数部分作为帧内进度
- seek / 变速 / 倒放 / 循环全是赋值语句
- **同一位置永远渲染同一张图** → 录制视频无掉帧时长漂移

### 2.2 名次与显示条数 n 解耦

原版关键帧写死 `rank = min(n, i)`，改一次显示条数需重建全部帧。本实现每帧只存
**全局名次**，`min(n, ·)` 在采样时现场算 → 拖动「显示条目」滑杆即时生效。

### 2.3 候选集剪枝（扛住大数据）

真正挤进过榜首区的名字远少于全体。预先求「所有观测点 top-(n+guard) 并集」作为候选
（快速选择 O(N)），后续排序只在候选上做：

```
4000 参赛者 → 候选集 49（1.23%），单帧采样 0.036ms
```

渲染成本与数据总量解耦，只跟显示条目数 `n` 有关。

## 3. 名次语义统一

`rank = min(n, globalRank)` 一条公式统一 enter / update / exit：

- 在榜：`globalRank < n` 正常绘制
- 进榜：上一帧 `globalRank ≥ n` ⇒ 起点压榜单下沿，从边缘滑入
- 出榜：下一帧 `globalRank ≥ n` ⇒ 终点滑向边缘后消失

## 4. 为什么是 Canvas 而不是 SVG

| | SVG + d3-transition（原版） | Canvas 2D（本实现） |
|---|---|---|
| 录制视频 | 序列化→img→canvas，字体跨域常翻车 | `captureStream()` 直通 MediaRecorder |
| seek / 变速 | 不支持 | 天然支持（纯函数采样） |
| 帧确定性 | 掉帧即漂移 | 每帧结果恒定 |
| 规模 | DOM 节点数 = 条目数 | 恒定，与 n 线性、与总量无关 |

代价：文字排版自算，用文本宽度缓存把 `measureText` 开销压回。

## 5. 视觉进阶

### 伪 3D 柱体

厚度挤出 + 竖向渐变 + 顶部高光 + 底部暗边四层叠加，`depth3D` 从 0 到 1 连续可调，
厚度从行高内扣除，永不压行。

### 柱头徽标（`src/core/icons.js`）

图标来源优先级：CSV `icon`/`image` 列（emoji 或图片 URL）→ 分类/国家映射 →
名称关键词 → 首字圆牌。系统缺 emoji 字体时自动降级成首字圆牌，不出现「豆腐块」。

## 6. 单文件打包（`scripts/build-standalone.js`）

把 `src/` 的 ES modules、CSS、示例 CSV 全部内联进一个 HTML：

- **完整性校验**：扫描 `src` 下所有相对 import，确认每个被引用文件都在打包清单 `ORDER` 中
- **顶层重名检测**：各模块拼进同一 IIFE 后，`const` 重复声明是 SyntaxError，提前查重
- **CSV 内联**：打包期把 `data/*.csv` 作为字符串注入 `DATASETS`，避免运行时 fetch（file:// 受限）
- 产物 `dist/bar-chart-race-standalone.html` 双击即可在 `file://` 下运行

> 单文件版**不支持直接改源码**；改代码请用开发模式，改完重跑 `npm run build:standalone`。
