const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { M } = require('./i18n');

/** 极简 zip 解压（只取需要的条目），用于释放老版本的原生库 */
function extractZipTo(zipPath, outDir, wanted) {
  const buf = fs.readFileSync(zipPath);
  // 找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(M('不是有效的 zip: ', 'Not a valid zip file: ') + zipPath);
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    off += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    if (wanted && !wanted(name)) continue;

    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const data = buf.slice(dataStart, dataStart + compSize);
    const content = method === 0 ? data : zlib.inflateRawSync(data);

    const target = path.join(outDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

// ---------------------------------------------------------------- 版本 JSON

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadVersion(mcFolder, id) {
  const jsonPath = path.join(mcFolder, 'versions', id, id + '.json');
  if (!fs.existsSync(jsonPath)) throw new Error(M('找不到版本文件: ', 'Version file not found: ') + jsonPath);
  const v = readJson(jsonPath);
  if (v.inheritsFrom) {
    const parent = loadVersion(mcFolder, v.inheritsFrom);
    return mergeVersion(parent, v, id);
  }
  return Object.assign({}, v, { id: v.id || id, __dir: path.join(mcFolder, 'versions', id) });
}

function libKey(name) {
  const parts = String(name).split(':');
  return parts[0] + ':' + parts[1];
}

function mergeVersion(parent, child, id) {
  const libs = [];
  const seen = new Map();
  for (const l of parent.libraries || []) {
    seen.set(libKey(l.name), l);
  }
  for (const l of child.libraries || []) {
    seen.set(libKey(l.name), l);
  }
  for (const l of seen.values()) libs.push(l);

  const pArgs = parent.arguments || {};
  const cArgs = child.arguments || {};

  return Object.assign({}, parent, child, {
    id,
    libraries: libs,
    mainClass: child.mainClass || parent.mainClass,
    assetIndex: child.assetIndex || parent.assetIndex,
    assets: child.assets || parent.assets,
    downloads: child.downloads || parent.downloads,
    javaVersion: child.javaVersion || parent.javaVersion,
    arguments: {
      game: [].concat(pArgs.game || [], cArgs.game || []),
      jvm: [].concat(pArgs.jvm || [], cArgs.jvm || []),
    },
    minecraftArguments: child.minecraftArguments || parent.minecraftArguments || null,
    type: child.type || parent.type,
    __dir: path.join(String(child.__mcFolder || ''), 'versions', id),
  });
}

// ---------------------------------------------------------------- 规则

function osName() {
  return process.platform === 'win32' ? 'windows' : process.platform;
}
function osArch() {
  if (process.arch === 'x64') return 'x86_64';
  if (process.arch === 'ia32') return 'x86';
  return process.arch;
}

function ruleApplies(rule) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    if (rule.os.arch) {
      const a = rule.os.arch;
      if (a !== osArch() && a !== process.arch) return false;
    }
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(require('os').release())) return false;
      } catch (e) {
        /* 正则无效就忽略 */
      }
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) {
      if (v) return false; // 我们默认不开启任何可选特性
    }
  }
  return true;
}

function allowedByRules(rules) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleApplies(rule)) allowed = rule.action === 'allow';
  }
  return allowed;
}

function applyTemplates(list, vars) {
  const out = [];
  for (const item of list) {
    if (typeof item === 'string') {
      out.push(subst(item, vars));
      continue;
    }
    if (!allowedByRules(item.rules)) continue;
    const v = item.value;
    if (Array.isArray(v)) {
      for (const one of v) out.push(subst(one, vars));
    } else if (typeof v === 'string') {
      out.push(subst(v, vars));
    }
  }
  return out;
}

function subst(str, vars) {
  return String(str).replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---------------------------------------------------------------- Java 查找

function findJavaCandidates(mcFolder) {
  const out = [];
  const add = (p, tag) => {
    if (p && fs.existsSync(p) && !out.some((x) => x.path === p)) out.push({ path: p, tag });
  };

  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'), 'JAVA_HOME');

  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\BellSoft',
    'C:\\Program Files\\Amazon Corretto',
  ];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r)) {
      add(path.join(r, d, 'bin', 'java.exe'), d);
    }
  }

  if (mcFolder) {
    const rt = path.join(mcFolder, 'runtime');
    if (fs.existsSync(rt)) {
      for (const a of fs.readdirSync(rt)) {
        const base = path.join(rt, a, 'windows-x64');
        if (!fs.existsSync(base)) continue;
        for (const b of fs.readdirSync(base)) {
          add(path.join(base, b, 'bin', 'java.exe'), M('MC 自带 ', 'Bundled with MC ') + a);
        }
      }
    }
  }

  try {
    const where = execFileSync('where', ['java'], { encoding: 'utf8' });
    for (const line of where.split(/\r?\n/)) {
      const p = line.trim();
      if (p.toLowerCase().endsWith('java.exe')) add(p, 'PATH');
    }
  } catch (e) {
    /* ignore */
  }

  // 附带 Java 主版本号，方便界面提示
  for (const item of out) {
    try {
      item.major = javaMajor(item.path);
    } catch (e) {
      item.major = null;
    }
  }
  return out;
}

function javaMajor(javaPath) {
  try {
    const res = require('child_process').spawnSync(javaPath, ['-version'], { encoding: 'utf8' });
    const text = String(res.stderr || '') + String(res.stdout || '');
    const m = text.match(/version "(\d+)/);
    return m ? Number(m[1]) : null;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------- 启动

function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const h = md5.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function launch(opts, onLog) {
  const {
    mcFolder,
    versionId,
    username = 'Player',
    javaPath,
    minMemory = 1024,
    maxMemory = 4096,
    width = 854,
    height = 480,
    extraJvm = '',
    extraGame = '',
    account = null, // { type:'msa', name, uuid, accessToken, xuid, clientId }
  } = opts || {};

  if (!mcFolder) throw new Error(M('未设置 .minecraft 文件夹', 'No .minecraft folder set'));
  if (!versionId) throw new Error(M('未选择版本', 'No version selected'));
  if (!javaPath || !fs.existsSync(javaPath)) throw new Error(M('Java 路径无效，请在上方选择正确的 java.exe', 'Invalid Java path - select the correct java.exe above'));

  const version = loadVersion(mcFolder, versionId);

  // 整合包独立实例：版本目录里若有 mctool-instance.json，就把游戏目录指到实例文件夹，
  // 这样它的 mods / config / saves 都独立，不会污染主目录
  let gameDir = mcFolder;
  const markerPath = path.join(mcFolder, 'versions', versionId, 'mctool-instance.json');
  if (fs.existsSync(markerPath)) {
    try {
      const mk = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      if (mk && mk.gameDir && fs.existsSync(mk.gameDir)) gameDir = mk.gameDir;
    } catch (e) {
      /* ignore */
    }
  }
  const nativeDir = path.join(mcFolder, 'versions', versionId, 'natives-mctool');
  fs.mkdirSync(nativeDir, { recursive: true });

  const missing = [];
  const classpath = [];

  // 客户端 jar：优先本版本目录，其次父版本目录
  let clientJar = path.join(mcFolder, 'versions', versionId, versionId + '.jar');
  if (!fs.existsSync(clientJar) && version.inheritsFrom) {
    const p = path.join(mcFolder, 'versions', version.inheritsFrom, version.inheritsFrom + '.jar');
    if (fs.existsSync(p)) clientJar = p;
  }
  if (!fs.existsSync(clientJar)) {
    // 尝试从继承链的版本目录找
    const verDir = path.join(mcFolder, 'versions', versionId);
    const anyJar = fs.existsSync(verDir) ? fs.readdirSync(verDir).find((f) => f.endsWith('.jar')) : null;
    if (anyJar) clientJar = path.join(verDir, anyJar);
  }
  if (fs.existsSync(clientJar)) classpath.push(clientJar);
  else missing.push(M('客户端 jar: ', 'Client jar: ') + clientJar);

  // 依赖库
  for (const lib of version.libraries || []) {
    if (!allowedByRules(lib.rules)) continue;

    // 现代版本：natives 作为独立 classifier 依赖
    if (lib.name && /:natives-windows/.test(lib.name)) {
      const art = lib.downloads && lib.downloads.artifact;
      const p = art ? path.join(mcFolder, 'libraries', art.path) : null;
      if (p && fs.existsSync(p)) {
        classpath.push(p);
        try {
          extractZipTo(p, nativeDir, (n) => n.toLowerCase().endsWith('.dll'));
        } catch (e) {
          /* 解压失败就让 LWJGL 从 classpath 加载 */
        }
      } else if (p) {
        missing.push(M('原生库: ', 'Native library: ') + lib.name);
      }
      continue;
    }

    // 老版本：natives 映射，需要解压
    if (lib.natives && lib.natives.windows) {
      const classifier = String(lib.natives.windows).replace('${arch}', process.arch === 'x64' ? '64' : '32');
      const art = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      if (art) {
        const p = path.join(mcFolder, 'libraries', art.path);
        if (fs.existsSync(p)) {
          try {
            extractZipTo(p, nativeDir, (n) => n.toLowerCase().endsWith('.dll'));
          } catch (e) {
            /* ignore */
          }
        } else {
          missing.push(M('原生库: ', 'Native library: ') + lib.name);
        }
      }
    }

    const art = lib.downloads && lib.downloads.artifact;
    if (art && art.path) {
      const p = path.join(mcFolder, 'libraries', art.path);
      if (fs.existsSync(p)) classpath.push(p);
      else missing.push(M('依赖库: ', 'Library: ') + lib.name);
    } else if (!art) {
      // 没有 downloads 的库（部分 Forge 老版本），按名字猜路径
      const parts = String(lib.name).split(':');
      if (parts.length >= 3) {
        const [g, a, v] = parts;
        const guess = path.join(mcFolder, 'libraries', g.replace(/\./g, '/'), a, v, `${a}-${v}.jar`);
        if (fs.existsSync(guess)) classpath.push(guess);
        else missing.push(M('依赖库: ', 'Library: ') + lib.name);
      }
    }
  }

  const assetIndexId = (version.assetIndex && version.assetIndex.id) || version.assets || 'legacy';
  // 资源目录可以指向别的完整游戏目录（缺 assets 时很有用）
  const assetsRoot =
    opts && opts.assetsDir && fs.existsSync(opts.assetsDir) ? opts.assetsDir : path.join(mcFolder, 'assets');
  const isMsa = !!(account && account.type === 'msa' && account.accessToken);
  const playerName = isMsa ? account.name : username;
  const vars = {
    auth_player_name: playerName,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: assetsRoot,
    game_assets: path.join(assetsRoot, 'virtual', 'legacy'),
    assets_index_name: assetIndexId,
    auth_uuid: isMsa ? account.uuid : offlineUuid(playerName),
    auth_access_token: isMsa ? account.accessToken : '0',
    auth_session: isMsa ? account.accessToken : '0',
    user_type: isMsa ? 'msa' : 'legacy',
    version_type: version.type || 'release',
    natives_directory: nativeDir,
    launcher_name: 'MCToolbox',
    launcher_version: '1.0.0',
    classpath: classpath.join(';'),
    classpath_separator: ';',
    library_directory: path.join(mcFolder, 'libraries'),
    resolution_width: width,
    resolution_height: height,
    user_properties: '{}',
    clientid: isMsa ? account.clientId || '' : '',
    auth_xuid: isMsa ? account.xuid || '' : '',
    quickPlayPath: '',
    quickPlaySingleplayer: '',
    quickPlayMultiplayer: '',
    quickPlayRealms: '',
  };

  const jvmArgs = [];
  if (version.arguments && version.arguments.jvm && version.arguments.jvm.length) {
    jvmArgs.push(...applyTemplates(version.arguments.jvm, vars));
  } else {
    jvmArgs.push('-Djava.library.path=' + nativeDir, '-cp', classpath.join(';'));
  }

  // 统一补上关键参数
  const pre = [
    `-Xms${minMemory}M`,
    `-Xmx${maxMemory}M`,
    '-Djava.library.path=' + nativeDir,
    '-Dminecraft.launcher.brand=MCToolbox',
    '-Dminecraft.launcher.version=1.0.0',
    '-Dfile.encoding=UTF-8',
    '-Dfml.ignoreInvalidMinecraftCertificates=true',
    '-Dfml.ignorePatchDiscrepancies=true',
  ];
  if (extraJvm && extraJvm.trim()) pre.push(...extraJvm.trim().split(/\s+/));

  let gameArgs;
  if (version.arguments && version.arguments.game && version.arguments.game.length) {
    gameArgs = applyTemplates(version.arguments.game, vars);
  } else if (version.minecraftArguments) {
    gameArgs = String(version.minecraftArguments).split(/\s+/).map((s) => subst(s, vars));
  } else {
    gameArgs = [
      '--username', playerName,
      '--version', versionId,
      '--gameDir', gameDir,
      '--assetsDir', assetsRoot,
      '--assetIndex', assetIndexId,
      '--uuid', vars.auth_uuid,
      '--accessToken', vars.auth_access_token,
      '--userType', vars.user_type,
      '--userProperties', '{}',
    ];
    if (isMsa) {
      if (vars.auth_xuid) gameArgs.push('--xuid', vars.auth_xuid);
      if (vars.clientid) gameArgs.push('--clientId', vars.clientid);
    }
  }
  if (extraGame && extraGame.trim()) gameArgs.push(...extraGame.trim().split(/\s+/));

  const fullArgs = [...pre, ...jvmArgs, version.mainClass, ...gameArgs];

  onLog && onLog(M('[启动] ', '[Launch] ') + javaPath);
  onLog && onLog(M('[参数] ', '[Args] ') + fullArgs.length + M(' 个', ' arguments'));
  if (missing.length) {
    onLog && onLog(M('[警告] 缺少 ', '[Warning] Missing ') + missing.length + M(' 个文件，可能需要先用官方启动器补全：', ' file(s) - you may need to complete them with the official launcher first:'));
    for (const m of missing.slice(0, 15)) onLog && onLog('   - ' + m);
  }

  const child = spawn(javaPath, fullArgs, { cwd: mcFolder, windowsHide: false });
  child.on('error', (err) => onLog && onLog(M('[错误] 无法启动 Java 进程: ', '[Error] Failed to start the Java process: ') + err.message));
  child.stdout.on('data', (d) => onLog && String(d).split(/\r?\n/).forEach((l) => l && onLog(l)));
  child.stderr.on('data', (d) => onLog && String(d).split(/\r?\n/).forEach((l) => l && onLog(l)));
  child.on('exit', (code) => onLog && onLog(M('[退出] 游戏进程结束，代码 ', '[Exit] Game process ended, exit code ') + code));

  return {
    pid: child.pid,
    missing,
    mainClass: version.mainClass,
    javaVersionRequired: version.javaVersion,
    classpathSize: classpath.length,
    javaPath,
    command: [javaPath].concat(fullArgs).join(' '),
  };
}

// ---------------------------------------------------------------- 可启动性检测

/** 找客户端 jar：优先本版本目录，其次沿 inheritsFrom 继承链找 */
function findClientJar(mcFolder, id) {
  const own = path.join(mcFolder, 'versions', id, id + '.jar');
  if (fs.existsSync(own)) return own;

  let cur = id;
  const seen = new Set([id]);
  for (let guard = 0; guard < 10; guard++) {
    let json;
    try {
      json = readJson(path.join(mcFolder, 'versions', cur, cur + '.json'));
    } catch (e) {
      break;
    }
    if (!json.inheritsFrom || seen.has(json.inheritsFrom)) break;
    seen.add(json.inheritsFrom);
    const p = path.join(mcFolder, 'versions', json.inheritsFrom, json.inheritsFrom + '.jar');
    if (fs.existsSync(p)) return p;
    cur = json.inheritsFrom;
  }

  // 兜底：本版本目录里任意 jar
  try {
    const dir = path.join(mcFolder, 'versions', id);
    const any = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.jar'));
    if (any) return path.join(dir, any);
  } catch (e) {
    /* ignore */
  }
  return null;
}

function countLibraries(mcFolder, version) {
  let total = 0;
  let missing = 0;
  for (const lib of version.libraries || []) {
    if (!allowedByRules(lib.rules)) continue;
    const art = lib.downloads && lib.downloads.artifact;
    if (!art || !art.path) continue;
    total++;
    if (!fs.existsSync(path.join(mcFolder, 'libraries', art.path))) missing++;
  }
  return { total, missing };
}

/**
 * 判断某个版本是否真的能启动。
 * @returns {{launchable:boolean, reason?:string, jar?:string, totalLibs?:number, missingLibs?:number}}
 */
function inspect(mcFolder, id) {
  let version;
  try {
    version = loadVersion(mcFolder, id);
  } catch (e) {
    return { launchable: false, reason: M('版本 JSON 无法解析: ', 'Version JSON could not be parsed: ') + e.message, jar: findClientJar(mcFolder, id) };
  }

  // jar 信息始终返回，供界面判断"值不值得列出来"
  const jar = findClientJar(mcFolder, id);
  if (!jar) {
    return { launchable: false, reason: M('缺少客户端 jar', 'Missing client jar'), jar: null };
  }
  if (!version.mainClass) {
    return { launchable: false, reason: M('缺少 mainClass', 'Missing mainClass'), jar };
  }

  const { total, missing } = countLibraries(mcFolder, version);
  const ratio = total > 0 ? missing / total : 0;
  if (ratio > 0.25) {
    return {
      launchable: false,
      reason: M('依赖库缺失过多 (', 'Too many libraries missing (') + missing + '/' + total + ')',
      jar,
      totalLibs: total,
      missingLibs: missing,
    };
  }

  return { launchable: true, jar, totalLibs: total, missingLibs: missing };
}

const assetsCheckCache = new Map();

/** 检查资源文件（assets）是否齐全。抽样检查 + 结果缓存，避免重复解析大 JSON */
function checkAssets(mcFolder, version, assetsDir) {
  const root = assetsDir || path.join(mcFolder, 'assets');
  const idx = version.assetIndex;
  if (!idx || !idx.id) return { ok: true, reason: null }; // 老版本没有 assets 索引
  const cacheKey = root + '||' + idx.id;
  const hit = assetsCheckCache.get(cacheKey);
  if (hit) return hit;
  const result = doCheckAssets(root, idx);
  assetsCheckCache.set(cacheKey, result);
  return result;
}

function doCheckAssets(root, idx) {
  const indexPath = path.join(root, 'indexes', idx.id + '.json');
  if (!fs.existsSync(indexPath)) {
    return { ok: false, reason: M('缺少资源索引 ', 'Missing asset index ') + idx.id };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (e) {
    return { ok: false, reason: M('资源索引损坏', 'Asset index is corrupted') };
  }
  const objs = Object.values(data.objects || {});
  if (!objs.length) return { ok: true, reason: null };
  const step = Math.max(1, Math.floor(objs.length / 30));
  let checked = 0;
  let missing = 0;
  for (let i = 0; i < objs.length && checked < 30; i += step, checked++) {
    const h = objs[i].hash;
    if (!fs.existsSync(path.join(root, 'objects', h.slice(0, 2), h))) missing++;
  }
  if (missing > 0) {
    const est = Math.round(((missing / checked) * objs.length) / 1000);
    return {
      ok: false,
      reason: M('缺少资源文件 (约 ', 'Missing asset files (~') + est + M(' 千个，游戏会崩溃)', 'k, the game will crash)'),
      missing,
      checked,
      total: objs.length,
    };
  }
  return { ok: true, reason: null };
}

function clearAssetsCache() {
  assetsCheckCache.clear();
}

/** 列出缺失的资源对象 */
function listMissingAssets(mcFolder, assetsDir, version) {
  const root = assetsDir || path.join(mcFolder, 'assets');
  const idx = version.assetIndex;
  if (!idx || !idx.id) return { list: [], total: 0, reason: M('该版本不需要资源索引', 'This version does not need an asset index') };
  const indexPath = path.join(root, 'indexes', idx.id + '.json');
  if (!fs.existsSync(indexPath)) return { list: [], total: 0, reason: M('缺少资源索引文件（需先下载索引）', 'Missing asset index file (download the index first)') };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch (e) {
    return { list: [], total: 0, reason: M('资源索引损坏', 'Asset index is corrupted') };
  }
  const out = [];
  const objs = Object.entries(data.objects || {});
  for (const [name, obj] of objs) {
    const h = obj.hash;
    const dest = path.join(root, 'objects', h.slice(0, 2), h);
    if (!fs.existsSync(dest)) {
      out.push({
        url: `https://resources.download.minecraft.net/${h.slice(0, 2)}/${h}`,
        dest,
        label: name,
        size: obj.size || 0,
      });
    }
  }
  return { list: out, total: objs.length, reason: null };
}

/** 并发下载 */
async function downloadAll(items, concurrency, onOne) {
  let done = 0;
  let failed = 0;
  let cursor = 0;
  const workers = [];
  const n = Math.min(Math.max(1, concurrency), items.length || 1);
  for (let k = 0; k < n; k++) {
    workers.push(
      (async () => {
        for (;;) {
          const i = cursor++;
          if (i >= items.length) return;
          const item = items[i];
          try {
            await downloadFile(item.url, item.dest);
            done++;
          } catch (e) {
            failed++;
          }
          if (onOne) onOne(done, failed, item);
        }
      })()
    );
  }
  await Promise.all(workers);
  return { done, failed };
}

// ---------------------------------------------------------------- 删除版本

function dirSize(dir) {
  let size = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          size += fs.statSync(p).size;
        } catch (err) {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return size;
}

/** 找出哪些其他版本通过 inheritsFrom 依赖这个版本（删掉它们会坏） */
function findDependents(mcFolder, id) {
  const versionsDir = path.join(mcFolder, 'versions');
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(versionsDir);
  } catch (e) {
    return out;
  }
  for (const name of names) {
    if (name === id) continue;
    const jp = path.join(versionsDir, name, name + '.json');
    if (!fs.existsSync(jp)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(jp, 'utf8'));
      if (j.inheritsFrom === id) out.push(name);
    } catch (e) {
      /* ignore */
    }
  }
  return out;
}

/** 删除前预览信息 */
function versionDeleteInfo(mcFolder, id) {
  const versionsDir = path.resolve(path.join(mcFolder || '', 'versions'));
  const dir = path.resolve(path.join(versionsDir, id));
  if (!dir.startsWith(versionsDir + path.sep)) throw new Error(M('非法的版本路径', 'Invalid version path'));
  if (!fs.existsSync(dir)) throw new Error(M('版本不存在：', 'Version does not exist: ') + id);
  if (!fs.statSync(dir).isDirectory()) throw new Error(M('不是版本目录：', 'Not a version directory: ') + id);
  return { id, dir, bytes: dirSize(dir), dependents: findDependents(mcFolder, id) };
}

/** 真正删除（只删 versions/<id>，不动 saves / mods / libraries / assets） */
function deleteVersion(mcFolder, id) {
  const info = versionDeleteInfo(mcFolder, id);
  fs.rmSync(info.dir, { recursive: true, force: true });
  return { id, removed: info.dir, bytes: info.bytes, dependents: info.dependents };
}

module.exports = {
  launch,
  findJavaCandidates,
  javaMajor,
  loadVersion,
  offlineUuid,
  inspect,
  findClientJar,
  repair,
  listMissing,
  listMissingAssets,
  checkAssets,
  fetchManifest,
  downloadVersion,
  versionDeleteInfo,
  deleteVersion,
  extractZipTo,
  downloadFile,
};

// ---------------------------------------------------------------- 官方版本清单 / 下载安装

const OFFICIAL_UA = 'MCToolbox/1.0.0';
let manifestCache = null;

/** 拉取 Mojang 官方版本清单 */
async function fetchManifest(force) {
  if (manifestCache && !force) return manifestCache;
  const res = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
    headers: { 'User-Agent': OFFICIAL_UA },
  });
  if (!res.ok) throw new Error(M('获取官方版本清单失败 HTTP ', 'Failed to fetch the official version manifest HTTP ') + res.status);
  const json = await res.json();
  const list = (json.versions || []).map((v) => ({
    id: v.id,
    type: v.type,
    releaseTime: v.releaseTime,
    url: v.url,
    sha1: v.sha1,
  }));
  list.sort((a, b) => String(b.releaseTime || '').localeCompare(String(a.releaseTime || '')));
  manifestCache = {
    latest: json.latest || {},
    versions: list,
    fetchedAt: Date.now(),
  };
  return manifestCache;
}

/**
 * 下载并安装一个官方版本（版本 JSON -> 客户端 jar -> 依赖库 -> 资源索引 -> 资源文件）
 * @param {(done:number,total:number,label:string,phase:string)=>void} onProgress
 */
async function downloadVersion(mcFolder, id, versionUrl, onProgress, opts) {
  opts = opts || {};
  if (!mcFolder) throw new Error(M('未设置 .minecraft 文件夹', 'No .minecraft folder set'));
  if (!id) throw new Error(M('未指定版本号', 'No version ID specified'));

  let url = versionUrl;
  if (!url) {
    const man = await fetchManifest();
    const hit = man.versions.find((v) => v.id === id);
    if (!hit) throw new Error(M('官方清单里没有版本 ', 'Version not found in the official manifest: ') + id);
    url = hit.url;
  }

  const dir = path.join(mcFolder, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, id + '.json');

  if (onProgress) onProgress(0, 1, M('版本 JSON', 'Version JSON'), 'json');
  await downloadFile(url, jsonPath);
  if (onProgress) onProgress(1, 1, M('版本 JSON', 'Version JSON'), 'json');

  // 剩下的交给补全逻辑：客户端 jar + 依赖库 + 资源索引 + 资源对象
  const result = await repair(mcFolder, id, onProgress, {
    includeAssets: opts.includeAssets !== false,
    assetsDir: opts.assetsDir,
  });
  return Object.assign({ versionId: id }, result);
}

// ---------------------------------------------------------------- 补全缺失文件

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MCToolbox/1.0.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

/** 列出该版本缺失、且能下载的文件 */
function listMissing(mcFolder, id) {
  const version = loadVersion(mcFolder, id);
  const out = [];

  const jarPath = path.join(mcFolder, 'versions', id, id + '.jar');
  const clientArt = version.downloads && version.downloads.client;
  if (!fs.existsSync(jarPath)) {
    if (clientArt && clientArt.url) out.push({ url: clientArt.url, dest: jarPath, label: M('客户端 jar', 'Client jar'), size: clientArt.size });
    else if (version.inheritsFrom) {
      // 继承版本用父级的 jar，检查父级
      const pj = findClientJar(mcFolder, version.inheritsFrom);
      if (!pj) out.push({ url: null, dest: jarPath, label: M('客户端 jar (父版本也缺失)', 'Client jar (missing in the parent version too)'), size: 0 });
    } else if (!findClientJar(mcFolder, id)) {
      out.push({ url: null, dest: jarPath, label: M('客户端 jar (无可下载地址)', 'Client jar (no download URL)'), size: 0 });
    }
  }

  for (const lib of version.libraries || []) {
    if (!allowedByRules(lib.rules)) continue;
    const art = lib.downloads && lib.downloads.artifact;
    if (art && art.path) {
      const dest = path.join(mcFolder, 'libraries', art.path);
      if (!fs.existsSync(dest)) {
        if (art.url) out.push({ url: art.url, dest, label: lib.name, size: art.size });
        else out.push({ url: null, dest, label: lib.name + M(' (无可下载地址)', ' (no download URL)'), size: 0 });
      }
    }
    if (lib.natives && lib.natives.windows) {
      const classifier = String(lib.natives.windows).replace('${arch}', process.arch === 'x64' ? '64' : '32');
      const nat = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifier];
      if (nat && nat.path) {
        const dest = path.join(mcFolder, 'libraries', nat.path);
        if (!fs.existsSync(dest)) out.push({ url: nat.url, dest, label: lib.name + ' (natives)', size: nat.size });
      }
    }
  }

  if (version.assetIndex && version.assetIndex.url && version.assetIndex.id) {
    const dest = path.join(mcFolder, 'assets', 'indexes', version.assetIndex.id + '.json');
    if (!fs.existsSync(dest)) out.push({ url: version.assetIndex.url, dest, label: M('资源索引 ', 'Asset index ') + version.assetIndex.id, size: 0 });
  }

  return out;
}

/**
 * 补全缺失的游戏文件（依赖库 / 客户端 jar / 资源索引 / 资源对象）。
 * @param {(done:number,total:number,label:string,phase:string)=>void} onProgress
 * @param {{assetsDir?:string, includeAssets?:boolean}} [opts]
 */
async function repair(mcFolder, id, onProgress, opts) {
  opts = opts || {};
  const externalAssets = opts.assetsDir && fs.existsSync(opts.assetsDir) ? opts.assetsDir : null;
  const assetsDir = externalAssets || path.join(mcFolder, 'assets');

  let list;
  try {
    list = listMissing(mcFolder, id);
  } catch (e) {
    return { total: 0, done: 0, failed: 0, error: e.message, skipped: [] };
  }

  let lastReport = 0;
  const report = (d, t, label, phase) => {
    const now = Date.now();
    if (onProgress && (now - lastReport > 200 || d >= t)) {
      lastReport = now;
      onProgress(d, t, label, phase);
    }
  };

  const skipped = list.filter((x) => !x.url);
  const todo = list.filter((x) => x.url);

  let done = 0;
  let failed = 0;
  for (const item of todo) {
    try {
      await downloadFile(item.url, item.dest);
      done++;
    } catch (e) {
      failed++;
    }
    report(done + failed, todo.length, item.label, 'files');
  }

  // 第二阶段：资源对象（体积大，可选）
  let assets = null;
  let assetReason = null;
  if (opts.includeAssets && !externalAssets) {
    let version = null;
    try {
      version = loadVersion(mcFolder, id);
    } catch (e) {
      /* ignore */
    }
    if (version) {
      const a = listMissingAssets(mcFolder, assetsDir, version);
      if (a.list.length) {
        const bytes = a.list.reduce((s, x) => s + (x.size || 0), 0);
        const mb = (bytes / 1024 / 1024).toFixed(0);
        report(0, a.list.length, M('需要下载 ', 'Downloading ') + a.list.length + M(' 个资源文件，共约 ', ' asset files, about ') + mb + M(' MB，请耐心等待', ' MB in total, please wait'), 'assets-info');
        const r = await downloadAll(a.list, 24, (d, f, item) => report(d, a.list.length, item.label, 'assets'));
        assets = { total: a.list.length, done: r.done, failed: r.failed, bytes };
      } else {
        assets = { total: 0, done: 0, failed: 0 };
        assetReason = a.reason || null;
      }
    }
  }

  const after = inspect(mcFolder, id);
  let assetCheck = { ok: true, reason: null };
  try {
    const v2 = loadVersion(mcFolder, id);
    assetCheck = checkAssets(mcFolder, v2, externalAssets);
  } catch (e) {
    /* ignore */
  }

  return {
    total: todo.length,
    done,
    failed,
    assets,
    assetsReason: assetReason,
    usedExternalAssets: externalAssets,
    skipped: skipped.map((s) => s.label),
    launchable: after.launchable && assetCheck.ok,
    missingLibs: after.missingLibs,
    totalLibs: after.totalLibs,
    reason: after.reason || null,
    assetsOk: assetCheck.ok,
    assetsReasonDetail: assetCheck.reason || null,
  };
}
