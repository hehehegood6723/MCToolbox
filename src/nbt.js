/**
 * 极简 NBT 解析器（只读）。
 * LONG / LONG_ARRAY 返回 BigInt，保证 litematic 里位压缩的方块数据不丢精度。
 */

const { M } = require('./i18n');

const TAG = {
  END: 0,
  BYTE: 1,
  SHORT: 2,
  INT: 3,
  LONG: 4,
  FLOAT: 5,
  DOUBLE: 6,
  BYTE_ARRAY: 7,
  STRING: 8,
  LIST: 9,
  COMPOUND: 10,
  INT_ARRAY: 11,
  LONG_ARRAY: 12,
};

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  i8() {
    return this.buf.readInt8((this.pos += 1) - 1);
  }
  u8() {
    return this.buf[this.pos++];
  }
  i16() {
    const v = this.buf.readInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  u16() {
    const v = this.buf.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.buf.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.buf.readBigInt64BE(this.pos);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.buf.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.buf.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }
  str() {
    const len = this.u16();
    const s = this.buf.slice(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return s;
  }
  bytes(n) {
    const b = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
}

function readPayload(r, type) {
  switch (type) {
    case TAG.BYTE:
      return r.i8();
    case TAG.SHORT:
      return r.i16();
    case TAG.INT:
      return r.i32();
    case TAG.LONG:
      return r.i64();
    case TAG.FLOAT:
      return r.f32();
    case TAG.DOUBLE:
      return r.f64();
    case TAG.BYTE_ARRAY: {
      const n = r.i32();
      return r.bytes(n);
    }
    case TAG.STRING:
      return r.str();
    case TAG.LIST: {
      const elemType = r.u8();
      const n = r.i32();
      const arr = [];
      for (let i = 0; i < n; i++) arr.push(readPayload(r, elemType));
      return arr;
    }
    case TAG.COMPOUND: {
      const obj = {};
      for (;;) {
        const t = r.u8();
        if (t === TAG.END) break;
        const name = r.str();
        obj[name] = readPayload(r, t);
      }
      return obj;
    }
    case TAG.INT_ARRAY: {
      const n = r.i32();
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = r.i32();
      return arr;
    }
    case TAG.LONG_ARRAY: {
      const n = r.i32();
      const arr = new Array(n);
      for (let i = 0; i < n; i++) arr[i] = r.i64();
      return arr;
    }
    default:
      throw new Error(M('未知的 NBT 标签类型: ', 'Unknown NBT tag type: ') + type);
  }
}

/** 解析以 type+name+payload 开头的 NBT（根通常是 COMPOUND） */
function parse(buf) {
  const r = new Reader(buf);
  const type = r.u8();
  if (type === TAG.END) return null;
  r.str(); // 根名字，忽略
  return readPayload(r, type);
}

module.exports = { parse, TAG };
