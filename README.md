# Bar Chart Race Studio

Flourish「Bar Chart Race」的**零依赖开源复刻**：算法源自 Observable 上 Mike Bostock 的
[@d3/bar-chart-race](https://observablehq.com/@d3/bar-chart-race-explained)（ISC License），
在其数学基础上做了三项工程化升级 —— **连续时间采样、名次与条目数解耦、候选集剪枝**。

纯 Canvas 2D 渲染，无任何运行时依赖，浏览器直接跑；专为**短视频制作**增加了
视频录制、PNG 帧序列导出、9:16 竖版等能力。

![样片](preview/brands.mp4)

---

## 快速开始

```bash
npm start            # 启动本地服务器 → http://localhost:5174
npm test             # 核心引擎 41 项正确性测试
npm run verify       # 无头浏览器端到端渲染验证 + 自动合成样片
npm run postprocess -- 录制.webm -o 成片.mp4   # 转 MP4 / GIF
```

> 源码版必须通过 HTTP 访问（ES modules 与 fetch 受同源策略约束），不能用 `file://` 直接打开。

### 下载后怎么跑

**方式 A · 零安装（推荐）**：双击 `dist/bar-chart-race-standalone.html`。
这是由打包脚本生成的单文件版，所有 JS/CSS/示例数据已内联，
浏览器默认安全策略下即可运行，改数据用页面里的「上传 CSV」或直接拖文件进去。

**方式 B · 开发模式**（可改源码、热改参数、跑测试）：

```bash
# Windows：双击 start.bat
# macOS：双击 start.command
# Linux / 终端：./start.sh
```

脚本会检查 Node.js 并自动打开浏览器；没有 Node 时提示改用方式 A。
装好依赖后也可以 `npm start` / `npm test`。

**方式 A → B 的区别**：单文件版是把 `src/` 打包成一个 IIFE，**不支持直接改源码**；
要改代码请用方式 B，改完执行 `npm run build:standalone` 重新生成单文件版。

## 它是怎么工作的

### 1. 数据整形

任意 CSV（长表 / 宽表自动识别）被归一成记录流，再聚合成数值矩阵：

```
长表: date,name,category,value     宽表: name,1990,1991,1992
      2000,Coca-Cola,Beverages,72537     广东,1559,1780,2293
```

```
observations[t][nameIndex]   // T 个观测点 × N 个名字的稠密矩阵
```

### 2. 关键帧插值（D3 原版核心）

相邻两个观测点之间线性插值出 `k` 帧，总帧数 `(T-1)·k + 1`。
每一帧对**全部名字**的值做 `lerp(a, b, t)`，再按值排序得到名次。
因为所有数值都在线性插值，条形的生长、轴的推移、名次的交换天然平滑——
这就是 bar chart race「顺滑感」的全部秘密。

### 3. 名次语义：一条公式统一 enter / update / exit

D3 原版用三段 join 逻辑分别处理进榜、在榜、出榜。观察后会发现它们其实共享同一条公式：

```
rank = min(n, globalRank)
```

- **在榜**：`globalRank < n`，正常绘制
- **进榜**：上一帧 `globalRank ≥ n` ⇒ 起点压在榜单下沿，从边缘滑入
- **出榜**：下一帧 `globalRank ≥ n` ⇒ 终点滑向边缘后消失

于是三种情形合成一条代码路径，也让下面的「解耦」成为可能。

### 4. 升级一：连续时间采样（可 seek 的关键）

D3 原版靠 `d3-transition` 排队推进，只能顺序播放。这里把动画建模成**纯函数**：

```
f(frameIndex, u) → { date, xMax, bars[] }
```

`position` 是一个浮点帧索引，`floor` 出帧号、小数部分作为帧内进度。
于是 seek、变速、倒放、循环全是赋值语句；更重要的是——**同一位置永远渲染出
同一张图**，录制视频时不会因掉帧产生时长漂移。

### 5. 升级二：名次与 n 解耦

原版关键帧里写死 `rank = min(n, i)`，改一次显示条数就要重建全部帧。
这里每帧只存全局名次，`min(n, ·)` 在采样时现场算 —— 拖动「显示条目」滑杆即时生效。

### 6. 升级三：候选集剪枝（扛住大数据的关键）

真正挤进过榜首区的名字远少于全体。预先求「所有观测点 top-(n+guard) 的并集」
作为候选（快速选择，O(N)），后续所有排序只在候选上做：

```
4000 个参赛者 → 候选集 49 个（1.23%），单帧采样 0.036ms
```

渲染成本与数据总量解耦，只跟显示条目数有关。

### 7. 为什么是 Canvas 而不是 SVG

| | SVG + d3-transition（原版） | Canvas 2D（本实现) |
|---|---|---|
| 录制视频 | 需序列化→img→canvas，字体跨域常翻车 | `captureStream()` 直通 MediaRecorder |
| seek / 变速 | 不支持（transition 队列） | 天然支持（纯函数采样） |
| 帧确定性 | 掉帧即漂移 | 每帧结果恒定 |
| 规模 | DOM 节点数 = 条目数 | 恒定，与 n 线性、与总量无关 |

代价是文字排版要自己算，用文本宽度缓存把 `measureText` 的开销压回去。

## 数据格式

- **列名自动识别**：`date/时间/年份`、`name/名称/省份`、`value/数值/GDP`、`category/分类/国家`
- **日期格式**：`2023` / `2023-01` / `2023-01-01` / `2023Q1` / `2023年3月` 均可
- **图片标记**：加一列 `image`（URL），条形起点会绘制图标/国旗
- 缺失值记 0；同一 (日期，名字) 重复时取较大值；也可以直接把 Flourish 的导出 CSV 拖进来

## 导出工作流（短视频）

1. **录制视频** —— MediaRecorder 按真实时间推进（WebM/VP9），时长与设定精确一致
2. **帧序列 ZIP** —— PNG 序列打包（内置零依赖 ZIP writer），进剪辑软件精修或逐帧后期
3. **当前帧 PNG** —— 2× 超采样，做封面
4. `npm run postprocess` —— WebM→MP4(H.264)/GIF，编码器按本机 ffmpeg 能力自动挑选

9:16 竖版（1080×1920）+ Vivid 高对比色板 + 深色渐变背景，是专为信息流短视频准备的组合。

## 目录结构

```
src/
  core/
    keyframes.js    ★ 核心引擎：插值、名次、采样、剪枝
    csv.js          RFC4180 解析 + 长宽表识别 + 类型推断
    format.js       千分位 / SI / 中文单位 / UTC 日期
    math.js         lerp、ticks、缓动
    color.js        6 套色板 + 感知亮度对比色
    zip.js          零依赖 ZIP（store）打包器
  render/
    renderer.js     Canvas 渲染器：三种标签布局、裁剪、淡出
  player.js         虚拟时钟播放器（seek/变速/离线渲染）
  exporter.js       MediaRecorder / 帧序列 / 截图
  main.js           控制台装配
scripts/
  serve.js            零依赖静态服务器
  build-standalone.js 单文件打包器（src+css+csv → dist/*.html）
  verify.js           无头端到端验证 → PNG → ffmpeg 合成样片
  postprocess.js      转码 CLI（MP4 / GIF）
  ffmpeg-util.js      编码器探测与回退（libx264 → libopenh264 → …）
start.bat / start.command / start.sh
                      免命令行启动（自动开浏览器）
dist/                 构建产物（单文件版）
test/model.test.js    41 项正确性测试
```

## 测试覆盖了什么

- **保真**：全部 20 个年份的整数帧榜首与原始数据逐一比对
- **连续**：相邻帧边界 Δ值/Δ名次 = 0（动画不跳变）
- **剪枝等价**：剪枝版与全量排序版结果零差异（品牌集 672 抽样 + 4000 参赛者合成集）
- **可复现**：同数据重复构建，采样结果逐项一致（录像确定性的前提）
- **健壮**：越界索引、u>1、n 超过总数、单观测点、升序模式

## 致谢

- [Mike Bostock / Observable](https://observablehq.com/@d3/bar-chart-race-explained) —— 原始算法（ISC）
- [Flourish](https://flourish.studio/visualisations/bar-chart-race/) —— 产品形态参考
- 数据：Interbrand（品牌价值）、Chandler (1987) & UN (2018)（城市人口）
