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
import { contrastText, hexToRgba } from "../core/color.js";

export const FONT_STACK =
  `-apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", Roboto, ` +
  `"Helvetica Neue", "Noto Sans SC", sans-serif`;

export const DEFAULT_OPTIONS = {
  width: 1280,
  height: 720,
  dpr: 1,

  n: 12,
  barPadding: 0.12,      // 条形之间的留白比例
  plotPad: 0.35,         // 榜单下沿额外预留的行高（给进出榜的条形缓冲）
  barRadius: 0.28,       // 条形右端圆角（相对条高）
  barOpacity: 1,

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
  showImages: true,
  imageSize: 0.75,       // 相对条高

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
  images: null,          // Map<name, HTMLImageElement>
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

    // 底部给 ticker / footer 留空间
    const bottomPad = (o.showTicker ? 0 : 0) + (o.footer ? H * 0.05 : 0);
    const plotBottom = H - pad.bottom - bottomPad;
    const plotHeight = Math.max(10, plotBottom - plotTop);

    const n = Math.max(1, o.n);
    const yStep = plotHeight / (n + o.plotPad);
    const barHeight = Math.max(2, yStep * (1 - o.barPadding));

    // 左侧名字列
    const labelColumn = o.labelLayout === "left" ? W * 0.22 : 0;
    // 右侧数值列宽度（按最长数字估的保守值）
    const valueColumn = o.showValue ? Math.min(W * 0.2, Math.max(70, axisLabelSize * 5.5)) : 0;

    const plotLeft = pad.left + labelColumn;
    const plotRight = W - pad.right - valueColumn;
    const plotWidth = Math.max(20, plotRight - plotLeft);

    this._layout = {
      W, H, pad, plotTop, plotBottom, plotHeight, plotLeft, plotRight, plotWidth,
      yStep, barHeight, axisLabelSize, titleSize, subtitleSize,
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
    const bg = this.options.theme.background;
    if (Array.isArray(bg)) {
      const g = ctx.createLinearGradient(0, 0, 0, L.H);
      bg.forEach((s, i) => g.addColorStop(i / (bg.length - 1), s));
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg;
    }
    ctx.fillRect(0, 0, L.W, L.H);
  }

  _drawGrid(ctx, L, scaleX, tickValues) {
    ctx.save();
    ctx.strokeStyle = this.options.theme.grid;
    ctx.lineWidth = 1;
    for (const t of tickValues) {
      const x = Math.round(scaleX(t)) + 0.5;
      if (x < L.plotLeft || x > L.plotRight) continue;
      ctx.beginPath();
      ctx.moveTo(x, L.plotTop - 6);
      ctx.lineTo(x, L.plotBottom);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawAxis(ctx, L, scaleX, tickValues) {
    const th = this.options.theme;
    ctx.save();
    ctx.font = `500 ${L.axisLabelSize}px ${FONT_STACK}`;
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

  _drawBar(ctx, L, bar, scaleX, yOf, alpha) {
    const o = this.options;
    const y = yOf(bar.rank);
    const h = L.barHeight;
    const w = Math.max(0, scaleX(bar.value) - L.plotLeft);
    if (w < 0.5) return;
    const color = o.colorScale.colorOf(bar, Math.round(bar.rank));
    const r = Math.min(h / 2, w, L.barHeight * o.barRadius);

    ctx.save();
    ctx.globalAlpha = alpha * o.barOpacity;
    ctx.beginPath();
    roundRectPath(ctx, L.plotLeft, y, w, h, [0, r, r, 0]);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    // 图片标记（国旗/图标）：贴在条形起点外侧
    if (o.showImages && bar.image) {
      const img = o.images?.get(bar.name) || o.images?.get(bar.image);
      if (img && img.complete && img.naturalWidth) {
        const size = Math.min(h, L.yStep) * o.imageSize;
        ctx.save();
        ctx.globalAlpha = alpha;
        drawCover(ctx, img, L.plotLeft - size - 6, y + (h - size) / 2, size, size);
        ctx.restore();
      }
    }
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

    const drawName = (x, align, fill) => {
      ctx.font = `600 ${size}px ${FONT_STACK}`;
      ctx.textAlign = align;
      ctx.fillStyle = fill;
      ctx.fillText(this._ellipsis(ctx, bar.name, align === "right" ? x - L.plotLeft : rightEdge - x, size), x, cy);
    };
    const drawValue = (x, align) => {
      if (!valueStr) return;
      ctx.font = `500 ${size * 0.94}px ${FONT_STACK}`;
      ctx.textAlign = align;
      ctx.fillStyle = th.subtext;
      ctx.fillText(valueStr, x, cy);
    };

    if (o.labelLayout === "left") {
      // 左侧固定列，右对齐紧贴条形起点；数值占据右侧留白列
      drawName(L.plotLeft - 10, "right", th.text);
      drawValue(rightEdge, "right");
    } else if (o.labelLayout === "inline") {
      const innerSpace = barEnd - L.plotLeft - 14;
      if (innerSpace > nameW + 10) {
        // 条形够长：名字压在条形上，用对比色保证可读
        drawName(L.plotLeft + 10, "left", contrastText(color, th.text, "#ffffff"));
      } else {
        drawName(barEnd + 10, "left", th.text);
      }
      drawValue(rightEdge, "right");
    } else {
      // trail：名字与数值成组跟在条形末端；右缘放不下时整组收进条形内部
      if (barEnd + 10 + pairW <= rightEdge) {
        drawName(barEnd + 10, "left", th.text);
        if (valueStr) drawValue(barEnd + 10 + nameW + 12, "left");
      } else if (barEnd - 10 - pairW >= L.plotLeft) {
        const fill = contrastText(color, th.text, "#ffffff");
        drawName(barEnd - 10, "right", fill);
        if (valueStr) {
          ctx.font = `500 ${size * 0.94}px ${FONT_STACK}`;
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
    ctx.font = `700 ${L.tickerSize}px ${FONT_STACK}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = th.ticker;
    ctx.fillText(str, L.W - L.pad.right, L.plotBottom + L.tickerSize * 0.06);
    ctx.restore();
  }

  _drawTitle(ctx, L) {
    const o = this.options;
    const th = o.theme;
    let y = L.pad.top + o.titleSize * 0.9;
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if (o.title) {
      ctx.font = `700 ${o.titleSize}px ${FONT_STACK}`;
      ctx.fillStyle = th.text;
      ctx.fillText(o.title, L.pad.left, y);
      y += o.titleSize * 0.35;
    }
    if (o.subtitle) {
      ctx.font = `400 ${o.subtitleSize}px ${FONT_STACK}`;
      ctx.fillStyle = th.subtext;
      ctx.fillText(o.subtitle, L.pad.left, y + o.subtitleSize * 0.9);
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
