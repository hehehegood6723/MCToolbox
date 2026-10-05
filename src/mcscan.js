const fs = require('fs');
const path = require('path');
const mcrun = require('./mcrun');
const { M } = require('./i18n');

/** 扫描 .minecraft，列出"真的能启动"的版本 */

function defaultFolder() {
  const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming');
  const p = path.join(appdata, '.minecraft');
  return fs.existsSync(p) ? p : '';
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch (e) {
    return false;
  }
}

/** 自动查找本机所有 .minecraft 游戏目录 */
function findGameFolders() {
  const found = new Map();

  const add = (p) => {
    const norm = path.resolve(p);
    if (found.has(norm)) return;
    const vdir = path.join(norm, 'versions');
    const mdir = path.join(norm, 'mods');
    const hasVersions = isDir(vdir);
    const hasMods = isDir(mdir);
    // 有 versions 的才算"游戏目录"；只有 mods 的算"资源/实例目录"（PCL 的实例缓存就是这种）
    if (!hasVersions && !hasMods) return;

    let count = 0;
    if (hasVersions) {
      try {
        count = fs.readdirSync(vdir).filter((n) => isDir(path.join(vdir, n))).length;
      } catch (e) {
        /* ignore */
      }
    }
    let mods = 0;
    if (hasMods) mods = countEntries(mdir, ['.jar'], false);

    const hasLib = isDir(path.join(norm, 'libraries'));
    found.set(norm, {
      path: norm,
      type: hasVersions ? 'game' : 'resource',
      hasLibraries: hasLib,
      hasAssets: isDir(path.join(norm, 'assets')),
      versions: count,
      mods,
      score: (hasVersions ? 5000 : 0) + (hasLib ? 1000 : 0) + count * 10 + mods,
    });
  };

  const appdata = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  const up = process.env.USERPROFILE || '';

  // 1) 明确的常见位置
  const direct = [
    path.join(appdata, '.minecraft'),
    path.join(up, '.minecraft'),
    path.join(up, 'curseforge', 'minecraft'),
    path.join(up, 'Documents', 'curseforge', 'minecraft'),
    path.join(up, 'AppData', 'Roaming', '.minecraft'),
  ];
  for (const d of direct) if (fs.existsSync(d)) add(d);

  // 微软商店版启动器
  const pkgRoot = path.join(local, 'Packages');
  if (isDir(pkgRoot)) {
    let pkgs = [];
    try {
      pkgs = fs.readdirSync(pkgRoot).filter((n) => /minecraft|4297127D64EC6/i.test(n));
    } catch (e) {
      /* ignore */
    }
    for (const p of pkgs) {
      for (const rel of ['LocalCache\\Local\\.minecraft', 'LocalCache\\Roaming\\.minecraft']) {
        const d = path.join(pkgRoot, p, rel);
        if (fs.existsSync(d)) add(d);
      }
    }
  }

  // 2) 各盘符下常见的启动器目录
  const drives = [];
  for (const letter of 'CDEFGH') {
    const dc = letter + ':\\';
    if (fs.existsSync(dc)) drives.push(dc);
  }
  const commonRels = [
    'MCLDownload\\Game\\.minecraft',
    'MCLDownload\\.minecraft',
    'Minecraft\\.minecraft',
    'Games\\.minecraft',
    '.minecraft',
  ];
  for (const dc of drives) {
    for (const rel of commonRels) {
      const d = path.join(dc, rel);
      if (fs.existsSync(path.join(d, 'versions'))) add(d);
    }
  }

  // 2.5) PCL 的实例缓存：MCLDownload\cache\game\<hash>\.minecraft
  //      这种目录只有 mods / config 没有 versions，以前会被整个漏掉
  for (const dc of drives) {
    for (const rel of ['MCLDownload\\cache\\game', 'MCLDownload\\Game', 'MCLDownload']) {
      const base = path.join(dc, rel);
      if (!isDir(base)) continue;
      let subs = [];
      try {
        subs = fs.readdirSync(base);
      } catch (e) {
        continue;
      }
      for (const sub of subs) {
        const d = path.join(base, sub);
        if (sub.toLowerCase() === '.minecraft') {
          add(d);
          continue;
        }
        if (!isDir(d)) continue;
        if (isDir(path.join(d, '.minecraft'))) add(path.join(d, '.minecraft'));
        if (isDir(path.join(d, 'versions')) || isDir(path.join(d, 'mods'))) add(d);
      }
    }
  }

  // 3) 广度优先兜底搜索（层数浅的优先，避免被大量目录吃掉预算）
  const SKIP = new Set([
    'windows', 'program files', 'program files (x86)', 'programdata', '$recycle.bin',
    'system volume information', 'appdata', 'node_modules', '.git', 'temp', 'tmp',
    'windowsapps', 'winsxs', 'driverstore', 'installer', 'assembly', 'softwaredistribution',
    'perflogs', 'recovery', 'crashdumps', 'syswow64', 'system32', 'usoshared', 'onedrive',
  ]);
  let budget = 25000;
  const queue = drives.map((d) => ({ dir: d, depth: 0 }));
  while (queue.length && budget > 0) {
    const cur = queue.shift();
    budget--;
    if (path.basename(cur.dir).toLowerCase() === '.minecraft') {
      add(cur.dir);
      continue;
    }
    if (cur.depth >= 3) continue;
    let entries;
    try {
      entries = fs.readdirSync(cur.dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    if (entries.length > 600) continue; // 目录太大，跳过
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const low = e.name.toLowerCase();
      if (SKIP.has(low)) continue;
      if (e.name.startsWith('$')) continue;
      queue.push({ dir: path.join(cur.dir, e.name), depth: cur.depth + 1 });
    }
  }

  return Array.from(found.values()).sort((a, b) => b.score - a.score);
}

/** 数目录下符合条件的文件（alsoDirs=true 时把子文件夹也算上，资源包/光影包常常是文件夹） */
function countEntries(dir, exts, alsoDirs) {
  try {
    if (!fs.statSync(dir).isDirectory()) return 0;
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => {
      if (e.isDirectory()) return !!alsoDirs;
      return exts.some((x) => e.name.toLowerCase().endsWith(x));
    }).length;
  } catch (e) {
    return 0;
  }
}

/** 某个游戏目录里的各类内容数量 */
function countGameDir(gameDir) {
  return {
    modCount: countEntries(path.join(gameDir, 'mods'), ['.jar'], false),
    resourcepackCount: countEntries(path.join(gameDir, 'resourcepacks'), ['.zip'], true),
    shaderpackCount: countEntries(path.join(gameDir, 'shaderpacks'), ['.zip'], true),
    datapackCount: countEntries(path.join(gameDir, 'datapacks'), ['.zip'], true),
  };
}

/** PCL 的版本隔离开关写在 versions\<版本>\PCL\Setup.ini 的 VersionArgumentIndieV2 */
function readPclIsolation(mcFolder, versionName) {
  const ini = path.join(mcFolder, 'versions', versionName, 'PCL', 'Setup.ini');
  if (!fs.existsSync(ini)) return null;
  try {
    const txt = fs.readFileSync(ini, 'utf8');
    const m = txt.match(/VersionArgumentIndieV2\s*:\s*(\w+)/i);
    if (m) return /true/i.test(m[1]);
  } catch (e) {
    /* ignore */
  }
  return null;
}

// 版本目录里出现这些，说明它被当成独立游戏目录用了
const GAMEDIR_MARKERS = [
  'mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'datapacks', 'options.txt',
  'logs', 'screenshots', 'crash-reports', 'defaultconfigs', 'server-resource-packs',
  'journeymap', 'xaero', 'schematics', 'shaderpacks',
];

/**
 * 判断某个版本实际用哪个游戏目录（mods / 存档到底在哪）。
 * 顺序：本工具装的整合包实例 → PCL 版本隔离 → 目录结构特征 → 根目录（不隔离）
 */
function resolveGameDir(mcFolder, versionName) {
  const vDir = path.join(mcFolder, 'versions', versionName);

  const marker = path.join(vDir, 'mctool-instance.json');
  if (fs.existsSync(marker)) {
    try {
      const j = JSON.parse(fs.readFileSync(marker, 'utf8').replace(/^\uFEFF/, ''));
      if (j.gameDir && fs.existsSync(j.gameDir)) return { dir: j.gameDir, isolated: true, by: 'modpack' };
    } catch (e) {
      /* ignore */
    }
  }

  const indie = readPclIsolation(mcFolder, versionName);
  if (indie === true) return { dir: vDir, isolated: true, by: 'pcl' };

  let hits = 0;
  try {
    for (const e of fs.readdirSync(vDir)) {
      if (GAMEDIR_MARKERS.includes(String(e).toLowerCase())) hits++;
    }
  } catch (e) {
    /* ignore */
  }
  if (indie === null && hits >= 2) return { dir: vDir, isolated: true, by: 'markers' };

  if (indie === false) return { dir: mcFolder, isolated: false, by: 'pcl-off' };
  return { dir: mcFolder, isolated: false, by: 'root' };
}

/**
 * 扫描版本。默认只返回"有 json 且能找到客户端 jar"的版本，
 * 并附带每项的可启动性、缺失文件数量、以及它自己的 mod / 资源包数量。
 */
function scan(folder, opts) {
  opts = opts || {};
  if (!folder) throw new Error(M('请先选择 .minecraft 文件夹', 'Please select the .minecraft folder first'));
  const versionsDir = path.join(folder, 'versions');
  if (!isDir(versionsDir)) {
    throw new Error(
      M('在 ', 'Cannot find the versions folder in ') +
        folder +
        M(' 中找不到 versions 文件夹，请确认选的是 .minecraft 目录', ' — make sure you selected the .minecraft directory')
    );
  }

  const all = [];
  for (const name of fs.readdirSync(versionsDir)) {
    const dir = path.join(versionsDir, name);
    if (!isDir(dir)) continue;

    const jsonPath = path.join(dir, name + '.json');
    const jarPath = path.join(dir, name + '.jar');
    const item = {
      id: name,
      folder: dir,
      type: 'unknown',
      releaseTime: null,
      javaVersion: null,
      inheritsFrom: null,
      hasJson: fs.existsSync(jsonPath),
      hasJar: fs.existsSync(jarPath),
      jarSize: 0,
      loader: '',
      loaders: [],
      launchable: false,
      usable: false,
      jarFound: false,
      totalLibs: 0,
      missingLibs: 0,
      reason: null,
    };

    if (item.hasJar) {
      try {
        item.jarSize = fs.statSync(jarPath).size;
      } catch (e) {
        /* ignore */
      }
    }

    if (item.hasJson) {
      try {
        const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        item.id = j.id || name;
        item.type = j.type || 'unknown';
        item.releaseTime = j.releaseTime || null;
        item.inheritsFrom = j.inheritsFrom || null;
        item.javaVersion = j.javaVersion ? j.javaVersion.majorVersion : null;

        const lower = name.toLowerCase();
        const L = [];
        if (lower.includes('neoforge')) L.push('NeoForge');
        if (lower.includes('forge') && !lower.includes('neoforge')) L.push('Forge');
        if (lower.includes('fabric')) L.push('Fabric');
        if (lower.includes('quilt')) L.push('Quilt');
        if (lower.includes('optifine')) L.push('OptiFine');
        if (!L.length && (item.type === 'release' || item.type === 'snapshot')) L.push(M('原版', 'Vanilla'));
        item.loaders = L;
        item.loader = L.join(' + ');
      } catch (e) {
        item.error = M('版本 JSON 解析失败', 'Failed to parse the version JSON');
      }
    }

    // 可启动性 + 缺失文件统计
    try {
      const ins = mcrun.inspect(folder, name);
      item.jarFound = !!ins.jar;
      item.launchable = !!ins.launchable;
      item.totalLibs = ins.totalLibs || 0;
      item.missingLibs = ins.missingLibs || 0;
      item.reason = ins.reason || null;
      item.usable = item.hasJson && !item.error && !!ins.jar;

      // 资源文件检查（可选，会缓存）
      if (item.usable && ins.launchable && mcrun.checkAssets) {
        try {
          const v = mcrun.loadVersion(folder, name);
          const ac = mcrun.checkAssets(folder, v, null);
          item.assetsOk = ac.ok;
          item.assetsReason = ac.reason || null;
          if (!ac.ok) {
            item.launchable = false;
            item.reason = ac.reason;
          }
        } catch (e) {
          item.assetsOk = true;
        }
      } else {
        item.assetsOk = false;
      }
    } catch (e) {
      item.reason = e.message;
      item.usable = false;
    }

    // 这个版本实际用哪个游戏目录 + 里面的 mod / 资源包数量
    try {
      const gd = resolveGameDir(folder, name);
      const c = countGameDir(gd.dir);
      item.gameDir = gd.dir;
      item.isolated = gd.isolated;
      item.isolatedBy = gd.by;
      item.modCount = c.modCount;
      item.resourcepackCount = c.resourcepackCount;
      item.shaderpackCount = c.shaderpackCount;
      item.datapackCount = c.datapackCount;
    } catch (e) {
      item.gameDir = folder;
      item.isolated = false;
      item.modCount = 0;
      item.resourcepackCount = 0;
      item.shaderpackCount = 0;
      item.datapackCount = 0;
    }

    all.push(item);
  }

  const rank = { release: 0, snapshot: 1, old_beta: 2, old_alpha: 3, unknown: 9 };
  all.sort((a, b) => {
    // 能启动的排前面
    if (a.launchable !== b.launchable) return a.launchable ? -1 : 1;
    const ra = rank[a.type] ?? 9;
    const rb = rank[b.type] ?? 9;
    if (ra !== rb) return ra - rb;
    return String(b.releaseTime || '').localeCompare(String(a.releaseTime || ''));
  });

  // 过滤掉"缺 json / 缺 jar"的废版本
  const visible = all.filter((v) => v.usable);
  const versions = opts.showAll ? visible : visible;

  const rootCounts = countGameDir(folder);
  const isolatedVersions = versions.filter((v) => v.isolated).length;
  const isolatedWithMods = versions.filter((v) => v.isolated && v.modCount > 0).length;
  const versionModTotal = versions.reduce((s, v) => s + (v.modCount || 0), 0);

  return {
    folder,
    versions,
    count: versions.length,
    total: all.length,
    hidden: all.length - visible.length,
    launchableCount: versions.filter((v) => v.launchable).length,
    repairableCount: versions.filter((v) => !v.launchable).length,
    // 根目录（未隔离时大家共用的那个）
    modCount: rootCounts.modCount,
    rootMods: rootCounts.modCount,
    rootResourcepacks: rootCounts.resourcepackCount,
    // 版本维度
    isolatedVersions,
    isolatedWithMods,
    versionModTotal,
    versionsWithMods: versions.filter((v) => v.modCount > 0).length,
    hasAssets: isDir(path.join(folder, 'assets')) && isDir(path.join(folder, 'assets', 'indexes')),
    hasLibraries: isDir(path.join(folder, 'libraries')),
  };
}

module.exports = { scan, defaultFolder, findGameFolders, detectTargets, baseMcVersion };

// ---------------------------------------------------------------- 安装目标自动检测

/** 顺着 inheritsFrom 找到这个版本对应的原版 MC 版本号 */
function baseMcVersion(mcFolder, id, depth) {
  const d = depth || 0;
  if (d > 5) return id;
  const jsonPath = path.join(mcFolder, 'versions', id, id + '.json');
  if (!fs.existsSync(jsonPath)) return id;
  try {
    const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8').replace(/^\uFEFF/, ''));
    if (j.inheritsFrom) return baseMcVersion(mcFolder, j.inheritsFrom, d + 1);
    return j.id || id;
  } catch (e) {
    return id;
  }
}

/**
 * 给某个资源类型找出"合适的已安装 MC 版本"，直接装进去。
 * @param {string} mcFolder
 * @param {{kind:string, gameVersion?:string, loader?:string, folder:string}} opts folder 形如 'mods'
 */
function detectTargets(mcFolder, opts) {
  const o = opts || {};
  const folder = o.folder || 'mods';
  const wantVer = String(o.gameVersion || '').trim();
  const wantLoader = String(o.loader || '').trim().toLowerCase();

  let r;
  try {
    r = scan(mcFolder);
  } catch (e) {
    return { targets: [], reason: e.message };
  }

  const targets = [];
  for (const v of r.versions) {
    const base = baseMcVersion(mcFolder, v.id);
    const loader = String(v.loader || '').toLowerCase();
    let score = 0;
    const why = [];

    if (wantVer) {
      if (base === wantVer || v.id === wantVer) {
        score += 100;
        why.push(M('版本匹配 ', 'version match ') + base);
      } else if (base.startsWith(wantVer) || wantVer.startsWith(base)) {
        score += 40;
        why.push(M('版本相近 ', 'similar version ') + base);
      } else {
        continue; // 版本对不上就跳过
      }
    } else {
      why.push('MC ' + base);
    }

    if (wantLoader) {
      if (loader.includes(wantLoader)) {
        score += 50;
        why.push(M('加载器匹配 ', 'loader match ') + v.loader);
      } else if (loader.includes(M('原版', 'vanilla'))) {
        score += 5;
        why.push(M('原版', 'vanilla'));
      } else {
        score -= 20;
        why.push(M('加载器不同(', 'different loader (') + (v.loader || M('未知', 'unknown')) + M(')', ')'));
      }
    }

    if (v.isolated) {
      score += 25;
      why.push(M('独立目录（不会影响别的版本）', 'isolated folder (will not affect other versions)'));
    }
    if (v.launchable) score += 10;
    if (v.modCount > 0) {
      score += 5;
      why.push(M('已有 ', 'already has ') + v.modCount + M(' 个 mod', ' mods'));
    }

    const targetDir = path.join(v.gameDir || mcFolder, folder);
    targets.push({
      versionId: v.id,
      baseVersion: base,
      loader: v.loader || '',
      gameDir: v.gameDir || mcFolder,
      targetDir,
      isolated: !!v.isolated,
      launchable: !!v.launchable,
      modCount: v.modCount || 0,
      exists: fs.existsSync(targetDir),
      score,
      reason: why.join(' · '),
    });
  }

  targets.sort((a, b) => b.score - a.score || a.versionId.localeCompare(b.versionId));
  return {
    targets,
    best: targets[0] || null,
    folder,
    gameVersion: wantVer || null,
    loader: wantLoader || null,
  };
}
