/**
 * 单文件打包器：把 src/ 下的 ES modules、styles/main.css、data/*.csv
 * 全部内联进一个 HTML 产物，双击即可在本地 file:// 下运行。
 *
 * 为什么需要它：ES modules + fetch 都受同源策略约束，
 * 直接双击 index.html 会报 CORS 错误，页面白屏。
 *
 * 用法：node scripts/build-standalone.js [输出路径]
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const OUT = process.argv[2] || resolve(ROOT, "dist/bar-chart-race-standalone.html");

/** 按依赖拓扑排序；本项目模块无环且导出名无重名，可以安全地拼进同一个作用域 */
const ORDER = [
  "src/core/math.js",
  "src/core/format.js",
  "src/core/csv.js",
  "src/core/color.js",
  "src/core/icons.js",
  "src/core/templates.js",

  "src/core/zip.js",
  "src/core/keyframes.js",
  "src/render/renderer.js",
  "src/player.js",
  "src/exporter.js",
  "src/main.js",
];

/**
 * 完整性校验：扫描 src 下所有相对 import，确认每个被引用的文件都在 ORDER 里。
 * 打包会剥掉 import 语句，漏一个文件就是运行时 ReferenceError，
 * 而且往往要等到第一次绘制才爆，很难排查 —— 宁可在这里挡下来。
 */
async function assertNoMissingModules() {
  const missing = [];
  for (const rel of ORDER) {
    const src = await read(rel);
    for (const m of src.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const dep = normalize(join(dirname(rel), m[1]));
      if (!ORDER.includes(dep)) missing.push(`${rel} → ${m[1]} (解析为 ${dep})`);
    }
  }
  // 反向检查：src 里有但 ORDER 没列的文件（新加的模块忘了登记）
  async function walk(dir) {
    const out = [];
    for (const e of await readdir(resolve(ROOT, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) out.push(...await walk(p));
      else if (e.name.endsWith(".js")) out.push(normalize(p));
    }
    return out;
  }
  const all = await walk("src");
  const unlisted = all.filter((f) => !ORDER.includes(f));
  const problems = [];
  if (missing.length) problems.push(`缺失的依赖:\n  ${missing.join("\n  ")}`);
  if (unlisted.length) problems.push(`src 下未登记进 ORDER 的模块:\n  ${unlisted.join("\n  ")}`);
  if (problems.length) {
    throw new Error("打包清单不完整 ——\n" + problems.join("\n"));
  }
  await assertNoDuplicateDeclarations();
}

/**
 * 顶层重名检测。
 * 各模块在自己的 ES module 作用域里重名没事，但打包后拼进同一个 IIFE，
 * `const` 重复声明是 SyntaxError —— 整个 bundle 一行都不会执行，
 * 页面表现为"静态 UI 在、动态全空、连错误捕获都没注册"。
 * 所以这里提前把所有顶层标识符收集起来查重。
 */
async function assertNoDuplicateDeclarations() {
  const seen = new Map(); // name → 文件
  const dup = [];
  for (const rel of ORDER) {
    const src = stripExports(stripImports(await read(rel)));
    for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      if (seen.has(name)) dup.push(`${name}: ${seen.get(name)} 与 ${rel} 重名`);
      else seen.set(name, rel);
    }
  }
  if (dup.length) {
    throw new Error("顶层标识符重名（打包后会变成重复声明）——\n  " + dup.join("\n  "));
  }
}

/** 去掉行首 import（含跨行写法），并保证不吃掉 import.meta 这类表达式 */
function stripImports(src) {
  return src.replace(/^import\s[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm, "");
}

/** export 降级为同一作用域内的声明 */
function stripExports(src) {
  return src
    .replace(/^export\s+(?=(async\s+function|function|const|let|var|class)\b)/gm, "")
    .replace(/^export\s*\{[^}]*\}\s*;[ \t]*$/gm, "");
}

const read = (p) => readFile(resolve(ROOT, p), "utf8");

async function buildBundle() {
  const parts = [];
  for (const rel of ORDER) {
    const raw = await read(rel);
    const code = stripExports(stripImports(raw)).trim();
    parts.push(`/* ─── ${rel} ─────────────────────────────── */\n${code}`);
  }
  return parts.join("\n\n");
}

/** 字符串安全地嵌入进 HTML 内的 <script> 之中 */
function escapeForScript(s) {
  return s
    .replace(/<\/(script|style)/gi, "<\\/$1") // 闭合标签会提前终结脚本块
    .replace(/\u2028/g, "\\u2028")            // JSON.stringify 不转义的行终止符
    .replace(/\u2029/g, "\\u2029");
}

/**
 * 把 DATASETS 里 `file: "./data/xxx.csv"` 就地补一行 `inline: "..."`。
 * 选择在打包期而非运行期注入，是因为 main.js 末尾直接调用了 init()，
 * 运行时 patch 会赶不上首次加载。
 */
async function injectData(bundle) {
  let count = 0;
  let out = bundle.replace(
    /file:\s*"(?:\.\/)?data\/([^"]+\.csv)",/g,
    (match, name) => {
      count++;
      return `${match}\n    __INLINE_CSV_${slug(name)}__,`;
    }
  );

  for (const [, name] of out.matchAll(/__INLINE_CSV_(\w+)__/g)) {
    const csvName = await findCsv(name);
    const text = await read(`data/${csvName}`);
    out = out.replace(`__INLINE_CSV_${name}__`, `inline: ${escapeForScript(JSON.stringify(text))}`);
    console.log(`  内联数据 ${csvName} → ${(text.length / 1024).toFixed(0)} KB`);
  }

  if (count === 0) throw new Error("未在 main.js 中找到 DATASETS 的 data/*.csv 引用，打包中止");
  return out;
}

/** 占位符只允许 \w，用它反查真实文件名 */
const slug = (n) => n.replace(/\W/g, "_");
async function findCsv(slugged) {
  return ways(slugged);
}
function ways(s) {
  // category-brands.csv → category_brands_csv；还原时按已知文件名表匹配
  for (const cand of CSV_FILES) if (slug(cand) === s) return cand;
  throw new Error(`无法把占位符还原为 csv 文件名：${s}`);
}
const CSV_FILES = ["category-brands.csv", "cities.csv"];

async function main() {
  console.log("\n  单文件打包\n");

  await assertNoMissingModules();
  let bundle = await injectData(await buildBundle());
  bundle = escapeForScript(bundle);

  const css = await read("styles/main.css");
  let html = await read("index.html");

  html = html.replace(
    /<link rel="stylesheet" href="\.\/styles\/main\.css">/,
    () => `<style>\n${css.replace(/<\/style/gi, "<\\/style")}\n</style>`
  );
  html = html.replace(
    /<script type="module" src="\.\/src\/main\.js"><\/script>/,
    () =>
      "<script>\n" +
      "/* 单文件版：由 scripts/build-standalone.js 生成，所有模块内联，无需本地服务器 */\n" +
      "(function () {\n" +
      '"use strict";\n' +
      bundle +
      "\n})();\n" +
      "</script>"
  );

  if (html.includes('src="./src/main.js"') || html.includes('href="./styles/main.css"')) {
    throw new Error("index.html 中的 script/link 标签未被替换，请检查标签写法是否变化");
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, html, "utf8");
  console.log(`\n  → ${OUT}`);
  console.log(`  ${(Buffer.byteLength(html, "utf8") / 1024).toFixed(0)} KB\n`);
}

main().catch((e) => {
  console.error("打包失败：" + e.message);
  process.exit(1);
});
