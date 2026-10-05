const mcrun = require('../src/mcrun.js');
const mcscan = require('../src/mcscan.js');

const MC = process.env.APPDATA + '\\.minecraft';

(async () => {
  console.log('=== 1. 各版本资源检查（全新逻辑）===');
  const r = mcscan.scan(MC);
  console.log(`列出 ${r.count}／共 ${r.total}，可启动 ${r.launchableCount}，待补全 ${r.repairableCount}，hasAssets=${r.hasAssets}`);
  for (const v of r.versions.slice(0, 6)) {
    const vv = mcrun.loadVersion(MC, v.id);
    const idx = vv.assetIndex ? vv.assetIndex.id : '(无)';
    const ac = mcrun.checkAssets(MC, vv, null);
    console.log(`  ${v.id.padEnd(26)} 索引=${String(idx).padEnd(6)} launchable=${v.launchable}  assetsOk=${ac.ok}  ${ac.reason || ''}`);
  }

  console.log('\n=== 2. 1.21.11 缺失资源统计（不下载）===');
  const v = mcrun.loadVersion(MC, '1.21.11');
  console.log('  assetIndex = ' + JSON.stringify(v.assetIndex && v.assetIndex.id));
  const a = mcrun.listMissingAssets(MC, null, v);
  const bytes = a.list.reduce((s, x) => s + (x.size || 0), 0);
  console.log(`  索引共 ${a.total} 个对象，缺失 ${a.list.length} 个，约 ${(bytes / 1024 / 1024).toFixed(0)} MB`);

  console.log('\n=== 3. 外部 assets 目录能否满足 1.21.11 ===');
  for (const d of ['D:\\MCLDownload\\Game\\.minecraft\\assets', 'F:\\新建文件夹\\.minecraft\\assets']) {
    const ac = mcrun.checkAssets(MC, v, d);
    console.log(`  ${d}\n     -> ok=${ac.ok} ${ac.reason || ''}`);
  }

  console.log('\n=== 4. 用外部 assets 组装启动参数（只打印，不启动）===');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  // 造一个假的 java 路径触发参数构建前的校验，改为直接看 vars 结果
  const src = fs.readFileSync('./src/mcrun.js', 'utf8');
  const hasAssetVar = src.includes("assets_root: assetsRoot");
  console.log('  launch 使用 assetsRoot 变量: ' + hasAssetVar);
  const hasFallback = src.includes("'--assetsDir', assetsRoot");
  console.log('  fallback 参数使用 assetsRoot: ' + hasFallback);
})();
