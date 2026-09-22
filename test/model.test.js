/**
 * 核心引擎正确性测试
 * 运行：npm test
 * ------------------------------------------------------------------
 * 重点验证三件事：
 *   1. 采样在整数帧处与原始数据吻合（不失真）
 *   2. 相邻帧边界连续（u=1 与下一帧 u=0 完全相等，动画不跳变）
 *   3. 名次单调、enter/exit 成员集合符合预期
 */

import { readFileSync } from "node:fs";
import { normalizeData } from "../src/core/csv.js";
import { RaceModel } from "../src/core/keyframes.js";

let passed = 0;
let failed = 0;

function ok(cond, label, extra = "") {
  if (cond) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { failed++; console.log(`  \x1b[31m✗\x1b[0m ${label} ${extra}`); }
}
function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}
function section(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

// ------------------------------------------------------------------ 数据准备
const brands = normalizeData(readFileSync(new URL("../data/category-brands.csv", import.meta.url), "utf8"));
console.log(`\n\x1b[2m品牌数据集：${brands.records.length} 行记录，识别为${brands.isWide ? "宽表" : "长表"}\x1b[0m`);

const cities = normalizeData(readFileSync(new URL("../data/cities.csv", import.meta.url), "utf8"));
console.log(`\x1b[2m城市数据集：${cities.records.length} 行记录，识别为${cities.isWide ? "宽表" : "长表"}\x1b[0m`);

// ================================================================== 1
section("1. 数据管道");
{
  ok(brands.records.length > 1500, `品牌数据解析出足量记录 (${brands.records.length})`);
  ok(!brands.isWide, "品牌 CSV 识别为长表");
  const r = brands.records[0];
  ok(r.date instanceof Date, "date 字段被解析为 Date");
  ok(typeof r.value === "number", "value 字段被解析为 number");
  ok(typeof r.category === "string" && r.category.length > 0, "category 字段存在");

  // cities 的 name 里含有逗号+引号，是对 CSV 解析器的硬考验
  const quoted = cities.records.find((x) => x.name.includes(", India"));
  ok(!!quoted, "cities.csv 中带引号逗号的城市名解析正确", quoted?.name);
  ok(!cities.records.some((x) => x.name.includes('"')), "没有残留未处理的转义引号");
}

// ================================================================== 2
section("2. 模型构建");
const n = 12;
const k = 10;
const model = new RaceModel(brands.records, { k, n });
console.log(`\x1b[2m  名字数 N=${model.N}，观测点 T=${model.T}，关键帧 ${model.frameCount}\x1b[0m`);
{
  ok(model.T === 20, `观测点数应为 20（2000–2019），实际 ${model.T}`);
  ok(model.frameCount === (model.T - 1) * k + 1, `关键帧数 = (T-1)*k+1 = ${model.frameCount}`);
  ok(!model.hasCategory === false, "数据含有分类字段");
  ok(model.dateRange[0].getUTCFullYear() === 2000 && model.dateRange[1].getUTCFullYear() === 2019,
    "日期范围解析正确 2000–2019");
}

// ================================================================== 3
section("3. 整数帧与原始数据吻合");
{
  // 第 0 帧必须是 2000 年的真实快照
  const s0 = model.sample(0, 0, n);
  const y2000 = brands.records.filter((r) => r.date.getUTCFullYear() === 2000)
    .sort((a, b) => b.value - a.value);
  const realTop = y2000[0];
  ok(s0.bars.length === n, `首帧渲染 ${n} 根条形 (${s0.bars.length})`);
  ok(s0.bars[0].name === realTop.name, `首帧榜首 = ${realTop.name}，实际 ${s0.bars[0].name}`);
  ok(approx(s0.bars[0].value, realTop.value, 1e-9), "首帧榜首数值与原始值一致");
  ok(approx(s0.xMax, realTop.value, 1e-9), "轴域上界 = 榜首数值");

  // 全部可见条形的值都应与 2000 年真实 top-n 一致
  let allMatch = true;
  for (let i = 0; i < n; i++) {
    const bar = s0.bars.find((b) => b.rank === i);
    if (!bar || !approx(bar.value, y2000[i].value, 1e-9)) { allMatch = false; break; }
  }
  ok(allMatch, "首帧全部条形的排名与数值都与原始数据逐一对上");

  // 末帧必须是 2019 年真实快照
  const sEnd = model.sample(model.frameCount - 1, 0, n);
  const y2019 = brands.records.filter((r) => r.date.getUTCFullYear() === 2019)
    .sort((a, b) => b.value - a.value);
  ok(sEnd.bars[0].name === y2019[0].name, `末帧榜首 = ${y2019[0].name}，实际 ${sEnd.bars[0].name}`);
  ok(approx(sEnd.bars[0].value, y2019[0].value, 1e-9), "末帧榜首数值准确");

  // 中间整数帧（每个观测点所在的那一帧）
  let idxOk = true;
  for (let year = 2000; year <= 2019; year++) {
    const fi = (year - 2000) * k;
    const s = model.sample(fi, 0, n);
    const truth = brands.records.filter((r) => r.date.getUTCFullYear() === year)
      .sort((a, b) => b.value - a.value)[0];
    if (s.bars[0].name !== truth.name || !approx(s.bars[0].value, truth.value, 1e-9)) {
      idxOk = false;
      console.log(`      ${year}: 期望 ${truth.name}/${truth.value}，得到 ${s.bars[0].name}/${s.bars[0].value}`);
      break;
    }
  }
  ok(idxOk, "全部 20 个年份的整数帧榜首都与原始数据一致");
}

// ================================================================== 4
section("4. 帧边界连续性（动画不跳变的关键）");
{
  let maxJump = 0;
  let maxDateJump = 0;
  for (let i = 0; i < model.frameCount - 2; i++) {
    const endOfPrev = model.sample(i, 1, n);        // 第 i 帧末尾
    const startOfNext = model.sample(i + 1, 0, n);  // 第 i+1 帧开头
    const mapA = new Map(endOfPrev.bars.map((b) => [b.name, b]));
    for (const b of startOfNext.bars) {
      const a = mapA.get(b.name);
      if (a) {
        maxJump = Math.max(maxJump, Math.abs(a.value - b.value));
        maxJump = Math.max(maxJump, Math.abs(a.rank - b.rank));
      }
    }
    maxDateJump = Math.max(maxDateJump, Math.abs(endOfPrev.date - startOfNext.date));
  }
  ok(maxJump < 1e-6, `跨帧 Max(\u0394值/\u0394名次) = ${maxJump.toExponential(2)}，低于 1e-6`);
  ok(maxDateJump < 1, `跨帧日期跳变 ${maxDateJump}ms，低于 1ms`);
}

// ================================================================== 5
section("5. 名次语义");
{
  const s = model.sample(50, 0.5, n);
  const sorted = [...s.bars].sort((a, b) => a.rank - b.rank);
  // rank 应按 value 降序（同一时刻）
  let monotonic = true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].value > sorted[i - 1].value + 1e-6) { monotonic = false; break; }
  }
  ok(monotonic, "任意时刻：名次靠前者的值不小于靠后者");

  // 插值帧里 rank 应为浮点（平滑滑动），整数帧可为整数
  const mid = model.sample(10, 0.37, n);
  ok(mid.bars.some((b) => Math.abs(b.rank - Math.round(b.rank)) > 1e-9),
    "插值帧出现浮点名次 ⇒ 条形是平滑滑动而非瞬移");

  const intFrame = model.sample(20, 0, n);
  ok(intFrame.bars.every((b) => Math.abs(b.rank - Math.round(b.rank)) < 1e-9),
    "整数帧名次归整到 0..n-1");
}

// ================================================================== 6
section("6. 候选集剪枝正确性（剪枝后的结果与全量排序一致）");
{
  const full = new RaceModel(brands.records, { k, prune: false });
  let diffCount = 0;
  let checked = 0;
  for (let i = 0; i < model.frameCount; i += 7) {
    for (const u of [0, 0.5]) {
      const A = model.sample(i, u, n);
      const B = full.sample(i, u, n);
      const mapB = new Map(B.bars.map((b) => [b.name, b]));
      for (const a of A.bars) {
        checked++;
        const b = mapB.get(a.name);
        if (!b) { diffCount++; continue; }
        if (!approx(a.value, b.value, 1e-9) || Math.abs(a.rank - b.rank) > 1e-9) diffCount++;
      }
    }
  }
  ok(diffCount === 0, `抽查 ${checked} 个条形，剪枝版与全量版无一差异 (${diffCount})`);

  const cand = model.candidates(n);
  ok(cand.length < model.N, `候选集 ${cand.length} < 全体 ${model.N}，剪枝确实生效`);
}

// ================================================================== 7
section("7. 大数据集性能");
{
  const t0 = performance.now();
  const cm = new RaceModel(cities.records, { k: 10 });
  const t1 = performance.now();
  console.log(`\x1b[2m  城市 N=${cm.N}，T=${cm.T}，关键帧 ${cm.frameCount}\x1b[0m`);

  const t2 = performance.now();
  const STEPS = 400;
  for (let f = 0; f < STEPS; f++) cm.sample(f, (f % 10) / 10, 12);
  const t3 = performance.now();
  const perFrame = (t3 - t2) / STEPS;
  console.log(`\x1b[2m  构建 ${(t1 - t0).toFixed(0)}ms；连续采样 ${perFrame.toFixed(3)}ms/帧\x1b[0m`);
  ok(t1 - t0 < 5000, `大数据集构建耗时 ${(t1 - t0).toFixed(0)}ms 在可接受范围`);
  ok(perFrame < 4, `单帧采样 ${perFrame.toFixed(3)}ms，满足 60fps (16.7ms) 预算`);

  // 用合成大数据集检验剪枝在“名字远多于榜单”时的真实收益
  const synthetic = [];
  const NP = 4000; // 4000 个参赛者
  const TP = 120;  // 120 个时间点
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let p = 0; p < NP; p++) {
    // 让每个参赛者有不同的量级，保证榜单长期稳定、局部有更替
    const base = Math.pow(1.02, NP - p) * 10;
    for (let t = 0; t < TP; t++) {
      synthetic.push({
        date: new Date(Date.UTC(1900 + t, 0, 1)),
        name: `参赛者-${p}`,
        value: base * (1 + 0.4 * Math.sin(t / 9 + p)) + rnd() * base * 0.1,
      });
    }
  }
  const bm = new RaceModel(synthetic, { k: 6 });
  const candN = bm.candidates(12).length;
  console.log(`\x1b[2m  合成集 N=${bm.N}，T=${bm.T}，候选 ${candN}\x1b[0m`);
  ok(candN < bm.N * 0.1, `候选集压缩到 ${candN}/${bm.N} (${(candN / bm.N * 100).toFixed(2)}%)，剪枝高效`);

  const tA = performance.now();
  for (let f = 0; f < 300; f++) bm.sample(f, (f % 6) / 6, 12);
  const bigFrame = (performance.now() - tA) / 300;
  console.log(`\x1b[2m  4000 参赛者下单帧采样 ${bigFrame.toFixed(3)}ms\x1b[0m`);
  ok(bigFrame < 4, `大规模下单帧采样 ${bigFrame.toFixed(3)}ms，仍满足实时预算`);

  // 剪枝版与全量版结果必须一致
  const fullBig = new RaceModel(synthetic, { k: 6, prune: false });
  let bigDiff = 0;
  for (let f = 0; f < 300; f += 3) {
    const A = bm.sample(f, 0.5, 12);
    const B = fullBig.sample(f, 0.5, 12);
    const mapB = new Map(B.bars.map((b) => [b.name, b]));
    for (const a of A.bars) {
      const b = mapB.get(a.name);
      if (!b || !approx(a.value, b.value, 1e-9) || Math.abs(a.rank - b.rank) > 1e-9) bigDiff++;
    }
  }
  ok(bigDiff === 0, `大规模下剪枝版与全量版结果零差异 (${bigDiff})`);
}

// ================================================================== 8
section("8. 边界与健壮性");
{
  // n 大于名字总数时不炸
  const s = model.sample(0, 0, 9999);
  ok(s.bars.length <= model.N, `n 超过总数时安全降级到 ${s.bars.length}`);

  // 越界索引被钳制
  ok(model.sample(-5, 0, n).bars.length > 0, "负索引被钳制且不报错");
  ok(model.sample(1e9, 0, n).bars.length > 0, "超界索引被钳制且不报错");

  // u 超出 [0,1] 时线性外推不崩溃
  ok(Number.isFinite(model.sample(30, 1.5, n).bars[0].value), "u>1 时不产生 NaN");

  // 单观测点也能构造
  const single = new RaceModel(
    [{ date: new Date(Date.UTC(2020, 0, 1)), name: "A", value: 1 },
     { date: new Date(Date.UTC(2020, 0, 1)), name: "B", value: 2 }],
    { k: 10 }
  );
  ok(single.frameCount === 1, "单点数据集关键帧数为 1");
  ok(single.sample(0, 1, 2).bars[0].name === "B", "单点数据集正确排序");

  // 升序模式：榜首应当是“该时刻全体成员中最小的”，缺失记 0 的名字也算在内
  const asc = new RaceModel(brands.records, { k, order: "asc" });
  const sAsc = asc.sample(0, 0, 5);
  const withMissing = new Map(model.names.map((nm) => [nm, 0]));
  for (const r of brands.records) {
    if (r.date.getUTCFullYear() === 2000) withMissing.set(r.name, r.value);
  }
  const minVal = Math.min(...withMissing.values());
  ok(approx(sAsc.bars[0].value, minVal, 1e-9),
    `升序模式榜首值为全场最小 ${minVal}，实际 ${sAsc.bars[0].value}`);
  ok(withMissing.get(sAsc.bars[0].name) === minVal,
    `升序榜首 ${sAsc.bars[0].name} 确实处于最小值那一档`);
  ok(sAsc.xMax >= sAsc.bars[0].value, "升序模式下轴域依然有效");

  // 确定性：同等输入必须产出同等输出（否则导出的视频不可复现）
  const again = new RaceModel(brands.records, { k, order: "asc" });
  const sa = again.sample(37, 0.4, 8);
  const sb = asc.sample(37, 0.4, 8);
  ok(sa.bars.map((b) => b.name).join("|") === sb.bars.map((b) => b.name).join("|"),
    "同一份数据重复构建，采样结果逐项一致（可复现）");
}

// ==================================================================
console.log(`\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}通过 ${passed} 项，失败 ${failed} 项\x1b[0m\n`);
process.exit(failed ? 1 : 0);
