/**
 * ffmpeg 编码器探测与封装
 * ------------------------------------------------------------------
 * 不同机器上的 ffmpeg 编译选项差别很大（本次环境就没有 libx264，
 * 但有 libopenh264）。与其写死编码器，不如按需探测、逐个降级。
 */

import { spawn } from "node:child_process";

export function ffmpeg(args, label = "ffmpeg") {
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0 ? res(err) : rej(new Error(`${label} 失败(${code}): ${err.trim().slice(0, 600)}`))
    );
  });
}

let _encoders = null;
async function encoderList() {
  if (_encoders) return _encoders;
  const p = spawn("ffmpeg", ["-hide_banner", "-encoders"]);
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  await new Promise((r) => p.on("close", r));
  _encoders = new Set();
  for (const m of out.matchAll(/^\s*[VAS\.FDS]+\s+(\S+)\s/gm)) _encoders.add(m[1]);
  return _encoders;
}

/** 从候选里挑第一个本机可用的编码器 */
export async function pickEncoder(candidates) {
  const list = await encoderList();
  for (const c of candidates) if (list.has(c)) return c;
  return null;
}

export const H264_CANDIDATES = ["libx264", "libopenh264", "h264_nvenc", "h264_qsv", "h264_vaapi", "mpeg4"];

/**
 * 把一组图片序列编码成视频。
 * @param {string} pattern    输入序列，如 /dir/frame_%04d.png
 * @param {string} outFile    输出文件
 * @param {object} [opt]
 */
export async function framesToVideo(pattern, outFile, opt = {}) {
  const {
    fps = 24,
    crf = 20,
    preset = null,
    pixFmt = "yuv420p",
    extraArgs = [],
    faststart = true,
  } = opt;

  const isMp4 = /\.mp4$/i.test(outFile);
  const enc = await pickEncoder(isMp4 ? H264_CANDIDATES : ["libvpx-vp9", "libvpx"]);
  if (!enc) throw new Error("本机没有可用的视频编码器，请安装带编码器的 ffmpeg 版本");

  const args = ["-framerate", String(fps), "-i", pattern, "-c:v", enc];

  if (enc === "libx264" || enc === "libopenh264") {
    args.push("-pix_fmt", pixFmt);
    if (enc === "libx264") {
      args.push("-crf", String(crf));
      if (preset) args.push("-preset", preset);
    } else {
      // OpenH264 不走 CRF，用码率控制
      args.push("-b:v", opt.bitrate || "8M");
    }
  } else if (enc.startsWith("h264_")) {
    args.push("-pix_fmt", pixFmt, "-b:v", opt.bitrate || "8M");
  } else if (enc === "mpeg4") {
    args.push("-q:v", "3");
  } else if (enc.startsWith("libvpx")) {
    args.push("-pix_fmt", pixFmt, "-b:v", "0", "-crf", String(crf + 10));
  }

  args.push(...extraArgs);
  if (faststart && isMp4) args.push("-movflags", "+faststart");
  args.push(outFile);

  await ffmpeg(args, "编码视频");
  return { encoder: enc, file: outFile };
}

/** 图片序列 → GIF（带调色板优化，避免色带） */
export async function framesToGif(pattern, outFile, opt = {}) {
  const { fps = 12, scale = 720, colors = 128 } = opt;
  const vf =
    `split[s0][s1];[s0]palettegen=max_colors=${colors}[p];[s1][p]paletteuse=dither=bayer` +
    (scale ? `,scale=${scale}:-1:flags=lanczos` : "");
  await ffmpeg([
    "-framerate", String(fps), "-i", pattern,
    "-vf", vf, "-loop", "0", outFile,
  ], "编码 GIF");
  return { file: outFile };
}

/** 视频转封装/转码（用于把浏览器录的 webm 转成剪辑软件更好用的 mp4） */
export async function transcode(input, outFile, opt = {}) {
  const { fps = 30, crf = 20, bitrate = "12M" } = opt;
  const isMp4 = /\.mp4$/i.test(outFile);
  const enc = await pickEncoder(isMp4 ? H264_CANDIDATES : ["libvpx-vp9"]);
  if (!enc) throw new Error("本机没有可用的视频编码器");

  const args = ["-i", input, "-c:v", enc, "-r", String(fps)];
  if (enc === "libx264") args.push("-crf", String(crf), "-pix_fmt", "yuv420p");
  else args.push("-b:v", bitrate, "-pix_fmt", "yuv420p");
  if (isMp4) args.push("-movflags", "+faststart");
  args.push(outFile);

  await ffmpeg(args, "转码");
  return { encoder: enc, file: outFile };
}
