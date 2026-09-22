/**
 * CSV 解析与数据整形
 * ------------------------------------------------------------------
 * Bar Chart Race 的输入只有两种形态：
 *
 *   A) 长表（long / tidy）—— 每行一条观测：
 *        date,name,category,value
 *        2000-01-01,Coca-Cola,Beverages,72537
 *        2000-01-01,Microsoft,Technology,70196
 *
 *   B) 宽表（wide / matrix）—— 每行一个参赛者，每列一个时间点：
 *        name,1990,1991,1992
 *        广东,1559,1780,2293
 *
 * Flourish 的界面就是要求用户上传宽表。这里两种都吃，自动识别。
 */

/** RFC4180 CSV 解析：支持引号包裹、"" 转义、字段内逗号与换行 */
export function parseCSV(text) {
  text = text.replace(/^﻿/, ""); // BOM
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }

  if (!rows.length) return { header: [], rows: [] };
  const header = rows[0].map((h) => h.trim());
  const body = rows.slice(1).filter((r) => !(r.length === 1 && r[0].trim() === ""));
  return { header, rows: body };
}

const NUM_RE = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]?\d{1,2}:\d{2}(:\d{2})?)?/;

function autoTypeCell(s) {
  if (s == null) return s;
  const t = s.trim();
  if (t === "" || t === "-" || t === "NA" || t === "null" || t === "NaN") return null;
  if (NUM_RE.test(t)) {
    const n = parseFloat(t);
    if (Number.isFinite(n)) return n;
  }
  if (DATE_RE.test(t)) {
    const d = parseFlexibleDate(t);
    if (d && Number.isFinite(d.getTime())) return d;
  }
  return s;
}

/** 把多种常见写法统一成 UTC 零点日期，避免时区抖动 */
export function parseFlexibleDate(input) {
  if (input instanceof Date) return toUTC(input);
  if (typeof input === "number") {
    // 纯年份
    if (Number.isInteger(input) && input >= 1000 && input <= 3000) {
      return new Date(Date.UTC(input, 0, 1));
    }
    return new Date(Date.UTC(1970, 0, 1) + input * 86400000);
  }
  let s = String(input).trim();

  // 2023Q1 / 2023-Q1 / 2023年 / 2023H1
  const m = /^(\d{4})[-\s]?([QqHh])(\d)$/.exec(s);
  if (m) {
    const y = +m[1];
    const step = m[2].toLowerCase() === "q" ? 3 : 6;
    return new Date(Date.UTC(y, (m[3] - 1) * step, 1));
  }
  const cy = /^(\d{4})年(\d{1,2})?月?(\d{1,2})?日?$/.exec(s);
  if (cy) {
    return new Date(Date.UTC(+cy[1], cy[2] ? +cy[2] - 1 : 0, cy[3] ? +cy[3] : 1));
  }
  const ymd = /^(\d{4})[-\/.](\d{1,2})([-\/.](\d{1,2}))?/.exec(s);
  if (ymd) {
    return new Date(Date.UTC(+ymd[1], +ymd[2] - 1, ymd[4] ? +ymd[4] : 1));
  }
  // 纯年份：2023
  if (/^\d{4}$/.test(s)) return new Date(Date.UTC(+s, 0, 1));
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return toUTC(d);
  return null;
}

function toUTC(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** 列名归一化：处理 date/DATE/ 日期 等各种写法 */
const ALIASES = {
  date: ["date", "time", "year", "日期", "时间", "年份", "period", "month"],
  name: ["name", "label", "category_name", "名称", "名字", "参赛者", "entity", "item", "key", "地区", "省份"],
  value: ["value", "val", "v", "amount", "gdp", "数值", "值", "数量", "金额"],
  category: ["category", "group", "type", "sector", "region", "分类", "类别", "分组", "国家"],
  image: ["image", "img", "icon", "flag", "url", "图片", "图标", "链接"],
  code: ["code", "iso", "id", "编码", "代码"],
};

function normalizeKey(h) {
  return String(h).trim().toLowerCase().replace(/\s+/g, "_");
}

function findColumn(header, keys) {
  const normd = header.map((h) => normalizeKey(h));
  for (const k of keys) {
    const idx = normd.indexOf(k);
    if (idx >= 0) return header[idx];
  }
  return null;
}

/**
 * 把任意 CSV 文本转成标准记录数组：
 *   [{ date: Date, name: string, value: number, category?: string, image?: string }]
 *
 * @param {string} text
 * @param {object} [opt] 手动指定列名：{date,name,value,category,image}
 */
export function normalizeData(text, opt = {}) {
  const { header, rows } = parseCSV(text);
  if (!header.length) throw new Error("CSV 为空或格式无法识别");

  let dateCol = opt.date || findColumn(header, ALIASES.date);
  let nameCol = opt.name || findColumn(header, ALIASES.name);
  let valueCol = opt.value || findColumn(header, ALIASES.value);
  const categoryCol = opt.category || findColumn(header, ALIASES.category);
  const imageCol = opt.image || findColumn(header, ALIASES.image);

  const records = [];
  let isWide = false;

  if (dateCol && nameCol && valueCol) {
    // —— 长表 ——
    for (const row of rows) {
      const o = {};
      header.forEach((h, i) => (o[h] = row[i]));
      const date = coerceDate(o[dateCol]);
      const name = o[nameCol];
      let value = o[valueCol];
      if (typeof value === "string") value = parseFloat(String(value).replace(/[,\s]/g, ""));
      if (date == null || name == null || value == null || !Number.isFinite(value)) continue;
      records.push({
        date,
        name: String(name).trim(),
        value,
        category: categoryCol ? o[categoryCol] : undefined,
        image: imageCol ? o[imageCol] : undefined,
      });
    }
  } else {
    // —— 宽表：第一列是名称，其余列是时间点 ——
    isWide = true;
    const key = opt.name ? nameCol : header[0];
    const timeCols = header.slice(1).filter((h) => h !== key);
    for (const row of rows) {
      const o = {};
      header.forEach((h, i) => (o[h] = row[i]));
      const name = o[key];
      if (name == null || String(name).trim() === "") continue;
      for (const c of timeCols) {
        const raw = o[c];
        const value = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").replace(/[,\s%]/g, ""));
        if (!Number.isFinite(value)) continue;
        const date = coerceDate(c);
        if (!date) continue;
        records.push({
          date,
          name: String(name).trim(),
          value,
          category: categoryCol ? o[categoryCol] : undefined,
          image: imageCol ? o[imageCol] : undefined,
        });
      }
    }
  }

  if (!records.length) throw new Error("未解析到有效数据行，请检查列名或数据格式");
  return { records, header, isWide, columns: { dateCol, nameCol, valueCol, categoryCol, imageCol } };
}

function coerceDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return toUTC(v);
  if (typeof v === "number") return parseFlexibleDate(v);
  const s = String(v).trim();
  const num = parseFloat(s.replace(/,/g, ""));
  // 纯数字列（如 2000）在时间列里应作年份处理
  if (NUM_RE.test(s) && Number.isFinite(num)) {
    const maybe = parseFlexibleDate(num);
    if (maybe) return maybe;
  }
  return parseFlexibleDate(s);
}

/** 导出为标准长表 CSV，方便用户二次加工 */
export function toCSV(records) {
  const head = ["date", "name", "category", "value"];
  const lines = [head.join(",")];
  for (const r of records) {
    const d = r.date instanceof Date ? r.date.toISOString().slice(0, 10) : r.date;
    lines.push([d, q(r.name), q(r.category), r.value].join(","));
  }
  return lines.join("\n");
}

function q(s) {
  if (s == null || s === "") return "";
  const str = String(s);
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}
