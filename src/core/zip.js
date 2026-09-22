/**
 * 极简 ZIP 打包器（store 模式，无压缩）
 * ------------------------------------------------------------------
 * PNG 本身已经压缩过，二次 deflate 收益极小；与其引入依赖，
 * 不如实现一百来行就把逐帧序列打包成 zip 给后期软件用。
 * 文件名限定 ASCII，避免 UTF-8 flag 带来的兼容问题。
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS 时间戳 */
function dosTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

export class ZipWriter {
  constructor() {
    this.files = [];
    this._offset = 0;
  }

  /**
   * @param {string} name 文件名（ASCII）
   * @param {Uint8Array} data 原始字节
   */
  add(name, data) {
    const { time, day } = dosTime();
    const crc = crc32(data);
    const nameBytes = new TextEncoder().encode(name);

    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);            // version needed
    dv.setUint16(6, 0, true);             // flags
    dv.setUint16(8, 0, true);             // method = store
    dv.setUint16(10, time, true);
    dv.setUint16(12, day, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);

    this.files.push({
      name: nameBytes,
      crc,
      size: data.length,
      offset: this._offset,
      time,
      day,
      localHeader: local,
      data,
    });
    this._offset += local.length + data.length;
    return this;
  }

  /** 生成完整 zip 字节 */
  build() {
    const central = [];
    let cdSize = 0;
    for (const f of this.files) {
      const h = new Uint8Array(46 + f.name.length);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, 0x02014b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, 0, true);
      dv.setUint16(12, f.time, true);
      dv.setUint16(14, f.day, true);
      dv.setUint32(16, f.crc, true);
      dv.setUint32(20, f.size, true);
      dv.setUint32(24, f.size, true);
      dv.setUint16(28, f.name.length, true);
      dv.setUint16(30, 0, true);
      dv.setUint16(32, 0, true);
      dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true);
      dv.setUint32(38, 0, true);
      dv.setUint32(42, f.offset, true);
      h.set(f.name, 46);
      central.push(h);
      cdSize += h.length;
    }

    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, this.files.length, true);
    dv.setUint16(10, this.files.length, true);
    dv.setUint32(12, cdSize, true);
    dv.setUint32(16, this._offset, true);
    dv.setUint16(20, 0, true);

    const parts = [];
    for (const f of this.files) parts.push(f.localHeader, f.data);
    parts.push(...central, eocd);

    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }
}
