const fs = require('fs');
const path = require('path');
const os = require('os');
const { downloadFile, extractZipTo } = require('./mcrun');
const { M } = require('./i18n');

/** 整合包安装器：装成独立实例（自己的 mods / config / 存档），不污染主目录 */

const UA = 'MCToolbox/1.0.0';

function safeId(name) {
  let s = String(name || 'Modpack')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) s = 'Modpack';
  return s.slice(0, 60);
}

async function fetchJson(url, headers) {
  const res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers || {}) });
  const text = await res.text();
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return JSON.parse(text);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** 读 JSON，容忍 UTF-8 BOM（有些打包工具会写进去） */
function readJsonLoose(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

/** 整合包依赖的基础 Minecraft 版本必须存在；没有就顺便下下来 */
async function ensureBaseVersion(mcFolder, mcVersion, onStatus, onProgress, allowDownload) {
  const p = path.join(mcFolder, 'versions', mcVersion, mcVersion + '.json');
  if (fs.existsSync(p)) return { ok: true, downloaded: false };
  if (!allowDownload) return { ok: false, downloaded: false, reason: M('缺少基础版本 ', 'Missing base version ') + mcVersion };
  const { fetchManifest, downloadVersion } = require('./mcrun');
  onStatus && onStatus(M('缺少基础版本 Minecraft ', 'Missing base version Minecraft ') + mcVersion + M('，正在从官方源下载…', ' - downloading from the official source…'));
  const man = await fetchManifest();
  const hit = (man.versions || []).find((v) => v.id === mcVersion);
  if (!hit) throw new Error(M('官方版本清单里找不到 Minecraft ', 'Cannot find Minecraft ') + mcVersion + M('（可能是很古老的版本）', ' in the official version manifest (it may be a very old version)'));
  await downloadVersion(mcFolder, mcVersion, hit.url, onProgress, { includeAssets: true });
  return { ok: true, downloaded: true };
}

/** 用 Fabric / Quilt 的 meta 接口直接生成加载器版本（不需要跑安装器） */
async function ensureLoader(mcFolder, kind, mcVersion, loaderVersion) {
  const base =
    kind === 'quilt'
      ? 'https://meta.quiltmc.org/v3/versions/loader'
      : 'https://meta.fabricmc.net/v2/versions/loader';
  const guess = `${kind === 'quilt' ? 'quilt-loader' : 'fabric-loader'}-${loaderVersion}-${mcVersion}`;
  const guessPath = path.join(mcFolder, 'versions', guess, guess + '.json');
  if (fs.existsSync(guessPath)) return guess;

  const j = await fetchJson(`${base}/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`);
  const id = j.id || guess;
  const dir = path.join(mcFolder, 'versions', id);
  const jsonPath = path.join(dir, id + '.json');
  if (!fs.existsSync(jsonPath)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(j, null, 2), 'utf8');
  }
  return id;
}

const FORGE_HINT = M(
  '这个整合包需要 %LOADER% 加载器，本工具没法自动安装它（需要运行官方安装器）。\n' +
    '请先用 PCL 或其他启动器装好 %MC% 的 %LOADER%，装完再回来安装本整合包 —— 那时就能直接装上了。',
  'This modpack needs the %LOADER% loader, which this tool cannot install automatically (the official installer must be run).\n' +
    'Please install %LOADER% for %MC% with PCL or another launcher first, then come back and install this modpack — it will work then.'
);

function writeInstance(mcFolder, instId, parentId, meta) {
  const instDir = path.join(mcFolder, 'versions', instId);
  fs.mkdirSync(instDir, { recursive: true });
  const now = new Date().toISOString();
  const instJson = {
    id: instId,
    inheritsFrom: parentId,
    type: 'release',
    releaseTime: now,
    time: now,
    mctool: { modpack: true, name: meta.name, packVersion: meta.packVersion },
  };
  fs.writeFileSync(path.join(instDir, instId + '.json'), JSON.stringify(instJson, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(instDir, 'mctool-instance.json'),
    JSON.stringify(
      Object.assign({ gameDir: instDir, installedAt: now }, meta),
      null,
      2
    ),
    'utf8'
  );
  return instDir;
}

/** 安装 Modrinth 整合包 (.mrpack) */
async function installModrinthPack({ mcFolder, zipPath, onStatus, onProgress, downloadBase = true }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mctool-pack-'));
  try {
    onStatus && onStatus(M('正在解压整合包…', 'Extracting the modpack…'));
    extractZipTo(zipPath, tmp, () => true);
    const indexPath = path.join(tmp, 'modrinth.index.json');
    if (!fs.existsSync(indexPath)) throw new Error(M('这不是有效的 Modrinth 整合包（缺少 modrinth.index.json）', 'This is not a valid Modrinth modpack (modrinth.index.json is missing)'));
    const index = readJsonLoose(indexPath);
    const deps = index.dependencies || {};
    const mcVersion = deps.minecraft;
    if (!mcVersion) throw new Error(M('整合包里没有写 Minecraft 版本', 'The modpack does not specify a Minecraft version'));

    let parentId = mcVersion;
    if (deps['fabric-loader']) {
      await ensureBaseVersion(mcFolder, mcVersion, onStatus, onProgress, downloadBase);
      onStatus && onStatus(M('正在准备 Fabric ', 'Preparing Fabric ') + deps['fabric-loader'] + M('（MC ', ' (MC ') + mcVersion + M('）…', ')…'));
      parentId = await ensureLoader(mcFolder, 'fabric', mcVersion, deps['fabric-loader']);
    } else if (deps['quilt-loader']) {
      await ensureBaseVersion(mcFolder, mcVersion, onStatus, onProgress, downloadBase);
      onStatus && onStatus(M('正在准备 Quilt ', 'Preparing Quilt ') + deps['quilt-loader'] + M('（MC ', ' (MC ') + mcVersion + M('）…', ')…'));
      parentId = await ensureLoader(mcFolder, 'quilt', mcVersion, deps['quilt-loader']);
    } else if (deps.forge || deps.neoforge) {
      const which = deps.neoforge ? 'NeoForge' : 'Forge';
      const ver = deps.neoforge || deps.forge;
      throw new Error(
        FORGE_HINT.replace('%LOADER%', which + ' ' + ver).replace('%MC%', mcVersion)
      );
    }

    const instId = safeId(index.name || path.basename(zipPath).replace(/\.mrpack$/i, ''));
    const instDir = path.join(mcFolder, 'versions', instId);
    fs.mkdirSync(instDir, { recursive: true });

    const files = (index.files || []).filter((f) => !(f.env && f.env.client === 'unsupported'));
    let done = 0;
    let failed = 0;
    const failedList = [];

    for (const f of files) {
      const url = (f.downloads || [])[0];
      const dest = path.join(instDir, f.path);
      const already =
        fs.existsSync(dest) && (!f.fileSize || fs.statSync(dest).size === f.fileSize);
      if (already) {
        done++;
      } else if (!url) {
        failed++;
        failedList.push(f.path + M('（没有下载地址）', ' (no download URL)'));
      } else {
        try {
          await downloadFile(url, dest);
          done++;
        } catch (e) {
          failed++;
          failedList.push(f.path);
        }
      }
      if (onProgress) onProgress(done + failed, files.length, f.path);
    }

    for (const ovName of ['overrides', 'client-overrides']) {
      const ov = path.join(tmp, ovName);
      if (fs.existsSync(ov)) {
        onStatus && onStatus(M('正在写入配置文件…', 'Writing the configuration files…'));
        copyDir(ov, instDir);
      }
    }

    const dir = writeInstance(mcFolder, instId, parentId, {
      name: index.name || instId,
      packVersion: index.versionId || '',
      source: 'modrinth',
      mcVersion,
      loader: deps['fabric-loader'] ? 'fabric' : deps['quilt-loader'] ? 'quilt' : 'vanilla',
    });

    return {
      instanceId: instId,
      instanceDir: dir,
      mcVersion,
      parentId,
      total: files.length,
      done,
      failed,
      failedList: failedList.slice(0, 10),
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

/** 安装 CurseForge 整合包（manifest.json + overrides） */
async function installCurseforgePack({ mcFolder, zipPath, curseforgeKey, onStatus, onProgress, downloadBase = true }) {
  if (!curseforgeKey) throw new Error(M('安装 CurseForge 整合包需要 API Key（请在设置里填写）', 'Installing a CurseForge modpack requires an API Key (please fill it in the settings)'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mctool-cfpack-'));
  try {
    onStatus && onStatus(M('正在解压整合包…', 'Extracting the modpack…'));
    extractZipTo(zipPath, tmp, () => true);
    const manPath = path.join(tmp, 'manifest.json');
    if (!fs.existsSync(manPath)) throw new Error(M('这不是有效的 CurseForge 整合包（缺少 manifest.json）', 'This is not a valid CurseForge modpack (manifest.json is missing)'));
    const man = readJsonLoose(manPath);
    const mcVersion = man.minecraft && man.minecraft.version;
    if (!mcVersion) throw new Error(M('整合包里没有写 Minecraft 版本', 'The modpack does not specify a Minecraft version'));

    const primary = ((man.minecraft && man.minecraft.modLoaders) || []).find((l) => l.primary) ||
      ((man.minecraft && man.minecraft.modLoaders) || [])[0] || {};
    const loaderId = String(primary.id || ''); // 形如 fabric-0.14.21 / forge-47.2.0
    const dash = loaderId.lastIndexOf('-');

    let parentId = mcVersion;
    if (/^fabric-/i.test(loaderId)) {
      await ensureBaseVersion(mcFolder, mcVersion, onStatus, onProgress, downloadBase);
      parentId = await ensureLoader(mcFolder, 'fabric', mcVersion, loaderId.slice(dash + 1));
    } else if (/^quilt-/i.test(loaderId)) {
      await ensureBaseVersion(mcFolder, mcVersion, onStatus, onProgress, downloadBase);
      parentId = await ensureLoader(mcFolder, 'quilt', mcVersion, loaderId.slice(dash + 1));
    } else if (/forge/i.test(loaderId)) {
      throw new Error(FORGE_HINT.replace('%LOADER%', loaderId).replace('%MC%', mcVersion));
    }

    const instId = safeId(man.name || path.basename(zipPath).replace(/\.zip$/i, ''));
    const instDir = path.join(mcFolder, 'versions', instId);
    fs.mkdirSync(instDir, { recursive: true });

    const files = (man.files || []).filter((f) => f.required !== false);
    let done = 0;
    let failed = 0;
    const failedList = [];
    const headers = { 'x-api-key': curseforgeKey };

    for (const f of files) {
      try {
        const info = await fetchJson(`https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}`, headers);
        const fileName = info.data && info.data.fileName;
        let url = info.data && info.data.downloadUrl;
        if (!url) {
          const dl = await fetchJson(
            `https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}/download-url`,
            headers
          );
          url = dl.data;
        }
        if (!url || !fileName) throw new Error(M('没有下载地址', 'No download URL'));
        await downloadFile(url, path.join(instDir, 'mods', fileName));
        done++;
      } catch (e) {
        failed++;
        failedList.push(`projectID ${f.projectID} / fileID ${f.fileID}: ${e.message}`);
      }
      if (onProgress) onProgress(done + failed, files.length, `mod ${f.projectID}`);
    }

    const ov = path.join(tmp, 'overrides');
    if (fs.existsSync(ov)) copyDir(ov, instDir);

    const dir = writeInstance(mcFolder, instId, parentId, {
      name: man.name || instId,
      packVersion: man.version || '',
      source: 'curseforge',
      mcVersion,
      loader: /fabric/i.test(loaderId) ? 'fabric' : /quilt/i.test(loaderId) ? 'quilt' : 'vanilla',
    });

    return {
      instanceId: instId,
      instanceDir: dir,
      mcVersion,
      parentId,
      total: files.length,
      done,
      failed,
      failedList: failedList.slice(0, 10),
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }
}

/** 自动识别格式并安装 */
async function installPack({ mcFolder, zipPath, source, curseforgeKey, onStatus, onProgress, downloadBase }) {
  if (!mcFolder) throw new Error(M('请先选择 .minecraft 文件夹', 'Please select the .minecraft folder first'));
  if (!zipPath || !fs.existsSync(zipPath)) throw new Error(M('整合包文件不存在：', 'Modpack file does not exist: ') + zipPath);
  const opts = { mcFolder, zipPath, onStatus, onProgress, downloadBase: downloadBase !== false };
  if (source === 'curseforge') {
    return installCurseforgePack(Object.assign(opts, { curseforgeKey }));
  }
  return installModrinthPack(opts);
}

/** 列出已安装的整合包实例 */
function listInstances(mcFolder) {
  const versionsDir = path.join(mcFolder || '', 'versions');
  const out = [];
  if (!fs.existsSync(versionsDir)) return out;
  for (const name of fs.readdirSync(versionsDir)) {
    const marker = path.join(versionsDir, name, 'mctool-instance.json');
    if (!fs.existsSync(marker)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(marker, 'utf8'));
      out.push(Object.assign({ instanceId: name }, j));
    } catch (e) {
      /* ignore */
    }
  }
  return out;
}

module.exports = { installPack, installModrinthPack, installCurseforgePack, listInstances, ensureLoader, safeId };
