const net = require('net');
const { M } = require('./i18n');

/** Minecraft 服务器列表查询 (Server List Ping, 1.7+ 协议) */

function writeVarInt(value) {
  const bytes = [];
  let v = value >>> 0;
  for (let i = 0; i < 5; i++) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v);
      break;
    }
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return Buffer.from(bytes);
}

function writeString(str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(b.length), b]);
}

function packet(id, payload) {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.pos = 0;
  }
  varInt() {
    let numRead = 0;
    let result = 0;
    let read;
    do {
      if (this.pos >= this.buf.length) throw new Error(M('数据不完整', 'Incomplete data'));
      read = this.buf[this.pos++];
      result |= (read & 0x7f) << (7 * numRead);
      numRead++;
      if (numRead > 5) throw new Error(M('VarInt 过长', 'VarInt too long'));
    } while ((read & 0x80) !== 0);
    return result;
  }
  string() {
    const len = this.varInt();
    const s = this.buf.slice(this.pos, this.pos + len).toString('utf8');
    this.pos += len;
    return s;
  }
}

function flattenDescription(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenDescription).join('');
  let out = '';
  if (node.text) out += node.text;
  if (node.translate) out += node.translate;
  if (node.extra) out += flattenDescription(node.extra);
  return out;
}

function ping(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false;
    const chunks = [];
    let expected = null;

    const done = (result) => {
      if (finished) return;
      finished = true;
      try {
        socket.destroy();
      } catch (e) {
        /* ignore */
      }
      resolve(result);
    };

    const socket = net.createConnection({ host, port, timeout: 8000 }, () => {
      // 1) handshake: protocol=-1, address, port, nextState=1
      const handshake = Buffer.concat([
        writeVarInt(0),
        writeVarInt(-1),
        writeString(host),
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1),
      ]);
      socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]));
      // 2) status request
      socket.write(packet(0, Buffer.alloc(0)));
    });

    socket.on('data', (data) => {
      chunks.push(data);
      const buf = Buffer.concat(chunks);
      try {
        const r = new Reader(buf);
        if (expected === null) {
          if (buf.length < 1) return;
          const len = r.varInt();
          expected = len + (r.pos - 0);
          if (buf.length < expected) return;
        } else if (buf.length < expected) {
          return;
        }
        const r2 = new Reader(buf);
        r2.varInt(); // packet length
        const id = r2.varInt();
        if (id !== 0) {
          done({ ok: false, error: M('服务器返回了意外的数据包 (id=', 'Server returned an unexpected packet (id=') + id + ')' });
          return;
        }
        const json = JSON.parse(r2.string());
        const latency = Date.now() - started;
        const players = json.players || {};
        const sample = (players.sample || []).map((s) => ({
          name: flattenDescription(s.name),
          id: s.id,
        }));
        done({
          ok: true,
          latency,
          json,
          motd: flattenDescription(json.description),
          version: (json.version && json.version.name) || M('未知', 'Unknown'),
          protocol: json.version && json.version.protocol,
          online: players.online ?? 0,
          max: players.max ?? 0,
          sample,
          favicon: json.favicon || null,
          modinfo: json.modinfo || null,
        });
      } catch (e) {
        /* 数据还没收全，等下一次 */
      }
    });

    socket.on('timeout', () => done({ ok: false, error: M('连接超时（8 秒）', 'Connection timed out (8 seconds)') }));
    socket.on('error', (err) => done({ ok: false, error: err.message }));
    socket.on('close', () => {
      if (!finished) {
        done({
          ok: false,
          error: M('连接被服务器关闭（可能是端口不对或非 Minecraft 服务器）', 'Connection closed by the server (the port may be wrong, or this is not a Minecraft server)'),
        });
      }
    });
  });
}

module.exports = { ping };
