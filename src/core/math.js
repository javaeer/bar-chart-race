/**
 * 数学与缓动工具
 * ------------------------------------------------------------------
 * Bar Chart Race 的所有动画都归结为「在两个状态之间按某个比例插值」。
 * 这里集中定义插值原语与时间曲线（easing），渲染层与播放层共用。
 */

/** 线性插值 */
export function lerp(a, b, t) {
  return a * (1 - t) + b * t;
}

/** 反向插值：求 v 在 [a,b] 中的位置 */
export function invLerp(a, b, v) {
  return a === b ? 0 : (v - a) / (b - a);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 把 v 从 [d0,d1] 线性映射到 [r0,r1] */
export function rescale(v, d0, d1, r0, r1) {
  return d0 === d1 ? r0 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/** 「漂亮的」刻度步长：1 / 2 / 5 × 10^n */
export function tickStep(min, max, count) {
  const span = max - min;
  if (!(span > 0) || !(count > 0)) return 1;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const mult = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
  return mult * mag;
}

/**
 * 生成刻度序列（从 0 起）。
 * 用于动态坐标轴：轴上永远显示当前第一名的量级下的整齐刻度。
 */
export function ticks(maxValue, count) {
  if (!(maxValue > 0)) return [0];
  const step = tickStep(0, maxValue, count);
  const out = [];
  // 从 step 开始，跳过 0（0 处是条形起点，标 0 意义不大且会与其他元素打架）
  for (let v = step; v <= maxValue + step * 1e-9; v += step) {
    // 消除浮点累积误差
    out.push(Math.round(v / step) * step);
  }
  return out;
}

/** 缓动函数集 */
export const ease = {
  linear: (t) => t,
  quadIn: (t) => t * t,
  quadOut: (t) => t * (2 - t),
  quadInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicIn: (t) => t * t * t,
  cubicOut: (t) => --t * t * t + 1,
  cubicInOut: (t) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  expoOut: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

/**
 * 可变的分数/小数位数格式化。
 * 「Currently no.1」这类标签需要在祖先值不断变化时保持稳定观感，
 * 所以统一走同一个 numbers formatter。
 */
export function padFraction(value, digits) {
  const n = Math.pow(10, digits);
  return Math.round(value * n) / n;
}
