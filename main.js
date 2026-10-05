const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 启动诊断日志（写入系统临时目录，便于排查打不开的问题）
const BOOT_LOG = path.join(os.tmpdir(), 'mctoolbox-boot.log');
function bootLog(msg) {
  try {
    fs.appendFileSync(BOOT_LOG, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    /* ignore */
  }
}
bootLog('--- main.js start, electron=' + process.versions.electron + ' node=' + process.versions.node);
process.on('uncaughtException', (e) => bootLog('UNCAUGHT ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => bootLog('REJECTED ' + ((e && e.stack) || e)));

// ★ 必须在 require 其他模块之前先把语言定下来：
//   有些模块的表（VPN_INFO / PLAYER_GUIDES / KINDS / CLIENTS / RULES）在 require 时
//   就调用 M() 生成文案，晚了就永远是中文。
const i18n = require('./src/i18n');
const { M } = i18n;
try {
  const earlyCfg = JSON.parse(
    fs.readFileSync(path.join(app.getPath('userData'), 'mctool-config.json'), 'utf8').replace(/^\uFEFF/, '')
  );
  if (earlyCfg && earlyCfg.lang) i18n.setLang(earlyCfg.lang);
  bootLog('lang = ' + i18n.getLang());
} catch (e) {
  /* 首次运行还没有配置文件，用默认中文 */
}

const crashlog = require('./src/crashlog');
const serverping = require('./src/serverping');
const litematic = require('./src/litematic');
const mcscan = require('./src/mcscan');
const mcrun = require('./src/mcrun');
const lan = require('./src/lan');
const tunnel = require('./src/tunnel');
const mods = require('./src/mods');
const auth = require('./src/auth');
const accountStore = require('./src/account');
const modpack = require('./src/modpack');
const server = require('./src/server');
// 让 tunnel 知道我们自己的工具下载目录（否则找不到自动下载的 playit.exe）
tunnel.setToolsRoot(path.join(app.getPath('userData'), 'tools'));
bootLog('modules loaded');

let win = null;

function send(channel, payload) {
  try {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  } catch (e) {
    /* ignore */
  }
}

// DNS 被运营商劫持时自动兜底（正常情况下零开销）
const doh = require('./src/doh');
doh.onFallback = (host, ip) => {
  bootLog('DoH fallback: ' + host + ' -> ' + ip);
  send('doh:fallback', { host, ip });
};
doh.install();
doh.installFetchFallback();
bootLog('doh fallback installed');

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 680,
    title: M('MC 工具箱', 'MC Toolbox'),
    backgroundColor: '#eaf4fd',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 关闭时最小化到托盘（默认关闭）
  win.on('close', (e) => {
    let toTray = false;
    try {
      toTray = !!mods.readConfig().minimizeToTray;
    } catch (err) {
      /* ignore */
    }
    if (toTray && !quitting) {
      e.preventDefault();
      win.hide();
      if (!tray) setupTray();
    }
  });

  win.webContents.on('did-finish-load', () => bootLog('renderer loaded ok'));
  win.webContents.on('did-fail-load', (_e, code, desc) => bootLog('renderer load failed ' + code + ' ' + desc));
  win.webContents.on('render-process-gone', (_e, details) => console.log('[ui] renderer gone', JSON.stringify(details)));
  win.webContents.on('console-message', (...args) => {
    const ev = args[0];
    if (ev && typeof ev === 'object' && 'message' in ev) {
      bootLog('[renderer/' + (ev.level ?? '') + '] ' + ev.message);
    } else {
      bootLog('[renderer] ' + args[2]);
    }
  });
}

app.whenReady().then(() => {
  bootLog('app ready');
  createWindow();
  bootLog('window created');
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------- 工具

function safe(handler) {
  return async (event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  };
}

// ---------------------------------------------------------------- 1. 崩溃日志

ipcMain.handle(
  'log:pick',
  safe(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择崩溃日志', 'Choose a crash log'),
      filters: [
        { name: M('日志文件', 'Log files'), extensions: ['txt', 'log', 'gz'] },
        { name: M('全部文件', 'All files'), extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) };
  })
);

ipcMain.handle(
  'log:analyze',
  safe(async (filePath) => crashlog.analyze(filePath))
);

ipcMain.handle(
  'log:recent',
  safe(async (mcFolder) => crashlog.findRecentLogs(mcFolder))
);

// ---------------------------------------------------------------- 2. 服务器查询

ipcMain.handle(
  'server:ping',
  safe(async (host, port) => serverping.ping(host, Number(port) || 25565))
);

// ---------------------------------------------------------------- 3. 图片转换

ipcMain.handle(
  'img:pick',
  safe(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择 JPG 图片', 'Choose JPG images'),
      filters: [{ name: M('JPG 图片', 'JPG images'), extensions: ['jpg', 'jpeg'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (res.canceled) return [];
    return res.filePaths;
  })
);

ipcMain.handle(
  'img:read',
  safe(async (filePath) => {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    return {
      name: path.basename(filePath, ext),
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    };
  })
);

ipcMain.handle(
  'img:pickDir',
  safe(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择输出文件夹', 'Choose output folder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled) return null;
    return res.filePaths[0];
  })
);

ipcMain.handle(
  'img:save',
  safe(async (outDir, name, base64) => {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const data = base64.replace(/^data:image\/png;base64,/, '');
    const target = path.join(outDir, name + '.png');
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
    return target;
  })
);

ipcMain.handle(
  'shell:reveal',
  safe(async (p) => {
    shell.showItemInFolder(p);
    return true;
  })
);

ipcMain.handle(
  'shell:openPath',
  safe(async (p) => shell.openPath(p))
);

// ---------------------------------------------------------------- 4. litematic

ipcMain.handle(
  'litematic:pick',
  safe(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择 litematic 蓝图', 'Choose a litematic blueprint'),
      filters: [{ name: M('Litematica 蓝图', 'Litematica blueprints'), extensions: ['litematic'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) return null;
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) };
  })
);

ipcMain.handle(
  'litematic:load',
  safe(async (filePath) => litematic.load(filePath))
);

// ---------------------------------------------------------------- 5. MC 文件夹

ipcMain.handle(
  'mc:defaultFolder',
  safe(async () => mcscan.defaultFolder()
  )
);

ipcMain.handle(
  'mc:pickFolder',
  safe(async () => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择 .minecraft 文件夹', 'Choose the .minecraft folder'),
      properties: ['openDirectory'],
    });
    if (res.canceled) return null;
    return res.filePaths[0];
  })
);

ipcMain.handle(
  'mc:scan',
  safe(async (folder) => mcscan.scan(folder))
);

ipcMain.handle(
  'mc:javaList',
  safe(async (folder) => mcrun.findJavaCandidates(folder))
);

ipcMain.handle(
  'mc:findFolders',
  safe(async () => mcscan.findGameFolders())
);

ipcMain.handle(
  'mc:deleteVersion',
  safe(async (mcFolder, id) => {
    const info = mcrun.versionDeleteInfo(mcFolder, id);
    const mb = (info.bytes / 1024 / 1024).toFixed(1);
    let detail =
      M('将删除文件夹：', 'Folder to delete:') +
      '\n' +
      info.dir +
      '\n\n' +
      M('占用约 ', 'Size: about ') +
      mb +
      M(
        ' MB。\n存档(saves)、mods、资源(assets)、依赖库(libraries) 不会被删除。',
        ' MB.\nSaves, mods, assets and libraries will NOT be deleted.'
      );
    if (info.dependents.length) {
      detail +=
        '\n\n' +
        M('⚠️ 注意：以下 ', '⚠️ Note: these ') +
        info.dependents.length +
        M(' 个版本依托于它，删除后可能无法启动：', ' version(s) depend on it and may stop launching:') +
        '\n' +
        info.dependents.slice(0, 8).join(', ') +
        (info.dependents.length > 8 ? ' …' : '');
    }
    const res = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: [M('取消', 'Cancel'), M('确认删除', 'Delete')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: M('删除版本', 'Delete version'),
      message: M('确定要删除版本「', 'Delete version "') + id + M('」吗？', '"?'),
      detail,
    });
    if (res.response !== 1) return { cancelled: true };
    return mcrun.deleteVersion(mcFolder, id);
  })
);

ipcMain.handle(
  'mc:manifest',
  safe(async (force) => mcrun.fetchManifest(!!force))
);

ipcMain.handle(
  'mc:downloadVersion',
  safe(async (mcFolder, id, url, opts) =>
    mcrun.downloadVersion(
      mcFolder,
      id,
      url,
      (done, total, label, phase) => {
        if (win && !win.isDestroyed()) win.webContents.send('repair:progress', { done, total, label, phase });
      },
      opts || {}
    )
  )
);

ipcMain.handle(
  'mc:repair',
  safe(async (mcFolder, versionId, opts) =>
    mcrun.repair(
      mcFolder,
      versionId,
      (done, total, label, phase) => {
        if (win && !win.isDestroyed()) win.webContents.send('repair:progress', { done, total, label, phase });
      },
      opts || {}
    )
  )
);

ipcMain.handle(
  'mc:launch',
  safe(async (opts) => {
    const o = Object.assign({}, opts);
    if (o.useMsa) {
      const acc = await freshAccount();
      if (!acc || !acc.accessToken) throw new Error(M('还没有登录微软账号 —— 请先在「版本下载与启动」里点「正版登录」', 'Not signed in — open "Versions & Launch" and click "Sign in (Microsoft)" first'));
      o.account = acc;
    }
    return mcrun.launch(o, (line) => send('game:log', line));
  })
);

// ---------------------------------------------------------------- 正版账户
let tray = null;
let quitting = false;

/** 取登录信息；快过期就静默续期 */
async function freshAccount() {
  const acc = accountStore.load();
  if (!acc) return null;
  const age = Date.now() - (acc.obtainedAt || 0);
  if (age > 12 * 3600 * 1000 && acc.msaRefreshToken) {
    try {
      const next = await auth.loginSilently(acc, { onStatus: (s) => send('auth:status-line', s) });
      accountStore.save(next);
      return next;
    } catch (e) {
      bootLog('silent refresh failed: ' + e.message);
    }
  }
  return acc;
}

ipcMain.handle('auth:current', safe(async () => accountStore.publicView(accountStore.load())));

/**
 * 取正版头像：在主进程下载皮肤贴图，裁出头部（8×8，含帽子层叠加），
 * 以 data URL 返回给界面。
 * 这样做的好处：不用在界面里请求外网（CSP 保持严格）、又只显示头部而不是整张贴图。
 */
ipcMain.handle(
  'auth:head',
  safe(async () => {
    const acc = accountStore.load();
    let url = acc && acc.skins && acc.skins[0] && acc.skins[0].url;
    if (!url) return null;
    url = String(url).replace(/^http:\/\//i, 'https://'); // 档案接口给的是 http，用 https 更稳

    const res = await fetch(url, { headers: { 'User-Agent': 'MCToolbox/1.0.0' } });
    if (!res.ok) throw new Error(M('下载皮肤失败 HTTP ', 'Failed to download skin: HTTP ') + res.status);
    const buf = Buffer.from(await res.arrayBuffer());

    const { nativeImage } = require('electron');
    const img = nativeImage.createFromBuffer(buf);
    if (img.isEmpty()) return null;
    const size = img.getSize();
    if (size.width < 64 || size.height < 32) return null;

    const head = img.crop({ x: 8, y: 8, width: 8, height: 8 });
    const hat = img.crop({ x: 40, y: 8, width: 8, height: 8 });
    const hb = head.getBitmap();
    const tb = hat.getBitmap();

    let out = hb;
    if (hb.length === tb.length && hb.length === 8 * 8 * 4) {
      out = Buffer.alloc(hb.length);
      for (let i = 0; i < hb.length; i += 4) {
        const a = tb[i + 3] / 255; // 帽子层透明度
        out[i] = Math.round(tb[i] * a + hb[i] * (1 - a));
        out[i + 1] = Math.round(tb[i + 1] * a + hb[i + 1] * (1 - a));
        out[i + 2] = Math.round(tb[i + 2] * a + hb[i + 2] * (1 - a));
        out[i + 3] = 255;
      }
    }
    return nativeImage.createFromBitmap(out, { width: 8, height: 8 }).toDataURL();
  })
);

ipcMain.handle(
  'auth:login',
  safe(async (clientId) => {
    const cfg = mods.readConfig();
    const cid = String(clientId || cfg.msaClientId || auth.DEFAULT_CLIENT_ID).trim();
    const acc = await auth.login(win, {
      clientId: cid,
      onStatus: (s) => send('auth:status-line', s),
    });
    accountStore.save(acc);
    return accountStore.publicView(acc);
  })
);

ipcMain.handle(
  'auth:logout',
  safe(async () => {
    accountStore.clear();
    return true;
  })
);

ipcMain.handle(
  'auth:refresh',
  safe(async () => {
    const acc = await freshAccount();
    if (!acc) throw new Error(M('还没有登录', 'Not signed in'));
    accountStore.save(acc);
    return accountStore.publicView(acc);
  })
);

// ---------------------------------------------------------------- 整合包
ipcMain.handle(
  'pack:install',
  safe(async (opts) =>
    modpack.installPack(
      Object.assign({}, opts, {
        curseforgeKey: mods.readConfig().curseforgeKey,
        onStatus: (s) => send('pack:log', s),
        onProgress: (d, t, n) => send('pack:progress', { done: d, total: t, name: n }),
      })
    )
  )
);

ipcMain.handle('pack:list', safe(async (mcFolder) => modpack.listInstances(mcFolder)));

ipcMain.handle(
  'pack:installFromUrl',
  safe(async (req) => {
    const { source, projectId, versionId, mcFolder } = req || {};
    if (!mcFolder) throw new Error(M('请先选择 .minecraft 文件夹', 'Choose a .minecraft folder first'));
    const list = await mods.versions({ source, projectId });
    const file = list.find((v) => String(v.versionId) === String(versionId)) || list[0];
    if (!file || !file.url) throw new Error(M('找不到可下载的整合包文件（CurseForge 需要 API Key）', 'No downloadable modpack file found (CurseForge requires an API key)'));

    const tmp = path.join(os.tmpdir(), 'mctool-pack-' + Date.now() + '-' + (file.fileName || 'pack.mrpack'));
    send('pack:log', M('正在下载整合包文件：', 'Downloading modpack file: ') + file.fileName);
    await mods.downloadTo(file.url, tmp, (d, t) =>
      send('pack:progress', { done: d, total: t, name: M('下载整合包文件 ', 'Downloading modpack file ') + file.fileName })
    );

    const isCf = source === 'curseforge' || /\.zip$/i.test(String(file.fileName || ''));
    try {
      const r = await modpack.installPack({
        mcFolder,
        zipPath: tmp,
        source: isCf ? 'curseforge' : 'modrinth',
        curseforgeKey: mods.readConfig().curseforgeKey,
        onStatus: (s) => send('pack:log', s),
        onProgress: (d, t, n) => send('pack:progress', { done: d, total: t, name: n }),
      });
      return Object.assign({ packFile: file.fileName }, r);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        /* ignore */
      }
    }
  })
);

// ---------------------------------------------------------------- 系统设置 / 托盘
function setupTray() {
  if (tray) return tray;
  const { Tray, Menu, nativeImage } = require('electron');
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'renderer', 'assets', 'tray.png')));
  } catch (e) {
    bootLog('tray create failed ' + e.message);
    return null;
  }
  tray.setToolTip(M('MC 工具箱', 'MC Toolbox'));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: M('显示主界面', 'Show window'),
        click: () => {
          if (win) {
            win.show();
            win.focus();
          }
        },
      },
      { type: 'separator' },
      {
        label: M('退出 MC 工具箱', 'Quit MC Toolbox'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on('double-click', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });
  return tray;
}

function destroyTray() {
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      /* ignore */
    }
    tray = null;
  }
}

ipcMain.handle(
  'settings:get',
  safe(async () => {
    const cfg = mods.readConfig();
    let autoStart = false;
    try {
      autoStart = !!app.getLoginItemSettings().openAtLogin;
    } catch (e) {
      /* ignore */
    }
    return {
      autoStart,
      minimizeToTray: !!cfg.minimizeToTray,
      clientId: cfg.msaClientId || auth.DEFAULT_CLIENT_ID,
      lang: i18n.getLang(),
      hasTray: !!tray,
    };
  })
);

ipcMain.handle(
  'settings:set',
  safe(async (patch) => {
    const p = patch || {};
    const out = {};
    if ('autoStart' in p) {
      try {
        app.setLoginItemSettings({ openAtLogin: !!p.autoStart, path: process.execPath, args: [] });
        out.autoStart = !!app.getLoginItemSettings().openAtLogin;
      } catch (e) {
        out.autoStart = false;
        out.autoStartError = e.message;
      }
    }
    if ('minimizeToTray' in p) {
      mods.writeConfig({ minimizeToTray: !!p.minimizeToTray });
      out.minimizeToTray = !!p.minimizeToTray;
      if (p.minimizeToTray) setupTray();
      else destroyTray();
    }
    if ('clientId' in p) {
      mods.writeConfig({ msaClientId: String(p.clientId || '').trim() });
      out.clientId = String(p.clientId || '').trim();
    }
    if ('lang' in p) {
      const l = i18n.setLang(p.lang);
      mods.writeConfig({ lang: l });
      out.lang = l;
    }
    return out;
  })
);

// ---------------------------------------------------------------- 一键开服
ipcMain.handle('srv:defaultRoot', safe(async () => server.defaultRoot()));
ipcMain.handle('srv:list', safe(async (root) => server.list(root)));
ipcMain.handle('srv:paperVersions', safe(async () => server.paperVersions()));
ipcMain.handle('srv:fabricLoaders', safe(async (mcVersion) => server.fabricLoaders(mcVersion)));
ipcMain.handle(
  'srv:create',
  safe(async (opts) =>
    server.createServer(
      Object.assign({}, opts, {
        onStatus: (s) => send('srv:log', s),
      })
    )
  )
);
ipcMain.handle(
  'srv:start',
  safe(async (opts) =>
    server.start(
      Object.assign({}, opts, {
        onLine: (line) => send('srv:line', { dir: opts.dir, line }),
      })
    )
  )
);
ipcMain.handle('srv:send', safe(async (dir, cmd) => server.send(dir, cmd)));
ipcMain.handle('srv:stop', safe(async (dir, force) => server.stop(dir, force)));
ipcMain.handle('srv:status', safe(async (dir) => server.status(dir)));

// 资源下载用：自动找合适的已安装版本
ipcMain.handle('mc:detectTargets', safe(async (mcFolder, opts) => mcscan.detectTargets(mcFolder, opts)));

// ---------------------------------------------------------------- 异地联机
ipcMain.handle('lan:overview', safe(async () => lan.vpnOverview()));
ipcMain.handle('lan:vpnInfo', safe(async () => lan.vpnInfo()));
ipcMain.handle('lan:playerGuides', safe(async () => lan.playerGuides()));
ipcMain.handle(
  'lan:installVpn',
  safe(async (id) =>
    lan.installVpnTool(id, (msg) => {
      if (win && !win.isDestroyed()) win.webContents.send('tunnel:log', M('[安装] ', '[Install] ') + msg);
    })
  )
);
ipcMain.handle('lan:adapters', safe(async () => lan.listAdapters()));
ipcMain.handle('lan:zerotierJoin', safe(async (networkId) => lan.zerotierJoin(networkId)));
ipcMain.handle('lan:tailscaleUp', safe(async () => lan.tailscaleUp()));
ipcMain.handle('lan:readPort', safe(async (mcFolder) => lan.readLanPort(mcFolder)));
ipcMain.handle('lan:firewall', safe(async (javaPath) => lan.checkFirewall(javaPath)));
ipcMain.handle('lan:firewallFix', safe(async (javaPath) => lan.addFirewallRule(javaPath)));
ipcMain.handle('lan:fingerprint', safe(async (mcFolder, versionId) => lan.fingerprint(mcFolder, versionId)));
ipcMain.handle('lan:buildShare', safe(async (opts) => lan.buildShareText(opts)));
ipcMain.handle('lan:parseShare', safe(async (text) => lan.parseShareText(text)));
ipcMain.handle('lan:tcpTest', safe(async (host, port, timeout) => lan.tcpTest(host, port, timeout)));

ipcMain.handle('tunnel:clients', safe(async () => tunnel.detectClientsAsync()));
ipcMain.handle(
  'tunnel:install',
  safe(async (id) => tunnel.installClient(id, path.join(app.getPath('userData'), 'tools'), (msg) => {
    if (win && !win.isDestroyed()) win.webContents.send('tunnel:log', M('[下载] ', '[Download] ') + msg);
  }))
);
ipcMain.handle(
  'tunnel:start',
  safe(async (opts) =>
    tunnel.start(
      Object.assign({}, opts, {
        onLine: (line) => {
          if (win && !win.isDestroyed()) win.webContents.send('tunnel:log', line);
        },
      })
    )
  )
);
ipcMain.handle('tunnel:stop', safe(async (id) => tunnel.stop(id)));
ipcMain.handle('tunnel:status', safe(async (id) => tunnel.status(id)));

app.on('before-quit', () => {
  quitting = true;
  try {
    tunnel.stopAll();
  } catch (e) {
    /* ignore */
  }
  try {
    server.stopAll();
  } catch (e) {
    /* ignore */
  }
});

ipcMain.handle(
  'shell:pickFile',
  safe(async (fileTitle, filters) => {
    const res = await dialog.showOpenDialog(win, {
      title: fileTitle || M('选择文件', 'Choose a file'),
      properties: ['openFile'],
      filters: filters || [{ name: M('所有文件', 'All files'), extensions: ['*'] }],
    });
    if (res.canceled) return null;
    return res.filePaths[0];
  })
);

ipcMain.handle(
  'shell:pickDir',
  safe(async (fileTitle, defaultPath) => {
    const res = await dialog.showOpenDialog(win, {
      title: fileTitle || M('选择文件夹', 'Choose a folder'),
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled) return null;
    return res.filePaths[0];
  })
);

ipcMain.handle(
  'mods:pickDir',
  safe(async (defaultPath) => {
    const res = await dialog.showOpenDialog(win, {
      title: M('选择 mod 下载文件夹', 'Choose a download folder'),
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled) return null;
    return res.filePaths[0];
  })
);

// ---------------------------------------------------------------- 6. Mod 下载

ipcMain.handle(
  'mods:search',
  safe(async (opts) => mods.search(opts))
);

ipcMain.handle(
  'mods:versions',
  safe(async (opts) => mods.versions(opts))
);

ipcMain.handle(
  'mods:install',
  safe(async (opts) => mods.install(opts))
);

ipcMain.handle(
  'mods:config',
  safe(async () => mods.readConfig())
);

ipcMain.handle(
  'mods:saveConfig',
  safe(async (cfg) => mods.writeConfig(cfg))
);
