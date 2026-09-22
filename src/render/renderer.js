/**
 * Canvas 2D 渲染器
 * ==================================================================
 * 为什么不用 SVG / D3 的 DOM 模式（原版做法）：
 *
 *   · 录视频友好 —— canvas.captureStream() 可以直接接 MediaRecorder；
 *     SVG 要先序列化成 <img> 再画到 canvas，字体和跨域图片经常翻车。
 *   · 帧率可控   —— 每帧是一次完整的同步绘制，不存在 DOM reflow 抖动。
 *   · 像素确定   —— 同一 (fi, u) 永远得到同一张图，导出结果可复现。
 *   · 规模线性   —— 绘制成本只与显示条目数 n 有关，与数据总量无关。
 *
 * 代价是文字排版要自己算，这部分用文本宽度缓存把开销压回去。
 */

import { clamp, lerp, ticks } from "../core/math.js";
import { contrastText, hexToRgba, shade } from "../core/color.js";
import { iconFor, detectEmojiSupport, initial, EMOJI_FONT } from "../core/icons.js";

export const FONT_STACK =
  `-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, ` +
  `"Helvetica Neue", "Noto Sans SC", sans-serif`;

/** emoji 必须显式列出彩色字体，否则部分系统会退化成单色描边字形 —— 定义见 core/icons.js */

/** 科技风主题下数字用等宽字体：数值跳动时不会左右抖，也更有仪表盘味道 */
export const MONO_FONT =
  `"SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, ` +
  `"Roboto Mono", "DejaVu Sans Mono", monospace`;

export const DEFAULT_OPTIONS = {
  width: 1280,
  height: 720,
  dpr: 1,

  n: 12,
  barPadding: 0.12,      // 条形之间的留白比例
  plotPad: 0.35,         // 榜单下沿额外预留的行高（给进出榜的条形缓冲）
  barRadius: 0.28,       // 条形右端圆角（相对条高）
  barOpacity: 1,
  depth3D: 0.45,         // 伪 3D 挤出强度 0=纯平 1=厚重；厚度会占用行高，不会压到下一行

  // 文字区
  title: "",
  subtitle: "",
  footer: "",
  titleSize: 44,
  subtitleSize: 22,
  footerSize: 18,

  labelLayout: "inline", // inline | left | trail
  showValue: true,
  showAxis: true,
  showGrid: true,
  showTicker: true,
  showTotal: false,

  // 柱头徽标（图标）
  showImages: true,
  iconPosition: "front", // front=柱头外侧(默认) | inside=柱头内侧 | start=条形起点外侧 | none
  iconSize: 0.9,         // 相对条高
  imageSize: 0.75,       // 兼容旧参数：图片类徽标相对条高
  images: null,          // Map<name, HTMLImageElement>（icon 列是 URL 时才用）

  tickCount: 5,
  dateFormat: (d) => String(new Date(d).getUTCFullYear()),
  valueFormat: (v) => Math.round(v).toLocaleString("en-US"),

  theme: {
    background: "#ffffff",
    text: "#1f2933",
    subtext: "#6b7280",
    axis: "#9aa5b1",
    grid: "rgba(0,0,0,0.08)",
    ticker: "rgba(31,41,51,0.22)",
    tickerSize: 1.5,     // 相对行高
  },

  colorScale: null,
  fadeEdge: true,        // 榜单边缘的条形淡入淡出
};

export class RaceRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d");
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.options.theme = { ...DEFAULT_OPTIONS.theme, ...(options.theme || {}) };
    this._textCache = new Map();
    this._layout = null;
    this.resize(this.options.width, this.options.height, this.options.dpr);
  }

  set(opts) {
    this.options = { ...this.options, ...opts };
    if (opts.theme) this.options.theme = { ...this.options.theme, ...opts.theme };
    // 换数据集后同名 id 会指向另一个条目，图标缓存必须作废
    this._iconCache = null;
    if (opts.width || opts.height || opts.dpr) {
      this.resize(this.options.width, this.options.height, this.options.dpr);
    } else {
      this._layout = null;
    }
  }

  resize(width, height, dpr = 1) {
    this.options.width = width;
    this.options.height = height;
    this.options.dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = width + "px";
      this.canvas.style.height = height + "px";
    }
    this._layout = null;
    this._textCache.clear();
  }

  // ------------------------------------------------------------- 布局

  /** 依据当前宽度/行数计算一套静态布局；结果可缓存，只在参数变化时重算 */
  layout() {
    if (this._layout) return this._layout;
    const o = this.options;
    const th = o.theme;
    const W = o.width;
    const H = o.height;
    const pad = { top: H * 0.045, right: W * 0.03, bottom: H * 0.035, left: W * 0.03 };

    let top = pad.top;
    const titleSize = o.title ? o.titleSize : 0;
    const subtitleSize = o.subtitle ? o.subtitleSize : 0;
    if (o.title) top += titleSize * 1.25;
    if (o.subtitle) top += subtitleSize * 1.45;
    if (o.title || o.subtitle) top += H * 0.018;

    // 顶部坐标轴
    const axisLabelSize = Math.max(11, Math.min(18, H * 0.022));
    const axisHeight = o.showAxis ? axisLabelSize * 1.6 + 8 : 0;
    const plotTop = top + axisHeight;

    const n = Math.max(1, o.n);

    // 底部：footer 预留空间。
    // 日期角标不外扩空间 —— 它叠印在绘图区内部右下（Flourish 的做法），
    // 画在柱子下层，被柱子自然遮挡，既醒目又不与任何元素抢地盘。
    const footerPad = o.footer ? H * 0.05 : 0;
    const plotBottom = H - pad.bottom - footerPad;
    const plotHeight = Math.max(10, plotBottom - plotTop);

    const yStep = plotHeight / (n + o.plotPad);
    // 3D 的厚度从行高里扣，挤出方向朝下，因此永远不会压到下一行
    const depth = o.depth3D > 0 ? Math.max(1, yStep * 0.2 * o.depth3D) : 0;
    const barHeight = Math.max(2, yStep * (1 - o.barPadding) - depth);

    // 柱头徽标
    const iconSize = clamp(barHeight * o.iconSize, 9, Math.max(12, yStep * 0.95));
    const showIcon = o.showImages && o.iconPosition !== "none";
    // 徽标贴在柱头外侧时要给它留地方，否则最长的条形会把徽标顶出画布
    const iconReserve = showIcon && o.iconPosition === "front" ? iconSize * 0.8 + 6 : 0;

    // 左侧名字列
    const labelColumn = o.labelLayout === "left" ? W * 0.22 : 0;
    // 右侧数值列宽度（按最长数字估的保守值）
    const valueColumn = o.showValue ? Math.min(W * 0.2, Math.max(70, axisLabelSize * 5.5)) : 0;

    const plotLeft = pad.left + labelColumn;
    const plotRight = W - pad.right - valueColumn - iconReserve;
    const plotWidth = Math.max(20, plotRight - plotLeft);

    this._layout = {
      W, H, pad, plotTop, plotBottom, plotHeight, plotLeft, plotRight, plotWidth,
      yStep, barHeight, depth, iconSize, showIcon, axisLabelSize, titleSize, subtitleSize,
      labelColumn, valueColumn, n,
      tickerSize: Math.max(24, barHeight * th.tickerSize),
      labelSize: clamp(barHeight * 0.42, 11, Math.max(14, barHeight * 0.62)),
    };
    return this._layout;
  }

  // ------------------------------------------------------------- 绘制主流程

  /**
   * 绘制一帧
   * @param {{date:number,xMax:number,bars:Array,totalValue:number}} sample
   */
  draw(sample) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = this.options;
    const L = this.layout();
    const th = o.theme;

    ctx.save();
    ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);

    this._drawBackground(ctx, L);

    const x0 = L.plotLeft;
    const scaleX = (v) => x0 + clamp(v / sample.xMax, 0, 1.2) * L.plotWidth;
    const yOf = (rank) => L.plotTop + rank * L.yStep;

    // —— 轴：画在条形之下，作为背景参照 ——
    const tickValues = o.showAxis || o.showGrid ? ticks(sample.xMax, o.tickCount) : [];
    if (o.showGrid) this._drawGrid(ctx, L, scaleX, tickValues);
    if (o.showAxis) this._drawAxis(ctx, L, scaleX, tickValues);

    if (o.showTicker) this._drawTicker(ctx, L, sample);

    // —— 条形：裁剪到绘图区，让滑出榜单的条形自然消失 ——
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.plotLeft - 2, L.plotTop - 2, L.plotWidth + L.valueColumn + 4, L.plotHeight + 4);
    ctx.clip();

    // 先画 rank 大的，让靠前的条形压在上面
    const bars = sample.bars;
    for (let i = bars.length - 1; i >= 0; i--) {
      const bar = bars[i];
      const alpha = o.fadeEdge ? this._edgeAlpha(bar.rank, L.n) : 1;
      if (alpha <= 0.003) continue;
      this._drawBar(ctx, L, bar, scaleX, yOf, alpha);
    }
    ctx.restore();

    // 徽标画在裁剪区之外 —— "起点外侧"位置本来就在绘图区左边缘外，
    // 放进裁剪区会被整个切掉（这就是之前 start 模式图标消失的原因）。
    // front / inside 位置都在区内，不受影响。
    if (L.showIcon) {
      for (let i = bars.length - 1; i >= 0; i--) {
        const bar = bars[i];
        const alpha = o.fadeEdge ? this._edgeAlpha(bar.rank, L.n) : 1;
        if (alpha <= 0.003) continue;
        this._drawIcon(ctx, L, bar, scaleX, yOf, alpha);
      }
    }

    // 标签绘制在裁剪区外会更好看（允许名字溢出到左侧列）
    for (const bar of bars) {
      const alpha = o.fadeEdge ? this._edgeAlpha(bar.rank, L.n) : 1;
      if (alpha <= 0.003) continue;
      this._drawLabels(ctx, L, bar, scaleX, yOf, alpha);
    }

    if (o.title) this._drawTitle(ctx, L);
    if (o.footer) this._drawFooter(ctx, L);
    ctx.restore();
  }

  /** 榜单下沿之外逐渐隐去，避免“第 n+1 名”堆在边缘形成色块 */
  _edgeAlpha(rank, n) {
    return clamp(1 - (rank - (n - 0.85)), 0, 1);
  }

  // ------------------------------------------------------------- 各图层

  _drawBackground(ctx, L) {
    const th = this.options.theme;
    const bg = th.background;
    if (Array.isArray(bg)) {
      const g = ctx.createLinearGradient(0, 0, 0, L.H);
      bg.forEach((s, i) => g.addColorStop(i / (bg.length - 1), s));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, L.W, L.H);

    // 科技风点阵底纹：用 pattern 缓存，避免每帧上千次 fillRect
    if (th.dot) {
      const gap = Math.max(16, Math.round(L.H / 46));
      const pat = this._dotPattern(ctx, th.dot, gap);
      if (pat) {
        ctx.save();
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, L.W, L.H);
        ctx.restore();
      }
    }
  }

  /** 生成点阵 pattern（按 间距+颜色 缓存，尺寸变化时重建） */
  _dotPattern(ctx, color, gap) {
    if (this._dot?.gap === gap && this._dot?.color === color) return this._dot.pattern;
    const size = gap;
    const tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const c = tile.getContext("2d");
    if (!c) return null;
    c.fillStyle = color;
    c.fillRect(0, 0, 1.5, 1.5);
    this._dot = { gap, color, pattern: ctx.createPattern(tile, "repeat") };
    return this._dot.pattern;
  }

  _drawGrid(ctx, L, scaleX, tickValues) {
    const th = this.options.theme;
    ctx.save();
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    for (const t of tickValues) {
      const x = Math.round(scaleX(t)) + 0.5;
      if (x < L.plotLeft || x > L.plotRight) continue;
      ctx.beginPath();
      ctx.moveTo(x, L.plotTop - 6);
      ctx.lineTo(x, L.plotBottom);
      ctx.stroke();
    }
    // 科技风：绘图区顶部一条强调色基线，把所有竖线"钉"住，画面立刻有结构
    if (th.accent) {
      ctx.strokeStyle = hexToRgba(th.accent, 0.5);
      ctx.lineWidth = 1.5;
      if (th.glow) { ctx.shadowColor = hexToRgba(th.accent, 0.6); ctx.shadowBlur = 8; }
      ctx.beginPath();
      ctx.moveTo(L.plotLeft, L.plotTop - 0.5);
      ctx.lineTo(L.plotRight, L.plotTop - 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawAxis(ctx, L, scaleX, tickValues) {
    const th = this.options.theme;
    ctx.save();
    ctx.font = `500 ${L.axisLabelSize}px ${th.mono ? MONO_FONT : FONT_STACK}`;
    ctx.fillStyle = th.axis;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const t of tickValues) {
      const x = scaleX(t);
      if (x < L.plotLeft - 2 || x > L.plotRight + L.valueColumn) continue;
      ctx.fillText(this.options.valueFormat(t), x, L.plotTop - 10);
    }
    ctx.restore();
  }

  /**
   * 柱体。depth3D > 0 时走伪 3D 画法：
   * 厚度层（下移 depth 的暗色）+ 正面竖向渐变 + 顶部高光 + 底部暗边，
   * 四层叠加出"上表面受光、向下挤出"的体积感，比真 3D 便宜得多，
   * 而且完全在 Canvas 2D 里完成，录视频时零额外成本。
   */
  _drawBar(ctx, L, bar, scaleX, yOf, alpha) {
    const o = this.options;
    const y = yOf(bar.rank);
    const h = L.barHeight;
    const w = Math.max(0, scaleX(bar.value) - L.plotLeft);
    if (w < 0.5) return;
    const color = o.colorScale.colorOf(bar, Math.round(bar.rank));
    const r = Math.min(h / 2, w, h * o.barRadius);
    const d = L.depth;
    const x0 = L.plotLeft;

    const path = () => {
      ctx.beginPath();
      roundRectPath(ctx, x0, y, w, h, [0, r, r, 0]);
    };

    ctx.save();
    ctx.globalAlpha = alpha * o.barOpacity;

    // ① 挤出厚度：同形状向下偏移 d，用压暗的同色，视觉上就是柱体的"下沿"
    if (d > 0.4) {
      ctx.beginPath();
      roundRectPath(ctx, x0, y + d, w, h, [0, r, r, 0]);
      ctx.fillStyle = shade(color, -0.45);
      ctx.fill();
    }

    // ② 正面：顶亮底暗的竖向渐变（无 3D 时就是纯色，零开销）
    path();
    const glow = o.theme.glow || 0;
    if (glow > 0) {
      ctx.shadowColor = hexToRgba(color, 0.55 * glow);
      ctx.shadowBlur = Math.max(6, h * 0.6) * glow;
    }
    if (d > 0.4) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, shade(color, 0.32));
      g.addColorStop(0.5, shade(color, 0.04));
      g.addColorStop(1, shade(color, -0.22));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = color;
    }
    ctx.fill();
    // 发光只作用于柱体本身，后面的高光/暗边不能被糊掉
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    if (d > 0.4 && h > 3) {
      // ③ 顶部高光：模拟上表面反光，是立体感最关键的一笔
      ctx.save();
      path();
      ctx.clip();
      const hl = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
      hl.addColorStop(0, "rgba(255,255,255,0.36)");
      hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hl;
      ctx.fillRect(x0, y, w, h * 0.55);
      ctx.restore();

      // ④ 底部暗边：把正面与厚度层的交界压实
      ctx.save();
      path();
      ctx.clip();
      ctx.fillStyle = hexToRgba(shade(color, -0.55), 0.45);
      ctx.fillRect(x0, y + h - Math.max(1, h * 0.08), w, Math.max(1, h * 0.08));
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * 柱头徽标（图标）。
   * 三种形态：URL 图片 → 圆形裁切；emoji → 白色圆托；都没有 → 首字圆牌。
   * 位置默认骑在柱头上（条形末端），随柱子一起移动。
   */
  _drawIcon(ctx, L, bar, scaleX, yOf, alpha) {
    const o = this.options;
    const icon = this._iconOf(bar);
    // 值为 0 的条目不画柱子，也不该凭空挂一个圆牌
    if (!icon || !(bar.value > 0)) return;

    const h = L.barHeight;
    const size = L.iconSize;
    const r = size / 2;
    const y = yOf(bar.rank);
    const cy = y + h / 2;
    const barEnd = scaleX(bar.value);
    const color = o.colorScale.colorOf(bar, Math.round(bar.rank));
    const TAU = Math.PI * 2;

    let cx;
    if (o.iconPosition === "start") {
      cx = L.plotLeft - r - 6;                                   // 条形起点外侧
    } else if (o.iconPosition === "inside") {
      cx = Math.max(L.plotLeft + r + 6, barEnd - r - 8);         // 柱头内侧
    } else {
      cx = barEnd + r + 8;                                       // 柱头外侧（默认）
    }

    const disc = (fill) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fillStyle = fill;
      ctx.fill();
    };

    ctx.save();
    ctx.globalAlpha = alpha;

    if (icon.kind === "url") {
      const img = o.images?.get(bar.name) || o.images?.get(icon.value);
      if (!img || !img.complete || !img.naturalWidth) { ctx.restore(); return; }
      disc("#ffffff");
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.clip();
      drawCover(ctx, img, cx - r, cy - r, size, size);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.stroke();
    } else if (icon.kind === "emoji" && this._emojiOk()) {
      disc("rgba(255,255,255,0.94)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.lineWidth = Math.max(1, size * 0.06);
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.stroke();
      ctx.font = `${size * 0.62}px ${EMOJI_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#1f2933";
      ctx.fillText(icon.value, cx, cy + size * 0.03);
    } else {
      // 首字圆牌：系统没有 emoji 字体、或压根没匹配到图标时的兜底
      disc(shade(color, -0.08));
      ctx.font = `700 ${size * 0.54}px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = contrastText(shade(color, -0.08), "#1f2933", "#ffffff");
      ctx.fillText(initial(bar.name), cx, cy + size * 0.03);
    }

    ctx.restore();
  }

  /** 图标解析结果缓存：每个名字只算一次 */
  _iconOf(bar) {
    const o = this.options;
    if (!o.showImages || o.iconPosition === "none") return null;
    if (!this._iconCache) this._iconCache = new Map();
    const key = bar.id != null ? bar.id : bar.name;
    let v = this._iconCache.get(key);
    if (v === undefined) {
      v = iconFor(bar.name, bar.category, bar.image);
      this._iconCache.set(key, v);
    }
    return v;
  }

  /** emoji 字体探测结果缓存（每次绘制都测太贵） */
  _emojiOk() {
    if (this._emojiSupport == null) this._emojiSupport = detectEmojiSupport();
    return this._emojiSupport;
  }

  _drawLabels(ctx, L, bar, scaleX, yOf, alpha) {
    const o = this.options;
    const th = o.theme;
    const y = yOf(bar.rank);
    const h = L.barHeight;
    const cy = y + h / 2;
    const barEnd = scaleX(bar.value);
    const color = o.colorScale.colorOf(bar, Math.round(bar.rank));
    const size = L.labelSize;
    const valueStr = o.showValue && bar.value >= 0.5 ? this.options.valueFormat(bar.value) : "";

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textBaseline = "middle";

    // 预量三种宽度，决定标签的归宿
    ctx.font = `600 ${size}px ${FONT_STACK}`;
    const nameW = this._measure(ctx, bar.name, size);
    ctx.font = `500 ${size * 0.94}px ${FONT_STACK}`;
    const valW = valueStr ? this._measure(ctx, valueStr, size * 0.94) : 0;
    const pairW = nameW + (valueStr ? 12 + valW : 0);
    const rightEdge = L.W - L.pad.right;
    // 徽标骑在柱头时，标签要往右让出一个徽标的身位，否则会叠在图标上
    const iconGap = L.showIcon && o.iconPosition === "front" ? L.iconSize + 12 : 0;

    const drawName = (x, align, fill) => {
      ctx.font = `600 ${size}px ${FONT_STACK}`;
      ctx.textAlign = align;
      ctx.fillStyle = fill;
      // 右对齐时可用宽度 = 从画布左留白到 x；之前用 x - plotLeft 会算出负数，
      // 把 left 布局下的名字全部省略成 "…"
      const maxW = align === "right" ? x - L.pad.left - 4 : rightEdge - x;
      ctx.fillText(this._ellipsis(ctx, bar.name, maxW, size), x, cy);
    };
    const drawValue = (x, align) => {
      if (!valueStr) return;
      ctx.font = `500 ${size * 0.94}px ${th.mono ? MONO_FONT : FONT_STACK}`;
      ctx.textAlign = align;
      ctx.fillStyle = th.subtext;
      ctx.fillText(valueStr, x, cy);
    };

    if (o.labelLayout === "left") {
      // 左侧固定列，右对齐紧贴条形起点；起点外侧有徽标时名字再让一个身位
      const nameX = L.plotLeft - 10 - (L.showIcon && o.iconPosition === "start" ? L.iconSize + 12 : 0);
      drawName(nameX, "right", th.text);
      drawValue(rightEdge, "right");
    } else if (o.labelLayout === "inline") {
      const innerSpace = barEnd - L.plotLeft - 14;
      if (innerSpace > nameW + 10) {
        // 条形够长：名字压在条形上，用对比色保证可读
        drawName(L.plotLeft + 10, "left", contrastText(color, th.text, "#ffffff"));
      } else {
        drawName(barEnd + 10 + iconGap, "left", th.text);
      }
      drawValue(rightEdge, "right");
    } else {
      // trail：名字与数值成组跟在条形末端；右缘放不下时整组收进条形内部
      const anchor = barEnd + 10 + iconGap;
      if (anchor + pairW <= rightEdge) {
        drawName(anchor, "left", th.text);
        if (valueStr) drawValue(anchor + nameW + 12, "left");
      } else if (barEnd - 10 - pairW >= L.plotLeft) {
        const fill = contrastText(color, th.text, "#ffffff");
        drawName(barEnd - 10, "right", fill);
        if (valueStr) {
          ctx.font = `500 ${size * 0.94}px ${th.mono ? MONO_FONT : FONT_STACK}`;
          ctx.textAlign = "right";
          ctx.fillStyle = fill;
          ctx.globalAlpha = alpha * 0.72;
          ctx.fillText(valueStr, barEnd - 10 - nameW - 12, cy);
          ctx.globalAlpha = alpha;
        }
      } else {
        // 条形太短：贴起点外侧
        drawName(L.plotLeft + 6, "left", th.text);
        if (valueStr) drawValue(L.plotLeft + 6 + nameW + 12, "left");
      }
    }

    ctx.restore();
  }

  _drawTicker(ctx, L, sample) {
    const th = this.options.theme;
    const str = this.options.dateFormat(sample.date);
    ctx.save();
    ctx.globalAlpha = 1;
    // 等宽数字：年份切换时宽度恒定，不会带着整块画面左右抖
    ctx.font = `700 ${L.tickerSize}px ${th.mono ? MONO_FONT : FONT_STACK}`;
    if (th.glow) {
      ctx.shadowColor = th.ticker;
      ctx.shadowBlur = L.tickerSize * 0.45 * th.glow;
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = th.ticker;
    // 叠印在绘图区内部右下（右缘对齐柱区，避开数值列），柱子会自然遮住它
    ctx.fillText(str, L.plotRight - 6, L.plotBottom - L.yStep * 0.18);
    ctx.restore();
  }

  _drawTitle(ctx, L) {
    const o = this.options;
    const th = o.theme;
    let y = L.pad.top + o.titleSize * 0.9;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    // 科技风：标题左侧一条渐隐的强调色竖条，压住整个标题块
    const tx = L.pad.left + (th.accent ? 18 : 0);
    if (th.accent) {
      const barTop = y - o.titleSize * 0.95;
      const barH = o.titleSize * 1.1 + (o.subtitle ? o.subtitleSize * 1.2 : 0);
      const g = ctx.createLinearGradient(0, barTop, 0, barTop + barH);
      g.addColorStop(0, th.accent);
      g.addColorStop(1, hexToRgba(th.accent, 0.12));
      ctx.fillStyle = g;
      ctx.fillRect(L.pad.left, barTop, 4, barH);
    }
    if (o.title) {
      ctx.font = `700 ${o.titleSize}px ${FONT_STACK}`;
      ctx.fillStyle = th.text;
      ctx.fillText(o.title, tx, y);
      y += o.titleSize * 0.35;
    }
    if (o.subtitle) {
      ctx.font = `400 ${o.subtitleSize}px ${FONT_STACK}`;
      ctx.fillStyle = th.subtext;
      ctx.fillText(o.subtitle, tx, y + o.subtitleSize * 0.9);
    }
    ctx.restore();
  }

  _drawFooter(ctx, L) {
    const o = this.options;
    ctx.save();
    ctx.font = `400 ${o.footerSize}px ${FONT_STACK}`;
    ctx.fillStyle = o.theme.subtext;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(o.footer, L.pad.left, L.H - L.pad.bottom * 0.6);
    ctx.restore();
  }

  // ------------------------------------------------------------- 文字工具

  /** 带缓存的文本宽度测量 */
  _measure(ctx, str, size) {
    const key = `${size}|${str}`;
    let w = this._textCache.get(key);
    if (w == null) {
      w = ctx.measureText(str).width;
      if (this._textCache.size > 4000) this._textCache.clear();
      this._textCache.set(key, w);
    }
    return w;
  }

  _ellipsis(ctx, str, maxWidth, size) {
    if (this._measure(ctx, str, size) <= maxWidth) return str;
    let lo = 0;
    let hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this._measure(ctx, str.slice(0, mid) + "…", size) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return str.slice(0, lo) + "…";
  }

  /** 清掉的工具：外部想看当前可用绘图区 */
  get plotRect() {
    const L = this.layout();
    return { x: L.plotLeft, y: L.plotTop, w: L.plotWidth, h: L.plotHeight };
  }
}

// ------------------------------------------------------------------ 图元

/** 带逐角半径的圆角矩形路径（左上/右上/右下/左下） */
export function roundRectPath(ctx, x, y, w, h, radii) {
  const [tl, tr, br, bl] = radii.map((r, i) =>
    Math.min(r, (i === 0 || i === 3 ? w : w) < 0 ? 0 : w, h));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl);
}

/** contain 或 cover 地把图片画进方框；这里用 cover 并居中裁切 */
export function drawCover(ctx, img, x, y, w, h) {
  const ir = img.naturalWidth / img.naturalHeight;
  const br = w / h;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  let sx = 0;
  let sy = 0;
  if (ir > br) { sw = img.naturalHeight * br; sx = (img.naturalWidth - sw) / 2; }
  else { sh = img.naturalWidth / br; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}
