/**
 * 配色系统
 * ------------------------------------------------------------------
 * 复刻 d3-scale-chromatic 里几套常用的离散色板，另加一套为深色背景
 * 优化过的 TikTok / 短视频风格色板。
 */

export const PALETTES = {
  // d3.schemeTableau10 —— D3 bar chart race 默认色板
  tableau10: [
    "#4e79a7", "#f28e2c", "#e15759", "#76b7b2", "#59a14f",
    "#edc949", "#af7aa1", "#ff9da7", "#9c755f", "#bab0ab",
  ],
  // d3.schemeObservable10
  observable10: [
    "#4269d0", "#efb118", "#ff725c", "#6cc5b0", "#3ca951",
    "#ff8ab7", "#a463f2", "#97bbf5", "#9c6b4e", "#9498a0",
  ],
  // d3.schemeSet2
  set2: [
    "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
    "#ffd92f", "#e5c494", "#b3b3b3",
  ],
  // 深色短视频风格：高明度、高饱和，在黑底上很跳
  vivid: [
    "#ff4d6d", "#ffb703", "#06d6a0", "#4cc9f0", "#f72585",
    "#a06cd5", "#ffdd4a", "#ff7f51", "#64dfdf", "#80b918",
  ],
  // 单一色相渐层：适合强调数值大小而非分类
  blues: [
    "#0b3d91", "#1668c4", "#2e9bd6", "#61c3e0", "#a5e3ef",
    "#cfeff7", "#9ec3e6", "#5a8fd6", "#3762b8", "#20408a",
  ],
  warm: [
    "#8c1c13", "#bf4342", "#d97a2b", "#e6a532", "#f2cc6b",
    "#fff0c9", "#f4b860", "#e0813a", "#c25020", "#94280e",
  ],
};

/** Determinstic string → 稳定整数哈希（用于名字分色，避免依赖 Map 顺序） */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

export class ColorScale {
  /**
   * @param {object} [opt]
   * @param {string} [opt.palette] 色板名
   * @param {string[]} [opt.colors] 自定义色板（优先）
   * @param {"category"|"name"|"rank"|"solid"} [opt.mode]
   * @param {string} [opt.solid] mode=solid 时的颜色
   */
  constructor(opt = {}) {
    this.colors = opt.colors || PALETTES[opt.palette] || PALETTES.tableau10;
    this.mode = opt.mode || "category";
    this.solid = opt.solid || this.colors[0];
    this._map = new Map();
    this._next = 0;
  }

  /** 为某个 key 分配稳定颜色 */
  assign(key) {
    if (this.mode === "solid") return this.solid;
    if (key == null || key === "") key = "__default__";
    let c = this._map.get(key);
    if (c) return c;
    if (this.mode === "category") {
      c = this.colors[this._next++ % this.colors.length];
    } else {
      c = this.colors[hashString(String(key)) % this.colors.length];
    }
    this._map.set(key, c);
    return c;
  }

  /**
   * 按给定顺序预热配色表。
   * 若不预热，颜色会按「首次绘制的顺序」分配 —— 而绘制是从榜尾往榜首画的，
   * 结果榜首品牌反而拿到色板的最后一个颜色。预热保证数据里最先出现的
   * 分类/名字拿走色板开头的颜色，语义上更符合直觉。
   */
  warmup(keys) {
    for (const k of keys) this.assign(k);
    return this;
  }

  reset() { this._map.clear(); this._next = 0; }

  colorOf(entry, rank = 0) {
    if (this.mode === "rank") return this.colors[rank % this.colors.length];
    const key = this.mode === "name" ? entry.name : entry.category;
    if (this.mode === "category" && !entry.category) return this.colors[hashString(entry.name) % this.colors.length];
    return this.assign(key);
  }
}

/** hex → rgba(...) */
export function hexToRgba(hex, alpha = 1) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  if (!Number.isFinite(num)) return hex;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 判断颜色的感知亮度，用于决定叠加文字用深色还是浅色 */
export function luminance(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  if (!Number.isFinite(num)) return 0.5;
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** 选择在给定背景色上可读性更好的文字色 */
export function contrastText(bg, dark = "#111827", light = "#ffffff") {
  return luminance(bg) > 0.45 ? dark : light;
}
