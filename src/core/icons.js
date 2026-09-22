/**
 * 图标（柱头徽标）来源
 * ==================================================================
 * 优先级：
 *   1. CSV 里的 icon / image 列   —— 数据驱动，用户可自由改
 *   2. 按 category 映射的内置表   —— 行业 emoji / 国家国旗
 *   3. 按名字关键词猜             —— 兜底
 *   4. 首字圆牌                   —— 实在没有时（含 emoji 字体缺失）
 *
 * 关于 emoji 字体：Canvas 绘制 emoji 依赖系统字体。
 * 万一机器上没有（少数精简 Linux / 容器），探测失败会自动降级成首字圆牌，
 * 不会出现"豆腐块"。
 */

/** 行业 / 分类 → emoji */
export const CATEGORY_ICONS = {
  // 饮食
  beverages: "🥤", alcohol: "🍺", restaurants: "🍽️", food: "🍔", fmcg: "🧴",
  tobacco: "🚬", hospitality: "🏨",
  // 科技
  technology: "💻", electronics: "📱", telecommunications: "📡",
  "business services": "📊", logistics: "📦",
  // 出行
  automotive: "🚗", energy: "⛽",
  // 消费
  apparel: "👕", luxury: "💎", "sporting goods": "👟", retail: "🛍️",
  "toys & games": "🧸", diversified: "🏢",
  // 金融医疗
  "financial services": "🏦", financial: "🏦", pharmaceuticals: "💊",
  media: "📺",
  // 大洲（cities 数据集的 category 列是大洲名）
  asia: "🏯", europe: "🏰", "middle east": "🕌", africa: "🦁",
  "north america": "🗽", "south america": "🌴", oceania: "🐨",
  americas: "🗽",
  // —— 中文分类（中文数据的分类列直接就是"饮料/科技/汽车"） ——
  饮料: "🥤", 白酒: "🍶", 酒类: "🍺", 食品: "🍔", 餐饮: "🍽️", 日化: "🧴",
  科技: "💻", 互联网: "🌐", 电子: "📱", 通信: "📡", 半导体: "🔬",
  汽车: "🚗", 新能源: "⚡", 能源: "🛢️", 石油: "🛢️", 电力: "🔌",
  金融: "🏦", 银行: "🏦", 保险: "🛡️", 医药: "💊", 医疗: "🏥",
  地产: "🏗️", 房地产: "🏗️", 建筑: "🏗️", 机械: "⚙️", 化工: "🧪",
  服装: "👕", 体育: "⚽", 零售: "🛒", 电商: "🛒", 物流: "🚚",
  媒体: "📺", 娱乐: "🎬", 游戏: "🎮", 教育: "📚", 航空: "✈️",
  铁路: "🚄", 农业: "🌾", 旅游: "🧳", 烟草: "🚬", 奢侈品: "💎",
  直辖市: "🏙️", 副省级城市: "🏙️", 经济特区: "🏙️", 省会: "🏙️",
};

/** 国家 / 地区 → 国旗（cities 数据集的 category 列正好是国家名） */
export const COUNTRY_FLAGS = {
  china: "🇨🇳", japan: "🇯🇵", india: "🇮🇳", "united states": "🇺🇸", usa: "🇺🇸",
  brazil: "🇧🇷", mexico: "🇲🇽", russia: "🇷🇺", indonesia: "🇮🇩", germany: "🇩🇪",
  "united kingdom": "🇬🇧", uk: "🇬🇧", france: "🇫🇷", italy: "🇮🇹", spain: "🇪🇸",
  turkey: "🇹🇷", egypt: "🇪🇬", iran: "🇮🇷", pakistan: "🇵🇰", nigeria: "🇳🇬",
  bangladesh: "🇧🇩", "south korea": "🇰🇷", korea: "🇰🇷",   argentina: "🇦🇷",
  colombia: "🇨🇴", canada: "🇨🇦", australia: "🇦🇺",
  philippines: "🇵🇭", vietnam: "🇻🇳", thailand: "🇹🇭", "south africa": "🇿🇦",
  "saudi arabia": "🇸🇦", iraq: "🇮🇶", afghanistan: "🇦🇫", ukraine: "🇺🇦",
  poland: "🇵🇱", netherlands: "🇳🇱", belgium: "🇧🇪", sweden: "🇸🇪",
  switzerland: "🇨🇭", portugal: "🇵🇹", greece: "🇬🇷", romania: "🇷🇴",
  hungary: "🇭🇺", austria: "🇦🇹", czech: "🇨🇿", israel: "🇮🇱", singapore: "🇸🇬",
  malaysia: "🇲🇾", myanmar: "🇲🇲", ethiopia: "🇪🇹", kenya: "🇰🇪", peru: "🇵🇪",
  chile: "🇨🇱", venezuela: "🇻🇪", morocco: "🇲🇦", algeria: "🇩🇿", sudan: "🇸🇩",
  uzbekistan: "🇺🇿", kazakhstan: "🇰🇿", nepal: "🇳🇵", "sri lanka": "🇱🇰",
  cambodia: "🇰🇭", ghana: "🇬🇭", tanzania: "🇹🇿", uganda: "🇺🇬", angola: "🇦🇴",
  mozambique: "🇲🇿", yemen: "🇾🇪", syria: "🇸🇾", jordan: "🇯🇴", lebanon: "🇱🇧",
  tunisia: "🇹🇳", libya: "🇱🇾", somalia: "🇸🇴", cuba: "🇨🇺", haiti: "🇭🇹",
  bolivia: "🇧🇴", ecuador: "🇪🇨", guatemala: "🇬🇹", paraguay: "🇵🇾",
  uruguay: "🇺🇾", panama: "🇵🇦", "costa rica": "🇨🇷", jamaica: "🇯🇲",
  "new zealand": "🇳🇿", ireland: "🇮🇪", denmark: "🇩🇰", finland: "🇫🇮",
  norway: "🇳🇴", bulgaria: "🇧🇬", serbia: "🇷🇸", croatia: "🇭🇷",
  slovakia: "🇸🇰", belarus: "🇧🇾", azerbaijan: "🇦🇿",
  // 中国香港 / 中国台湾 / 中国澳门 属于中国，一律使用中国国旗
  "hong kong": "🇨🇳", taiwan: "🇨🇳", macau: "🇨🇳", "macao": "🇨🇳",
  // —— 中文国名（中文数据的分类列直接写"日本/美国"） ——
  中国: "🇨🇳", 日本: "🇯🇵", 印度: "🇮🇳", 美国: "🇺🇸", 韩国: "🇰🇷",
  英国: "🇬🇧", 法国: "🇫🇷", 德国: "🇩🇪", 俄罗斯: "🇷🇺", 巴西: "🇧🇷",
  意大利: "🇮🇹", 西班牙: "🇪🇸", 加拿大: "🇨🇦", 澳大利亚: "🇦🇺",
  墨西哥: "🇲🇽", 印尼: "🇮🇩", 印度尼西亚: "🇮🇩", 土耳其: "🇹🇷",
  沙特: "🇸🇦", 泰国: "🇹🇭", 越南: "🇻🇳", 菲律宾: "🇵🇭", 新加坡: "🇸🇬",
  马来西亚: "🇲🇾", 埃及: "🇪🇬", 南非: "🇿🇦", 尼日利亚: "🇳🇬",
  阿根廷: "🇦🇷", 荷兰: "🇳🇱", 瑞士: "🇨🇭", 瑞典: "🇸🇪", 波兰: "🇵🇱",
  巴基斯坦: "🇵🇰", 孟加拉国: "🇧🇩", 伊朗: "🇮🇷", 伊拉克: "🇮🇶",
  乌克兰: "🇺🇦", 希腊: "🇬🇷", 葡萄牙: "🇵🇹", 奥地利: "🇦🇹",
  // 中文语境下的中国地区词
  中国香港: "🇨🇳", 中国台湾: "🇨🇳", 中国澳门: "🇨🇳",
};

/** 名字关键词 → emoji（在分类表没命中时用，写最常见的即可） */
export const NAME_HINTS = [
  [/coca|pepsi|cola|beer|wine|whisky|spirits|vodka/i, "🥤"],
  [/apple|microsoft|google|amazon|intel|ibm|oracle|samsung|sony|siemens|hp\b|cisco|nvidia|facebook|meta|netflix|uber|ebay|salesforce|huawei|xiaomi|lenovo|dell|qualcomm|tsmc/i, "💻"],
  [/toyota|honda|nissan|bmw|mercedes|benz|ford|volkswagen|audi|hyundai|kia|chevrolet|ferrari|porsche|tesla|volvo|suzuki|mazda|lexus|renault|peugeot/i, "🚗"],
  [/mcdonald|kfc|starbucks|burger|pizza|nestle|danone|kraft|heinz|unilever|coca/i, "🍔"],
  [/nike|adidas|puma|reebok|under armour|lululemon|new balance|asics/i, "👟"],
  [/louis vuitton|hermes|gucci|chanel|dior|prada|cartier|rolex|tiffany|burberry|versace|armani|zara|h&m|uniqlo/i, "💎"],
  [/walmart|target|tesco|carrefour|costco|ikea|aldi|lidl|7-eleven|alibaba|jd\b|ikea/i, "🛍️"],
  [/bank|jpmorgan|icbc|hsbc|citi|wells fargo|goldman|morgan stanley|visa|mastercard|amex|american express|allianz|axa|ping an/i, "🏦"],
  [/disney|warner|sony pictures|netflix|nbc|fox|cbs|viacom|comcast|time warner|universal/i, "📺"],
  [/pfizer|johnson|roche|novartis|merck|gsk|sanofi|abbott|bayer|astrazeneca|eli lilly/i, "💊"],
  [/shell|exxon|bp\b|chevron oil|petrobras|total|gazprom|sinopec|petrochina|eni/i, "⛽"],
  [/marlboro|camel|philip morris|british american/i, "🚬"],
  [/fedex|ups\b|dhl|maersk|logistics/i, "📦"],
  [/marriott|hilton|hyatt|airbnb|hotel/i, "🏨"],
  [/lego|nintendo|mattel|hasbro|bandai/i, "🧸"],
  [/samsung|lg\b|panasonic|philips|toshiba|hitachi|xiaomi|nokia|ericsson|motorola|huawei|zte/i, "📱"],
  [/financial|insurance|assurance/i, "🏦"],
];

const norm = (s) => String(s ?? "").trim().toLowerCase();

/** 彩色 emoji 字体栈：单一来源，渲染器画 emoji 与这里探测共用一份 */
export const EMOJI_FONT =
  `"Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", ` +
  `"Noto Color Emoji", "Twemoji Mozilla", "EmojiOne Color", sans-serif`;

/**
 * 求一个条目的图标。
 * @returns {{kind:"emoji"|"text", value:string}}
 *          kind=text 时 value 是"首字"，由渲染器画成圆牌
 */
export function iconFor(name, category, explicit) {
  // 1) 数据里显式给了 icon / image 列（emoji 或图片 URL 都行）
  if (explicit != null && String(explicit).trim() !== "") {
    const v = String(explicit).trim();
    return /^https?:|^\.{0,2}\//.test(v)
      ? { kind: "url", value: v }
      : { kind: "emoji", value: takeGrapheme(v) };
  }

  // 2) 分类表（行业 / 国家）
  const cat = norm(category);
  if (cat) {
    if (CATEGORY_ICONS[cat]) return { kind: "emoji", value: CATEGORY_ICONS[cat] };
    if (COUNTRY_FLAGS[cat]) return { kind: "emoji", value: COUNTRY_FLAGS[cat] };
  }

  // 3) 名字关键词
  const nm = norm(name);
  for (const [re, emoji] of NAME_HINTS) if (re.test(nm)) return { kind: "emoji", value: emoji };

  // 4) 兜底：首字圆牌
  return { kind: "text", value: initial(name) };
}

/** 取首字：中文取第一个汉字，英文取首字母 */
export function initial(name) {
  const s = String(name ?? "").trim();
  if (!s) return "?";
  const ch = s[0];
  if (/[\u4e00-\u9fa5]/.test(ch)) return ch;
  const m = s.match(/[A-Za-z0-9]/);
  return (m ? m[0] : ch).toUpperCase();
}

/** 只取第一个"字形簇"，避免 emoji 带修饰后缀被截断成半个 */
function takeGrapheme(s) {
  const m = String(s).match(/\p{Extended_Pictographic}(?:\uFE0F)?(?:\p{Emoji_Modifier})?/u);
  if (m) return m[0];
  return Array.from(String(s))[0] ?? "";
}

let _emojiOk = null;

/**
 * 探测系统是否真的能画出 emoji。
 * 用"emoji 宽度 vs 未分配码位(tofu)宽度"比较：
 * 没有 emoji 字体时两者都是豆腐块，宽度相同。
 */
/**
 * emoji 彩色渲染探测。
 * 只对比宽度不可靠：装了 NotoSansSymbols2 之类黑白符号字体的 Linux，
 * 部分 emoji 码点宽度与 tofu 不同，画出来却是方块。
 * 所以这里直接离屏画一个纯色 emoji，检查有没有"彩色像素" ——
 * 黑白字形不管多正常都不算支持，宁可降级成首字圆牌，也不出豆腐块。
 */
export function detectEmojiSupport() {
  if (_emojiOk != null) return _emojiOk;
  try {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 24;
    const c = tile.getContext("2d");
    if (!c) { _emojiOk = false; return false; }
    c.textBaseline = "middle";
    c.font = `18px ${EMOJI_FONT}`;
    c.fillText("\u{1F7EA}", 3, 12); // 🟪 紫色大方块，正常人眼可见级别的大 emoji
    const d = c.getImageData(0, 0, 24, 24).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 24) continue;                       // 全透明
      const max = Math.max(d[i], d[i + 1], d[i + 2]);
      const min = Math.min(d[i], d[i + 1], d[i + 2]);
      if (max - min > 40) { _emojiOk = true; return true; } // 存在彩色像素
    }
    _emojiOk = false;
  } catch {
    _emojiOk = false;
  }
  return _emojiOk;
}

/** 测试用：强制重置探测缓存 */
export function resetEmojiDetection() { _emojiOk = null; }
