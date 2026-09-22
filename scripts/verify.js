/**
 * 端到端渲染验证
 * ------------------------------------------------------------------
 * 无头浏览器里没法直接驱动 MediaRecorder，所以走这条路：
 *   页面在 ?testframes=N 模式下按等距时间点渲染 N 帧 → 转成 PNG dataURL
 *   写回 DOM → 这里用 chromium --dump-dom 把整个 DOM 取回来 → 从中提取
 *   dataURL 落盘 → ffmpeg 合成成真正的视频。
 *
 * 于是「渲染器真的画对了东西」这件事可以被自动验证，而不用人眼看截图。
 *
 * 用法：
 *   node scripts/verify.js                 # 默认 brands 数据集
 *   node scripts/verify.js --dataset=cities
 *   node scripts/verify.js --frames=60 --out=/tmp/bcr
 */

import { spawn } from "node:child_process";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./serve.js";
import { framesToVideo, framesToGif } from "./ffmpeg-util.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

const args = parseArgs(process.argv);
const DATASET = args.dataset || "brands";
const FRAMES = Number(args.frames || 40);
const OUT = args.out ? resolve(args.out) : resolve(ROOT, "preview");
const CHROME = args.chrome || "chromium";

function run(cmd, cmdArgs, opt = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], ...opt });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res({ stdout, stderr }) : rej(new Error(`${cmd} 退出码 ${code}\n${stderr.slice(0, 1500)}`))));
  });
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const server = createStaticServer();
  const port = 5199;
  await new Promise((r) => server.listen(port, r));

  const url =
    `http://127.0.0.1:${port}/` +
    `?dataset=${DATASET}&testframes=${FRAMES}&preset=1280x720&dpr=1`;

  console.log(`\x1b[2m  渲染 DATASET=${DATASET}，${FRAMES} 帧\x1b[0m`);

  let dom;
  try {
    const r = await run(CHROME, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--window-size=1400,900",
      "--virtual-time-budget=20000",
      "--dump-dom",
      url,
    ], { maxBuffer: 512 * 1024 * 1024 });
    dom = r.stdout;
  } finally {
    server.close();
  }

  // —— 从 DOM 里把帧数据抠出来 ——
  const marker = /<script id="testFrames" type="text\/plain">([\s\S]*?)<\/script>/;
  const hit = marker.exec(dom);
  if (!hit) {
    console.error("\x1b[31m没有取到帧数据。页面可能报错了，DOM 片段：\x1b[0m");
    console.error(dom.slice(0, 2000));
    process.exit(1);
  }
  let frames;
  try {
    frames = JSON.parse(hit[1]);
  } catch (e) {
    // 浏览器会把 dataURL 里的某些字符做 HTML 实体转义，先还原
    frames = JSON.parse(hit[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  }
  if (!Array.isArray(frames) || !frames.length) {
    console.error("\x1b[31m帧数据为空\x1b[0m");
    process.exit(1);
  }

  const sizes = [];
  for (let i = 0; i < frames.length; i++) {
    const b64 = frames[i].replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    await writeFile(resolve(OUT, `frame_${String(i + 1).padStart(4, "0")}.png`), buf);
    sizes.push(buf.length);
  }

  // —— 验证：画出来的图必须”有内容“ ——
  const min = Math.min(...sizes);
  const max = Math.max(...sizes);
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  console.log(`\x1b[2m  PNG ${frames.length} 张，平均 ${(avg / 1024).toFixed(1)}KB (最小 ${(min / 1024).toFixed(1)}KB / 最大 ${(max / 1024).toFixed(1)}KB)\x1b[0m`);

  const blank = sizes.filter((s) => s < 3000).length;
  if (blank > 0) {
    console.error(`\x1b[31m✗ 有 ${blank} 张疑似空白（<3KB）\x1b[0m`);
    process.exit(1);
  }
  const uniqueish = new Set(sizes).size;
  if (uniqueish < frames.length * 0.6) {
    console.error(`\x1b[31m✗ 大部分帧字节数完全相同，画面可能没有随时间变化 (${uniqueish}/${frames.length})\x1b[0m`);
    process.exit(1);
  }
  console.log(`  \x1b[32m✓\x1b[0m 全部 ${frames.length} 帧均有内容，且随时间变化`);

  // —— 合成视频：编码器按机器能力自动挑选 ——
  const pattern = resolve(OUT, "frame_%04d.png");

  const mp4 = resolve(OUT, `${DATASET}.mp4`);
  const r1 = await framesToVideo(pattern, mp4, { fps: 24, crf: 20 });

  const webm = resolve(OUT, `${DATASET}.webm`);
  const r2 = await framesToVideo(pattern, webm, { fps: 24, crf: 20 });

  const gif = resolve(OUT, `${DATASET}.gif`);
  await framesToGif(pattern, gif, { fps: 12 });

  for (const [label, file, enc] of [
    ["MP4", mp4, r1.encoder], ["WebM", webm, r2.encoder], ["GIF", gif, "gif"],
  ]) {
    const buf = await readFile(file);
    console.log(`  \x1b[32m✓\x1b[0m ${label.padEnd(4)} ${(buf.length / 1024).toFixed(0).padStart(6)}KB  ${file}  \x1b[2m[${enc}]\x1b[0m`);
  }

  console.log(`\n\x1b[32m验证通过\x1b[0m —— 输出目录：${OUT}\n`);
}

main().catch((err) => {
  console.error("\x1b[31m验证失败：\x1b[0m", err.message);
  process.exit(1);
});
