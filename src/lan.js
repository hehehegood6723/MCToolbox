const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const { spawnSync, execFile } = require('child_process');
const { M } = require('./i18n');

/** 异步执行外部命令（绝不阻塞 Electron 主进程） */
function execFileAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      Object.assign({ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }, opts || {}),
      (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
  });
}

/** 异地联机：网卡识别 / 虚拟组网工具检测 / LAN 端口读取 / 防火墙 / 连通性 */

const VPN_HINTS = [
  { re: /radmin/i, kind: 'radmin', label: 'Radmin VPN' },
  { re: /zerotier/i, kind: 'zerotier', label: 'ZeroTier' },
  { re: /tailscale/i, kind: 'tailscale', label: 'Tailscale' },
  { re: /hamachi|logmein/i, kind: 'hamachi', label: 'Hamachi' },
  { re: /openvpn|tap-?windows|wintun|wireguard/i, kind: 'vpn', label: 'VPN' },
];

function classify(name) {
  for (const h of VPN_HINTS) {
    if (h.re.test(name)) return { kind: h.kind, label: h.label };
  }
  if (/vmware|virtualbox|vbox|hyper-?v|vethernet|loopback|bluetooth/i.test(name)) {
    return { kind: 'virtual', label: M('虚拟/虚拟机网卡', 'Virtual / VM adapter') };
  }
  if (/wi-?fi|wlan|wireless|无线/i.test(name)) return { kind: 'wifi', label: 'Wi-Fi' };
  if (/ethernet|以太网|本地连接|realtek|intel\(r\)/i.test(name)) return { kind: 'ethernet', label: M('有线网卡', 'Ethernet adapter') };
  return { kind: 'other', label: M('其他', 'Other') };
}

/** 列出所有 IPv4 网卡 */
function listAdapters() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifs)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4') continue;
      const c = classify(name);
      const isVpn = ['radmin', 'zerotier', 'tailscale', 'hamachi', 'vpn'].includes(c.kind);
      const usable = !a.internal && c.kind !== 'virtual';
      out.push({
        name,
        address: a.address,
        netmask: a.netmask,
        internal: !!a.internal,
        kind: c.kind,
        label: c.label,
        isVpn,
        usable,
        recommend: usable && isVpn, // 联机优先推荐虚拟网卡
      });
    }
  }
  // 推荐的排前面
  out.sort((x, y) => Number(y.recommend) - Number(x.recommend) || Number(y.usable) - Number(x.usable));
  return out;
}

// ---------------------------------------------------------------- 虚拟组网工具

const TOOL_PATHS = {
  zerotier: [
    'C:\\Program Files\\ZeroTier\\One\\zerotier-cli.bat',
    'C:\\Program Files (x86)\\ZeroTier\\One\\zerotier-cli.bat',
  ],
  tailscale: ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'],
};

function which(exe) {
  try {
    const r = spawnSync('where', [exe], { encoding: 'utf8' });
    if (r.status === 0) {
      const p = String(r.stdout).split(/\r?\n/)[0].trim();
      if (p && fs.existsSync(p)) return p;
    }
  } catch (e) {
    /* ignore */
  }
  return null;
}

function findTool(exe, paths) {
  const byPath = which(exe);
  if (byPath) return byPath;
  for (const p of paths) if (fs.existsSync(p)) return p;
  return null;
}

async function run(cmd, args, timeout) {
  const { err, stdout, stderr } = await execFileAsync(cmd, args, { timeout: timeout || 12000 });
  return { ok: !err, out: stdout, err: stderr || (err ? err.message : ''), status: err ? err.code || -1 : 0 };
}

async function zerotierInfo() {
  const cli = findTool('zerotier-cli.bat', TOOL_PATHS.zerotier);
  const info = { id: 'zerotier', name: 'ZeroTier', installed: !!cli, cli, running: false, networks: [], version: null, note: '' };
  if (!cli) {
    info.note = M('未检测到 ZeroTier。官网：', 'ZeroTier not detected. Official site: ') + 'https://www.zerotier.com/download/';
    return info;
  }
  try {
    const v = await run(cli, ['-v']);
    if (v.ok) info.version = v.out.trim();
    const list = await run(cli, ['listnetworks', '-j']);
    if (list.ok && list.out.trim().startsWith('[')) {
      const arr = JSON.parse(list.out);
      info.running = true;
      info.networks = arr.map((n) => ({
        id: n.nwid || n.id,
        name: n.name || '',
        status: n.status,
        type: n.type,
        assigned: n.assignedAddresses || [],
        portDeviceName: n.portDeviceName || '',
      }));
    } else {
      info.note = M('ZeroTier 服务可能没在运行（listnetworks 失败）', 'The ZeroTier service may not be running (listnetworks failed)');
    }
  } catch (e) {
    info.note = M('ZeroTier 查询失败：', 'ZeroTier query failed: ') + e.message;
  }
  return info;
}

async function zerotierJoin(networkId) {
  const cli = findTool('zerotier-cli.bat', TOOL_PATHS.zerotier);
  if (!cli) throw new Error(M('未检测到 ZeroTier', 'ZeroTier not detected'));
  if (!/^[0-9a-fA-F]{16}$/.test(String(networkId).trim())) {
    throw new Error(M('Network ID 应该是 16 位十六进制，例如 8056c2e21c000001', 'The Network ID must be 16 hexadecimal characters, e.g. 8056c2e21c000001'));
  }
  const r = await run(cli, ['join', String(networkId).trim()], 20000);
  if (!r.ok && /access denied|requires|管理员|elevat/i.test(r.out + r.err)) {
    throw new Error(M('需要管理员权限：请用「以管理员身份运行」打开本工具箱后重试，或手动执行 zerotier-cli join ', 'Administrator privileges required: reopen this toolbox with "Run as administrator" and try again, or run manually: zerotier-cli join ') + networkId);
  }
  return { ok: r.ok, output: (r.out + r.err).trim() };
}

async function tailscaleInfo() {
  const exe = findTool('tailscale.exe', TOOL_PATHS.tailscale);
  const info = { id: 'tailscale', name: 'Tailscale', installed: !!exe, exe, running: false, ip: null, note: '' };
  if (!exe) {
    info.note = M('未检测到 Tailscale。官网：', 'Tailscale not detected. Official site: ') + 'https://tailscale.com/download/windows';
    return info;
  }
  try {
    const st = await run(exe, ['status']);
    info.running = st.ok && !/stopped|Logged out/i.test(st.out);
    const ip = await run(exe, ['ip', '-4']);
    if (ip.ok) {
      const first = ip.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && /^\d+\.\d+\.\d+\.\d+$/.test(first)) info.ip = first;
    }
  } catch (e) {
    info.note = M('Tailscale 查询失败：', 'Tailscale query failed: ') + e.message;
  }
  if (!info.running) info.note = info.note || M('Tailscale 未登录/未启动，请先点「启动并登录」完成浏览器登录', 'Tailscale is not signed in or not running - click "Start and sign in" to finish the browser login first');
  return info;
}

async function tailscaleUp() {
  const exe = findTool('tailscale.exe', TOOL_PATHS.tailscale);
  if (!exe) throw new Error(M('未检测到 Tailscale', 'Tailscale not detected'));
  const r = await run(exe, ['up'], 90000);
  return { ok: r.ok, output: (r.out + r.err).trim() };
}

/** 汇总虚拟组网环境（全异步，绝不卡住界面） */
async function vpnOverview() {
  const adapters = listAdapters();
  const zt = await zerotierInfo();
  const ts = await tailscaleInfo();
  // Radmin 只有网卡，没有 CLI
  const radminAdapters = adapters.filter((a) => a.kind === 'radmin');
  const ztAdapters = adapters.filter((a) => a.kind === 'zerotier');
  const tsAdapters = adapters.filter((a) => a.kind === 'tailscale');
  return {
    adapters,
    radmin: {
      id: 'radmin',
      name: 'Radmin VPN',
      installed: radminAdapters.length > 0,
      running: radminAdapters.length > 0,
      ip: radminAdapters[0] ? radminAdapters[0].address : null,
      note: radminAdapters.length
        ? M('已连接，虚拟 IP 已就绪', 'Connected, virtual IP is ready')
        : M('未检测到 Radmin VPN 网卡。下载：', 'Radmin VPN adapter not detected. Download: ') +
          'https://www.radmin-vpn.com/',
    },
    zerotier: Object.assign({}, zt, {
      ip: ztAdapters[0]
        ? ztAdapters[0].address
        : zt.networks[0] && zt.networks[0].assigned[0]
        ? String(zt.networks[0].assigned[0]).split('/')[0]
        : null,
    }),
    tailscale: Object.assign({}, ts, { ip: ts.ip || (tsAdapters[0] ? tsAdapters[0].address : null) }),
  };
}

// ---------------------------------------------------------------- LAN 端口

const LAN_PATTERNS = [
  /Started serving on (\d{2,5})/i,
  /Local game hosted on port (\d{2,5})/i,
  /Started serving on port (\d{2,5})/i,
  /Serving on port (\d{2,5})/i,
  /Opened? (?:to )?LAN[^\d]{0,40}(\d{2,5})/i,
];

/** 从 logs/latest.log 末尾读取"对局域网开放"的端口 */
function readLanPort(mcFolder) {
  const logPath = path.join(mcFolder || '', 'logs', 'latest.log');
  if (!fs.existsSync(logPath)) {
    return { found: false, reason: M('找不到 ', 'Not found: ') + logPath + M('（先在游戏里点一次「对局域网开放」）', ' (click "Open to LAN" in the game once first)') };
  }
  let st;
  try {
    st = fs.statSync(logPath);
  } catch (e) {
    return { found: false, reason: M('读取日志失败: ', 'Failed to read the log: ') + e.message };
  }
  const start = Math.max(0, st.size - 256 * 1024);
  let text = '';
  try {
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch (e) {
    return { found: false, reason: M('读取日志失败: ', 'Failed to read the log: ') + e.message };
  }
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const re of LAN_PATTERNS) {
      const m = lines[i].match(re);
      if (m) {
        return { found: true, port: Number(m[1]), line: lines[i].trim(), logPath, mtime: st.mtimeMs };
      }
    }
  }
  return {
    found: false,
    reason: M('日志里还没有「对局域网开放」的记录 —— 请在游戏里按 Esc → 对局域网开放', 'No "Open to LAN" entry in the log yet - press Esc in the game, then click "Open to LAN"'),
    logPath,
    mtime: st.mtimeMs,
  };
}

// ---------------------------------------------------------------- 防火墙

/**
 * 检查防火墙是否放行了「即将使用的那个 java.exe / javaw.exe」。
 * 性能注意：绝不能遍历全部规则（实测 60~90 秒，会把主进程卡到"未响应"）。
 * 这里用 -Program 定向查询，实测约 1.7 秒，并且是异步执行。
 */
async function checkFirewall(javaPath) {
  if (!javaPath) {
    return {
      ok: false,
      unknown: true,
      reason: M('还没有选中 Java —— 先去「版本下载与启动」扫描并选中一个版本（会自动带出 Java），再回来检查', 'No Java selected yet - go to "Version download & launch", scan and pick a version (Java is detected automatically), then come back to check'),
    };
  }
  if (!fs.existsSync(javaPath)) {
    return { ok: false, unknown: true, reason: M('这个 Java 路径不存在：', 'This Java path does not exist: ') + javaPath };
  }

  const dir = path.dirname(javaPath);
  const base = path.basename(javaPath).toLowerCase();
  const candidates = [javaPath];
  if (base === 'java.exe') candidates.push(path.join(dir, 'javaw.exe'));
  else if (base === 'javaw.exe') candidates.push(path.join(dir, 'java.exe'));

  const ps = [
    "$ErrorActionPreference='SilentlyContinue'",
    '$paths = @(' + candidates.map((p) => "'" + String(p).replace(/'/g, "''") + "'").join(',') + ')',
    '$out = New-Object System.Collections.ArrayList',
    'foreach ($p in $paths) {',
    '  foreach ($af in (Get-NetFirewallApplicationFilter -Program $p)) {',
    '    foreach ($rr in @($af | Get-NetFirewallRule)) {',
    '      if ($rr) {',
    '        [void]$out.Add([pscustomobject]@{',
    '          name=[string]$rr.DisplayName; program=[string]$p;',
    '          direction=[string]$rr.Direction; action=[string]$rr.Action;',
    '          enabled=[string]$rr.Enabled; profiles=[string]$rr.Profile',
    '        })',
    '      }',
    '    }',
    '  }',
    '}',
    'ConvertTo-Json -InputObject @($out) -Depth 3 -Compress',
  ].join('\n');

  const { err, stdout, stderr } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  if (err && !stdout) {
    return { ok: false, unknown: true, reason: M('读取防火墙规则失败：', 'Failed to read firewall rules: ') + String(stderr || err.message).trim().slice(0, 200) };
  }

  let rules = [];
  try {
    const parsed = JSON.parse(String(stdout).trim() || '[]');
    rules = (Array.isArray(parsed) ? parsed : [parsed]).filter((x) => x && x.program);
  } catch (e) {
    if (!String(stdout).trim()) rules = [];
    else return { ok: false, unknown: true, reason: M('防火墙规则解析失败', 'Failed to parse the firewall rules') };
  }

  // Direction / Action / Enabled 是枚举，序列化后是英文（Inbound / Allow / True），不受系统语言影响
  const inboundAllow = rules.filter(
    (r) => /^(1|inbound)$/i.test(String(r.direction)) && /^(2|allow)$/i.test(String(r.action))
  );

  if (!inboundAllow.length) {
    return {
      ok: false,
      rules,
      reason:
        M('防火墙里没有为这个 Java 放行入站连接：\n', 'No firewall rule allows inbound connections for this Java:\n') +
        javaPath +
        M('\n朋友会连不上你（点「一键放行」即可修复）', '\nYour friends will not be able to connect (click "One-click allow" to fix it)'),
    };
  }

  const disabled = inboundAllow.filter((r) => !/^(1|true|yes)$/i.test(String(r.enabled)));
  if (disabled.length === inboundAllow.length) {
    return { ok: false, rules, reason: M('相关防火墙规则被禁用了：', 'The related firewall rules are disabled: ') + disabled.map((r) => r.name).join(M('、', ', ')), rule: disabled[0] };
  }

  const use = inboundAllow.find((r) => /^(1|true|yes)$/i.test(String(r.enabled)));
  const profiles = String(use.profiles || '');
  let warn = '';
  if (profiles && !/^(0|any|all)$/i.test(profiles) && !/private|domain/i.test(profiles)) {
    warn = M('规则只对部分网络类型生效（当前：', 'The rule only applies to some network profiles (current: ') + profiles + M('）。建议点「一键放行」重建一条对所有网络都生效的规则。', '). Click "One-click allow" to rebuild a rule that applies to all networks.');
  }
  return { ok: true, rules, rule: use, warn };
}

/** 以管理员身份添加防火墙放行规则（会弹 UAC）。异步执行，避免 UAC 弹窗期间界面未响应 */
async function addFirewallRule(javaPath) {
  if (!javaPath || !fs.existsSync(javaPath)) throw new Error(M('Java 路径无效：', 'Invalid Java path: ') + javaPath);
  const bat = path.join(os.tmpdir(), 'mctool-firewall.bat');
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'netsh advfirewall firewall delete rule name="MCToolbox Minecraft TCP" >nul 2>&1',
    'netsh advfirewall firewall delete rule name="MCToolbox Minecraft UDP" >nul 2>&1',
    `netsh advfirewall firewall add rule name="MCToolbox Minecraft TCP" dir=in action=allow program="${javaPath}" enable=yes profile=any protocol=TCP`,
    `netsh advfirewall firewall add rule name="MCToolbox Minecraft UDP" dir=in action=allow program="${javaPath}" enable=yes profile=any protocol=UDP`,
    'exit /b %errorlevel%',
  ];
  fs.writeFileSync(bat, lines.join('\r\n'), 'utf8');
  // 有些启动器用 javaw.exe，一并放行
  const dir = path.dirname(javaPath);
  const javaw = path.join(dir, 'javaw.exe');
  if (fs.existsSync(javaw) && javaw.toLowerCase() !== javaPath.toLowerCase()) {
    const more = [
      `netsh advfirewall firewall delete rule name="MCToolbox Minecraft javaw TCP" >nul 2>&1`,
      `netsh advfirewall firewall add rule name="MCToolbox Minecraft javaw TCP" dir=in action=allow program="${javaw}" enable=yes profile=any protocol=TCP`,
      'exit /b %errorlevel%',
    ];
    fs.appendFileSync(bat, '\r\n' + more.join('\r\n'), 'utf8');
  }

  const cmd = `Start-Process -FilePath '${bat.replace(/'/g, "''")}' -Verb RunAs -Wait -WindowStyle Hidden`;
  const { err, stdout, stderr } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd]);
  const out = stdout + stderr;
  if (err) {
    if (/canceled|cancelled|已取消|拒绝|The operation was canceled/i.test(out + String(err.message))) {
      throw new Error(M('已取消（UAC 未同意），未添加规则', 'Cancelled (UAC was not approved) - no rule was added'));
    }
    throw new Error(M('添加失败：', 'Failed to add: ') + (out.trim() || err.message));
  }
  return { ok: true };
}

// ---------------------------------------------------------------- 版本/Mod 指纹

function fingerprint(mcFolder, versionId) {
  const fp = { versionId: versionId || null, type: null, loader: null, javaVersion: null, mods: [], modCount: 0 };
  if (!mcFolder || !versionId) return fp;
  const vdir = path.join(mcFolder, 'versions', versionId);
  const jsonPath = path.join(vdir, versionId + '.json');
  if (fs.existsSync(jsonPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      fp.type = j.type || null;
      fp.javaVersion = j.javaVersion ? j.javaVersion.majorVersion : null;
      fp.mainClass = j.mainClass || null;
      const low = String(versionId).toLowerCase();
      const L = [];
      if (low.includes('neoforge')) L.push('NeoForge');
      if (low.includes('forge') && !low.includes('neoforge')) L.push('Forge');
      if (low.includes('fabric')) L.push('Fabric');
      if (low.includes('quilt')) L.push('Quilt');
      fp.loader = L.join(' + ') || (j.type === 'release' || j.type === 'snapshot' ? M('原版', 'Vanilla') : null);
    } catch (e) {
      /* ignore */
    }
  }
  const modsDir = path.join(mcFolder, 'mods');
  if (fs.existsSync(modsDir)) {
    try {
      fp.mods = fs
        .readdirSync(modsDir)
        .filter((f) => f.toLowerCase().endsWith('.jar'))
        .map((f) => {
          let size = 0;
          try {
            size = fs.statSync(path.join(modsDir, f)).size;
          } catch (e) {
            /* ignore */
          }
          return { name: f, size };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      fp.modCount = fp.mods.length;
    } catch (e) {
      /* ignore */
    }
  }
  return fp;
}

/** 生成给朋友复制的联机地址文本 */
function buildShareText(opts) {
  const { address, port, mode, fp, note } = opts || {};
  const lines = [];
  lines.push(M('=== MC 联机地址（直接粘贴到「异地联机 → 玩家」里）===', '=== MC multiplayer address (paste it into "Remote play -> Player") ==='));
  lines.push(`${address}:${port}`);
  if (mode) lines.push(M('方式: ', 'Method: ') + mode);
  if (fp) {
    lines.push(M('版本: ', 'Version: ') + (fp.versionId || '?') + (fp.loader ? ' (' + fp.loader + ')' : ''));
    if (fp.javaVersion) lines.push(`Java: ${fp.javaVersion}`);
    lines.push(`Mods(${fp.modCount}): ${fp.mods.map((m) => m.name).join(', ') || M('无', 'none')}`);
  }
  if (note) lines.push(M('备注: ', 'Note: ') + note);
  return lines.join('\n');
}

/** 解析朋友粘贴的地址文本 */
function parseShareText(text) {
  const raw = String(text || '');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let host = null;
  let port = null;
  for (const l of lines) {
    let m = l.match(/^([a-zA-Z0-9._-]+):(\d{2,5})$/);
    if (!m) m = l.match(/([a-zA-Z0-9._-]+):(\d{2,5})/);
    if (m) {
      host = m[1];
      port = Number(m[2]);
      break;
    }
  }
  // 中英文两种分享文本都要能解析（英文模式发出的是 "Version: 1.21.11 (Fabric)"）
  const versionLine = (raw.match(/(?:版本|Version)[:：]\s*(.+)/i) || [])[1];
  let version = versionLine ? versionLine.trim() : null;
  let loader = null;
  if (version) {
    const m = version.match(/^(.+?)\s*[（(](.+?)[)）]\s*$/);
    if (m) {
      version = m[1].trim();
      loader = m[2].trim();
    }
  }
  const modLine = raw.match(/Mods?\((\d+)\)\s*[:：]?\s*(.*)/i) || [];
  const guessed = guessMethod(host);
  return {
    host,
    port,
    version,
    loader,
    modCount: modLine[1] ? Number(modLine[1]) : null,
    modNames: modLine[2] ? modLine[2].split(',').map((s) => s.trim()).filter(Boolean) : [],
    method: guessed.method,
    methodReason: guessed.reason,
    raw,
  };
}

/** TCP 连通性 + 延迟测试 */
function tcpTest(host, port, timeoutMs) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve({ ok: false, error: M('地址或端口为空', 'Address or port is empty') });
    const t0 = Date.now();
    let done = false;
    const sock = net.createConnection({ host, port });
    const finish = (r) => {
      if (done) return;
      done = true;
      try {
        sock.destroy();
      } catch (e) {
        /* ignore */
      }
      resolve(r);
    };
    sock.setTimeout(timeoutMs || 6000);
    sock.on('connect', () => finish({ ok: true, latency: Date.now() - t0 }));
    sock.on('timeout', () =>
      finish({
        ok: false,
        error: M('连接超时', 'Connection timed out'),
        hint: M('常见原因：房主没开服 / 没点「对局域网开放」 / 虚拟组网没连上（双方都要加入同一网络）/ 防火墙拦了', 'Common causes: the host has not opened the world to LAN / the VPN is not connected (both sides must join the same network) / the firewall blocked it'),
      })
    );
    sock.on('error', (err) => {
      let hint = '';
      if (err.code === 'ECONNREFUSED') hint = M('对方机器在线但端口没人监听 —— 房主可能还没点「对局域网开放」，或端口填错了', 'The other machine is online but nothing is listening on that port - the host may not have clicked "Open to LAN" yet, or the port is wrong');
      else if (err.code === 'ENOTFOUND') hint = M('域名解析失败，检查地址有没有打错', 'Domain name resolution failed - check the address for typos');
      else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH') hint = M('网络不可达 —— 虚拟组网（Radmin/ZeroTier/Tailscale）可能没连上', 'Network unreachable - the VPN (Radmin/ZeroTier/Tailscale) may not be connected');
      else if (err.code === 'EACCES') hint = M('本机防火墙/安全软件拦截了这次连接', 'A local firewall or security app blocked this connection');
      finish({ ok: false, error: err.code + ' ' + err.message, hint });
    });
  });
}

/** 各家虚拟组网工具的获取方式 */
const VPN_INFO = {
  radmin: {
    id: 'radmin',
    name: 'Radmin VPN',
    needAccount: false,
    page: 'https://www.radmin-vpn.com/',
    installer: null, // 官网目前无法直接下载
    why: M('免费、不用注册账号，国内最常用，延迟低', 'Free, no account required, the most popular choice in China, low latency'),
    steps: [
      M('你和朋友都安装 Radmin VPN（免费，不需要注册账号）', 'Both you and your friend install Radmin VPN (free, no account required)'),
      M('你打开 Radmin VPN →「网络」→「创建网络」，起一个网络名 + 设一个密码', 'You open Radmin VPN -> "Network" -> "Create network", then pick a network name and set a password'),
      M('把「网络名 + 密码」发给朋友，朋友点「加入网络」填进去', 'Send the network name + password to your friend; they click "Join network" and enter them'),
      M('双方在列表里能看到对方（显示绿色/已连接）', 'Both of you can see each other in the list (shown green / connected)'),
      M('回到本工具箱，点你那一行右边的「用这个 IP」', 'Come back to this toolbox and click "Use this IP" on the right of your row'),
    ],
    tip: M('Radmin VPN 的虚拟 IP 通常是 26.x.x.x 开头。', 'Radmin VPN virtual IPs usually start with 26.x.x.x.'),
  },
  zerotier: {
    id: 'zerotier',
    name: 'ZeroTier',
    needAccount: true,
    page: 'https://www.zerotier.com/download/',
    console: 'https://my.zerotier.com',
    installer: null, // 官网下载地址在当前网络下无法访问
    why: M('跨城市很稳，但需要注册账号并去后台授权设备', 'Very stable across cities, but you must register an account and authorize devices in the console'),
    steps: [
      M('你和朋友都安装 ZeroTier One 客户端', 'Both you and your friend install the ZeroTier One client'),
      M('★ 你去 https://my.zerotier.com 免费注册账号，点「Create A Network」', '★ You register a free account at https://my.zerotier.com and click "Create A Network"'),
      M('★ 创建成功后会看到一串 16 位十六进制，例如 8056c2e21c000001', '★ After it is created you will see a 16-character hexadecimal string, e.g. 8056c2e21c000001'),
      M('   这串就是 Network ID —— 它不是账号、不是密码，是刚创建的这个虚拟局域网的编号', '   That string is the Network ID - it is neither an account nor a password, it is the ID of the virtual LAN you just created'),
      M('把 Network ID 填到上面的输入框，点「加入 ZeroTier 网络」', 'Enter the Network ID in the box above and click "Join ZeroTier network"'),
      M('回到 my.zerotier.com 的 Members 列表，勾选刚出现的设备前面的 Auth 复选框（授权）', 'Go back to the Members list on my.zerotier.com and tick the Auth checkbox next to the device that just appeared (authorize it)'),
      M('朋友也装客户端、填同一个 Network ID，你再在后台给他授权一次', 'Your friend installs the client and enters the same Network ID, then you authorize them in the console as well'),
    ],
    tip: M('没授权的话网卡虽然出现，但连不通 —— 这是最常见的坑。', 'Without authorization the adapter appears but nothing can connect - this is the most common pitfall.'),
  },
  tailscale: {
    id: 'tailscale',
    name: 'Tailscale',
    needAccount: true,
    page: 'https://tailscale.com/download/windows',
    installer: 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi',
    installerName: 'tailscale-setup.msi',
    console: 'https://login.tailscale.com/admin/machines',
    why: M('有官方 Windows 安装包，可以一键下载安装', 'There is an official Windows installer, so it can be downloaded and installed in one click'),
    steps: [
      M('你点这一行的「下载安装」，工具箱会自动下载并启动官方安装程序（会弹 UAC）', 'Click "Download & install" on this row; the toolbox downloads and launches the official installer (a UAC prompt appears)'),
      M('装完后点「启动并登录」，浏览器会打开让你登录（Google / GitHub / 微软账号都行）', 'After installing, click "Start and sign in"; your browser opens for sign-in (Google / GitHub / Microsoft account all work)'),
      M('登录成功后 Tailscale 会自动分配一个 100.x.x.x 的虚拟 IP', 'After signing in, Tailscale automatically assigns a 100.x.x.x virtual IP'),
      M('朋友也要装 Tailscale 并登录 —— 想联机的话：在后台 Invite 对方进你的 tailnet，', 'Your friend must install Tailscale and sign in too - to play together: invite them to your tailnet in the console,'),
      M('   或者双方用同一个账号登录', '   or both of you sign in with the same account'),
      M('双方都能 ping 通之后，点「用这个 IP」', 'Once both sides can ping each other, click "Use this IP"'),
    ],
    tip: M('必须先在浏览器完成登录，否则网卡不会分配 IP。', 'You must finish signing in in the browser first, otherwise the adapter will not be assigned an IP.'),
  },
};

function vpnInfo() {
  return VPN_INFO;
}

/** 下载并安装虚拟组网客户端（目前只有 Tailscale 提供可直接下载的官方安装包） */
async function installVpnTool(id, onProgress) {
  const info = VPN_INFO[id];
  if (!info) throw new Error(M('未知的工具：', 'Unknown tool: ') + id);
  if (!info.installer) {
    throw new Error(
      info.name + M(' 没有可直接下载的安装包（官网在当前网络下访问不通）。\n请在浏览器里打开官网手动下载安装：\n', ' has no directly downloadable installer (the official site is unreachable on the current network).\nPlease open the official site in your browser and install it manually:\n') + info.page
    );
  }
  const dest = path.join(os.tmpdir(), info.installerName || 'setup.msi');
  if (onProgress) onProgress(M('正在下载 ', 'Downloading ') + (info.installerName || 'setup.msi') + M(' …（约 38 MB）', ' … (about 38 MB)'));
  const { downloadFile } = require('./mcrun');
  await downloadFile(info.installer, dest);

  if (onProgress) onProgress(M('下载完成，正在启动安装程序…（会弹 UAC，请点「是」）', 'Download complete, launching the installer… (a UAC prompt will appear - click "Yes")'));
  const ps = `Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','${dest.replace(/'/g, "''")}','/qb' -Verb RunAs -Wait`;
  const { err, stdout, stderr } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    timeout: 600000,
  });
  if (err) {
    throw new Error(M('安装被取消或失败：', 'Installation was cancelled or failed: ') + String(stderr || stdout || err.message).trim().slice(0, 200));
  }
  return { ok: true, path: dest };
}

/** 玩家（加入方）每种方式分别要做什么 */
const PLAYER_GUIDES = {
  tunnel: {
    id: 'tunnel',
    name: M('内网穿透（playit.gg / ngrok / frp）', 'Tunneling (playit.gg / ngrok / frp)'),
    needInstall: false,
    page: '',
    why: M('房主用这种方式时，你什么都不用装', 'When the host uses this method you do not have to install anything'),
    steps: [
      M('你【什么都不用装】—— 这是房主用穿透方式最大的好处', 'You install [nothing] — that is the biggest advantage of the host using a tunneling service'),
      M('直接拿房主给你的「地址:端口」', 'Just take the "address:port" the host gives you'),
      M('在 MC 里进入「多人游戏」→「直接连接」→ 输入那个地址 → 加入服务器', 'In MC go to "Multiplayer" -> "Direct Connect" -> enter that address -> join the server'),
      M('版本和加载器必须和房主完全一致，Mod 也要一样（用下面「版本 / Mod 一致性检查」对一下）', 'Your version and loader must match the host exactly, and so must the mods (compare them with the "Version / Mod consistency check" below)'),
    ],
    tip: M('连不上时多半是房主的穿透程序停了、或免费版地址变了 —— 让房主重新点一次「生成」再发给你。', 'If you cannot connect, the host\'s tunneling program has probably stopped or the free-tier address changed — ask the host to click "Generate" again and resend it.'),
  },
  radmin: {
    id: 'radmin',
    name: 'Radmin VPN',
    needInstall: true,
    installer: null,
    page: 'https://www.radmin-vpn.com/',
    why: M('你也必须装 Radmin VPN，否则连不上', 'You must install Radmin VPN too, otherwise you cannot connect'),
    steps: [
      M('★ 你也要安装 Radmin VPN（免费，不用注册账号）—— 不装的话根本连不上', '★ You must install Radmin VPN as well (free, no account needed) — without it you simply cannot connect'),
      M('装完打开它，点「网络」→「加入网络」', 'After installing, open it and click "Network" -> "Join network"'),
      M('填房主给你的【网络名 + 密码】', 'Enter the [network name + password] the host gave you'),
      M('   注意：房主给你的不是 IP，而是他创建网络时起的「名字」和「密码」', '   Note: what the host gave you is not an IP but the name and password they chose when creating the network'),
      M('连上后列表里能看到房主的设备（显示绿灯/已连接）', 'Once connected you will see the host device in the list (green light / connected)'),
      M('回到本工具箱「我是玩家」，把地址粘进来点「测试连接」', 'Come back to this toolbox, open "I am the player", paste the address and click "Test connection"'),
    ],
    tip: M('顺序反了会连不上：必须先加入网络，再测试连接。', 'Doing it in the wrong order will fail: you must join the network first, then test the connection.'),
  },
  zerotier: {
    id: 'zerotier',
    name: 'ZeroTier',
    needInstall: true,
    installer: null,
    page: 'https://www.zerotier.com/download/',
    why: M('你也必须装 ZeroTier 客户端，而且要被房主授权', 'You must install the ZeroTier client too, and the host must authorize you'),
    steps: [
      M('★ 你也要安装 ZeroTier One 客户端（不装连不上）', '★ You must install the ZeroTier One client as well (without it you cannot connect)'),
      M('把房主给你的 16 位 Network ID 填到上面输入框，点「加入网络」', 'Enter the 16-character Network ID the host gave you in the box above and click "Join network"'),
      M('★ 然后让房主去 my.zerotier.com 后台，在 Members 列表里勾选你的设备授权（Auth）', '★ Then ask the host to open my.zerotier.com and tick the Auth checkbox for your device in the Members list'),
      M('授权成功后你才会分到 10.x / 172.x / 192.x 的虚拟 IP', 'Only after being authorized will you be assigned a 10.x / 172.x / 192.x virtual IP'),
      M('用房主给的地址点「测试连接」', 'Click "Test connection" with the address the host gave you'),
    ],
    tip: M('没被房主授权时，网卡会显示出来但永远连不通 —— 这是 ZeroTier 最常见的坑。', 'If the host has not authorized you, the adapter shows up but never connects — this is the most common ZeroTier pitfall.'),
  },
  tailscale: {
    id: 'tailscale',
    name: 'Tailscale',
    needInstall: true,
    installer: 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi',
    installerName: 'tailscale-setup.msi',
    page: 'https://tailscale.com/download/windows',
    why: M('你也必须装 Tailscale 并登录，还要被房主邀请', 'You must install Tailscale and sign in too, and the host must invite you'),
    steps: [
      M('★ 你也要安装 Tailscale（点下面的「下载并安装」，工具箱会自动下官方安装包）', '★ You must install Tailscale as well (click "Download & install" below; the toolbox fetches the official installer for you)'),
      M('装完点「启动并登录」，浏览器会打开让你登录（Google / GitHub / 微软账号都行）', 'After installing, click "Start and sign in"; your browser opens for sign-in (Google / GitHub / Microsoft account all work)'),
      M('★ 还要让房主在他的 Tailscale 后台 Invite 你的账号（或者你们用同一个账号登录）', '★ The host must also invite your account from their Tailscale console (or both of you sign in with the same account)'),
      M('登录成功后会分到 100.x.x.x 的虚拟 IP', 'After signing in you will be assigned a 100.x.x.x virtual IP'),
      M('用房主给的地址点「测试连接」', 'Click "Test connection" with the address the host gave you'),
    ],
    tip: M('没登录成功的话不会有 100.x.x.x 的 IP，也就连不上。', 'If the sign-in did not succeed you will have no 100.x.x.x IP, and you will not be able to connect.'),
  },
};

function playerGuides() {
  return PLAYER_GUIDES;
}

/** 根据地址猜房主用的是哪种方式（只做提示，不做强制） */
function guessMethod(host) {
  const h = String(host || '').trim();
  if (!h) return { method: 'unknown', reason: '' };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const parts = h.split('.').map(Number);
    const a = parts[0];
    const b = parts[1];
    if (a === 26) return { method: 'radmin', reason: M('26.x.x.x 是 Radmin VPN 的虚拟网段', '26.x.x.x is the Radmin VPN virtual subnet') };
    if (a === 25) return { method: 'radmin', reason: M('25.x.x.x 常见于 Radmin / Hamachi 虚拟网段', '25.x.x.x is common for Radmin / Hamachi virtual subnets') };
    if (a === 100 && b >= 64 && b <= 127) {
      return { method: 'tailscale', reason: M('100.64~127.x.x 是 Tailscale 专用网段', "100.64-127.x.x is Tailscale's dedicated subnet") };
    }
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return { method: 'zerotier', reason: M('这是内网网段，通常是虚拟组网分到的地址（ZeroTier / Radmin 之类）', 'This is a private subnet, usually an address handed out by a VPN (ZeroTier / Radmin and the like)') };
    }
    return { method: 'tunnel', reason: M('看起来是公网地址，多半是内网穿透转发出来的', 'This looks like a public address, most likely forwarded by a tunneling service') };
  }
  if (/playit\.gg|joinmc\.link|at\.playit\.gg/i.test(h)) return { method: 'tunnel', reason: M('这是 playit.gg 的域名', 'This is a playit.gg domain') };
  if (/ngrok/i.test(h)) return { method: 'tunnel', reason: M('这是 ngrok 的域名', 'This is an ngrok domain') };
  return { method: 'unknown', reason: M('看不出是哪一种，按房主说的选上面几个标签', 'Cannot tell which method this is - pick one of the tabs above as the host described') };
}

module.exports = {
  listAdapters,
  vpnOverview,
  vpnInfo,
  installVpnTool,
  playerGuides,
  guessMethod,
  zerotierInfo,
  zerotierJoin,
  tailscaleInfo,
  tailscaleUp,
  readLanPort,
  checkFirewall,
  addFirewallRule,
  fingerprint,
  buildShareText,
  parseShareText,
  tcpTest,
};
