/**
 * 控制台主逻辑
 * ------------------------------------------------------------------
 * 把「数据 → 模型 → 渲染器 → 播放器 → 导出」串成一条可交互的流水线。
 *
 * 一个设计上的关键点：改变显示条目数 n 不需要重建模型。
 * 核心引擎把名次与 n 解耦了，所以拖动 n 的滑杆是即时生效的，
 * 只有切换数据集或改变插值密度 k（帧数会变）时才重建模型。
 */

import { normalizeData } from "./core/csv.js";
import { TEMPLATES, templateBlob } from "./core/templates.js";
import { RaceModel } from "./core/keyframes.js";
import { RaceRenderer } from "./render/renderer.js";
import { PALETTES, ColorScale } from "./core/color.js";
import { Player } from "./player.js";
import { recordVideo, exportFrameSequence, snapshotPNG, download, pickMimeType } from "./exporter.js";
import { utcFormat, siFormat, cnNumber } from "./core/format.js";
import { clamp } from "./core/math.js";

// ─────────────────────────────────────────────── 数据集定义

const DATASETS = {
  brands: {
    name: "全球最具价值品牌 (2000–2019)",
    file: "./data/category-brands.csv",
    title: "全球最具价值品牌",
    subtitle: "按品牌价值排名 · 单位：百万美元",
    footer: "数据来源：Interbrand",
    n: 12, k: 10, frameDur: 250,
    dateFormat: "%Y",
  },
  cities: {
    name: "全球最大城市 (1575–2018)",
    file: "./data/cities.csv",
    title: "全球最大城市",
    subtitle: "按城市人口排名 · 单位：千人",
    footer: "数据来源：Chandler (1987), UN (2018)",
    n: 15, k: 2, frameDur: 90,
    dateFormat: "%Y",
  },
};

const CANVAS_THEMES = {
  dark: {
    background: "#0f1419", text: "#f0f4f8", subtext: "#9aa7b8",
    axis: "#7c8899", grid: "rgba(255,255,255,0.07)", ticker: "rgba(240,244,248,0.20)",
  },
  light: {
    background: "#ffffff", text: "#1f2933", subtext: "#6b7280",
    axis: "#9aa5b1", grid: "rgba(0,0,0,0.07)", ticker: "rgba(31,41,51,0.20)",
  },
  gradient: {
    background: ["#111827", "#1e293b", "#0f172a"], text: "#f8fafc", subtext: "#94a3b8",
    axis: "#64748b", grid: "rgba(255,255,255,0.08)", ticker: "rgba(248,250,252,0.18)",
  },
  paper: {
    background: "#faf8f4", text: "#23201c", subtext: "#7a7268",
    axis: "#b3a99c", grid: "rgba(35,32,28,0.06)", ticker: "rgba(35,32,28,0.16)",
  },
  // —— 科技深蓝：深空渐变 + 青色霓虹 + 点阵底纹 + 柱体发光 ——
  tech: {
    background: ["#03060f", "#071227", "#050c1c"],
    text: "#eaf2ff", subtext: "#7f93b8",
    axis: "#3f5f8f", grid: "rgba(0,229,255,0.10)", ticker: "rgba(0,229,255,0.42)",
    accent: "#00e5ff", dot: "rgba(130,190,255,0.08)",
    tickerSize: 2.0, glow: 0.55, mono: true,
  },
  // —— 赛博霓虹：纯黑底 + 洋红霓虹，发光最强 ——
  cyber: {
    background: ["#05010c", "#0d0320"],
    text: "#ffffff", subtext: "#c4a7e7",
    axis: "#7c4dff", grid: "rgba(124,77,255,0.16)", ticker: "rgba(255,0,230,0.48)",
    accent: "#ff00e6", dot: "rgba(255,255,255,0.05)",
    tickerSize: 2.1, glow: 0.75, mono: true,
  },
};

// ─────────────────────────────────────────────── 应用状态

const $ = (id) => document.getElementById(id);

const state = {
  model: null,
  renderer: null,
  player: null,
  datasetId: "brands",
  // URL 里显式指定的参数（n/k/frameDur）优先级高于数据集自带默认值
  urlSet: new Set(),
  rawText: null,
  records: null,
  header: null,
  customMeta: null,
  uiTheme: "dark",
  busy: false,
};

/** 当前生效的渲染/动画参数 */
const cfg = {
  n: 12, k: 10, frameDur: 250,
  labelLayout: "inline",
  palette: "tech",
  colorMode: "category",
  valueFormat: "full",
  barRadius: 0.28,
  depth3D: 0.45,
  iconPosition: "front",
  iconSize: 0.9,
  showValue: true, showAxis: true, showGrid: true, showTicker: true, fadeEdge: true,
  width: 1920, height: 1080, dpr: 1,
  canvasTheme: "tech",
  sortDir: "desc",
  easing: "linear",
  title: "", subtitle: "", footer: "",
};

// ─────────────────────────────────────────────── 初始化

async function init() {
  buildDatasetSelect();
  buildPaletteSelect();
  readUrlOverrides();
  applyUiTheme(state.uiTheme);

  state.renderer = new RaceRenderer($("chart"), {
    width: cfg.width, height: cfg.height, dpr: cfg.dpr,
    colorScale: new ColorScale({ palette: cfg.palette, mode: cfg.colorMode }),
  });

  await loadDataset(state.datasetId);
  bindControls();
  bindKeyboard();
  bindDragDrop();
  maybeRunTestMode();
}

function buildDatasetSelect() {
  const sel = $("dataset");
  sel.innerHTML = "";
  for (const [id, d] of Object.entries(DATASETS)) {
    const o = document.createElement("option");
    o.value = id; o.textContent = d.name;
    sel.appendChild(o);
  }
}

function buildPaletteSelect() {
  const sel = $("palette");
  sel.innerHTML = "";
  const labels = {
    tableau10: "Tableau 10（D3 默认）", observable10: "Observable 10",
    set2: "Set 2（柔和）", vivid: "Vivid（短视频高对比）",
    blues: "Blues（单色系）", warm: "Warm（暖色系）",
  };
  for (const key of Object.keys(PALETTES)) {
    const o = document.createElement("option");
    o.value = key; o.textContent = labels[key] || key;
    sel.appendChild(o);
  }
}

/** 允许用 URL 参数直接初始化，便于自动化与分享链接 */
function readUrlOverrides() {
  const q = new URLSearchParams(location.search);
  if (q.get("dataset") && DATASETS[q.get("dataset")]) state.datasetId = q.get("dataset");
  const preset = q.get("preset");
  if (preset) { const [w, h] = preset.split("x").map(Number); if (w && h) { cfg.width = w; cfg.height = h; } }
  if (q.get("theme")) state.uiTheme = q.get("theme");
  for (const key of ["n", "k", "frameDur"]) {
    if (q.get(key)) { cfg[key] = Number(q.get(key)); state.urlSet.add(key); }
  }
  for (const key of ["depth3D", "iconSize"]) if (q.get(key) != null) cfg[key] = Number(q.get(key));
  if (q.get("icon")) cfg.iconPosition = q.get("icon");
  if (q.get("label")) cfg.labelLayout = q.get("label");
  if (q.get("canvasTheme") && CANVAS_THEMES[q.get("canvasTheme")]) cfg.canvasTheme = q.get("canvasTheme");
  if (q.get("palette")) cfg.palette = q.get("palette");
  if (q.get("colorMode")) cfg.colorMode = q.get("colorMode");
  // 图层开关：0/1，便于自动化对比截图
  for (const key of ["showValue", "showAxis", "showGrid", "showTicker"]) {
    const v = q.get(key);
    if (v != null) cfg[key] = v !== "0" && v !== "false";
  }
  syncControls();
}

// ─────────────────────────────────────────────── 数据加载

async function loadDataset(id) {
  state.datasetId = id;
  const ds = DATASETS[id];
  if (!ds) return;
  const text = await readDatasetText(ds);
  ingest(text, { n: ds.n, k: ds.k, frameDur: ds.frameDur, title: ds.title, subtitle: ds.subtitle, footer: ds.footer, dateFormat: ds.dateFormat });
}

/**
 * 取数据集文本。
 * `ds.inline` 由单文件打包脚本注入 —— 把 CSV 直接嵌进 HTML，
 * 这样用 file:// 双击打开（没有 fetch、没有本地服务器）也能跑。
 */
async function readDatasetText(ds) {
  if (ds.inline != null) return ds.inline;
  const res = await fetch(ds.file);
  if (!res.ok) throw new Error(`数据集加载失败 (${res.status})：${ds.file}`);
  return res.text();
}

async function loadFile(file) {
  const text = await file.text();
  ingest(text, {
    n: 12, k: 10, frameDur: 250,
    title: file.name.replace(/\.(csv|txt|tsv)$/i, ""),
    subtitle: "上传数据", footer: "", dateFormat: "%Y",
  });
  toast(`已载入 ${file.name}`, "success");
}

/** 把一份 CSV 文本灌进模型，并按配置重建整条流水线 */
function ingest(text, meta) {
  try {
    const parsed = normalizeData(text);
    state.rawText = text;
    state.records = parsed.records;
    state.header = parsed.header;
    state.customMeta = meta;

    for (const [k2, v] of Object.entries(meta)) {
      // URL 显式传过的参数不被数据集默认值覆盖（自动化截图依赖这一点）
      if (["n", "k", "frameDur"].includes(k2)) { if (!state.urlSet.has(k2)) cfg[k2] = v; }
      else if (["title", "subtitle", "footer"].includes(k2)) cfg[k2] = v;
    }
    state.dateFormatSpec = meta.dateFormat || "%Y";

    rebuildModel();
    syncControls();
    updateDurationHint();

    // icon/image 列填的是图片 URL 时异步预加载；emoji 图标不需要这一步
    preloadIconImages(state.records).then((map) => {
      if (!map || !map.size) return;
      applyRendererOptions();
      if (state.player) state.player.render();
    });
  } catch (err) {
    recordPageError("ingest", String(err?.stack || err)); // 写进 DOM，无头环境也能读到
    // 常见错误给出可操作的提示，而不是让用户对着"解析失败"猜
    const hint =
      /未解析到有效数据行|为空/.test(err.message)
        ? "  请检查首行表头：长表需 date/name/value（或 日期/名称/数值），宽表首列为名称、其余列为时间。可点顶栏「模板下载」参考格式。"
        : "";
    toast("数据解析失败：" + err.message + hint, "error");
    console.error(err);
  }
}

/**
 * 预加载 icon/image 列里的图片 URL。
 * 只处理看起来像 URL 的值（emoji 图标直接画，不需要网络）。
 * 加载失败的条目静默跳过，由渲染器降级成首字圆牌。
 */
function preloadIconImages(records) {
  state.iconImages = null;
  const urls = new Set();
  for (const r of records) {
    const s = String(r.image ?? "").trim();
    if (/^https?:\/\/|^\.{0,2}\//.test(s)) urls.add(s);
  }
  if (!urls.size) return Promise.resolve(null);

  const map = new Map();
  return Promise.all(
    [...urls].map(
      (u) =>
        new Promise((done) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { map.set(u, img); done(); };
          img.onerror = () => done();
          img.src = u;
        })
    )
  ).then(() => { state.iconImages = map; return map; });
}

/** 重建模型并重接播放器（切换数据集 / 改 k 时调用） */
function rebuildModel() {
  state.model = new RaceModel(state.records, {
    k: cfg.k,
    order: cfg.sortDir,
  });

  const fmt = utcFormat(state.dateFormatSpec || "%Y");
  applyRendererOptions({ dateFormat: (d) => fmt(new Date(d)) });

  const keepProgress = state.player ? state.player.progress : 0;
  if (state.player) state.player.dispose();

  state.player = new Player({
    model: state.model,
    renderer: state.renderer,
    frameDuration: cfg.frameDur,
    n: cfg.n,
    easing: cfg.easing,
  });
  state.player.on("state", (playing) => $("playBtn").classList.toggle("playing", playing));
  state.player.on("frame", ({ sample }) => updateTransport(sample));
  state.player.progress = keepProgress;
}

/** 把 cfg 里的视觉参数刷进渲染器 */
function applyRendererOptions(extra = {}) {
  const colorScale = new ColorScale({ palette: cfg.palette, mode: cfg.colorMode });
  // 按数据里的出现顺序预热配色，让先登场的分类/名字拿到色板开头的颜色
  if (state.model) {
    if (cfg.colorMode === "category") {
      const seen = new Set();
      for (const c of state.model.categories) {
        if (c && !seen.has(c)) { seen.add(c); colorScale.assign(c); }
      }
    } else if (cfg.colorMode === "name") {
      for (const nm of state.model.names) colorScale.assign(nm);
    }
  }

  state.renderer.set({
    n: cfg.n,
    title: cfg.title,
    subtitle: cfg.subtitle,
    footer: cfg.footer,
    // 字号随画布宽度缩放：竖屏 1080 宽下 44px 标题会占掉 1/4 宽度，比例失调
    titleSize: clamp(Math.round(cfg.width * 0.023), 22, 46),
    subtitleSize: clamp(Math.round(cfg.width * 0.0115), 13, 24),
    footerSize: clamp(Math.round(cfg.width * 0.009), 12, 20),
    labelLayout: cfg.labelLayout,
    depth3D: cfg.depth3D,
    iconPosition: cfg.iconPosition,
    iconSize: cfg.iconSize,
    showValue: cfg.showValue,
    showAxis: cfg.showAxis,
    showGrid: cfg.showGrid,
    showTicker: cfg.showTicker,
    fadeEdge: cfg.fadeEdge,
    barRadius: cfg.barRadius,
    images: state.iconImages || null,
    theme: CANVAS_THEMES[cfg.canvasTheme],
    colorScale,
    valueFormat: valueFormatFor(),
    ...extra,
  });
}

/** 依据选择的格式方案产出数值格式化函数 */
function valueFormatFor() {
  switch (cfg.valueFormat) {
    case "raw": return (v) => String(Math.round(v));
    case "si": return (v) => siFormat(v, 3);
    case "cn": return (v) => cnNumber(v, 2);
    default: return (v) => Math.round(v).toLocaleString("en-US");
  }
}

// ─────────────────────────────────────────────── 控件绑定

function bindControls() {
  const on = (id, evt, fn) => $(id).addEventListener(evt, fn);

  $("dataset").addEventListener("change", (e) => {
    loadDataset(e.target.value).catch((err) => toast(err.message, "error"));
  });

  $("file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) loadFile(f);
  });

  $("themeToggle").addEventListener("click", () => {
    state.uiTheme = state.uiTheme === "dark" ? "light" : "dark";
    applyUiTheme(state.uiTheme);
  });

  $("panelToggle").addEventListener("click", () => $("panel").classList.toggle("open"));

  // —— 文案 ——
  for (const id of ["title", "subtitle", "footer"]) {
    on(id, "input", (e) => { cfg[id] = e.target.value; applyRendererOptions(); state.player?.render(); });
  }

  // —— 竞赛参数 ——
  on("n", "input", (e) => {
    cfg.n = +e.target.value;
    $("nVal").textContent = cfg.n;
    // 名次与 n 解耦，这里无需重建模型，改完立刻生效
    state.player?.setN(cfg.n);
  });

  on("k", "input", (e) => { $("kVal").textContent = e.target.value; });
  on("k", "change", (e) => {
    cfg.k = +e.target.value;
    rebuildModel();
    updateDurationHint();
  });

  on("frameDur", "input", (e) => {
    cfg.frameDur = +e.target.value;
    $("frameVal").textContent = cfg.frameDur;
    if (state.player) state.player.frameDuration = cfg.frameDur;
    updateDurationHint();
  });

  on("sortDir", "change", (e) => { cfg.sortDir = e.target.value; rebuildModel(); });
  on("easing", "change", (e) => { cfg.easing = e.target.value; state.player?.setEasing(cfg.easing); state.player?.render(); });

  // —— 外观 ——
  on("canvasTheme", "change", (e) => { cfg.canvasTheme = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("labelLayout", "change", (e) => { cfg.labelLayout = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("palette", "change", (e) => { cfg.palette = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("colorMode", "change", (e) => { cfg.colorMode = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("valueFormat", "change", (e) => { cfg.valueFormat = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("barRadius", "input", (e) => {
    cfg.barRadius = +e.target.value;
    $("radiusVal").textContent = cfg.barRadius.toFixed(2);
    applyRendererOptions(); state.player?.render();
  });
  on("depth3D", "input", (e) => {
    cfg.depth3D = +e.target.value;
    $("depthVal").textContent = cfg.depth3D.toFixed(2);
    applyRendererOptions(); state.player?.render();
  });
  on("iconPosition", "change", (e) => { cfg.iconPosition = e.target.value; applyRendererOptions(); state.player?.render(); });
  on("iconSize", "input", (e) => {
    cfg.iconSize = +e.target.value;
    $("iconSizeVal").textContent = cfg.iconSize.toFixed(2);
    applyRendererOptions(); state.player?.render();
  });

  for (const id of ["showValue", "showAxis", "showGrid", "showTicker", "fadeEdge"]) {
    on(id, "change", (e) => { cfg[id] = e.target.checked; applyRendererOptions(); state.player?.render(); });
  }

  // —— 模板下载：照格式填数据，Excel/WPS 打开不乱码（带 BOM） ——
  on("templateSel", "change", (e) => {
    const id = e.target.value;
    e.target.value = ""; // 复位占位项，允许连续下载同一份
    const t = TEMPLATES[id];
    if (!t) return;
    download(templateBlob(t.text), t.file);
    toast(`已下载「${t.label}」`, "success");
  });

  // —— 画布 ——
  on("preset", "change", (e) => {
    const [w, h] = e.target.value.split("x").map(Number);
    cfg.width = w; cfg.height = h;
    state.renderer.resize(w, h, cfg.dpr);
    applyRendererOptions(); state.player?.render();
  });
  on("dpr", "input", (e) => {
    cfg.dpr = +e.target.value;
    $("dprVal").textContent = cfg.dpr;
    state.renderer.resize(cfg.width, cfg.height, cfg.dpr);
    applyRendererOptions(); state.player?.render();
  });

  // —— 播放控制 ——
  on("playBtn", "click", () => state.player?.toggle());
  on("prevBtn", "click", () => state.player?.step(-1));
  on("nextBtn", "click", () => state.player?.step(1));
  on("loopBtn", "click", (e) => {
    if (!state.player) return;
    state.player.loop = !state.player.loop;
    e.currentTarget.classList.toggle("active", state.player.loop);
  });
  on("speed", "change", (e) => { if (state.player) state.player.speed = +e.target.value; });

  const scrub = (clientX) => {
    const tl = $("timeline");
    const r = tl.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    state.player?.pause();
    state.player.progress = p;
  };
  let scrubbing = false;
  $("timeline").addEventListener("pointerdown", (e) => {
    scrubbing = true;
    $("timeline").setPointerCapture(e.pointerId);
    scrub(e.clientX);
  });
  $("timeline").addEventListener("pointermove", (e) => { if (scrubbing) scrub(e.clientX); });
  $("timeline").addEventListener("pointerup", () => { scrubbing = false; });
  $("timeline").addEventListener("pointercancel", () => { scrubbing = false; });

  // —— 导出 ——
  on("exportVideo", "click", exportVideo);
  on("exportFrames", "click", exportFrames);
  on("exportPNG", "click", exportPng);
}

function bindKeyboard() {
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.code === "Space") { e.preventDefault(); state.player?.toggle(); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); state.player?.step(e.shiftKey ? -10 : -1); }
    else if (e.code === "ArrowRight") { e.preventDefault(); state.player?.step(e.shiftKey ? 10 : 1); }
    // 注意：可选链不能作赋值目标，这里必须显式判空
    else if (e.code === "Home") { if (state.player) state.player.progress = 0; }
    else if (e.code === "End") { if (state.player) state.player.progress = 1; }
  });
}

function bindDragDrop() {
  const wrap = $("canvasWrap");
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover"].forEach((t) => wrap.addEventListener(t, (e) => { stop(e); wrap.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((t) => wrap.addEventListener(t, (e) => { stop(e); wrap.classList.remove("dragover"); }));
  wrap.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) loadFile(f);
  });
}

/** 把 cfg 的当前值回填到界面控件 */
function syncControls() {
  for (const [id, val] of Object.entries({
    title: cfg.title, subtitle: cfg.subtitle, footer: cfg.footer,
  })) $(id).value = val;
  $("n").value = cfg.n; $("nVal").textContent = cfg.n;
  $("k").value = cfg.k; $("kVal").textContent = cfg.k;
  $("frameDur").value = cfg.frameDur; $("frameVal").textContent = cfg.frameDur;
  $("labelLayout").value = cfg.labelLayout;
  $("canvasTheme").value = cfg.canvasTheme;
  $("palette").value = cfg.palette;
  $("colorMode").value = cfg.colorMode;
  $("valueFormat").value = cfg.valueFormat;
  $("barRadius").value = cfg.barRadius; $("radiusVal").textContent = Number(cfg.barRadius).toFixed(2);
  $("depth3D").value = cfg.depth3D; $("depthVal").textContent = Number(cfg.depth3D).toFixed(2);
  $("iconPosition").value = cfg.iconPosition;
  $("iconSize").value = cfg.iconSize; $("iconSizeVal").textContent = Number(cfg.iconSize).toFixed(2);
  $("showValue").checked = cfg.showValue;
  $("showAxis").checked = cfg.showAxis;
  $("showGrid").checked = cfg.showGrid;
  $("showTicker").checked = cfg.showTicker;
  $("fadeEdge").checked = cfg.fadeEdge;
  $("preset").value = `${cfg.width}x${cfg.height}`;
  $("dpr").value = cfg.dpr; $("dprVal").textContent = cfg.dpr;
  $("sortDir").value = cfg.sortDir;
  $("easing").value = cfg.easing;
}

function applyUiTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function updateTransport(sample) {
  if (!sample) return;
  $("tlFill").style.width = (state.player.progress * 100).toFixed(2) + "%";
  $("curTime").textContent = state.renderer.options.dateFormat(sample.date);
}

function updateDurationHint() {
  if (!state.player) return;
  const sec = state.player.durationMs / 1000;
  const frames = state.model.frameCount;
  $("durHint").textContent = `${sec.toFixed(1)} 秒 · ${frames} 关键帧`;
}

// ─────────────────────────────────────────────── 导出

function setProgress(p, text) {
  $("progressWrap").classList.remove("hidden");
  $("progressBar").style.width = (p * 100).toFixed(1) + "%";
  if (text) $("progressText").textContent = text;
}
function clearProgress() {
  setTimeout(() => $("progressWrap").classList.add("hidden"), 1200);
}

async function guard(fn) {
  if (state.busy) return;
  state.busy = true;
  document.querySelectorAll(".export-row .btn").forEach((b) => (b.disabled = true));
  try { await fn(); }
  catch (err) { toast("导出失败：" + err.message, "error"); console.error(err); }
  finally {
    state.busy = false;
    document.querySelectorAll(".export-row .btn").forEach((b) => (b.disabled = false));
    clearProgress();
  }
}

async function exportVideo() {
  const p = state.player;
  await guard(async () => {
    p.pause();
    if (!pickMimeType()) {
      toast("当前浏览器不支持 MediaRecorder，正在改用帧序列导出", "error");
      return exportFrames();
    }
    setProgress(0, "准备录制…");
    const { blob, mimeType, frames, dropped } = await recordVideo({
      canvas: state.renderer.canvas,
      player: p,
      fps: +$("fps").value,
      bitrate: +$("bitrate").value,
      onProgress: (v) => setProgress(v, `录制中 ${Math.round(v * 100)}%`),
    });
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    download(blob, `${state.datasetId}-${Date.now()}.${ext}`);
    setProgress(1, "完成");
    toast(`已导出 ${frames} 帧 / ${ext.toUpperCase()}${dropped ? `（丢帧 ${dropped}）` : ""}`, "success");
  });
}

async function exportFrames() {
  await guard(async () => {
    state.player.pause();
    setProgress(0, "渲染帧序列…");
    const { blob, frames } = await exportFrameSequence({
      player: state.player,
      fps: +$("fps").value,
      onProgress: (v) => setProgress(v, `渲染 ${Math.round(v * 100)}%`),
    });
    download(blob, `${state.datasetId}-frames-${Date.now()}.zip`);
    setProgress(1, "完成");
    toast(`已打包 ${frames} 张 PNG`, "success");
  });
}

async function exportPng() {
  await guard(async () => {
    const blob = await snapshotPNG(state.player, 2);
    download(blob, `${state.datasetId}-${Math.round(state.player.position)}.png`);
    toast("已保存当前帧（2× 分辨率）", "success");
  });
}

// ─────────────────────────────────────────────── 工具

let toastTimer;
function toast(msg, kind = "") {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast " + kind; }, 3600);
}

// ───────────────────────────────────────────────
// 自动化测试钩子
// 无头浏览器没法操作 MediaRecorder，所以让页面把若干指定时刻的画面
// 渲染成 PNG dataURL 写回 DOM，外部再用 --dump-dom 取走落盘。
// 这样就能在 CI 里对实际渲染结果做校验并用 ffmpeg 合成样片。
// ───────────────────────────────────────────────
function maybeRunTestMode() {
  const q = new URLSearchParams(location.search);
  const count = Number(q.get("testframes") || 0);
  if (!count) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // 字体加载在无头环境下可能一直不 settle，超时兜底，别把整个测试卡死
  const timeout = (p, ms) => Promise.race([p, wait(ms)]);

  (async () => {
    try {
      if (document.fonts?.ready) await timeout(document.fonts.ready, 1500).catch(() => {});
      await wait(80);

      const out = [];
      for (let i = 0; i < count; i++) {
        const p = i / Math.max(1, count - 1);
        state.player.progress = p;
        await wait(16);
        out.push(state.renderer.canvas.toDataURL("image/png"));
      }

      const holder = document.createElement("script");
      holder.id = "testFrames";
      holder.type = "text/plain";
      holder.textContent = JSON.stringify(out);
      document.body.appendChild(holder);
    } catch (err) {
      recordPageError("testmode", String(err?.stack || err));
    }
    const done = document.createElement("div");
    done.id = "testDone";
    document.body.appendChild(done);
  })();
}

window.__bcr = { state, cfg, DATASETS, loadDataset, ingest, rebuildModel, applyRendererOptions };

// 把运行期异常写进 DOM —— 页面里肉眼可见，自动化脚本用 --dump-dom 也能读到
function recordPageError(kind, msg, stack) {
  const el = document.createElement("pre");
  el.id = "pageError";
  el.setAttribute("data-kind", kind);
  el.textContent = `[${kind}] ${msg}\n${stack || ""}`;
  document.body.appendChild(el);
  console.error(kind, msg, stack);
}
window.addEventListener("error", (e) => recordPageError("error", e.message, `${e.filename}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => recordPageError("unhandled", String(e.reason?.stack || e.reason)));

init().catch((err) => {
  recordPageError("init", String(err?.stack || err));
  toast("初始化失败：" + err.message, "error");
});
