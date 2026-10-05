const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 崩溃日志
  pickLog: () => ipcRenderer.invoke('log:pick'),
  analyzeLog: (p) => ipcRenderer.invoke('log:analyze', p),
  recentLogs: (dir) => ipcRenderer.invoke('log:recent', dir),

  // 服务器
  pingServer: (host, port) => ipcRenderer.invoke('server:ping', host, port),

  // 图片
  pickImages: () => ipcRenderer.invoke('img:pick'),
  readImage: (p) => ipcRenderer.invoke('img:read', p),
  pickOutputDir: () => ipcRenderer.invoke('img:pickDir'),
  savePng: (dir, name, b64) => ipcRenderer.invoke('img:save', dir, name, b64),

  // 蓝图
  pickLitematic: () => ipcRenderer.invoke('litematic:pick'),
  loadLitematic: (p) => ipcRenderer.invoke('litematic:load', p),

  // MC 文件夹
  defaultMcFolder: () => ipcRenderer.invoke('mc:defaultFolder'),
  pickMcFolder: () => ipcRenderer.invoke('mc:pickFolder'),
  findGameFolders: () => ipcRenderer.invoke('mc:findFolders'),
  scanVersions: (dir) => ipcRenderer.invoke('mc:scan', dir),
  versionManifest: (force) => ipcRenderer.invoke('mc:manifest', force),
  downloadVersion: (dir, id, url, opts) => ipcRenderer.invoke('mc:downloadVersion', dir, id, url, opts),
  javaList: (dir) => ipcRenderer.invoke('mc:javaList', dir),
  repairVersion: (dir, id, opts) => ipcRenderer.invoke('mc:repair', dir, id, opts),
  deleteVersion: (dir, id) => ipcRenderer.invoke('mc:deleteVersion', dir, id),
  launchGame: (opts) => ipcRenderer.invoke('mc:launch', opts),

  // Mod / 资源
  searchMods: (opts) => ipcRenderer.invoke('mods:search', opts),
  modVersions: (opts) => ipcRenderer.invoke('mods:versions', opts),
  installMod: (opts) => ipcRenderer.invoke('mods:install', opts),
  pickModsDir: (def) => ipcRenderer.invoke('mods:pickDir', def),
  getModConfig: () => ipcRenderer.invoke('mods:config'),
  saveModConfig: (cfg) => ipcRenderer.invoke('mods:saveConfig', cfg),

  // 正版账户
  authCurrent: () => ipcRenderer.invoke('auth:current'),
  authHead: () => ipcRenderer.invoke('auth:head'),
  authLogin: (clientId) => ipcRenderer.invoke('auth:login', clientId),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authRefresh: () => ipcRenderer.invoke('auth:refresh'),
  onAuthStatus: (cb) => ipcRenderer.on('auth:status-line', (_e, s) => cb(s)),

  // 整合包
  installPack: (opts) => ipcRenderer.invoke('pack:install', opts),
  installPackFromUrl: (opts) => ipcRenderer.invoke('pack:installFromUrl', opts),
  listInstances: (mcFolder) => ipcRenderer.invoke('pack:list', mcFolder),
  onPackLog: (cb) => ipcRenderer.on('pack:log', (_e, s) => cb(s)),
  onPackProgress: (cb) => ipcRenderer.on('pack:progress', (_e, p) => cb(p)),

  // 系统设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  // 系统
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  pickDir: (title, def) => ipcRenderer.invoke('shell:pickDir', title, def),
  pickFile: (title, filters) => ipcRenderer.invoke('shell:pickFile', title, filters),

  // 一键开服
  srvDefaultRoot: () => ipcRenderer.invoke('srv:defaultRoot'),
  srvList: (root) => ipcRenderer.invoke('srv:list', root),
  srvPaperVersions: () => ipcRenderer.invoke('srv:paperVersions'),
  srvFabricLoaders: (mcVersion) => ipcRenderer.invoke('srv:fabricLoaders', mcVersion),
  srvCreate: (opts) => ipcRenderer.invoke('srv:create', opts),
  srvStart: (opts) => ipcRenderer.invoke('srv:start', opts),
  srvSend: (dir, cmd) => ipcRenderer.invoke('srv:send', dir, cmd),
  srvStop: (dir, force) => ipcRenderer.invoke('srv:stop', dir, force),
  srvStatus: (dir) => ipcRenderer.invoke('srv:status', dir),
  onSrvLine: (cb) => ipcRenderer.on('srv:line', (_e, x) => cb(x)),
  onSrvLog: (cb) => ipcRenderer.on('srv:log', (_e, s) => cb(s)),

  // 安装目标自动检测
  detectTargets: (mcFolder, opts) => ipcRenderer.invoke('mc:detectTargets', mcFolder, opts),

  // 异地联机
  lanOverview: () => ipcRenderer.invoke('lan:overview'),
  vpnInfo: () => ipcRenderer.invoke('lan:vpnInfo'),
  playerGuides: () => ipcRenderer.invoke('lan:playerGuides'),
  installVpn: (id) => ipcRenderer.invoke('lan:installVpn', id),
  lanAdapters: () => ipcRenderer.invoke('lan:adapters'),
  zerotierJoin: (id) => ipcRenderer.invoke('lan:zerotierJoin', id),
  tailscaleUp: () => ipcRenderer.invoke('lan:tailscaleUp'),
  readLanPort: (mcFolder) => ipcRenderer.invoke('lan:readPort', mcFolder),
  checkFirewall: (javaPath) => ipcRenderer.invoke('lan:firewall', javaPath),
  fixFirewall: (javaPath) => ipcRenderer.invoke('lan:firewallFix', javaPath),
  lanFingerprint: (mcFolder, versionId) => ipcRenderer.invoke('lan:fingerprint', mcFolder, versionId),
  buildShare: (opts) => ipcRenderer.invoke('lan:buildShare', opts),
  parseShare: (text) => ipcRenderer.invoke('lan:parseShare', text),
  tcpTest: (host, port, timeout) => ipcRenderer.invoke('lan:tcpTest', host, port, timeout),

  // 穿透
  tunnelClients: () => ipcRenderer.invoke('tunnel:clients'),
  tunnelInstall: (id) => ipcRenderer.invoke('tunnel:install', id),
  tunnelStart: (opts) => ipcRenderer.invoke('tunnel:start', opts),
  tunnelStop: (id) => ipcRenderer.invoke('tunnel:stop', id),
  tunnelStatus: (id) => ipcRenderer.invoke('tunnel:status', id),
  onTunnelLog: (cb) => ipcRenderer.on('tunnel:log', (_e, line) => cb(line)),
  onDohFallback: (cb) => ipcRenderer.on('doh:fallback', (_e, info) => cb(info)),
  onGameLog: (cb) => ipcRenderer.on('game:log', (_e, line) => cb(line)),
  onRepairProgress: (cb) => ipcRenderer.on('repair:progress', (_e, info) => cb(info)),
});
