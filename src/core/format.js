/**
 * 数值与日期格式化
 * ------------------------------------------------------------------
 * 对标 d3-format / d3-time-format 的常用子集，零依赖实现。
 */

const DEFAULT_LOCALE = {
  thousands: ",",
  decimal: ".",
  groupSize: 3,
};

/**
 * 千分位分组：把整数部分每 3 位插分隔符。
 * 注意要处理负数与已经带小数的情况。
 */
function groupInt(intStr, loc) {
  const neg = intStr.startsWith("-");
  let s = neg ? intStr.slice(1) : intStr;
  if (s.length <= loc.groupSize) return intStr;
  let out = "";
  for (let i = s.length; i > 0; i -= loc.groupSize) {
    const chunk = s.slice(Math.max(0, i - loc.groupSize), i);
    out = out ? chunk + loc.thousands + out : chunk;
  }
  return (neg ? "-" : "") + out;
}

/**
 * 灵活数值格式化
 * @param {number} value
 * @param {object} [opt]
 * @param {string} [opt.spec]  简短格式串，如 ",d" ".1f" ",.2f" "%"
 * @param {number} [opt.digits] 小数位数（spec 未给时用）
 */
export function formatNumber(value, opt = {}) {
  if (value == null || Number.isNaN(value)) return "";
  const loc = { ...DEFAULT_LOCALE, ...opt };
  let grouping = false;
  let digits = opt.digits ?? null;
  let type = "d";

  if (opt.spec) {
    const m = /^([,])?(?:\.(\d+))?([defgs%])$/.exec(opt.spec.trim());
    if (m) {
      grouping = m[1] === ",";
      if (m[2] != null) digits = parseInt(m[2], 10);
      type = m[3];
    }
  }

  if (type === "s") return siFormat(value, digits ?? 3);
  if (type === "%") {
    const s = (value * 100).toFixed(digits ?? 1);
    return maybeGroup(s, grouping, loc) + "%";
  }

  const fixed = digits == null ? null : Number(value).toFixed(digits);
  if (fixed != null) return maybeGroup(fixed, grouping, loc);

  // 非 '.' 指定的整数模式：四舍五入到整数
  return maybeGroup(String(Math.round(Number(value))), grouping, loc);
}

function maybeGroup(numStr, grouping, loc) {
  if (!grouping) return numStr;
  const neg = numStr.startsWith("-");
  let s = neg ? numStr.slice(1) : numStr;
  const dot = s.indexOf(".");
  const intPart = dot >= 0 ? s.slice(0, dot) : s;
  const fracPart = dot >= 0 ? s.slice(dot) : "";
  return (neg ? "-" : "") + groupInt(intPart, loc) + fracPart;
}

const SI_UNITS = [
  { v: 1e12, s: "T" },
  { v: 1e9, s: "B" },
  { v: 1e6, s: "M" },
  { v: 1e3, s: "k" },
];
const SI_UNITS_CN = [
  { v: 1e12, s: "万亿" },
  { v: 1e8, s: "亿" },
  { v: 1e4, s: "万" },
];

/** SI 缩写：1,234,567 → 1.23M */
export function siFormat(value, digits = 3) {
  const abs = Math.abs(value);
  for (const u of SI_UNITS) {
    if (abs >= u.v) {
      const n = value / u.v;
      const str = trimZeros(n.toFixed(digitsDecimal(n, digits)));
      return str + u.s;
    }
  }
  return trimZeros(value.toFixed(digitsDecimal(value, digits)));
}

/** 中文数量单位：123456789 → 1.23亿 */
export function cnNumber(value, digits = 2) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  for (const u of SI_UNITS_CN) {
    if (abs >= u.v) {
      const n = abs / u.v;
      return sign + trimZeros(n.toFixed(digitsDecimal(n, digits))) + u.s;
    }
  }
  return sign + String(Math.round(abs));
}

function digitsDecimal(n, digits) {
  const abs = Math.abs(n);
  if (abs >= 100) return Math.max(0, digits - 3);
  if (abs >= 10) return Math.max(0, digits - 2);
  return Math.max(0, digits - 1);
}

function trimZeros(s) {
  return s.indexOf(".") >= 0 ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * 日期格式化
 * 支持的占位符：%Y %y %m %d %b %B %j(季度) %H %M %S
 * UTC 语义（与 d3.utcFormat 一致），避免时区导致年份偏移。
 */
export function utcFormat(spec) {
  const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // 预编译：拆成 token 序列，避免每帧重复解析
  const parts = [];
  let last = 0;
  for (let i = 0; i < spec.length - 1; i++) {
    if (spec[i] === "%") {
      if (i > last) parts.push({ lit: spec.slice(last, i) });
      const ch = spec[i + 1];
      parts.push({ tok: ch });
      i++;
      last = i + 1;
    }
  }
  if (last < spec.length) parts.push({ lit: spec.slice(last) });

  return (date) => {
    if (!(date instanceof Date)) date = new Date(date);
    const y = date.getUTCFullYear();
    const mo = date.getUTCMonth();
    const d = date.getUTCDate();
    let out = "";
    for (const p of parts) {
      if (p.lit != null) { out += p.lit; continue; }
      switch (p.tok) {
        case "Y": out += String(y).padStart(4, "0"); break;
        case "y": out += String(y % 100).padStart(2, "0"); break;
        case "m": out += String(mo + 1).padStart(2, "0"); break;
        case "d": out += String(d).padStart(2, "0"); break;
        case "b": out += MONTHS_SHORT[mo]; break;
        case "B": out += MONTHS_LONG[mo]; break;
        case "j": out += "Q" + (Math.floor(mo / 3) + 1); break;
        case "H": out += String(date.getUTCHours()).padStart(2, "0"); break;
        case "M": out += String(date.getUTCMinutes()).padStart(2, "0"); break;
        case "S": out += String(date.getUTCSeconds()).padStart(2, "0"); break;
        case "%": out += "%"; break;
        default: out += p.tok;
      }
    }
    return out;
  };
}

/** 中文日期：2023年12月 */
export function cnDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`;
}
export function cnYear(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}年`;
}
