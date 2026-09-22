/**
 * 导出后处理
 * ------------------------------------------------------------------
 * 浏览器里录出来的是 WebM（VP9），剪辑软件对它的兼容性参差不齐；
 * 帧序列 ZIP 也需要一条转成成片的路。这个脚本负责收尾：
 *
 *   node scripts/postprocess.js 录制.webm -o 成片.mp4 [--fps 30] [--crf 20]
 *   node scripts/postprocess.js ./frames -o 成片.mp4      # PNG 序列目录
 *   node scripts/postprocess.js 录制.webm -o 动图.gif
 *
 * 编码器按本机 ffmpeg 的能力自动挑选（有 libx264 用 libx264，
 * 没有就退到 libopenh264 / 硬件编码器）。
 */

import { stat, readdir } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import { framesToVideo, framesToGif, transcode } from "./ffmpeg-util.js";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2).split("=")[0];
      const inline = a.includes("=") ? a.split("=").slice(1).join("=") : argv[++i];
      out[key] = inline === undefined || inline === "true" ? true : inline;
    } else out._.push(a);
  }
  return out;
}

const HELP = `
用法：
  node scripts/postprocess.js <输入> -o <输出> [选项]

输入可以是：
  · 视频文件（.webm / .mp4 / .mov …）—— 转封装或转码
  · 帧序列目录（内含 frame_0001.png …）—— 合成视频

输出按扩展名决定动作：.mp4 / .webm / .gif

选项：
  --fps N      帧率（默认 30；GIF 默认 12）
  --crf N      质量（x264/VP9 用，越小越清晰，默认 20）
  --scale N    GIF 宽度上限（默认 720）
  --colors N   GIF 调色板颜色数（默认 128）
  --bitrate S  码率，如 12M（OpenH264 / 硬件编码器路径用）
`;

async function main() {
  const args = parseArgs(process.argv);
  if (!args._.length || !args.o || args.help) {
    console.log(HELP);
    process.exit(args.help ? 0 : 1);
  }

  const input = resolve(args._[0]);
  const output = resolve(args.o);
  const info = await stat(input).catch(() => null);
  if (!info) {
    console.error(`输入不存在：${input}`);
    process.exit(1);
  }

  const fps = Number(args.fps || 30);
  const crf = Number(args.crf || 20);
  const ext = extname(output).toLowerCase();

  console.log(`\x1b[2m  输入 ${basename(input)} → 输出 ${basename(output)}\x1b[0m`);

  if (info.isDirectory()) {
    // 帧序列目录
    const files = (await readdir(input)).filter((f) => /\.png$/i.test(f)).sort();
    if (!files.length) {
      console.error("目录里没有 PNG 帧");
      process.exit(1);
    }
    // 推断编号宽度（frame_0001.png → 4）
    const width = (files[0].match(/(\d+)\.png$/i)?.[1] || "").length || 4;
    const prefix = files[0].replace(/\d+\.png$/i, "");
    const pattern = resolve(input, `${prefix}%0${width}d.png`);
    console.log(`\x1b[2m  ${files.length} 帧，pattern=${prefix}%0${width}d.png\x1b[0m`);

    if (ext === ".gif") {
      await framesToGif(pattern, output, { fps: Number(args.fps || 12), scale: Number(args.scale || 720), colors: Number(args.colors || 128) });
    } else {
      await framesToVideo(pattern, output, { fps, crf, bitrate: args.bitrate });
    }
  } else {
    // 视频输入：转码
    if (ext === ".gif") {
      // 先抽帧再调色板，两步走画质更好
      const { spawn } = await import("node:child_process");
      const { mkdtemp } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const dir = await mkdtemp(join(tmpdir(), "bcrgif-"));
      await new Promise((res, rej) => {
        const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y",
          "-i", input, "-vf", `fps=${Number(args.fps || 12)},scale=${Number(args.scale || 720)}:-1:flags=lanczos`,
          join(dir, "f_%04d.png")]);
        p.on("close", (c) => (c === 0 ? res() : rej(new Error("抽帧失败"))));
      });
      await framesToGif(join(dir, "f_%04d.png"), output, { fps: Number(args.fps || 12), colors: Number(args.colors || 128) });
    } else {
      await transcode(input, output, { fps, crf, bitrate: args.bitrate || "12M" });
    }
  }

  const out = await stat(output);
  console.log(`\x1b[32m✓ 完成\x1b[0m ${(out.size / 1024).toFixed(0)}KB → ${output}\n`);
}

main().catch((err) => {
  console.error("\x1b[31m" + err.message + "\x1b[0m");
  process.exit(1);
});
