/**
 * 视频与图片导出
 * ==================================================================
 * 做短视频有三条刚性需求，对应这里三个出口：
 *
 *   1. 直接拿到成片     → recordWebM：MediaRecorder + captureStream
 *   2. 进剪辑软件精修   → exportFrameSequence：PNG 序列打包成 zip
 *   3. 做封面 / 静帧   → snapshotPNG
 *
 * 录制走「按真实时间推进」而不是「尽快跑完」：MediaRecorder 的时间戳来自
 * 墙上时钟，跑得再快也应该让它在时间轴上占满应有的时长，否则导出的视频
 * 会快进。这一点是很多自己撸录制的同学踩的坑。
 */

import { ZipWriter } from "./core/zip.js";

/** 挑一个当前浏览器真正支持的容器/编码组合 */
export function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];
  if (typeof MediaRecorder === "undefined") return null;
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return null;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 等到一个精确的时间点（用 rAF 驱动，避免 setTimeout 抖动） */
function waitUntil(ts) {
  return new Promise((resolve) => {
    const tick = () => {
      if (performance.now() >= ts) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * 录制为 WebM / MP4（取决于浏览器能力）
 *
 * @param {object} cfg
 * @param {HTMLCanvasElement} cfg.canvas
 * @param {import('./player.js').Player} cfg.player
 * @param {number} [cfg.fps=30]
 * @param {number} [cfg.durationMs]
 * @param {number} [cfg.bitrate=12_000_000]
 * @param {(p:number)=>void} [cfg.onProgress]
 * @param {(msg:string)=>void} [cfg.onStatus]
 * @returns {Promise<{blob:Blob, mimeType:string, frames:number, elapsed:number}>}
 */
export async function recordVideo({
  canvas, player, fps = 30, durationMs,
  bitrate = 12_000_000, onProgress, onStatus,
}) {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error("当前浏览器不支持 MediaRecorder，请改用「导出帧序列」");

  const duration = durationMs ?? player.durationMs;
  const total = Math.max(2, Math.round((duration / 1000) * fps));
  const interval = 1000 / fps;

  // fps=0 表示手动请求帧；部分实现不支持时退回自动采样
  let stream;
  let track;
  try {
    stream = canvas.captureStream(0);
    track = stream.getVideoTracks()[0];
    if (!track.requestFrame) throw new Error("no requestFrame");
  } catch {
    stream = canvas.captureStream(fps);
    track = stream.getVideoTracks()[0];
  }

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const stopped = new Promise((res, rej) => {
    rec.onstop = res;
    rec.onerror = (e) => rej(e.error || new Error("录制失败"));
  });

  rec.start();
  onStatus?.("录制中…");

  const start = performance.now();
  let dropped = 0;
  for (let i = 0; i < total; i++) {
    const due = start + i * interval;
    if (performance.now() > due + interval) dropped++;
    await waitUntil(due);
    player.position = (i / (total - 1)) * player.lastFrame;
    player.render();
    track.requestFrame?.();
    onProgress?.((i + 1) / total);
  }

  await new Promise((r) => setTimeout(r, 120)); // 给编码器收尾的时间
  rec.stop();
  await stopped;
  for (const t of stream.getTracks()) t.stop();

  const blob = new Blob(chunks, { type: mimeType });
  return {
    blob, mimeType, frames: total, dropped,
    elapsed: performance.now() - start,
  };
}

/**
 * 导出 PNG 帧序列（打包 zip）
 * 不做时间节流 —— 输出的是图序列而非视频，越快越好。
 */
export async function exportFrameSequence({
  player, fps = 30, durationMs, onProgress, scale = 1, prefix = "frame",
}) {
  const duration = durationMs ?? player.durationMs;
  const total = Math.max(2, Math.round((duration / 1000) * fps));
  const zip = new ZipWriter();
  const canvas = player.renderer.canvas;

  for (let i = 0; i < total; i++) {
    player.position = (i / (total - 1)) * player.lastFrame;
    player.render();
    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/png")
    );
    const buf = new Uint8Array(await blob.arrayBuffer());
    zip.add(`${prefix}_${String(i + 1).padStart(5, "0")}.png`, buf);
    onProgress?.((i + 1) / total);
    if (i % 20 === 19) await new Promise((r) => setTimeout(r, 0));
  }
  return { blob: new Blob([zip.build()], { type: "application/zip" }), frames: total };
}

/** 导出当前画面为单张 PNG */
export async function snapshotPNG(player, scale = 2) {
  const canvas = player.renderer.canvas;
  if (scale === 1) {
    return await new Promise((res) => canvas.toBlob(res, "image/png"));
  }
  // 用离屏画布放大导出，得到更高分辨率的封面图
  const off = document.createElement("canvas");
  off.width = canvas.width * scale;
  off.height = canvas.height * scale;
  const octx = off.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(canvas, 0, 0, off.width, off.height);
  return await new Promise((res) => off.toBlob(res, "image/png"));
}

export { download };
