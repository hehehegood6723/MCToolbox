/**
 * 极简 asar 打包器（无依赖）。
 * 格式： [UInt32LE(4)][UInt32LE(headerBuf.length)][headerBuf][files...]
 * header = { files: { name: { size, offset } | { files: {...} } } }
 */
const fs = require('fs');
const path = require('path');

function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

function createAsar(srcDir, outFile) {
  const header = { files: {} };
  const flat = [];

  function walk(dir, node) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const child = { files: {} };
        node.files[name] = child;
        walk(full, child);
      } else {
        const entry = { size: st.size };
        node.files[name] = entry;
        flat.push({ full, entry });
      }
    }
  }
  walk(srcDir, header);

  let offset = 0;
  for (const f of flat) {
    f.entry.offset = String(offset);
    offset += f.entry.size;
  }

  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  const payload = Buffer.concat([u32(json.length), json, Buffer.alloc(pad, 0)]);
  const headerBuf = Buffer.concat([u32(payload.length), payload]);

  const sizeBuf = Buffer.concat([u32(4), u32(headerBuf.length)]);

  const parts = [sizeBuf, headerBuf];
  for (const f of flat) parts.push(fs.readFileSync(f.full));

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.concat(parts));
  return { file: outFile, files: flat.length, bytes: offset, headerBytes: headerBuf.length };
}

if (require.main === module) {
  const src = process.argv[2];
  const out = process.argv[3];
  if (!src || !out) {
    console.error('用法: node make-asar.js <源目录> <输出 app.asar>');
    process.exit(1);
  }
  const r = createAsar(src, out);
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { createAsar };
