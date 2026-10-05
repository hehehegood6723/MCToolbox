const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { downloadFile } = require('./mcrun');
const { M } = require('./i18n');

/** 一键开服：Paper / Fabric / 原版 服务端的创建、启动、控制台 */

const UA = { 'User-Agent': 'MCToolbox/1.0.0', Accept: 'application/json' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

// ---------------------------------------------------------------- 元数据

/** Paper 支持的 Minecraft 版本（新 Fill API） */
async function paperVersions() {
  const j = await getJson('https://fill.papermc.io/v3/projects/paper');
  const groups = j.versions || {};
  const out = [];
  for (const k of Object.keys(groups)) {
    for (const v of groups[k] || []) out.push(v);
  }
  return out;
}

/** Paper 某个 MC 版本的构建（返回最新那个） */
async function paperLatestBuild(mcVersion) {
  const list = await getJson(
    'https://fill.papermc.io/v3/projects/paper/versions/' + encodeURIComponent(mcVersion) + '/builds'
  );
  if (!Array.isArray(list) || !list.length) {
    throw new Error(M('Paper 没有 ', 'No Paper build found for ') + mcVersion + M(' 的构建', '.'));
  }
  const stable = list.filter((b) => String(b.channel || '').toUpperCase() === 'STABLE');
  const b = (stable.length ? stable : list)[0];
  const dl = (b.downloads && (b.downloads['server:default'] || b.downloads.application)) || {};
  return { build: b.id, channel: b.channel, url: dl.url, name: dl.name, size: dl.size };
}

/** Fabric loader 列表 */
async function fabricLoaders(mcVersion) {
  const j = await getJson('https://meta.fabricmc.net/v2/versions/loader/' + encodeURIComponent(mcVersion));
  return (j || []).map((x) => ({ loader: x.loader.version, stable: x.loader.stable }));
}

/** Fabric 服务端启动 jar 的地址 */
function fabricServerJarUrl(mcVersion, loaderVersion, installerVersion) {
  return (
    'https://meta.fabricmc.net/v2/versions/loader/' +
    encodeURIComponent(mcVersion) +
    '/' +
    encodeURIComponent(loaderVersion) +
    '/' +
    encodeURIComponent(installerVersion || '1.0.1') +
    '/server/jar'
  );
}

/** 原版服务端下载地址 */
async function vanillaServerUrl(mcVersion) {
  const man = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const hit = (man.versions || []).find((v) => v.id === mcVersion);
  if (!hit) throw new Error(M('官方清单里没有版本 ', 'Version not found in the official manifest: ') + mcVersion);
  const vj = await getJson(hit.url);
  if (!vj.downloads || !vj.downloads.server) {
    throw new Error(M('这个版本没有官方服务端（太老的版本请用 Paper）', 'This version has no official server (use Paper for very old versions)'));
  }
  return { url: vj.downloads.server.url, size: vj.downloads.server.size, name: 'server.jar' };
}

// ---------------------------------------------------------------- 目录

function safeName(s) {
  let n = String(s || 'server').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!n) n = 'server';
  return n.slice(0, 48);
}

/** 这个 Minecraft 版本需要哪个 Java（用于避免"用 Java 17 开 1.21 服"这种崩） */
function requiredJava(mcVersion) {
  const s = String(mcVersion || '').trim();
  const m = s.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] ? Number(m[3]) : 0;
  if (a > 1) return 21; // 26.x 这类新版本号
  if (b >= 21) return 21;
  if (b === 20) return c >= 5 ? 21 : 17;
  if (b >= 18) return 17;
  if (b === 17) return 17;
  return 8;
}

function defaultRoot() {
  return path.join(os.homedir(), 'MCToolboxServers');
}

/** 列出某个目录下的所有服务器 */
function list(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    return out;
  }
  for (const name of names) {
    const dir = path.join(root, name);
    let st;
    try {
      st = fs.statSync(dir);
    } catch (e) {
      continue;
    }
    if (!st.isDirectory()) continue;
    const props = path.join(dir, 'server.properties');
    const jars = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar'));
    if (!fs.existsSync(props) && !jars.length) continue;

    let info = {};
    try {
      info = JSON.parse(fs.readFileSync(path.join(dir, 'mctool-server.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      /* ignore */
    }
    let port = 25565;
    let motd = '';
    try {
      const txt = fs.readFileSync(props, 'utf8');
      const pm = txt.match(/^server-port\s*=\s*(\d+)/m);
      if (pm) port = Number(pm[1]);
      const mm = txt.match(/^motd\s*=\s*(.*)$/m);
      if (mm) motd = mm[1].trim();
    } catch (e) {
      /* ignore */
    }
    const run = running.get(dir);
    const reqJava = info.requiredJava || requiredJava(info.mcVersion) || null;
    out.push({
      dir,
      name,
      port,
      motd,
      jar: jars[0] || null,
      jars,
      type: info.type || (jars[0] && /paper/i.test(jars[0]) ? 'paper' : /fabric/i.test(jars[0] || '') ? 'fabric' : 'vanilla'),
      mcVersion: info.mcVersion || null,
      loader: info.loader || null,
      requiredJava: reqJava,
      running: !!run,
      startedAt: run ? run.startedAt : null,
      ready: run ? run.ready : false,
      hasMods: fs.existsSync(path.join(dir, 'mods')),
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------- 创建

const DEFAULT_PROPS = {
  'server-port': 25565,
  'max-players': 20,
  'online-mode': true,
  'enable-command-block': true,
  'spawn-protection': 0,
  motd: 'MCToolbox Server',
  difficulty: 'normal',
  gamemode: 'survival',
  'view-distance': 10,
  'simulation-distance': 10,
  'allow-flight': true,
  'white-list': false,
  pvp: true,
};

function writeServerProperties(dir, port, motd, onlineMode) {
  const file = path.join(dir, 'server.properties');
  const props = Object.assign({}, DEFAULT_PROPS, { 'server-port': port, motd: motd || DEFAULT_PROPS.motd });
  if (onlineMode === false) props['online-mode'] = false;
  const lines = Object.keys(props).map((k) => k + '=' + props[k]);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

/**
 * 创建服务器
 * @param {{root:string,name:string,type:'paper'|'fabric'|'vanilla',mcVersion:string,loader?:string,memory?:number,port?:number,motd?:string,onlineMode?:boolean,onStatus?:Function,onProgress?:Function}} o
 */
async function createServer(o) {
  const say = (s) => o.onStatus && o.onStatus(s);
  if (!o.mcVersion) throw new Error(M('请选择 Minecraft 版本', 'Please select a Minecraft version'));
  const root = o.root || defaultRoot();
  const name = safeName(o.name || o.type + '-' + o.mcVersion);
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });

  const type = o.type || 'paper';
  let jarName = 'server.jar';
  let meta = { type, mcVersion: o.mcVersion, name, createdAt: new Date().toISOString() };

  if (type === 'paper') {
    say(M('正在查询 Paper ', 'Looking up Paper builds for ') + o.mcVersion + M(' 的构建…', '…'));
    const b = await paperLatestBuild(o.mcVersion);
    if (!b.url) throw new Error(M('没有拿到 Paper 下载地址', 'Could not get the Paper download URL'));
    jarName = b.name || 'paper-' + o.mcVersion + '-' + b.build + '.jar';
    say(
      M('正在下载 ', 'Downloading ') +
        jarName +
        (b.size ? M('（', ' (') + (b.size / 1048576).toFixed(1) + M(' MB）', ' MB)') : '') +
        '…'
    );
    await downloadFile(b.url, path.join(dir, jarName));
    meta.build = b.build;
    meta.channel = b.channel;
  } else if (type === 'fabric') {
    const loaders = await fabricLoaders(o.mcVersion);
    const loader = o.loader || (loaders.find((x) => x.stable) || loaders[0] || {}).loader;
    if (!loader) throw new Error(M('Fabric 没有 ', 'No Fabric loader found for ') + o.mcVersion + M(' 的加载器', '.'));
    say(M('正在下载 Fabric 服务端（loader ', 'Downloading the Fabric server (loader ') + loader + M('）…', ')…'));
    await downloadFile(fabricServerJarUrl(o.mcVersion, loader), path.join(dir, 'fabric-server-launch.jar'));
    say(M('正在下载原版服务端（Fabric 需要）…', 'Downloading the vanilla server (required by Fabric)…'));
    const van = await vanillaServerUrl(o.mcVersion);
    await downloadFile(van.url, path.join(dir, 'server.jar'));
    fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
    // fabric 启动器要知道原版 jar 在哪
    fs.writeFileSync(path.join(dir, 'fabric-server-launcher.properties'), 'serverJar=server.jar\n', 'utf8');
    jarName = 'fabric-server-launch.jar';
    meta.loader = loader;
  } else {
    say(M('正在下载原版服务端…', 'Downloading the vanilla server…'));
    const van = await vanillaServerUrl(o.mcVersion);
    jarName = 'server.jar';
    await downloadFile(van.url, path.join(dir, jarName));
  }

  // 自动同意 EULA（用户点了开服就是同意）
  fs.writeFileSync(path.join(dir, 'eula.txt'), 'eula=true\n', 'utf8');

  const port = Number(o.port) || 25565;
  writeServerProperties(dir, port, o.motd || name, o.onlineMode);

  // 便于手动启动
  const memory = Number(o.memory) || 2048;
  fs.writeFileSync(
    path.join(dir, 'start.bat'),
    ['@echo off', 'chcp 65001 >nul', `title ${name}`, `java -Xms${Math.min(1024, memory)}M -Xmx${memory}M -jar "${jarName}" nogui`, 'pause'].join('\r\n'),
    'utf8'
  );

  meta.jar = jarName;
  meta.port = port;
  meta.memory = memory;
  meta.requiredJava = requiredJava(o.mcVersion);
  fs.writeFileSync(path.join(dir, 'mctool-server.json'), JSON.stringify(meta, null, 2), 'utf8');

  return { dir, name, jar: jarName, port, meta, requiredJava: meta.requiredJava };
}

// ---------------------------------------------------------------- 运行

const running = new Map(); // dir -> { child, log, ready, startedAt, port, name }

function log(id, line) {
  const st = running.get(id);
  if (st) {
    st.log.push(line);
    if (st.log.length > 2000) st.log.shift();
    if (typeof st.onLine === 'function') st.onLine(line);
  }
}

const READY_RE = /Done \([\d.]+s\)!|For help, type "help"/i;
const PORT_RE = /Starting Minecraft server on \*?:(\d+)/i;

function start(o) {
  const dir = o.dir;
  if (!dir || !fs.existsSync(dir)) throw new Error(M('服务器目录不存在：', 'Server folder does not exist: ') + dir);
  if (running.has(dir)) throw new Error(M('这个服务器已经在运行了', 'This server is already running'));

  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'mctool-server.json'), 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    /* ignore */
  }
  const jars = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.jar'));
  // 优先用 meta 里记的启动 jar
  let jar = meta.jar && jars.includes(meta.jar) ? meta.jar : null;
  if (!jar) {
    jar =
      jars.find((f) => /fabric-server-launch/i.test(f)) ||
      jars.find((f) => /paper/i.test(f)) ||
      jars.find((f) => /^server\.jar$/i.test(f)) ||
      jars[0];
  }
  if (!jar) throw new Error(M('这个目录里没有服务端 jar', 'No server jar found in this folder'));

  const java = o.javaPath;
  if (!java || !fs.existsSync(java)) {
    throw new Error(M('Java 路径无效，请先在上方选择 java.exe', 'Invalid Java path — please select java.exe above first'));
  }

  // Java 版本校验：避免出现 UnsupportedClassVersionError
  const needJava = meta.requiredJava || requiredJava(meta.mcVersion);
  if (needJava && o.javaMajor && Number(o.javaMajor) < needJava) {
    throw new Error(
      M('这个服务器（', 'This server (') +
        (meta.mcVersion || '?') +
        M('）需要 Java ', ') requires Java ') +
        needJava +
        M('，但当前选的是 Java ', ', but the selected one is Java ') +
        o.javaMajor +
        M(' —— 请把上面的 Java 换成 ', ' — please switch the Java above to ') +
        needJava +
        M(' 或更高的版本再启动', ' or newer before starting')
    );
  }

  const memory = Number(o.memory) || meta.memory || 2048;
  const args = ['-Xms' + Math.min(1024, memory) + 'M', '-Xmx' + memory + 'M'];
  if (o.extraJvm) args.push(...String(o.extraJvm).trim().split(/\s+/).filter(Boolean));
  args.push('-jar', jar, 'nogui');

  const child = spawn(java, args, { cwd: dir, windowsHide: true });
  const st = {
    child,
    log: [],
    ready: false,
    startedAt: Date.now(),
    port: meta.port || 25565,
    name: path.basename(dir),
    onLine: o.onLine,
    jar,
  };
  running.set(dir, st);

  const handle = (buf) => {
    const text = String(buf);
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (!line) continue;
      log(dir, line);
      if (PORT_RE.test(line)) {
        const m = line.match(PORT_RE);
        if (m) st.port = Number(m[1]);
      }
      if (READY_RE.test(line) && !st.ready) {
        st.ready = true;
        log(dir, M('>>> 服务器已就绪，端口 ', '>>> Server is ready, port ') + st.port);
      }
      // 常见故障给中文提示
      if (/UnsupportedClassVersionError/.test(line)) {
        log(
          dir,
          M(
            '>>> ⚠️ Java 版本太低！这个服务端是用更新的 Java 编译的（1.21.x 需要 Java 21，1.20.5+ 也要 21）。',
            '>>> ⚠️ Java version too old! This server was compiled with a newer Java (1.21.x needs Java 21, and 1.20.5+ needs 21 too).'
          ) +
            M('请把上面的 Java 换成 21 或更高，再点一次启动。', 'Switch the Java above to 21 or newer and click start again.')
        );
      } else if (/Failed to bind to port|Address already in use/i.test(line)) {
        log(
          dir,
          M(
            '>>> ⚠️ 端口被占用了 —— 换一个端口（改 server.properties 里的 server-port）或关掉占用它的程序。',
            '>>> ⚠️ Port already in use — pick another port (change server-port in server.properties) or close the program using it.'
          )
        );
      } else if (/You need to agree to the EULA/i.test(line)) {
        log(
          dir,
          M(
            '>>> ⚠️ 需要同意 EULA —— 把 eula.txt 里的 eula=false 改成 true。',
            '>>> ⚠️ You must agree to the EULA — change eula=false to true in eula.txt.'
          )
        );
      }
    }
  };
  child.stdout.on('data', handle);
  child.stderr.on('data', handle);
  child.on('error', (err) => log(dir, M('[错误] ', '[Error] ') + err.message));
  child.on('exit', (code) => {
    log(dir, M('[退出] 服务器进程结束（代码 ', '[Exit] Server process ended (code ') + code + M('）', ')'));
    running.delete(dir);
  });

  return { ok: true, dir, jar, pid: child.pid, port: st.port, memory };
}

function send(dir, command) {
  const st = running.get(dir);
  if (!st) throw new Error(M('服务器没在运行', 'Server is not running'));
  st.child.stdin.write(String(command) + '\n');
  log(dir, '> ' + command);
  return { ok: true };
}

function stop(dir, force) {
  const st = running.get(dir);
  if (!st) return { ok: true, already: true };
  try {
    if (!force) {
      st.child.stdin.write('stop\n');
      // 给它 20 秒优雅退出
      setTimeout(() => {
        const s2 = running.get(dir);
        if (s2) {
          try {
            s2.child.kill();
          } catch (e) {
            /* ignore */
          }
        }
      }, 20000);
      return { ok: true, graceful: true };
    }
    st.child.kill();
    return { ok: true, forced: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function status(dir) {
  const st = running.get(dir);
  if (!st) return { running: false };
  return {
    running: true,
    ready: st.ready,
    pid: st.child.pid,
    port: st.port,
    startedAt: st.startedAt,
    log: st.log.slice(-400),
  };
}

function stopAll() {
  for (const [dir, st] of Array.from(running.entries())) {
    try {
      st.child.stdin.write('stop\n');
    } catch (e) {
      /* ignore */
    }
    setTimeout(() => {
      try {
        st.child.kill();
      } catch (e) {
        /* ignore */
      }
    }, 3000);
  }
}

module.exports = {
  defaultRoot,
  list,
  createServer,
  start,
  send,
  stop,
  stopAll,
  status,
  paperVersions,
  paperLatestBuild,
  fabricLoaders,
  vanillaServerUrl,
  requiredJava,
  safeName,
};
