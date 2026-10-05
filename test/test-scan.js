const path = require('path');
const fs = require('fs');
const os = require('os');

const mcscan = require('../src/mcscan.js');
const mcrun = require('../src/mcrun.js');

const MC = process.env.APPDATA + '\\.minecraft';

(async () => {
  console.log('=== 1. 扫描过滤（主目录）===');
  try {
    const r = mcscan.scan(MC);
    console.log(`  列出 ${r.count} / 共 ${r.total}，隐藏 ${r.hidden}，可直接启动 ${r.launchableCount}，待补全 ${r.repairableCount}，mods ${r.modCount}`);
    console.log('  前 8 条：');
    for (const v of r.versions.slice(0, 8)) {
      console.log(`    ${v.id.padEnd(28)} ${v.launchable ? 'OK  ' : '缺' + String(v.missingLibs).padStart(3) + '个'}  ${v.loader || ''}  ${v.reason || ''}`);
    }
    console.log('  被隐藏的示例：');
    const all = fs.readdirSync(path.join(MC, 'versions')).filter((n) => {
      try { return fs.statSync(path.join(MC, 'versions', n)).isDirectory(); } catch (e) { return false; }
    });
    const visibleIds = new Set(r.versions.map((v) => v.id));
    console.log('    ' + all.filter((n) => !visibleIds.has(n)).slice(0, 8).join(', '));
  } catch (e) {
    console.log('  失败: ' + e.message);
  }

  console.log('\n=== 2. 扫描 PCL 目录（应可启动）===');
  try {
    const r = mcscan.scan('D:\\MCLDownload\\Game\\.minecraft');
    console.log(`  列出 ${r.count}，可直接启动 ${r.launchableCount}`);
    for (const v of r.versions) console.log(`    ${v.id} launchable=${v.launchable} libs=${v.totalLibs - v.missingLibs}/${v.totalLibs}`);
  } catch (e) {
    console.log('  失败: ' + e.message);
  }

  console.log('\n=== 3. 自动查找游戏目录 ===');
  const t0 = Date.now();
  const folders = mcscan.findGameFolders();
  console.log(`  用时 ${((Date.now() - t0) / 1000).toFixed(1)}s，找到 ${folders.length} 个：`);
  for (const f of folders.slice(0, 8)) {
    console.log(`    ${f.hasLibraries ? '✅' : '⚠️'} ${f.path}  (${f.versions} 版本)`);
  }

  console.log('\n=== 4. 缺失文件清单（1.21.8，不下载）===');
  try {
    const miss = mcrun.listMissing(MC, '1.21.8');
    const withUrl = miss.filter((m) => m.url).length;
    console.log(`  缺失 ${miss.length} 个，其中有下载地址 ${withUrl} 个`);
    for (const m of miss.slice(0, 4)) {
      console.log(`    ${m.label}`);
      console.log(`      -> ${m.dest}`);
      console.log(`      url=${m.url ? m.url.slice(0, 80) + '...' : '(无)'}`);
    }
  } catch (e) {
    console.log('  失败: ' + e.message);
  }

  console.log('\n=== 5. 真实下载一个库文件到临时目录 ===');
  try {
    const miss = mcrun.listMissing(MC, '1.21.8').filter((m) => m.url);
    const one = miss[0];
    const tmp = path.join(os.tmpdir(), 'mctool-dltest', path.basename(one.dest));
    const res = await fetch(one.url, { headers: { 'User-Agent': 'MCToolbox/1.0.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, buf);
    console.log(`  下载成功: ${path.basename(one.dest)}  ${(buf.length / 1024).toFixed(1)} KB`);
  } catch (e) {
    console.log('  失败: ' + e.message);
  }
})();
