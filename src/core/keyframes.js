/**
 * Bar Chart Race 核心引擎
 * ==================================================================
 * 算法来源：Observable @d3/bar-chart-race（Mike Bostock，ISC License）
 * 本实现保留其数学本质，并做了三处工程化升级：
 *
 *  1) 连续时间采样（continuous sampling）
 *     D3 原版依赖 d3-transition 逐帧推进，只能顺序播放；这里把动画建模为
 *     纯函数 f(frameIndex, u) → 状态。于是可以任意 seek、变速、倒放，
 *     且每帧结果完全确定——录视频时不会因掉帧产生时长漂移。
 *
 *  2) 名次与显示条目数 n 解耦
 *     原版关键帧里写死 rank = min(n, i)，改一次 n 就要重建全部帧。
 *     这里每帧只存「全局降序名次 + 数值」，rank = min(n, globalRank) 在采样
 *     时现场算，拖动 n 的滑杆可实时响应，无需重算。
 *
 *  3) 候选集剪枝（candidate pruning）
 *     真正挤进榜首区的名字远少于全体。预先求「所有观测点的 top-(n+guard)
 *     并集」作为候选，后续排序只在这批候选上做，把 O(N log N) 压到与显示
 *     条目数同阶——这是它能扛住上万行数据的原因。
 *
 * ------------------------------------------------------------------
 * 术语
 *   观测 observation : 原始数据里的一个时间点，共 T 个
 *   关键帧 frame    : 相邻观测之间线性插值出 k 帧，总数 (T-1)·k + 1
 */

import { lerp, clamp } from "./math.js";

/**
 * 部分选择：把「最靠前的 k 个」移到数组头部。
 * desc 时是最小的反面（最大的 k 个），asc 时是最小的 k 个。
 * 平均 O(N)，避免了对全体的 O(N log N) 排序。
 */
function selectTopK(idx, vals, k, asc = false) {
  let lo = 0;
  let hi = idx.length - 1;
  const target = Math.min(k, hi);
  while (lo < hi) {
    const pivot = vals[idx[(lo + hi) >> 1]];
    let i = lo;
    let j = hi;
    while (i <= j) {
      if (asc) {
        while (vals[idx[i]] < pivot) i++;
        while (vals[idx[j]] > pivot) j--;
      } else {
        while (vals[idx[i]] > pivot) i++;
        while (vals[idx[j]] < pivot) j--;
      }
      if (i <= j) {
        const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
        i++; j--;
      }
    }
    if (target <= j) hi = j;
    else if (target >= i) lo = i;
    else break;
  }
  return idx;
}

/**
 * 按 direction 生成比较器。
 * 值相等时以「名字首次出现顺序」兜底 —— 这样每一帧的排列都是确定的，
 * 同一份数据多次跑出来的画面逐像素一致（对录像导出而言是硬要求）。
 * Array.prototype.sort 在 V8 里虽然稳定，但输入顺序依赖 Set/Map 的插入
 * 次序，显式 tie-break 才能杜绝不确定性。
 */
function comparator(vals, asc) {
  const primary = asc ? (a, b) => vals[a] - vals[b] : (a, b) => vals[b] - vals[a];
  return (a, b) => {
    const d = primary(a, b);
    return d !== 0 && !Number.isNaN(d) ? d : a - b;
  };
}

export class RaceModel {
  /**
   * @param {Array<{date:Date,name:string,value:number,category?:string,image?:string}>} records
   * @param {object} [opts]
   * @param {number} [opts.k=10]        相邻观测之间插入多少帧
   * @param {number} [opts.guard=16]    候选集裕度（防插值帧冒出榜外黑马）
   * @param {boolean} [opts.prune=true] 是否启用候选集剪枝
   * @param {"desc"|"asc"} [opts.order] 降序比大 / 升序比小
   */
  constructor(records, opts = {}) {
    this.k = Math.max(1, opts.k ?? 10);
    this.guard = opts.guard ?? 16;
    this.prune = opts.prune !== false;
    this.direction = opts.order === "asc" ? "asc" : "desc";

    this._cache = new Map();     // frameIndex → {date, vals}
    this._rankCache = new Map(); // `${i}|${n}` → {rank, topN, top}
    this._candCache = new Map(); // n → Int32Array

    this._build(records);
  }

  // ------------------------------------------------------------- 构建阶段

  _build(records) {
    const meta = new Map();   // name → { index, category, image }
    const byDate = new Map(); // timestamp → Map<name, value>

    for (const r of records) {
      const name = String(r.name);
      let m = meta.get(name);
      if (!m) {
        m = { index: meta.size, category: null, image: null };
        meta.set(name, m);
      }
      if (r.category != null && r.category !== "" && !m.category) m.category = String(r.category);
      if (r.image && !m.image) m.image = String(r.image);

      const t = r.date instanceof Date ? r.date.getTime() : Number(r.date);
      if (!Number.isFinite(t)) continue;
      let row = byDate.get(t);
      if (!row) { row = new Map(); byDate.set(t, row); }
      const v = Number(r.value);
      if (!Number.isFinite(v)) continue;
      // 同一 (date,name) 重复出现时保留较大值，避免脏数据互相打架
      const prev = row.get(name);
      row.set(name, prev == null ? v : Math.max(prev, v));
    }

    this.names = [];
    this.categories = [];
    this.images = [];
    for (const [name, m] of meta) {
      m.index = this.names.length;
      this.names.push(name);
      this.categories.push(m.category);
      this.images.push(m.image);
    }
    this.N = this.names.length;

    const times = Array.from(byDate.keys()).sort((a, b) => a - b);
    this.dates = times;
    this.T = times.length;

    // 数值矩阵：observations[time][nameIndex]
    this.observations = times.map((t) => {
      const row = byDate.get(t);
      const arr = new Float64Array(this.N);
      for (const [name, v] of row) {
        const m = meta.get(name);
        if (m) arr[m.index] = v;
      }
      return arr;
    });

    this.frameCount = this.T > 0 ? (this.T - 1) * this.k + 1 : 0;
    if (this.T === 0) throw new Error("有效观测点数量为 0");
  }

  // ------------------------------------------------------------- 候选集

  /**
   * 候选集合：所有观测点的 top-(n+guard) 取并集。
   * 名字只要在任一时刻挤进过榜单边缘，就会被长期纳入候选。
   * 用快速选择代替全排序，把单次代价压到 O(N)。
   */
  candidates(n) {
    const hit = this._candCache.get(n);
    if (hit) return hit;
    const take = Math.min(this.N, n + this.guard);
    const set = new Set();
    const buf = new Int32Array(this.N);
    const asc = this.direction === "asc";
    for (const vals of this.observations) {
      for (let i = 0; i < this.N; i++) buf[i] = i;
      // 注意方向：升序模式下要收的是「最小的那些」，而非最大的
      selectTopK(buf, vals, take - 1, asc);
      for (let i = 0; i < take; i++) set.add(buf[i]);
    }
    const arr = Int32Array.from(set);
    this._candCache.set(n, arr);
    return arr;
  }

  // ------------------------------------------------------------- 帧求值

  /**
   * 第 i 帧的数值快照（只做插值，不做排序）。
   * @returns {{date:number, vals:Float64Array}}
   */
  frame(i) {
    const key = clamp(Math.round(i), 0, this.frameCount - 1);
    const cached = this._cache.get(key);
    if (cached) return cached;

    let vals;
    let date;
    if (key <= 0) {
      vals = this.observations[0];
      date = this.dates[0];
    } else if (key >= this.frameCount - 1) {
      vals = this.observations[this.T - 1];
      date = this.dates[this.T - 1];
    } else {
      const oi = Math.min(Math.floor(key / this.k), this.T - 2);
      const u = (key - oi * this.k) / this.k;
      const a = this.observations[oi];
      const b = this.observations[oi + 1];
      vals = new Float64Array(this.N);
      for (let j = 0; j < this.N; j++) vals[j] = a[j] + (b[j] - a[j]) * u;
      date = lerp(this.dates[oi], this.dates[oi + 1], u);
    }

    const snap = { date, vals };
    this._cache.set(key, snap);
    if (this._cache.size > 800) {
      const keys = Array.from(this._cache.keys()).slice(0, 300);
      for (const kk of keys) this._cache.delete(kk);
    }
    return snap;
  }

  /**
   * 某帧在给定 n 下的名次表。
   * @returns {{rank:Map<number,number>, topN:Int32Array, top:number}}
   */
  ranks(i, n) {
    const key = `${clamp(Math.round(i), 0, this.frameCount - 1)}|${n}`;
    const hit = this._rankCache.get(key);
    if (hit) return hit;

    const snap = this.frame(i === Infinity ? this.frameCount - 1 : i);
    const limit = n + this.guard;

    const asc = this.direction === "asc";
    let idx;
    if (this.prune) {
      idx = Int32Array.from(this.candidates(n));
      if (idx.length > limit) {
        selectTopK(idx, snap.vals, limit - 1, asc);
        const head = Array.from(idx.subarray(0, limit));
        head.sort(comparator(snap.vals, asc));
        idx = Int32Array.from(head);
      } else {
        Array.prototype.sort.call(idx, comparator(snap.vals, asc));
      }
    } else {
      idx = new Int32Array(this.N);
      for (let j = 0; j < this.N; j++) idx[j] = j;
      Array.prototype.sort.call(idx, comparator(snap.vals, asc));
    }

    const rank = new Map();
    const m = Math.min(idx.length, limit);
    for (let j = 0; j < m; j++) rank.set(idx[j], Math.min(n, j));
    const topN = Int32Array.from(idx.subarray(0, Math.min(n, idx.length)));
    const top = idx.length ? snap.vals[idx[0]] : 0;

    const res = { rank, topN, top };
    this._rankCache.set(key, res);
    if (this._rankCache.size > 800) {
      const keys = Array.from(this._rankCache.keys()).slice(0, 300);
      for (const kk of keys) this._rankCache.delete(kk);
    }
    return res;
  }

  // ------------------------------------------------------------- 采样

  /**
   * 核心：把「第 fi 帧 + 帧内进度 u」翻译成一帧完整画面状态。
   *
   * 统一处理 D3 原版里 enter / update / exit 三种情形：
   *   · update —— 起止都在榜内
   *   · enter  —— 起点取自上一帧的全局名次（≥ n，位于榜单下沿），从边缘滑入
   *   · exit   —— 终点取自下一帧的全局名次（≥ n），滑向边缘后消失
   * 三者共用同一条 rank = min(n, globalRank) 公式，因此只有一条代码路径。
   *
   * @param {number} fi 整数关键帧索引
   * @param {number} u  帧内进度 [0,1]
   * @param {number} n  显示条目数
   */
  sample(fi, u, n) {
    const i0 = clamp(Math.floor(fi), 0, this.frameCount - 1);
    const i1 = Math.min(i0 + 1, this.frameCount - 1);
    const A = this.frame(i0);
    const B = this.frame(i1);
    const RA = this.ranks(i0, n);
    const RB = this.ranks(i1, n);

    // 参与绘制 = 本帧榜内 ∪ 下一帧榜内（正是 enter/exit 需要额外考虑的两类）
    const union = new Set(RA.topN);
    for (const id of RB.topN) union.add(id);

    const bars = [];
    let totalValue = 0;
    for (const id of union) {
      const rA = RA.rank.has(id) ? RA.rank.get(id) : n;
      const rB = RB.rank.has(id) ? RB.rank.get(id) : n;
      const vA = A.vals[id] || 0;
      const vB = B.vals[id] || 0;
      const rank = lerp(rA, rB, u);
      const value = lerp(vA, vB, u);
      if (value > 0) totalValue += value;

      bars.push({
        id,
        name: this.names[id],
        category: this.categories[id],
        image: this.images[id],
        rank,
        value,
        entering: !RA.topN.includes(id),
      });
    }

    // 坐标轴域 = 榜首值，两帧之间插值 ⇒ 轴的推移同样平滑
    const xMax = Math.max(1e-9, lerp(RA.top, RB.top, u));

    // 按名次升序输出：bars[0] 恒为榜首，绘制顺序也天然从前景到背景
    bars.sort((a, b) => a.rank - b.rank);

    return {
      date: lerp(A.date, B.date, u),
      frameIndex: i0,
      xMax,
      bars,
      totalValue,
    };
  }

  /** 某一帧所有可见条目的合计值，用于「总计」角标 */
  totalAt(fi, u, n) {
    return this.sample(fi, u, n).totalValue;
  }

  get dateRange() {
    return [new Date(this.dates[0]), new Date(this.dates[this.T - 1])];
  }

  get hasCategory() {
    return this.categories.some((c) => c != null && c !== "");
  }

  /** 全时空范围内的最大绝对值，用于兜底轴域估算 */
  get globalMax() {
    let m = 0;
    for (const row of this.observations) {
      for (let i = 0; i < row.length; i++) if (row[i] > m) m = row[i];
    }
    return m || 1;
  }

  get categoriesUnique() {
    const s = new Set();
    for (const c of this.categories) if (c) s.add(c);
    return Array.from(s).sort();
  }
}
