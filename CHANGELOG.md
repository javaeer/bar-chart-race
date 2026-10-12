# 更新日志（Changelog）

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 规范，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)（SemVer）。

## [1.0.0] - 2024-10-12

### 初始发布

零依赖、纯 Canvas 2D 的动态排序条形竞赛图（Bar Chart Race）工具。

#### 新增

- **连续时间采样引擎**：动画建模为纯函数 `f(frameIndex, u)`，原生支持 seek / 变速 / 倒放 / 循环，且每帧结果恒定（视频录制无时长漂移）
- **名次与显示条数 n 解耦**：拖动"显示条目"滑杆即时生效，无需重建帧
- **候选集剪枝**：预求 top-(n+guard) 并集作为候选，渲染成本与数据总量解耦（4000 参赛者 → 候选 1.23%）
- **数据格式自动识别**：CSV 长表 / 宽表自动归一，列名中英文别名映射（date/name/value/category 及中文同义词）
- **伪 3D 柱体**：厚度挤出 + 竖向渐变 + 顶部高光 + 底部暗边，连续可调
- **柱头徽标**：emoji / 图片 URL / 分类·国家映射 / 首字圆牌，缺字体时自动降级
- **多主题**：tech / cyber / dark / light / gradient / paper，科技主题含 glow / dot / accent / mono
- **视频导出工作流**：MediaRecorder 录制（WebM/VP9）、PNG 帧序列 ZIP（零依赖 writer）、当前帧 2× 超采样截图、`postprocess` 转码 MP4/GIF
- **9:16 竖版**：1080×1920 预设，面向信息流短视频
- **单文件打包**：`build:standalone` 把 src + CSS + 示例数据内联为可 `file://` 运行的 HTML
- **内置数据集**：Interbrand 品牌价值（长表）、城市人口（宽表）

[1.0.0]: https://github.com/javaeer/bar-chart-race/releases/tag/v1.0.0
