/**
 * 虚拟时钟播放器
 * ==================================================================
 * 原版 D3 用 d3-transition 排队播放：每播完一个 transition 再排下一个。
 * 那种模型没法 seek、没法变速、更没法保证 export 出来的视频与时分秒对齐
 * （掉一帧就慢一点）。
 *
 * 这里改用「虚拟时钟」：位置是一个浮点关键帧索引 position ∈ [0, F-1]，
 * 渲染时拆成 (floor(position), frac) 交给模型采样。于是：
 *
 *   · seek(service) —— 直接赋值 position，画面立刻响应
 *   · 变速        —— 改每帧步进速率即可，画面逻辑不变
 *   · 导出        —— 按视频帧号反推 position，输出时长严格等于设定值
 */

import { clamp } from "./core/math.js";

export const EASINGS = {
  linear: (t) => t,
  // 每一步开头结尾略微收力，让条形交换位置时更有“吸附感”
  smooth: (t) => t * t * (3 - 2 * t),
  smoother: (t) => t * t * t * (t * (t * 6 - 15) + 10),
};

export class Player {
  /**
   * @param {object} cfg
   * @param {import('./core/keyframes.js').RaceModel} cfg.model
   * @param {import('./render/renderer.js').RaceRenderer} cfg.renderer
   * @param {number} [cfg.frameDuration=250] 每个关键帧对应的毫秒数
   * @param {number} [cfg.n=12] 显示条目数
   * @param {boolean} [cfg.loop=true]
   * @param {string} [cfg.easing='linear']
   */
  constructor(cfg) {
    this.model = cfg.model;
    this.renderer = cfg.renderer;
    this.frameDuration = cfg.frameDuration ?? 250;
    this.n = cfg.n ?? 12;
    this.loop = cfg.loop ?? true;
    this.speed = 1;
    this.setEasing(cfg.easing || "linear");

    this.position = 0;         // 浮点关键帧位置
    this.playing = false;
    this._last = 0;
    this._raf = null;
    this._listeners = { frame: [], end: [], state: [] };
    this.render();
  }

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); return this; }
  _emit(evt, arg) { for (const fn of this._listeners[evt] || []) fn(arg); }

  setEasing(name) { this._ease = EASINGS[name] || EASINGS.linear; }

  /** 总时长（毫秒） */
  get durationMs() {
    return Math.max(0, (this.model.frameCount - 1) * this.frameDuration);
  }

  /** 进度 0..1 */
  get progress() {
    const last = Math.max(1, this.model.frameCount - 1);
    return clamp(this.position / last, 0, 1);
  }

  set progress(p) {
    const last = Math.max(1, this.model.frameCount - 1);
    this.position = clamp(p, 0, 1) * last;
    this.render();
  }

  get lastFrame() { return Math.max(1, this.model.frameCount - 1); }

  setN(n) {
    this.n = n;
    this.renderer.set({ n });
    this.render();
  }

  // ------------------------------------------------------------- 播放控制

  play() {
    if (this.playing) return;
    if (this.position >= this.lastFrame - 1e-6) this.position = 0;
    this.playing = true;
    this._last = performance.now();
    this._emit("state", true);
    const loopFn = (now) => {
      if (!this.playing) return;
      const dt = Math.min(now - this._last, 200); // 卡顿保护：一次最多补 200ms
      this._last = now;
      this.position += (dt / this.frameDuration) * this.speed;

      if (this.position >= this.lastFrame) {
        this.position = this.lastFrame;
        this.render();
        if (this.loop) { this.position = 0; }
        else { this.pause(); this._emit("end"); return; }
      }
      this.render();
      this._raf = requestAnimationFrame(loopFn);
    };
    this._raf = requestAnimationFrame(loopFn);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._emit("state", false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  step(delta) {
    this.pause();
    const i = Math.round(this.position) + delta;
    this.position = clamp(i, 0, this.lastFrame);
    this.render();
  }

  seek(frame) {
    this.position = clamp(frame, 0, this.lastFrame);
    this.render();
  }

  // ------------------------------------------------------------- 渲染

  /** 在当前位置立即绘制一帧 */
  render() {
    const u0 = this.position % 1;
    const fi = Math.min(Math.floor(this.position), this.lastFrame);
    const u = this._ease(clamp(u0, 0, 1));
    const sample = this.model.sample(fi, u, this.n);
    this.renderer.draw(sample);
    this._emit("frame", { position: this.position, progress: this.progress, sample });
    return sample;
  }

  /**
   * 离线推进：严格按固定步长走完全程。
   * 用于录像导出——输出时长与设定值精确一致，不受机器性能影响。
   *
   * @param {object} cfg
   * @param {number} cfg.fps          输出视频帧率
   * @param {number} [cfg.durationMs] 期望时长（默认走完自然时长）
   * @param {(info:{frame:number,total:number,position:number}) => void} cfg.onFrame
   * @param {() => Promise<void>} [cfg.onBeforeDraw] 每次绘制前的钩子（录制时用）
   */
  async renderOffline({ fps = 30, durationMs, onFrame, onBeforeDraw }) {
    const wasPlaying = this.playing;
    this.pause();

    const count = Math.max(2, Math.round(((durationMs ?? this.durationMs) / 1000) * fps));
    for (let i = 0; i < count; i++) {
      const p = i / (count - 1);
      this.position = p * this.lastFrame;
      if (onBeforeDraw) await onBeforeDraw();
      this.render();
      onFrame?.({ frame: i, total: count, position: this.position });
      // 让出主线程，避免长时间阻塞导致页面假死
      if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0));
    }
    if (wasPlaying) this.play();
    return count;
  }

  dispose() {
    this.pause();
    this._listeners = { frame: [], end: [], state: [] };
  }
}
