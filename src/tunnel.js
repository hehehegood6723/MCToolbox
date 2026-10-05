const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync, execFile } = require('child_process');
const { M } = require('./i18n');

/** 内网穿透：ngrok / frp / playit.gg 的检测、下载、启动与地址解析 */

const UA = 'MCToolbox/1.0.0';

const CLIENTS = [
  {
    id: 'bore',
    name: M('bore（免注册，最省事）', 'bore (no sign-up, easiest)'),
    exe: 'bore.exe',
    dirs: ['C:\\Program Files\\bore', path.join(os.homedir(), 'bore'), 'D:\\Download'],
    download: 'https://github.com/ekzhang/bore/releases',
    repo: 'ekzhang/bore',
    assetRe: /x86_64-pc-windows-msvc\.zip$/i,
    note: M(
      '不用注册、不用认领、不用配置 —— 直接给你一个 bore.pub:端口，朋友输入就能连（走公共免费服务器，速度一般）',
      'No sign-up, no claiming, no config — you get a bore.pub:port address that friends can type in directly (public free server, so speed is average)'
    ),
    best: true,
  },
  {
    id: 'playit',
    name: 'playit.gg',
    exe: 'playit.exe',
    dirs: ['C:\\Program Files\\playit', path.join(os.homedir(), 'playit'), 'D:\\Download'],
    download: 'https://playit.gg/download',
    repo: 'playit-cloud/playit-agent',
    assetRe: /windows.*(x86_64|amd64|win64).*\.exe$/i,
    note: M(
      '免费、专为 MC 设计；需要装完整客户端并在网页认领隧道（新版单独跑 exe 不会自动建隧道）',
      'Free and made for Minecraft; you need the full client and must claim the tunnel on the website (running the exe alone no longer creates a tunnel)'
    ),
  },
  {
    id: 'ngrok',
    name: 'ngrok',
    exe: 'ngrok.exe',
    dirs: ['C:\\Program Files\\ngrok', path.join(os.homedir(), 'ngrok'), 'D:\\Download'],
    download: 'https://ngrok.com/download',
    equinox: 'https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip',
    note: M(
      '需要 auth token；注意：官网免费版通常不含 TCP 隧道，若报错请改用 bore 或 frp',
      'Needs an auth token; note: the free plan usually does not include TCP tunnels, so switch to bore or frp if it errors'
    ),
  },
  {
    id: 'frpc',
    name: 'frp (frpc)',
    exe: 'frpc.exe',
    dirs: ['C:\\Program Files\\frp', path.join(os.homedir(), 'frp'), 'D:\\Download'],
    download: 'https://github.com/fatedier/frp/releases',
    repo: 'fatedier/frp',
    assetRe: /windows_amd64\.zip$/i,
    note: M(
      '需要你自己有一台公网服务器跑 frps，并填好 frpc 配置',
      'You need your own public server running frps, plus a working frpc config'
    ),
  },
];

let toolsRoot = null;

/** 设置"我们自己的工具下载目录"（installClient 就是装到这里） */
function setToolsRoot(dir) {
  toolsRoot = dir || null;
}

function which(exe) {
  try {
    const r = spawnSync('where', [exe], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) {
      const p = String(r.stdout).split(/\r?\n/)[0].trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

/** 在我们自己的工具目录里找（含解压后可能多一层子目录的情况） */
function findInTools(cl) {
  if (!toolsRoot || !cl || !cl.id || !cl.exe) return null;
  const direct = path.join(toolsRoot, cl.id, cl.exe);
  if (fs.existsSync(direct)) return direct;
  const base = path.join(toolsRoot, cl.id);
  if (!fs.existsSync(base)) return null;
  const found = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name.toLowerCase() === cl.exe.toLowerCase()) found.push(p);
    }
  };
  walk(base, 0);
  return found[0] || null;
}

function findExe(cl) {
  // 1) 我们自己下载安装的目录（最常见）
  const inTools = findInTools(cl);
  if (inTools) return inTools;
  // 2) 系统 PATH
  const p = which(cl.exe);
  if (p) return p;
  // 3) 常见安装位置
  for (const d of cl.dirs) {
    const f = path.join(d, cl.exe);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function detectClients() {
  return CLIENTS.map((c) => {
    const p = findExe(c); // 只找一次（每次 findExe 都要起一个 where 进程，别重复）
    return {
      id: c.id,
      name: c.name,
      exe: c.exe,
      path: p,
      installed: !!p,
      download: c.download,
      note: c.note,
      best: !!c.best,
    };
  });
}

function getClient(id) {
  const c = CLIENTS.find((x) => x.id === id);
  if (!c) throw new Error(M('未知的穿透工具：', 'Unknown tunnel tool: ') + id);
  return c;
}

/** 异步版的 findExe，避免阻塞主进程 */
async function findExeAsync(cl) {
  const inTools = findInTools(cl);
  if (inTools) return inTools;
  return new Promise((resolve) => {
    execFile('where', [cl.exe], { encoding: 'utf8', windowsHide: true }, (err, stdout) => {
      if (!err) {
        const first = String(stdout || '').split(/\r?\n/)[0].trim();
        if (first && fs.existsSync(first)) return resolve(first);
      }
      for (const d of cl.dirs) {
        const f = path.join(d, cl.exe);
        if (fs.existsSync(f)) return resolve(f);
      }
      resolve(null);
    });
  });
}

async function detectClientsAsync() {
  const out = [];
  for (const c of CLIENTS) {
    const p = await findExeAsync(c);
    out.push({
      id: c.id,
      name: c.name,
      exe: c.exe,
      path: p,
      installed: !!p,
      download: c.download,
      note: c.note,
      best: !!c.best,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 下载

// 国内访问 github.com 经常被 DNS 劫持 / 连接超时，这两个加速镜像实测可用
const GH_PROXIES = ['https://ghproxy.net/', 'https://gh-proxy.com/'];

async function downloadOnce(url, dest) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const { Readable } = require('stream');
  const { pipeline } = require('stream/promises');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return dest;
}

/** 下载文件；GitHub 直连失败时自动换加速镜像重试 */
async function downloadFile(url, dest) {
  try {
    return await downloadOnce(url, dest);
  } catch (e) {
    if (!/^https:\/\/github\.com\//i.test(url)) throw e;
    let lastErr = e;
    for (const p of GH_PROXIES) {
      try {
        return await downloadOnce(p + url, dest);
      } catch (e2) {
        lastErr = e2;
      }
    }
    throw new Error(
      M('GitHub 直连和镜像都失败了（', 'Both the direct GitHub download and the mirrors failed (') +
        (lastErr && lastErr.message) +
        M('）—— 可以挂代理后重试，或手动下载放到工具目录', ') — retry with a proxy, or download the file manually into the tools folder')
    );
  }
}

async function githubAsset(repo, assetRe) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(M('查询 GitHub 发布信息失败 HTTP ', 'Failed to query GitHub release info: HTTP ') + res.status);
  const j = await res.json();
  const asset = (j.assets || []).find((a) => assetRe.test(a.name));
  if (!asset) {
    throw new Error(M('没有找到匹配的下载文件（发布页：', 'No matching download found (release page: ') + (j.html_url || repo) + M('）', ')'));
  }
  return { url: asset.browser_download_url, name: asset.name, size: asset.size };
}

/** 下载并安装到 <userData>/tools/<id>/ */
async function installClient(id, toolRoot, onProgress) {
  const c = getClient(id);
  const outDir = path.join(toolRoot, id);
  fs.mkdirSync(outDir, { recursive: true });
  const existing = findInTools(c);
  if (existing) return { ok: true, path: existing, already: true };

  if (id === 'ngrok') {
    if (onProgress) onProgress(M('下载 ngrok…', 'Downloading ngrok…'));
    const zip = path.join(outDir, 'ngrok.zip');
    await downloadFile(c.equinox, zip);
    const { extractZipTo } = require('./mcrun');
    extractZipTo(zip, outDir, (n) => /ngrok\.exe$/i.test(n));
    fs.unlinkSync(zip);
  } else {
    const asset = await githubAsset(c.repo, c.assetRe);
    if (onProgress) onProgress(M('下载 ', 'Downloading ') + asset.name + ' (' + (asset.size / 1024 / 1024).toFixed(1) + ' MB)…');
    const tmp = path.join(outDir, asset.name);
    await downloadFile(asset.url, tmp);
    if (asset.name.toLowerCase().endsWith('.zip')) {
      const { extractZipTo } = require('./mcrun');
      if (onProgress) onProgress(M('解压…', 'Extracting…'));
      extractZipTo(tmp, outDir, (n) => /(^|\/)frpc\.exe$/i.test(n) || /\.exe$/i.test(n));
      // frp 压缩包里是 frp_xxx_windows_amd64/frpc.exe，可能需要再找一层
      if (!fs.existsSync(path.join(outDir, c.exe))) {
        const found = [];
        const walk = (d, depth) => {
          if (depth > 3) return;
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p, depth + 1);
            else if (e.name.toLowerCase() === c.exe) found.push(p);
          }
        };
        walk(outDir, 0);
        if (found.length) {
          fs.copyFileSync(found[0], path.join(outDir, c.exe));
        }
      }
      try {
        fs.unlinkSync(tmp);
      } catch (e) {
        /* ignore */
      }
    } else {
      fs.renameSync(tmp, path.join(outDir, c.exe));
    }
  }

  const final = path.join(outDir, c.exe);
  if (!fs.existsSync(final)) {
    throw new Error(
      M('安装后没有找到 ', 'Could not find ') +
        c.exe +
        M('，请手动下载放到：', ' after installing — please download it manually into: ') +
        outDir
    );
  }
  return { ok: true, path: final };
}

// ---------------------------------------------------------------- 运行中的隧道

const running = new Map(); // id -> { child, address, log, startedAt, mode }

function pushLog(id, line, onLine) {
  const st = running.get(id);
  if (st) {
    st.log.push(line);
    if (st.log.length > 500) st.log.shift();
  }
  if (onLine) onLine(line);
}

function parseNgrok(line) {
  try {
    const j = JSON.parse(line);
    if (j && j.url && /^tcp:\/\//i.test(j.url)) {
      const m = j.url.replace(/^tcp:\/\//i, '').match(/^(.+):(\d+)$/);
      if (m) return { host: m[1], port: Number(m[2]), raw: j.url };
    }
  } catch (e) {
    /* 不是 JSON 行 */
  }
  const m2 = line.match(/(tcp:\/\/)?([a-z0-9.-]+\.ngrok[a-z0-9.-]*):(\d+)/i);
  if (m2) return { host: m2[2], port: Number(m2[3]), raw: m2[0] };
  return null;
}

function parseBore(line) {
  // bore 会输出： listening at bore.pub:34567
  const m = line.match(/listening at\s+([a-z0-9][a-z0-9.-]*):(\d{2,5})/i);
  if (m) return { host: m[1], port: Number(m[2]), raw: m[0] };
  return null;
}

const PRIVATE_RE = /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;

function parsePlayit(line) {
  // 1) 认领链接
  const claim = line.match(/https?:\/\/playit\.gg\/claim\/[A-Za-z0-9_-]+/i);
  if (claim) return { claim: claim[0] };

  // 2) playit 的域名（最常见）
  let m = line.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:playit\.gg|joinmc\.link|at\.playit\.gg)):(\d{2,5})/i);
  if (m) return { host: m[1], port: Number(m[2]), raw: m[0] };

  // 3) "address / tunnel / connect" 后面跟的域名:端口
  m = line.match(/(?:address|tunnel|connect|endpoint|server|addr)\D{0,24}([a-z0-9][a-z0-9.-]*\.[a-z]{2,}):(\d{2,5})/i);
  if (m && !PRIVATE_RE.test(m[1])) return { host: m[1], port: Number(m[2]), raw: m[0] };

  // 4) 公网 IP:端口（排除内网 / 回环）
  const all = line.match(/(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}/g) || [];
  for (const hit of all) {
    const sp = hit.lastIndexOf(':');
    const host = hit.slice(0, sp);
    const port = Number(hit.slice(sp + 1));
    if (!PRIVATE_RE.test(host) && port > 0 && port < 65536) return { host, port, raw: hit };
  }
  return null;
}

/** 从 frpc 配置里读出对外地址：serverAddr:remotePort */
function parseFrpcConfig(configPath) {
  const text = fs.readFileSync(configPath, 'utf8');
  const get = (re) => {
    const m = text.match(re);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  const serverAddr = get(/serverAddr\s*[:=]\s*["']?([^"'\r\n#]+)/i) || get(/server_addr\s*[:=]\s*["']?([^"'\r\n#]+)/i);
  const serverPort = get(/serverPort\s*[:=]\s*(\d+)/i) || get(/server_port\s*[:=]\s*(\d+)/i);
  const remotePort = get(/remotePort\s*[:=]\s*(\d+)/i) || get(/remote_port\s*[:=]\s*(\d+)/i);
  return {
    serverAddr,
    serverPort: serverPort ? Number(serverPort) : null,
    remotePort: remotePort ? Number(remotePort) : null,
  };
}

/**
 * 启动穿透
 * @param {{id:string, port:number, token?:string, exePath?:string, configPath?:string, onLine?:Function}} opts
 */
function start(opts) {
  const { id, port } = opts;
  const c = getClient(id);
  if (running.has(id)) throw new Error(c.name + M(' 已经在运行了，请先停止', ' is already running — stop it first'));

  const exe = opts.exePath || findExe(c);
  if (!exe || !fs.existsSync(exe)) {
    throw new Error(
      M('没有找到 ', 'Could not find ') + c.exe + M('，请先点「自动下载」或手动指定路径', ' — click "Auto download" first, or set the path manually')
    );
  }
  if (!port) throw new Error(M('请先填写要穿透的本地端口', 'Please enter the local port to tunnel first'));

  let args = [];
  let mode = '';

  if (id === 'ngrok') {
    if (!opts.token) {
      throw new Error(
        M('ngrok 需要 auth token（在 ngrok 官网 Dashboard → Your Authtoken 获取）', 'ngrok needs an auth token (get it from the ngrok Dashboard → Your Authtoken)')
      );
    }
    args = ['tcp', String(port), '--authtoken', opts.token, '--log', 'stdout', '--log-format', 'json'];
    mode = `ngrok tcp ${port}`;
  } else if (id === 'bore') {
    const server = opts.boreServer || 'bore.pub';
    args = ['local', String(port), '--to', server];
    if (opts.secret) args.push('--secret', opts.secret);
    mode = `bore local ${port} --to ${server}`;
  } else if (id === 'frpc') {
    if (!opts.configPath || !fs.existsSync(opts.configPath)) {
      throw new Error(M('请选择 frpc 配置文件（.toml / .ini）', 'Please select an frpc config file (.toml / .ini)'));
    }
    args = ['-c', opts.configPath];
    mode = `frpc -c ${path.basename(opts.configPath)}`;
  } else {
    args = [];
    mode = 'playit.exe';
  }

  const child = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true });
  const st = { child, address: null, claim: null, log: [], startedAt: Date.now(), mode, id, port, exe };
  running.set(id, st);

  const handle = (buf) => {
    const text = String(buf);
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      pushLog(id, line, opts.onLine);
      if (!st.address) {
        let hit = null;
        if (id === 'ngrok') hit = parseNgrok(line);
        else if (id === 'playit') hit = parsePlayit(line);
        else if (id === 'bore') hit = parseBore(line);
        if (hit && hit.claim) st.claim = hit.claim;
        if (hit && hit.host) {
          st.address = { host: hit.host, port: hit.port, raw: hit.raw };
          pushLog(id, M('>>> 公网地址：', '>>> Public address: ') + hit.host + ':' + hit.port, opts.onLine);
        }
      }
    }
  };

  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  child.on('error', (err) => pushLog(id, M('[错误] ', '[Error] ') + err.message, opts.onLine));
  child.on('exit', (code) => {
    pushLog(id, M('[退出] ', '[Exit] ') + c.name + M(' 已结束（代码 ', ' has ended (code ') + code + M('）', ')'), opts.onLine);
    running.delete(id);
  });

  // frp：直接从配置推导对外地址
  if (id === 'frpc') {
    try {
      const cfg = parseFrpcConfig(opts.configPath);
      if (cfg.serverAddr && cfg.remotePort) {
        st.address = { host: cfg.serverAddr, port: cfg.remotePort, raw: `${cfg.serverAddr}:${cfg.remotePort}` };
      }
    } catch (e) {
      /* ignore */
    }
  }

  return { ok: true, mode, pid: child.pid, exe };
}

function stop(id) {
  const st = running.get(id);
  if (!st) return { ok: true, already: true };
  try {
    st.child.kill();
  } catch (e) {
    /* ignore */
  }
  running.delete(id);
  return { ok: true };
}

function stopAll() {
  for (const id of Array.from(running.keys())) stop(id);
}

function status(id) {
  const st = id ? running.get(id) : null;
  if (id) {
    return st
      ? { running: true, address: st.address, claim: st.claim, mode: st.mode, pid: st.child.pid, log: st.log.slice(-200) }
      : { running: false };
  }
  return Array.from(running.entries()).map(([k, v]) => ({
    id: k,
    mode: v.mode,
    address: v.address,
    pid: v.child.pid,
  }));
}

module.exports = {
  detectClients,
  detectClientsAsync,
  installClient,
  start,
  stop,
  stopAll,
  status,
  parseFrpcConfig,
  setToolsRoot,
  findExe,
};
