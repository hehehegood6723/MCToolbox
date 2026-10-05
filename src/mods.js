const fs = require('fs');
const path = require('path');
const { M } = require('./i18n');

/** Modrinth + CurseForge 搜索与下载（支持 mod / 整合包 / 资源包 / 光影包 / 数据包） */

const UA = 'MCToolbox/1.0.0 (local desktop tool)';

/** 分类定义：Modrinth 的 project_type、CurseForge 的 classId、以及各自该放进哪个文件夹 */
const KINDS = {
  mod: {
    id: 'mod',
    label: 'Mod',
    modrinth: 'mod',
    cfClass: 6,
    folder: 'mods',
    useLoader: true,
    tip: M('放进 .minecraft\\mods，需要和游戏版本 + 加载器（Forge/Fabric）匹配', 'Put it in .minecraft\\mods; it must match the game version and mod loader (Forge/Fabric)'),
  },
  modpack: {
    id: 'modpack',
    label: M('整合包', 'Modpack'),
    modrinth: 'modpack',
    cfClass: 4471,
    folder: null,
    useLoader: false,
    tip: M('整合包会安装成一个独立实例（独立的 mods / 存档），不会污染你原来的版本', 'A modpack installs as a separate instance (its own mods / saves) and will not touch your existing versions'),
  },
  resourcepack: {
    id: 'resourcepack',
    label: M('资源包', 'Resource pack'),
    modrinth: 'resourcepack',
    cfClass: 12,
    folder: 'resourcepacks',
    useLoader: false,
    tip: M('放进 .minecraft\\resourcepacks，然后在游戏「选项 → 资源包」里启用', 'Put it in .minecraft\\resourcepacks, then enable it in Options → Resource Packs in game'),
  },
  shader: {
    id: 'shader',
    label: M('光影包', 'Shader pack'),
    modrinth: 'shader',
    cfClass: 6552,
    folder: 'shaderpacks',
    useLoader: false,
    tip: M('放进 .minecraft\\shaderpacks，需要先装 Iris / OptiFine 才能用', 'Put it in .minecraft\\shaderpacks; you need Iris / OptiFine installed first'),
  },
  datapack: {
    id: 'datapack',
    label: M('数据包', 'Datapack'),
    modrinth: 'datapack',
    cfClass: 6945,
    folder: 'datapacks',
    useLoader: false,
    tip: M(
      '默认放到 .minecraft\\datapacks；要只对某个存档生效，请改放到 saves\\<存档名>\\datapacks',
      'Goes in .minecraft\\datapacks by default; to apply it to one save only, put it in saves\\<save name>\\datapacks instead'
    ),
  },
};

function kindOf(kind) {
  return KINDS[kind] || KINDS.mod;
}

/** 该分类默认该放哪个文件夹 */
function folderFor(kind, mcFolder) {
  const k = kindOf(kind);
  if (!k.folder) return null;
  return path.join(mcFolder || '', k.folder);
}

function configPath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'mctool-config.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch (e) {
    return { curseforgeKey: '', mcFolder: '', username: 'Player' };
  }
}

function writeConfig(cfg) {
  const cur = readConfig();
  const merged = Object.assign(cur, cfg || {});
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers: Object.assign({ 'User-Agent': UA, Accept: 'application/json' }, headers || {}) });
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j && j.error) msg += ' - ' + j.error;
      if (j && j.errorMessage) msg += ' - ' + j.errorMessage;
    } catch (e) {
      msg += ' - ' + text.slice(0, 200);
    }
    throw new Error(msg);
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------- Modrinth

async function modrinthSearch({ query, gameVersion, loader, limit = 20, kind = 'mod' }) {
  const k = kindOf(kind);
  const facets = [['project_type:' + (k.modrinth || 'mod')]];
  if (k.useLoader && loader) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const url =
    'https://api.modrinth.com/v2/search?query=' +
    encodeURIComponent(query || '') +
    '&limit=' +
    limit +
    '&index=relevance&facets=' +
    encodeURIComponent(JSON.stringify(facets));

  const json = await getJson(url);
  return (json.hits || []).map((h) => ({
    source: 'modrinth',
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    follows: h.follows,
    icon: h.icon_url,
    categories: h.categories || [],
    versions: h.versions || [],
    projectType: h.project_type,
    url: 'https://modrinth.com/' + (h.project_type === 'modpack' ? 'modpack' : h.project_type || 'mod') + '/' + h.slug,
  }));
}

async function modrinthVersions({ projectId, gameVersion, loader }) {
  const params = [];
  if (gameVersion) params.push('game_versions=' + encodeURIComponent(JSON.stringify([gameVersion])));
  if (loader) params.push('loaders=' + encodeURIComponent(JSON.stringify([loader])));
  const url = `https://api.modrinth.com/v2/project/${projectId}/version` + (params.length ? '?' + params.join('&') : '');
  const list = await getJson(url);
  return (list || []).map((v) => {
    const primary = (v.files || []).find((f) => f.primary) || (v.files || [])[0] || {};
    return {
      source: 'modrinth',
      versionId: v.id,
      name: v.name,
      versionNumber: v.version_number,
      gameVersions: v.game_versions,
      loaders: v.loaders,
      downloads: v.downloads,
      fileName: primary.filename,
      url: primary.url,
      size: primary.size,
      date: v.date_published,
    };
  });
}

// ---------------------------------------------------------------- CurseForge

const LOADER_TYPE = { forge: 1, fabric: 4, quilt: 5, neoforge: 6, liteloader: 3 };

async function curseforgeSearch({ query, gameVersion, loader, limit = 20, kind = 'mod' }) {
  const key = readConfig().curseforgeKey;
  if (!key) throw new Error(M('未配置 CurseForge API Key（点右上角「设置」填写）', 'CurseForge API key is not configured (fill it in under Settings, top right)'));

  const k = kindOf(kind);
  const params = new URLSearchParams({
    gameId: '432',
    classId: String(k.cfClass),
    searchFilter: query || '',
    pageSize: String(limit),
  });
  if (gameVersion) params.set('gameVersion', gameVersion);
  if (k.useLoader) {
    const lt = LOADER_TYPE[String(loader || '').toLowerCase()];
    if (lt) params.set('modLoaderType', String(lt));
  }

  const json = await getJson('https://api.curseforge.com/v1/mods/search?' + params.toString(), { 'x-api-key': key });
  return (json.data || []).map((m) => ({
    source: 'curseforge',
    id: m.id,
    slug: m.slug,
    title: m.name,
    description: m.summary,
    author: (m.authors && m.authors[0] && m.authors[0].name) || '',
    downloads: m.downloadCount,
    follows: m.thumbsUpCount,
    icon: (m.logo && m.logo.thumbnailUrl) || null,
    categories: (m.categories || []).map((c) => c.name),
    versions: (m.latestFilesIndexes || []).map((x) => x.gameVersion).filter((v, i, a) => v && a.indexOf(v) === i),
    url: m.links && m.links.websiteUrl,
  }));
}

async function curseforgeFiles({ projectId, gameVersion, loader }) {
  const key = readConfig().curseforgeKey;
  if (!key) throw new Error(M('未配置 CurseForge API Key', 'CurseForge API key is not configured'));

  const params = new URLSearchParams({ pageSize: '30' });
  if (gameVersion) params.set('gameVersion', gameVersion);
  const lt = LOADER_TYPE[String(loader || '').toLowerCase()];
  if (lt) params.set('modLoaderType', String(lt));

  const json = await getJson(`https://api.curseforge.com/v1/mods/${projectId}/files?` + params.toString(), { 'x-api-key': key });
  const files = json.data || [];

  const out = [];
  for (const f of files) {
    let url = f.downloadUrl;
    if (!url) {
      try {
        const dl = await getJson(`https://api.curseforge.com/v1/mods/${projectId}/files/${f.id}/download-url`, { 'x-api-key': key });
        url = dl.data;
      } catch (e) {
        url = null;
      }
    }
    out.push({
      source: 'curseforge',
      versionId: f.id,
      name: f.displayName,
      versionNumber: f.displayName,
      gameVersions: f.gameVersions || [],
      loaders: [],
      downloads: f.downloadCount,
      fileName: f.fileName,
      url,
      size: f.fileLength,
      date: f.fileDate,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 下载

async function downloadTo(url, dest, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(M('下载失败 HTTP ', 'Download failed: HTTP ') + res.status);
  const total = Number(res.headers.get('content-length') || 0);

  fs.mkdirSync(path.dirname(dest), { recursive: true });

  // Node 的 Readable -> 写文件
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  let received = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (c) => {
    received += c.length;
    if (onProgress && total) onProgress(received, total);
  });
  await pipeline(body, fs.createWriteStream(dest));
  return { path: dest, size: received };
}

async function install({ source, projectId, versionId, mcFolder, modsDir, onProgress, kind = 'mod' }) {
  const k = kindOf(kind);
  const dir = modsDir || (k.folder ? path.join(mcFolder || '', k.folder) : null);
  if (!dir) throw new Error(M('请先设置 .minecraft 文件夹或目标目录', 'Please set the .minecraft folder or a target folder first'));

  let file;
  if (source === 'modrinth') {
    const list = await modrinthVersions({ projectId });
    file = list.find((v) => v.versionId === versionId) || list[0];
  } else {
    const list = await curseforgeFiles({ projectId });
    file = list.find((v) => v.versionId === versionId) || list[0];
  }

  if (!file || !file.url) {
    throw new Error(
      M('该项目没有可下载的文件（可能需要 CurseForge Key，或作者禁用了第三方下载）', 'This project has no downloadable file (you may need a CurseForge key, or the author disabled third-party downloads)')
    );
  }

  const dest = path.join(dir, file.fileName);
  const result = await downloadTo(file.url, dest, onProgress);
  return Object.assign({ fileName: file.fileName, dest, targetDir: dir, kind: k.id }, result);
}

// ---------------------------------------------------------------- 汇总入口

async function search({ source, query, gameVersion, loader, limit, kind }) {
  if (source === 'curseforge') return curseforgeSearch({ query, gameVersion, loader, limit, kind });
  return modrinthSearch({ query, gameVersion, loader, limit, kind });
}

async function versions({ source, projectId, gameVersion, loader }) {
  if (source === 'curseforge') return curseforgeFiles({ projectId, gameVersion, loader });
  return modrinthVersions({ projectId, gameVersion, loader });
}

module.exports = { search, versions, install, readConfig, writeConfig, KINDS, kindOf, folderFor, downloadTo, getJson };
