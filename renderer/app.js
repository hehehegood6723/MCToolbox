import * as THREE from './vendor/three.module.js';
import { t, setLang, getLang, restoreLang, applyStaticLang } from './i18n.js';

// ================================================================ 基础

const $ = (id) => document.getElementById(id);

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function unwrap(res) {
  if (!res) return null;
  if (res.ok) return res.data;
  throw new Error(res.error || t('未知错误', 'Unknown error'));
}

// 导航
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('panel-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'blueprint') resizeBpCanvas();
    if (btn.dataset.tab === 'remote') loadRemoteEnv();
    if (btn.dataset.tab === 'serverhost') initSrv();
  });
});

// 设置弹窗
let config = { curseforgeKey: '', mcFolder: '', username: 'Player' };
let sysSettings = {};

async function loadConfig() {
  restoreLang();
  try {
    const c = unwrap(await window.api.getModConfig());
    if (c) config = Object.assign(config, c);
  } catch (e) {}
  // 语言以后端保存的为准
  if (config.lang === 'en' || config.lang === 'zh') setLang(config.lang);
  applyStaticLang();
  if ($('cfgLang')) $('cfgLang').value = getLang();
  $('cfgCfKey').value = config.curseforgeKey || '';
  $('cfgMcFolder').value = config.mcFolder || '';
  $('cfgUser').value = config.username || 'Player';
  await loadSysSettings();
}

async function loadSysSettings() {
  try {
    sysSettings = unwrap(await window.api.getSettings()) || {};
    $('cfgAutoStart').checked = !!sysSettings.autoStart;
    $('cfgTray').checked = !!sysSettings.minimizeToTray;
    const cid = sysSettings.clientId || '';
    $('cfgClientId').value = cid === '00000000402b5328' ? '' : cid;
    if (sysSettings.lang && sysSettings.lang !== getLang()) {
      setLang(sysSettings.lang);
    }
    if ($('cfgLang')) $('cfgLang').value = getLang();
  } catch (e) {
    /* ignore */
  }
}

$('btnSettings').addEventListener('click', async () => {
  await loadSysSettings();
  $('modalMask').style.display = 'flex';
});
$('cfgCancel').addEventListener('click', () => ($('modalMask').style.display = 'none'));
$('cfgSave').addEventListener('click', async () => {
  const lang = $('cfgLang') ? $('cfgLang').value : getLang();
  config.lang = lang;
  config.curseforgeKey = $('cfgCfKey').value.trim();
  config.mcFolder = $('cfgMcFolder').value.trim();
  config.username = $('cfgUser').value.trim() || 'Player';
  unwrap(await window.api.saveModConfig(config));
  try {
    const lang = $('cfgLang') ? $('cfgLang').value : getLang();
    setLang(lang);
    unwrap(
      await window.api.setSettings({
        autoStart: $('cfgAutoStart').checked,
        minimizeToTray: $('cfgTray').checked,
        clientId: $('cfgClientId').value.trim(),
        lang,
      })
    );
  } catch (e) {
    toast(t('系统设置保存失败：', 'Failed to save system settings: ') + e.message, 4000);
  }
  if (config.mcFolder) $('mcFolder').value = config.mcFolder;
  if (config.username) $('mcUser').value = config.username;
  $('modalMask').style.display = 'none';
  toast(t('设置已保存', 'Settings saved'));
});

// ================================================================ 1. 崩溃日志

let currentLogPath = null;

$('crashPick').addEventListener('click', async () => {
  const picked = unwrap(await window.api.pickLog());
  if (!picked) return;
  currentLogPath = picked.path;
  $('crashFile').textContent = picked.name;
  await runAnalysis(picked.path);
});

$('crashRecent').addEventListener('click', async () => {
  const mcFolder = $('mcFolder').value || config.mcFolder;
  if (!mcFolder) return toast(t('请先在「版本与启动」里选择 .minecraft 文件夹', 'Choose your .minecraft folder in Versions & Launch first'));
  const logs = unwrap(await window.api.recentLogs(mcFolder));
  const card = $('crashRecentCard');
  const list = $('crashRecentList');
  list.innerHTML = '';
  if (!logs || !logs.length) {
    list.innerHTML = '<div class="hint">' + t('没找到日志文件', 'No log files found') + '</div>';
  } else {
    logs.forEach((l) => {
      const el = document.createElement('div');
      el.className = 'list-item';
      el.innerHTML = `<div class="li-main"><div class="li-title">${l.name}</div>
        <div class="li-sub">${new Date(l.mtime).toLocaleString()} · ${(l.size / 1024).toFixed(1)} KB</div></div>`;
      el.addEventListener('click', async () => {
        currentLogPath = l.path;
        $('crashFile').textContent = l.name;
        await runAnalysis(l.path);
      });
      list.appendChild(el);
    });
  }
  card.style.display = 'block';
});

async function runAnalysis(p) {
  try {
    const r = unwrap(await window.api.analyzeLog(p));
    renderAnalysis(r);
  } catch (e) {
    toast(t('解析失败：', 'Parse failed: ') + e.message);
  }
}

function renderAnalysis(r) {
  $('crashResult').style.display = 'block';
  $('crashVerdict').innerHTML =
    `<b>${t('结论：', 'Conclusion: ')}</b>${escapeHtml(r.summary)}` + (r.crashTitle ? `<br><b>${t('崩溃标题：', 'Crash title: ')}</b>${escapeHtml(r.crashTitle)}` : '');

  const env = r.env || {};
  const rows = [
    [t('文件', 'File'), r.name],
    [t('大小', 'Size'), env.size],
    [t('总行数', 'Total lines'), env.lines],
    [t('Java 版本', 'Java version'), env.java],
    [t('MC 版本', 'MC version'), env.mcVersion],
    [t('内存', 'Memory'), env.memory],
    [t('模组数量', 'Mods'), env.modCount],
    [t('操作系统', 'OS'), env.os],
    ['CPU', env.cpu],
  ].filter((x) => x[1] !== null && x[1] !== undefined && x[1] !== '');
  $('crashEnv').innerHTML = rows.map((x) => `<div><span>${x[0]}${t('：', ': ')}</span>${escapeHtml(String(x[1]))}</div>`).join('');

  const hitsEl = $('crashHits');
  hitsEl.innerHTML = '';
  if (!r.hits.length) {
    hitsEl.innerHTML = '<div class="card"><h3>' + t('未匹配到典型错误', 'No typical errors matched') + '</h3><p class="hint">' + t('建议把日志中的 "Caused by" 段落贴到社区求助，或尝试移除最近新加的模组。', 'Post the "Caused by" section of the log for help, or remove the mods you added recently.') + '</p></div>';
  } else {
    r.hits.forEach((h) => {
      const el = document.createElement('div');
      el.className = 'hit';
      el.innerHTML = `
        <h4>${escapeHtml(h.title)} ${h.line ? `<span class="badge">${t('第 ' + h.line + ' 行', 'Line ' + h.line)}</span>` : ''}</h4>
        <div class="reason">${escapeHtml(h.reason)}</div>
        <ul>${h.advice.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
        <div class="sample">${escapeHtml(h.sample)}</div>`;
      hitsEl.appendChild(el);
    });
  }

  if (r.causes && r.causes.length) {
    $('crashStackCard').style.display = 'block';
    $('crashStack').textContent = r.causes.map((c) => `L${c.line}: ${c.text}`).join('\n');
  } else {
    $('crashStackCard').style.display = 'none';
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================================================================ 2. 服务器

$('serverPing').addEventListener('click', async () => {
  let input = $('serverHost').value.trim();
  if (!input) return toast(t('请输入服务器地址', 'Enter the server address'));
  let port = 25565;
  const m = input.match(/^(.*):(\d+)$/);
  let host = input;
  if (m) {
    host = m[1];
    port = Number(m[2]);
  }
  $('serverError').style.display = 'none';
  $('serverResult').style.display = 'none';
  $('serverPing').disabled = true;
  $('serverPing').textContent = t('查询中…', 'Querying…');

  try {
    const r = unwrap(await window.api.pingServer(host, port));
    if (!r.ok) throw new Error(r.error);
    renderServer(r, host, port);
  } catch (e) {
    $('serverError').style.display = 'block';
    $('serverError').textContent = t('查询失败：', 'Query failed: ') + e.message;
  } finally {
    $('serverPing').disabled = false;
    $('serverPing').textContent = t('查询', 'Query');
  }
});

function renderServer(r, host, port) {
  $('serverResult').style.display = 'block';
  $('serverMotd').textContent = stripColor(r.motd) || t('(无 MOTD)', '(no MOTD)');
  $('serverMeta').textContent = `${host}:${port}${t(' · 协议 ', ' · protocol ')}${r.protocol ?? '?'}`;

  const icon = $('serverIcon');
  if (r.favicon) {
    icon.src = r.favicon;
    icon.style.display = 'block';
  } else {
    icon.removeAttribute('src');
    icon.style.display = 'none';
  }

  const stats = [
    [t('在线玩家', 'Players online'), `${r.online} / ${r.max}`],
    [t('版本', 'Version'), r.version],
    [t('延迟', 'Latency'), r.latency + ' ms'],
    [t('协议号', 'Protocol'), String(r.protocol ?? '-')],
  ];
  if (r.modinfo) stats.push(['Mod', (r.modinfo.type || '') + ' ' + (r.modinfo.modList ? '(' + r.modinfo.modList.length + ')' : '')]);
  $('serverStats').innerHTML = stats.map((s) => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${escapeHtml(String(s[1]))}</div></div>`).join('');

  const pt = $('playerTitle');
  const pe = $('serverPlayers');
  if (r.sample && r.sample.length) {
    pt.style.display = 'block';
    pe.innerHTML = r.sample
      .slice(0, 80)
      .map((s) => `<span class="chip">${escapeHtml(stripColor(s.name))}</span>`)
      .join('');
  } else {
    pt.style.display = 'none';
    pe.innerHTML = '';
  }
}

function stripColor(s) {
  return String(s == null ? '' : s).replace(/§[0-9a-fk-or]/gi, '').trim();
}

// ================================================================ 3. 图片转换

let imageFiles = [];
let outDir = null;

const renderImageList = () => {
  const el = $('imgList');
  el.innerHTML = '';
  if (!imageFiles.length) {
    el.innerHTML = '<div class="hint">' + t('还没有添加图片', 'No images added yet') + '</div>';
  } else {
    imageFiles.forEach((f, i) => {
      const d = document.createElement('div');
      d.className = 'list-item';
      d.innerHTML = `<div class="li-main"><div class="li-title">${escapeHtml(f.name)}</div><div class="li-sub">${escapeHtml(f.path)}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'ghost small';
      btn.textContent = t('移除', 'Remove');
      btn.style.width = 'auto';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        imageFiles.splice(i, 1);
        renderImageList();
      });
      d.appendChild(btn);
      el.appendChild(d);
    });
  }
  $('imgConvert').disabled = imageFiles.length === 0;
};

$('imgPick').addEventListener('click', async () => {
  const paths = unwrap(await window.api.pickImages());
  if (!paths || !paths.length) return;
  for (const p of paths) {
    if (!imageFiles.some((f) => f.path === p)) imageFiles.push({ path: p, name: p.split(/[\\/]/).pop() });
  }
  renderImageList();
});

$('imgClear').addEventListener('click', () => {
  imageFiles = [];
  renderImageList();
  $('imgStatus').textContent = '';
});

$('imgOutDir').addEventListener('click', async () => {
  const d = unwrap(await window.api.pickOutputDir());
  if (!d) return;
  outDir = d;
  $('imgOutHint').textContent = t('输出目录：', 'Output folder: ') + d;
});

$('imgConvert').addEventListener('click', async () => {
  $('imgConvert').disabled = true;
  let done = 0;
  for (const f of imageFiles) {
    try {
      const img = unwrap(await window.api.readImage(f.path));
      const png = await jpgToPng(img.dataUrl);
      const target = outDir || f.path.replace(/[\\/][^\\/]+$/, '');
      const saved = unwrap(await window.api.savePng(target, img.name, png));
      done++;
      $('imgStatus').textContent = `${t('已转换', 'Converted')} ${done}/${imageFiles.length}${t(' · 最后一个：', ' · last: ')}${saved.split(/[\\/]/).pop()}`;
    } catch (e) {
      $('imgStatus').textContent = `${t('失败：', 'Failed: ')}${f.name} (${e.message})`;
    }
  }
  $('imgConvert').disabled = false;
  if (done === imageFiles.length && done > 0) toast(`${t('全部转换完成，共', 'All converted —')} ${done} ${t('张', 'images')}`);
});

function jpgToPng(dataUrl) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth;
      c.height = im.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(im, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    im.onerror = () => reject(new Error(t('图片解码失败', 'Image decoding failed')));
    im.src = dataUrl;
  });
}

// ================================================================ 4. 蓝图 3D

let bp = null; // { renderer, scene, camera, model, ... }

function initBlueprint() {
  const canvas = $('bpCanvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.95);
  d1.position.set(1, 1.4, 0.8);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xdcefff, 0.45);
  d2.position.set(-1, 0.4, -0.9);
  scene.add(d2);

  const grid = new THREE.GridHelper(200, 40, 0xbcdcf5, 0xdceafa);
  grid.position.y = -0.5;
  scene.add(grid);

  const group = new THREE.Group();
  scene.add(group);

  const state = { dist: 60, yaw: -0.7, pitch: 0.55, panX: 0, panY: 0, target: new THREE.Vector3() };

  const updateCam = () => {
    const { dist, yaw, pitch } = state;
    camera.position.set(
      state.target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      state.target.y + dist * Math.sin(pitch),
      state.target.z + dist * Math.cos(pitch) * Math.cos(yaw)
    );
    camera.lookAt(state.target);
  };
  updateCam();

  // 交互
  let dragging = null;
  let lastX = 0, lastY = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    dragging = e.button === 2 ? 'pan' : 'rotate';
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => (dragging = null));
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragging === 'rotate') {
      state.yaw -= dx * 0.007;
      state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + dy * 0.007));
    } else {
      const right = new THREE.Vector3(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
      const up = new THREE.Vector3(0, 1, 0);
      const scale = state.dist * 0.0016;
      state.target.addScaledVector(right, -dx * scale);
      state.target.addScaledVector(up, dy * scale);
    }
    updateCam();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.dist = Math.max(3, Math.min(4000, state.dist * (1 + Math.sign(e.deltaY) * 0.12)));
    updateCam();
  });

  bp = { renderer, scene, camera, group, state, updateCam, grid };

  const loop = () => {
    bp.renderer.render(bp.scene, bp.camera);
    requestAnimationFrame(loop);
  };
  loop();
  resizeBpCanvas();
}

function resizeBpCanvas() {
  if (!bp) return;
  const canvas = $('bpCanvas');
  const w = canvas.clientWidth || 800;
  const h = canvas.clientHeight || 460;
  bp.renderer.setSize(w, h, false);
  bp.camera.aspect = w / h;
  bp.camera.updateProjectionMatrix();
}

window.addEventListener('resize', resizeBpCanvas);

$('bpPick').addEventListener('click', async () => {
  const picked = unwrap(await window.api.pickLitematic());
  if (!picked) return;
  $('bpFile').textContent = t('解析中…', 'Parsing…');
  try {
    const data = unwrap(await window.api.loadLitematic(picked.path));
    $('bpFile').textContent = picked.name;
    renderBlueprint(data);
  } catch (e) {
    $('bpFile').textContent = picked.name;
    toast(t('蓝图解析失败：', 'Failed to parse blueprint: ') + e.message);
  }
});

$('bpReset').addEventListener('click', () => {
  if (!bp) return;
  bp.state.dist = 60;
  bp.state.yaw = -0.7;
  bp.state.pitch = 0.55;
  bp.state.target.set(0, 0, 0);
  bp.group.rotation.set(0, 0, 0);
  bp.updateCam();
});

$('bpRotX').addEventListener('click', () => {
  if (bp) bp.group.rotation.x += Math.PI / 2;
});
$('bpRotY').addEventListener('click', () => {
  if (bp) bp.group.rotation.y += Math.PI / 2;
});

function renderBlueprint(data) {
  if (!bp) initBlueprint();
  // 清理旧模型
  while (bp.group.children.length) {
    const c = bp.group.children.pop();
    c.geometry && c.geometry.dispose();
    c.material && c.material.dispose();
  }

  const positions = data.data; // [x,y,z,pi, ...]
  const count = positions.length / 4;

  const opaque = [];
  const glass = [];
  for (let i = 0; i < positions.length; i += 4) {
    const row = [positions[i], positions[i + 1], positions[i + 2], positions[i + 3]];
    (data.palette[row[3]] && data.palette[row[3]].glass ? glass : opaque).push(row);
  }

  const geo = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const build = (rows, transparent) => {
    if (!rows.length) return null;
    const mat = transparent
      ? new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.42, depthWrite: false })
      : new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, rows.length);
    rows.forEach((r, i) => {
      dummy.position.set(r[0], r[1], r[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const p = data.palette[r[3]];
      color.set(p ? p.color : '#999999');
      mesh.setColorAt(i, color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    bp.group.add(mesh);
    return mesh;
  };

  build(opaque, false);
  build(glass, true);

  // 自适应相机
  const s = Math.max(data.size.x, data.size.y, data.size.z, 8);
  bp.state.dist = s * 1.9;
  bp.state.target.set(0, 0, 0);
  bp.updateCam();
  bp.grid.visible = true;

  $('bpInfo').innerHTML = `
    <b>${escapeHtml(data.name || t('未命名', 'Untitled'))}</b><br>
    ${t('作者：', 'Author: ')}${escapeHtml(data.author || t('未知', 'Unknown'))}<br>
    ${t('尺寸：', 'Size: ')}${data.size.x} × ${data.size.y} × ${data.size.z}<br>
    ${t('方块：', 'Blocks: ')}${data.totalBlocks.toLocaleString()}${data.truncated ? t('（已截断显示）', '(display truncated)') : ''}<br>
    ${t('区域：', 'Regions: ')}${data.regions}${t(' · 调色板：', ' · palette: ')}${data.palette.length}`;

  $('bpPalette').innerHTML = data.palette
    .slice(0, 40)
    .map((p) => {
      const nm = p.id.replace('minecraft:', '');
      return `<span class="chip"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${p.color};margin-right:5px"></span>${escapeHtml(nm)}</span>`;
    })
    .join('') + (data.palette.length > 40 ? `<span class="chip">${t('… 还有 ', '… and ')}${data.palette.length - 40}${t(' 种', ' more kinds')}</span>` : '');
}

// ================================================================ 5. 版本与启动

let versions = [];
let selectedVersion = null;
let onlyLaunchable = false;

$('mcPick').addEventListener('click', async () => {
  const d = unwrap(await window.api.pickMcFolder());
  if (!d) return;
  $('mcFolder').value = d;
  config.mcFolder = d;
  unwrap(await window.api.saveModConfig(config));
  if (!$('modsDir').value.trim()) $('modsDir').value = defaultModsDir();
  await scanVersions();
});

$('mcFind').addEventListener('click', findFolders);

async function findFolders() {
  const box = $('mcFolders');
  const list = $('mcFolderList');
  box.style.display = 'block';
  list.innerHTML = '<div class="hint">' + t('正在查找本机的 .minecraft 目录…（最多几秒）', 'Looking for .minecraft folders on this PC… (a few seconds at most)') + '</div>';
  try {
    const found = unwrap(await window.api.findGameFolders()) || [];
    if (!found.length) {
      list.innerHTML = '<div class="hint">' + t('没有找到其他 .minecraft 目录', 'No other .minecraft folders found') + '</div>';
      return;
    }
    list.innerHTML = '';
    const games = found.filter((f) => f.type !== 'resource');
    const resources = found.filter((f) => f.type === 'resource');

    if (resources.length) {
      const tip = document.createElement('div');
      tip.className = 'hint';
      tip.innerHTML =
        `${t('另外还发现 ', 'Also found ')}<b>${resources.length}</b>${t(' 个「实例 / 资源目录」（只有 mods 没有 versions，', ' instance / resource folders (mods but no versions —')}` +
        `${t('通常是 PCL 整合包实例的存放位置）—— 它们不在版本列表里，但你的 mod 就在那儿：', 'usually where PCL modpack instances live) — they are not in the version list, but your mods are there:')}`;
      list.appendChild(tip);
    }

    found.forEach((f) => {
      const el = document.createElement('div');
      el.className = 'list-item';
      const isRes = f.type === 'resource';
      el.innerHTML = `
        <div class="li-main">
          <div class="li-title">${escapeHtml(f.path)}</div>
          <div class="li-sub">${
            isRes
              ? `<span class="tag snapshot">${t('实例/资源目录', 'instance / resources folder')}</span> <b>${f.mods}</b>${t(' 个 mod · 没有 versions（不能直接启动，但 mod 在这里）', ' mods · no versions folder (cannot launch directly, but the mods are here)')}`
              : `<span class="tag release">${t('游戏目录', 'game folder')}</span> ${f.versions}${t(' 个版本 · ', ' versions · ')}<b>${f.mods}</b>${t(' 个共享 mod · ', ' shared mods · ')}${f.hasLibraries ? t('✅ 含 libraries', '✅ has libraries') : t('⚠️ 无 libraries', '⚠️ no libraries')}${f.hasAssets ? t(' · 含 assets', ' · has assets') : ''}`
          }</div>
        </div>
        <button class="ghost small" style="width:auto">${isRes ? t('打开文件夹', 'Open folder') : t('选用', 'Use')}</button>`;
      el.addEventListener('click', async () => {
        if (isRes) {
          window.api.openPath(f.path);
          return;
        }
        $('mcFolder').value = f.path;
        config.mcFolder = f.path;
        unwrap(await window.api.saveModConfig(config));
        if (!$('modsDir').value.trim()) $('modsDir').value = defaultModsDir();
        box.style.display = 'none';
        await scanVersions();
      });
      list.appendChild(el);
    });
  } catch (e) {
    list.innerHTML = '<div class="hint">' + t('查找失败：', 'Lookup failed: ') + escapeHtml(e.message) + '</div>';
  }
}

$('mcScan').addEventListener('click', scanVersions);

// ---- 资源目录（assets）----
$('mcAssetsPick').addEventListener('click', async () => {
  const d = unwrap(await window.api.pickDir(t('选择 assets 资源目录', 'Choose the assets folder'), $('mcAssets').value.trim() || undefined));
  if (!d) return;
  $('mcAssets').value = d;
  config.assetsDir = d;
  unwrap(await window.api.saveModConfig(config));
  toast(t('资源目录已设为：', 'Assets folder set to: ') + d, 3500);
});

$('mcAssetsAuto').addEventListener('click', () => autoDetectAssets(true));

/** 当前游戏目录缺 assets 时，自动借用其他完整目录的 assets（零下载） */
async function autoDetectAssets(force) {
  const mc = $('mcFolder').value.trim();
  if (!mc) return;
  if (!force && $('mcAssets').value.trim()) return;
  try {
    const found = unwrap(await window.api.findGameFolders()) || [];
    const cur = mc.replace(/[\\/]+$/, '').toLowerCase();
    const cand = found.find((f) => f.hasAssets && f.path.replace(/[\\/]+$/, '').toLowerCase() !== cur);
    if (cand) {
      const dir = cand.path.replace(/[\\/]+$/, '') + '\\assets';
      $('mcAssets').value = dir;
      config.assetsDir = dir;
      unwrap(await window.api.saveModConfig(config));
      appendLog(`${t('[提示] 当前目录缺少 assets，已自动借用：', '[Info] This folder has no assets — borrowed: ')}${dir}\n`);
    } else if (force) {
      toast(t('没有找到其他带 assets 的游戏目录，只能用「补全文件」下载资源', 'No other game folder has assets — use "Repair files" to download them'), 4500);
    }
  } catch (e) {
    /* ignore */
  }
}

$('verOnlyLaunchable').addEventListener('change', () => {
  onlyLaunchable = $('verOnlyLaunchable').checked;
  renderVersionList();
});

async function scanVersions() {
  const folder = $('mcFolder').value.trim();
  if (!folder) return toast(t('请先选择 .minecraft 文件夹', 'Choose the .minecraft folder first'));
  try {
    const r = unwrap(await window.api.scanVersions(folder));
    versions = r.versions;
    $('mcSummary').style.display = 'block';
    $('mcStats').innerHTML = [
      [t('列出的版本', 'Versions listed'), r.count],
      [t('可直接启动', 'Launchable now'), r.launchableCount],
      [t('待补全文件', 'Need repair'), r.repairableCount],
      [t('已隐藏(缺 jar)', 'Hidden (no jar)'), r.hidden],
      [t('有 mod 的版本', 'Versions with mods'), r.versionsWithMods],
      [t('版本 mod 合计', 'Mods across versions'), r.versionModTotal],
      [t('根目录共享 mods', 'Shared root mods'), r.rootMods],
    ]
      .map((s) => `<div class="stat"><div class="k">${s[0]}</div><div class="v">${escapeHtml(String(s[1]))}</div></div>`)
      .join('');

    $('verFilterRow').style.display = 'flex';
    $('verFilterHint').textContent = r.hidden > 0 ? `${t('已自动隐藏 ', 'Hidden automatically: ')}${r.hidden}${t(' 个缺少 jar / JSON 的废版本', ' broken versions missing jar / JSON')}` : '';
    renderVersionList();
    $('launchBar').style.display = 'flex';
    $('assetsRow').style.display = 'flex';
    updateModsPath();
    if (!r.hasAssets) await autoDetectAssets();
    await refreshJava();

    let msg = `${t('已列出 ', 'Listed ')}${r.count}${t(' 个可用版本', ' usable versions')}`;
    if (r.launchableCount) msg += `${t('，其中 ', ', of which ')}<b>${r.launchableCount}</b>${t(' 个可直接启动', ' can be launched right away')}`;
    if (r.repairableCount) msg += `${t('，另有 ', ', and ')}<b>${r.repairableCount}</b>${t(' 个缺文件（可点「补全文件」自动下载）', ' are missing files (click "Repair files" to download them)')}`;
    setStatus(msg + t('。', '.'), null);
  } catch (e) {
    toast(t('扫描失败：', 'Scan failed: ') + e.message);
  }
}

function setStatus(html, log) {
  $('launchStatusCard').style.display = 'block';
  $('launchStatus').innerHTML = html;
  if (log !== null && log !== undefined) {
    $('gameLog').style.display = 'block';
    $('gameLog').textContent = log;
  }
  try {
    $('launchStatusCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {}
}

function appendLog(line) {
  const logEl = $('gameLog');
  logEl.style.display = 'block';
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

function renderVersionList() {
  const el = $('versionList');
  el.innerHTML = '';
  const list = onlyLaunchable ? versions.filter((v) => v.launchable) : versions;
  if (!list.length) {
    el.innerHTML =
      '<div class="hint">' + t('没有符合条件的版本。', 'No versions match.') + '<br>' +
      t('如果列表是空的，说明这些版本都缺少游戏库文件（PCL 会在启动时才补全）。', 'If the list is empty, those versions are missing game libraries (PCL downloads them only at launch).') + '<br>' +
      t('请把上方勾选框取消，然后点版本右侧的「补全文件」自动下载缺失依赖。', 'Clear the checkbox above, then click "Repair files" next to a version to download the missing dependencies.') + '</div>';
    return;
  }
  list.forEach((v) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const status = v.launchable
      ? '<span class="tag release">' + t('可启动', 'Launchable') + '</span>'
      : `<span class="tag snapshot">${t('缺 ', 'Missing ')}${v.missingLibs || '?'}${t(' 个文件', ' files')}</span>`;
    const loaders = (v.loaders || [])
      // 中英文两种模式下「原版」的取值都要能被过滤掉（后端 en 模式给的是 Vanilla）
      .filter((x) => !/^(原版|vanilla)$/i.test(String(x)))
      .map((x) => `<span class="tag ${String(x).toLowerCase()}">${escapeHtml(x)}</span>`)
      .join('');
    item.innerHTML = `
      <span class="tag ${v.type || 'unknown'}">${typeLabel(v.type)}</span>
      <div class="li-main">
        <div class="li-title">${escapeHtml(v.id)}</div>
        <div class="li-sub">${v.jarSize ? (v.jarSize / 1024 / 1024).toFixed(1) + ' MB' : t('继承父版本', 'inherits parent')} · ${v.releaseTime ? new Date(v.releaseTime).toLocaleDateString() : t('未知日期', 'unknown date')}${v.javaVersion ? t(' · 建议 Java ', ' · recommends Java ') + v.javaVersion : ''}${v.reason ? ' · ' + escapeHtml(v.reason) : ''}
          <br><b>Mods ${v.modCount || 0}</b>${v.resourcepackCount ? t(' · 资源包 ', ' · resource packs ') + v.resourcepackCount : ''}${v.shaderpackCount ? t(' · 光影 ', ' · shaders ') + v.shaderpackCount : ''}${v.isolated ? ' · <span style="color:#1a6cab">' + t('独立目录', 'isolated folder') + '</span>' : t(' · 用共享根目录', ' · uses shared root folder')}</div>
      </div>
      ${status}${loaders}
      <button class="ghost small" style="width:auto" data-act="repair">${t('补全文件', 'Repair files')}</button>
      <button class="primary small" style="width:auto" data-act="launch">${t('启动', 'Launch')}</button>
      <button class="danger small" style="width:auto" data-act="delete">${t('删除', 'Delete')}</button>`;

    const select = () => {
      document.querySelectorAll('#versionList .list-item').forEach((x) => x.classList.remove('selected'));
      item.classList.add('selected');
      selectedVersion = v;
      $('mcLaunch').disabled = false;
      $('mcLaunch').textContent = t('启动 ', 'Launch ') + v.id;
      $('mcRepair').disabled = false;
      selectBestJava();
      updateModsPath(v);
    };
    item.addEventListener('click', select);
    item.querySelector('[data-act="launch"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      select();
      doLaunch();
    });
    item.querySelector('[data-act="repair"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      select();
      repairVersion();
    });
    item.querySelector('[data-act="delete"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      select();
      deleteVersion(v);
    });
    el.appendChild(item);
  });
}

function typeLabel(type) {
  return { release: t('正式版', 'Release'), snapshot: t('快照', 'Snapshot'), old_beta: t('远古BETA', 'Ancient BETA'), old_alpha: t('远古ALPHA', 'Ancient ALPHA') }[type] || (type || t('未知', 'Unknown'));
}

async function refreshJava() {
  const folder = $('mcFolder').value.trim();
  const list = unwrap(await window.api.javaList(folder)) || [];
  const sel = $('mcJava');
  sel.innerHTML = '';
  if (!list.length) {
    sel.innerHTML = '<option value="">' + t('未找到 Java，请安装或手动指定', 'No Java found — install one or set it manually') + '</option>';
    return;
  }
  const seen = new Set();
  const uniq = list.filter((j) => (seen.has(j.path) ? false : (seen.add(j.path), true)));
  uniq.forEach((j) => {
    const o = document.createElement('option');
    o.value = j.path;
    o.textContent = `Java ${j.major || '?'} · ${String(j.tag || '').trim()} · ${j.path}`;
    o.dataset.major = String(j.major || '');
    sel.appendChild(o);
  });
  selectBestJava();
}

/** 按选中版本需要的 Java 版本自动挑选 */
function selectBestJava() {
  const sel = $('mcJava');
  const need = selectedVersion && selectedVersion.javaVersion;
  if (!need) return;
  for (const o of sel.options) {
    if (Number(o.dataset.major) === Number(need)) {
      sel.value = o.value;
      return;
    }
  }
}

$('mcJavaRefresh').addEventListener('click', refreshJava);
$('mcLaunch').addEventListener('click', doLaunch);
$('mcRepair').addEventListener('click', repairVersion);

async function repairVersion() {
  if (!selectedVersion) return toast(t('请先选择一个版本', 'Select a version first'));
  const mcFolder = $('mcFolder').value.trim();
  setStatus(`${t('正在补全 ', 'Repairing ')}<b>${escapeHtml(selectedVersion.id)}</b>${t(' 的缺失文件…', ' — downloading missing files…')}`, t('正在检查并下载缺失文件，请稍候…\n（依赖库 + 客户端 jar + 资源索引；随后会下载资源文件，可能较久）\n', 'Checking and downloading missing files, please wait…\n(libraries + client jar + asset index; asset files come afterwards and can take a while)\n'));
  $('mcRepair').disabled = true;
  try {
    const assetsDir = $('mcAssets').value.trim() || undefined;
    const r = unwrap(await window.api.repairVersion(mcFolder, selectedVersion.id, { assetsDir, includeAssets: !assetsDir }));
    let msg = `${t('下载 ', 'Downloaded ')}${r.done}/${r.total}${t(' 个文件', ' files')}`;
    if (r.failed) msg += `${t('，失败 ', ', failed ')}${r.failed}`;
    appendLog(t('补全结果：', 'Repair result: ') + msg + '\n');
    if (r.skipped && r.skipped.length) {
      appendLog(`${t('有 ' + r.skipped.length + ' 个文件没有可用下载地址（需官方启动器/PCL 补全）', r.skipped.length + ' files have no usable download URL (repair them with the official launcher / PCL)')}\n`);
      for (const s of r.skipped.slice(0, 8)) appendLog('   - ' + s + '\n');
    }
    appendLog(r.launchable ? t('✅ 现在可以启动了！\n', '✅ Ready to launch now!\n') : `${t('⚠️ 仍缺文件：', '⚠️ Still missing files: ')}${r.reason || r.assetsReasonDetail || ''}\n`);
    await scanVersions();
    toast(r.launchable ? t('补全完成，可以启动了', 'Repair finished — ready to launch') : t('补全完成，但仍有缺失', 'Repair finished, but files are still missing'), 4000);
  } catch (e) {
    appendLog(t('补全失败：', 'Repair failed: ') + e.message + '\n');
    toast(t('补全失败：', 'Repair failed: ') + e.message, 4000);
  } finally {
    $('mcRepair').disabled = false;
  }
}

// ---- 正版账户（微软登录）----
let currentAccount = null;

async function refreshAccount() {
  try {
    currentAccount = unwrap(await window.api.authCurrent());
  } catch (e) {
    currentAccount = null;
  }
  renderAccount();
}

function renderAccount() {
  const a = currentAccount;
  const av = $('accAvatar');
  if (a && a.name) {
    $('accName').textContent = t('正版账号：', 'Premium account: ') + a.name;
    const when = a.obtainedAt ? new Date(a.obtainedAt).toLocaleString() : '';
    $('accSub').textContent =
      t('已登录（UUID ', 'Signed in (UUID ') + String(a.uuid || '').slice(0, 8) + t('…）', '…)') + (when ? ' · ' + when : '') + t(' · 每次启动会自动续期', ' · renewed automatically on every launch');
    $('accLogin').textContent = t('重新登录', 'Sign in again');
    $('accLogout').style.display = 'inline-flex';
    // 头像是主进程裁好的 8×8 data URL（界面不直接请求外网）
    if (a.skin) {
      window.api
        .authHead()
        .then((r) => {
          const head = r && r.ok ? r.data : null;
          if (head) {
            av.src = head;
            av.style.display = 'block';
          } else {
            av.style.display = 'none';
          }
        })
        .catch(() => {
          av.style.display = 'none';
        });
    } else {
      av.style.display = 'none';
    }
  } else {
    $('accName').textContent = t('离线模式（游客）', 'Offline mode (guest)');
    $('accSub').textContent = t('用用户名直接进游戏；想要正版皮肤 / 联机验证请点右边登录', 'Play with just a username; sign in on the right for premium skins and online-play auth');
    $('accLogin').textContent = t('正版登录（微软）', 'Sign in (Microsoft)');
    $('accLogout').style.display = 'none';
    av.style.display = 'none';
  }
}

$('accLogin').addEventListener('click', async () => {
  toast(t('即将弹出微软登录窗口，请在弹出的窗口里完成登录', 'A Microsoft sign-in window will open — finish signing in there'), 6000);
  appendLog(t('[账号] 正在打开微软登录窗口…\n', '[Account] Opening the Microsoft sign-in window…\n'));
  try {
    currentAccount = unwrap(await window.api.authLogin());
    renderAccount();
    appendLog(t('[账号] 登录成功：', '[Account] Signed in: ') + currentAccount.name + t('（UUID ', ' (UUID ') + currentAccount.uuid + t('）\n', ')\n'));
    toast(t('登录成功：', 'Signed in: ') + currentAccount.name, 4000);
  } catch (e) {
    appendLog(t('[账号] 登录失败：', '[Account] Sign-in failed: ') + e.message + '\n');
    toast(t('登录失败：', 'Sign-in failed: ') + e.message, 7000);
  }
});

$('accLogout').addEventListener('click', async () => {
  try {
    unwrap(await window.api.authLogout());
  } catch (e) {
    /* ignore */
  }
  currentAccount = null;
  renderAccount();
  toast(t('已退出登录，回到离线模式', 'Signed out — back to offline mode'));
});

async function deleteVersion(v) {
  const mcFolder = $('mcFolder').value.trim();
  if (!mcFolder) return toast(t('请先选择 .minecraft 文件夹', 'Choose the .minecraft folder first'));
  try {
    const r = unwrap(await window.api.deleteVersion(mcFolder, v.id));
    if (r.cancelled) return;
    toast(`${t('已删除 ', 'Deleted ')}${r.id}${t('（释放 ', ' (freed ')}${(r.bytes / 1024 / 1024).toFixed(1)} MB${t('）', ')')}`, 4200);
    if (selectedVersion && selectedVersion.id === r.id) {
      selectedVersion = null;
      $('mcLaunch').disabled = true;
      $('mcRepair').disabled = true;
      $('mcLaunch').textContent = t('启动选中版本', 'Launch selected version');
    }
    appendLog(`${t('[删除] 已删除版本 ', '[Delete] Removed version ')}${r.id}${t('，释放 ', ', freed ')}${(r.bytes / 1024 / 1024).toFixed(1)} MB\n`);
    await scanVersions();
  } catch (e) {
    toast(t('删除失败：', 'Delete failed: ') + e.message, 4000);
  }
}

async function doLaunch() {
  if (!selectedVersion) return toast(t('请先选择一个版本', 'Select a version first'));
  const mcFolder = $('mcFolder').value.trim();
  const javaPath = $('mcJava').value;
  const username = $('mcUser').value.trim() || 'Player';
  const maxMemory = Number($('mcMem').value) || 4096;

  if (!javaPath) {
    setStatus(t('❌ 没有可用的 Java，请先安装 Java 或用启动器自带的 Java 目录', '❌ No usable Java — install Java or point at the Java folder bundled with your launcher'), t('未找到 java.exe\n', 'java.exe not found\n'));
    return toast(t('没有可用的 Java', 'No usable Java'));
  }

  const sel = $('mcJava').selectedOptions[0];
  const javaMajorSel = Number((sel && sel.dataset && sel.dataset.major) || 0);
  const need = Number(selectedVersion.javaVersion || 0);

  config.username = username;
  config.mcFolder = mcFolder;
  try {
    unwrap(await window.api.saveModConfig(config));
  } catch (e) {}

  setStatus(`${t('正在启动 ', 'Launching ')}<b>${escapeHtml(selectedVersion.id)}</b>${t(' …（详细日志见下方）', ' … (details in the log below)')}`, t('正在启动…\n', 'Launching…\n'));
  if (need && javaMajorSel && javaMajorSel < need) {
    appendLog(`${t('⚠️ 该版本建议 Java ', '⚠️ This version recommends Java ')}${need}${t('，当前选的是 Java ', ', but Java ')}${javaMajorSel}${t('，可能启动失败', ', so the launch may fail')}\n`);
  }

  try {
    const assetsDir = $('mcAssets').value.trim() || undefined;
    const r = unwrap(
      await window.api.launchGame({
        mcFolder,
        versionId: selectedVersion.id,
        username,
        javaPath,
        maxMemory,
        assetsDir,
        useMsa: !!currentAccount,
      })
    );
    appendLog(`${t('[信息] Java: ', '[Info] Java: ')}${r.javaPath}\n${t('[信息] PID ', '[Info] PID ')}${r.pid}${t(' · 主类 ', ' · main class ')}${r.mainClass}${t(' · 依赖库 ' + r.classpathSize + ' 个', ' · ' + r.classpathSize + ' libraries')}\n`);
    if (r.missing && r.missing.length) {
      appendLog(`${t('[警告] 缺少 ' + r.missing.length + ' 个文件，游戏很可能立刻崩溃。建议先点「补全缺失文件」。', '[Warning] ' + r.missing.length + ' files are missing — the game will most likely crash immediately. Click "Repair missing files" first.')}\n`);
      setStatus(
        `${t('⚠️ 已启动进程，但缺少 ', '⚠️ The process started, but ')}<b>${r.missing.length}</b>${t(' 个文件，很可能立刻崩溃。<br>建议点上面的 ', ' files are missing — it will most likely crash immediately.<br>Click ')}<b>${t('补全缺失文件', 'Repair missing files')}</b>${t(' 自动下载依赖库。', ' above to download the libraries automatically.')}`,
        undefined
      );
      toast(t('缺少文件，建议先补全', 'Files are missing — repair them first'), 4000);
    } else {
      setStatus(
        `${t('✅ 已发送启动命令：', '✅ Launch command sent: ')}<b>${escapeHtml(selectedVersion.id)}</b>${t('（PID ', ' (PID ')}${r.pid}${t('）<br>游戏窗口稍后出现；若长时间没出现，请看下方日志。', ')<br>The game window appears shortly; if it does not, check the log below.')}`,
        undefined
      );
      toast(t('已启动，请稍候…', 'Launched, please wait…'));
    }
  } catch (e) {
    appendLog(t('启动失败：', 'Launch failed: ') + e.message + '\n');
    setStatus(t('❌ 启动失败：', '❌ Launch failed: ') + escapeHtml(e.message), undefined);
    toast(t('启动失败：', 'Launch failed: ') + e.message, 4000);
  }
}

// ---- 子标签：已安装 / 下载新版本（只作用于版本页，别碰其他页的子标签）----
document.querySelectorAll('#verTabs .subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#verTabs .subtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const sub = btn.dataset.sub;
    $('sub-installed').style.display = sub === 'installed' ? 'block' : 'none';
    $('sub-download').style.display = sub === 'download' ? 'block' : 'none';
  });
});

// ---- Mod 文件夹路径 ----
function copyText(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

function updateModsPath(ver) {
  const mc = $('mcFolder').value.trim();
  // 选中版本时用它自己的游戏目录（PCL 版本隔离 / 整合包实例各有各的 mods）
  const gd = (ver && ver.gameDir) || mc;
  if (!gd) return;
  const mods = gd.replace(/[\\/]+$/, '') + '\\mods';
  $('modsPathCard').style.display = 'block';
  $('modsPath').value = mods;

  let hint =
    t('把 mod 的 <b>.jar</b> 直接放进上面这个文件夹（不要解压）。', 'Put the mod <b>.jar</b> straight into the folder above (no need to unzip it).') +
    t('也可以在「资源下载」页面搜索后一键下载到这里。', 'You can also search on the Download Content page and install it here in one click.');
  if (ver) {
    const where = ver.isolated
      ? ver.isolatedBy === 'modpack'
        ? t('整合包独立实例', 'the modpack instance folder')
        : t('PCL 版本隔离目录', 'the isolated PCL version folder')
      : t('共享根目录（所有未隔离的版本共用）', 'the shared root folder (used by all non-isolated versions)');
    hint =
      `${t('当前选中 ', 'Selected: ')}<b>${escapeHtml(ver.id)}</b>${t('：这个版本的 mod 放在 ', ' — this version keeps its mods in ')}<b>${where}</b>${t('，', ', ')}` +
      `${t('里面有 ', 'with ')}<b>${ver.modCount || 0}</b>${t(' 个 mod', ' mods')}` +
      (ver.resourcepackCount ? `${t('、', ' · ')}${ver.resourcepackCount}${t(' 个资源包', ' resource packs')}` : '') +
      (ver.shaderpackCount ? `${t('、', ' · ')}${ver.shaderpackCount}${t(' 个光影', ' shaders')}` : '') +
      `${t('。', '.')}<br>` + hint;
  } else if (mc) {
    hint = t('⚠️ 上面显示的是<b>共享根目录</b>的 mods。PCL 开了「版本隔离」的版本，mod 在各自版本的目录里 —— 点一下版本列表里的版本就能看到它自己的路径。<br>', '⚠️ The path above is the <b>shared root</b> mods folder. Versions with PCL version isolation keep their mods in their own folder — click a version in the list to see its own path.<br>') + hint;
  }
  $('modsPathHint').innerHTML = hint;

  if (!$('modsDir').value.trim()) $('modsDir').value = mods;
  $('modsPathOpen').onclick = () => window.api.openPath(mods);
  $('modsPathCopy').onclick = () => toast(copyText(mods) ? t('已复制路径：', 'Path copied: ') + mods : mods, 4000);
}

// ---- 下载新版本 ----
let manifest = null;

$('dlLoad').addEventListener('click', () => loadManifest(false));
$('dlRefresh').addEventListener('click', () => loadManifest(true));
$('dlSearch').addEventListener('input', renderDownloadList);
$('dlType').addEventListener('change', renderDownloadList);

async function loadManifest(force) {
  $('dlStatus').textContent = t('正在获取官方版本清单…', 'Fetching the official version list…');
  $('dlList').innerHTML = '';
  try {
    manifest = unwrap(await window.api.versionManifest(force));
    $('dlStatus').innerHTML =
      `${t('官方清单共 ', 'Official list: ')}<b>${manifest.versions.length}</b>${t(' 个版本 · 最新正式版 ', ' versions · latest release ')}<b>${manifest.latest.release || '?'}</b>` +
      `${t(' · 最新快照 ', ' · latest snapshot ')}<b>${manifest.latest.snapshot || '?'}</b>`;
    renderDownloadList();
  } catch (e) {
    $('dlStatus').textContent = '';
    toast(t('获取清单失败：', 'Failed to fetch the list: ') + e.message, 4000);
  }
}

function renderDownloadList() {
  const el = $('dlList');
  el.innerHTML = '';
  if (!manifest) return;
  const q = $('dlSearch').value.trim().toLowerCase();
  const type = $('dlType').value;
  const mcFolder = $('mcFolder').value.trim();
  const installed = new Set(versions.map((v) => v.id));

  let list = manifest.versions;
  if (type === 'release') list = list.filter((v) => v.type === 'release');
  else if (type === 'snapshot') list = list.filter((v) => v.type === 'snapshot');
  else if (type === 'old') list = list.filter((v) => v.type === 'old_beta' || v.type === 'old_alpha');
  if (q) list = list.filter((v) => v.id.toLowerCase().includes(q));

  if (!list.length) {
    el.innerHTML = '<div class="hint">' + t('没有匹配的版本', 'No matching versions') + '</div>';
    return;
  }
  const show = list.slice(0, 250);
  if (list.length > show.length) {
    const tip = document.createElement('div');
    tip.className = 'hint';
    tip.textContent = `${t('共 ' + list.length + ' 个匹配，只显示前 ' + show.length + ' 个，请用搜索缩小范围', list.length + ' matches — showing the first ' + show.length + '; narrow it down with a search')}`;
    el.appendChild(tip);
  }

  show.forEach((v) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const has = installed.has(v.id);
    item.innerHTML = `
      <span class="tag ${v.type || 'unknown'}">${typeLabel(v.type)}</span>
      <div class="li-main">
        <div class="li-title">${escapeHtml(v.id)}${has ? ' <span class="badge">' + t('已安装', 'Installed') + '</span>' : ''}</div>
        <div class="li-sub">${t('发布于 ', 'Published ')}${v.releaseTime ? new Date(v.releaseTime).toLocaleString() : t('未知', 'unknown')}</div>
      </div>
      <button class="primary small" style="width:auto">${has ? t('重新下载', 'Download again') : t('下载并安装', 'Download and install')}</button>`;
    item.querySelector('button').addEventListener('click', (ev) => {
      ev.stopPropagation();
      downloadAndInstall(v, ev.target, mcFolder);
    });
    el.appendChild(item);
  });
}

async function downloadAndInstall(v, btn, mcFolder) {
  if (!mcFolder) return toast(t('请先选择 .minecraft 文件夹', 'Choose the .minecraft folder first'));
  const assetsDir = $('mcAssets').value.trim() || undefined;
  btn.disabled = true;
  btn.textContent = t('下载中…', 'Downloading…');
  setStatus(
    `${t('正在下载安装 ', 'Downloading and installing ')}<b>${escapeHtml(v.id)}</b>${t(' …<br>（版本 JSON → 客户端 jar → 依赖库 → 资源文件，可能要几分钟）', ' …<br>(version JSON → client jar → libraries → assets; this can take a few minutes)')}`,
    `${t('开始下载 ', 'Starting download of ')}${v.id}\n`
  );
  try {
    const r = unwrap(await window.api.downloadVersion(mcFolder, v.id, v.url, { includeAssets: !assetsDir, assetsDir }));
    appendLog(`\n${t('[完成] 依赖库 ', '[Done] Libraries ')}${r.done}/${r.total}${t('，失败 ', ', failed ')}${r.failed}\n`);
    if (r.assets) appendLog(`${t('[完成] 资源文件 ', '[Done] Assets ')}${r.assets.done}/${r.assets.total}${t('，失败 ', ', failed ')}${r.assets.failed}\n`);
    appendLog(r.launchable ? t('✅ 安装完成，可以启动了！\n', '✅ Installed — ready to launch!\n') : `${t('⚠️ 仍有缺失：', '⚠️ Still missing: ')}${r.reason || r.assetsReasonDetail || ''}\n`);
    btn.textContent = t('已安装', 'Installed');
    toast(r.launchable ? `${v.id}${t(' 安装完成，可以启动了', ' installed — ready to launch')}` : `${v.id}${t(' 下载完成，但仍有缺失', ' downloaded, but files are still missing')}`, 4500);
    await scanVersions();
    // 自动跳到已安装列表
    document.querySelector('.subtab[data-sub="installed"]').click();
  } catch (e) {
    appendLog(t('下载失败：', 'Download failed: ') + e.message + '\n');
    setStatus(t('❌ 下载失败：', '❌ Download failed: ') + escapeHtml(e.message), undefined);
    btn.disabled = false;
    btn.textContent = t('下载并安装', 'Download and install');
    toast(t('下载失败：', 'Download failed: ') + e.message, 4000);
  }
}

// ================================================================ 6. 资源下载（Mod / 整合包 / 资源包 / 光影包 / 数据包）

let modResults = [];
let currentKind = 'mod';
let packProgressEl = null;

const KIND_META = {
  mod: {
    label: 'Mod',
    folder: 'mods',
    get tip() {
      return t('下载到 .minecraft\\mods；要和游戏版本 + 加载器（Forge / Fabric）匹配', 'Downloads to .minecraft\\mods; must match the game version + loader (Forge / Fabric)');
    },
  },
  modpack: {
    get label() {
      return t('整合包', 'Modpack');
    },
    folder: null,
    get tip() {
      return t('整合包会装成一个【独立实例】（自己的 mods 和存档），不会污染你原来的版本；装完在「版本下载与启动」里就能看到它并直接启动', 'A modpack installs as its own instance (with its own mods and saves) and does not touch your existing versions; once installed it shows up in Versions & Launch, ready to start');
    },
  },
  resourcepack: {
    get label() {
      return t('资源包', 'Resource pack');
    },
    folder: 'resourcepacks',
    get tip() {
      return t('下载到 .minecraft\\resourcepacks，然后在游戏「选项 → 资源包」里启用', 'Downloads to .minecraft\\resourcepacks; enable it in-game under Options → Resource Packs');
    },
  },
  shader: {
    get label() {
      return t('光影包', 'Shader pack');
    },
    folder: 'shaderpacks',
    get tip() {
      return t('下载到 .minecraft\\shaderpacks；需要先装 Iris 或 OptiFine 才能生效', 'Downloads to .minecraft\\shaderpacks; install Iris or OptiFine first for it to take effect');
    },
  },
  datapack: {
    get label() {
      return t('数据包', 'Data pack');
    },
    folder: 'datapacks',
    get tip() {
      return t('默认下载到 .minecraft\\datapacks；只对某个存档生效的话，请改放到 saves\\<存档名>\\datapacks', 'Downloads to .minecraft\\datapacks by default; for a single world, put it in saves\\<world name>\\datapacks instead');
    },
  },
};

function mcFolderNow2() {
  return ($('mcFolder') && $('mcFolder').value.trim()) || config.mcFolder || '';
}

function defaultModsDir() {
  const mc = mcFolderNow2();
  const folder = (KIND_META[currentKind] || {}).folder;
  if (!mc) return '';
  return mc.replace(/[\\/]+$/, '') + '\\' + (folder || 'mods');
}

function applyKind() {
  const k = KIND_META[currentKind] || KIND_META.mod;
  $('kindTip').innerHTML = '📁 ' + escapeHtml(k.tip);
  const mc = mcFolderNow2();
  if (k.folder && mc) $('modsDir').value = mc.replace(/[\\/]+$/, '') + '\\' + k.folder;
  $('modLoader').style.display = currentKind === 'mod' ? '' : 'none';
  $('modGameVersion').style.display = currentKind === 'mod' || currentKind === 'modpack' ? '' : 'none';
  $('modResults').innerHTML = '';
  $('modStatus').textContent = '';
  // 换分类就重置"安装到已装版本"
  const sel = $('modTarget');
  if (sel) {
    sel.innerHTML = '<option value="">' + t('（不指定，就用上面的「下载到」文件夹）', '(none — use the "Download to" folder above)') + '</option>';
    $('modTargetHint').textContent =
      currentKind === 'modpack'
        ? t('整合包装成独立实例，不需要指定目标版本', 'A modpack installs as its own instance — no target version needed')
        : t('点「自动检测」会扫描你已安装的版本，自动挑一个匹配的装进去', 'Auto-detect scans your installed versions and picks a matching one');
  }
  $('modQuery').placeholder =
    currentKind === 'modpack'
      ? t('搜索整合包，例如 cobblemon / better mc', 'Search modpacks, e.g. cobblemon / better mc')
      : currentKind === 'resourcepack'
      ? t('搜索资源包，例如 faithful / 汉化', 'Search resource packs, e.g. faithful / translations')
      : currentKind === 'shader'
      ? t('搜索光影，例如 complementary / bsl', 'Search shaders, e.g. complementary / bsl')
      : currentKind === 'datapack'
      ? t('搜索数据包，例如 recipes / terralith', 'Search data packs, e.g. recipes / terralith')
      : t('搜索 mod，例如 sodium / jei', 'Search mods, e.g. sodium / jei');
}

document.querySelectorAll('#kindTabs .kind-tab').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#kindTabs .kind-tab').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    currentKind = b.dataset.kind;
    applyKind();
  });
});

$('modsPickDir').addEventListener('click', async () => {
  const d = unwrap(await window.api.pickModsDir($('modsDir').value.trim() || defaultModsDir()));
  if (!d) return;
  $('modsDir').value = d;
  config.modsDir = d;
  unwrap(await window.api.saveModConfig(config));
  toast(t('下载目录已设为：', 'Download folder set to: ') + d, 3500);
});

$('modSearch').addEventListener('click', async () => {
  const source = $('modSource').value;
  const query = $('modQuery').value.trim();
  const gameVersion = $('modGameVersion').value.trim();
  const loader = currentKind === 'mod' ? $('modLoader').value : '';
  $('modStatus').textContent = t('搜索中…', 'Searching…');
  $('modResults').innerHTML = '';
  try {
    const r = unwrap(
      await window.api.searchMods({ source, query, gameVersion, loader, limit: 20, kind: currentKind })
    );
    modResults = r || [];
    const dir = $('modsDir').value.trim() || defaultModsDir();
    $('modStatus').textContent =
      `${(KIND_META[currentKind] || {}).label}${t(' · 找到 ', ' · ')}${modResults.length}${t(' 个结果（', ' results (')}${source === 'modrinth' ? 'Modrinth' : 'CurseForge'}${t('）', ')')}` +
      (currentKind === 'modpack' ? t(' · 会安装成独立实例', ' · installs as its own instance') : `${t(' · 下载目录：', ' · download folder: ')}${dir || t('未设置', 'not set')}`);
    renderModResults();
  } catch (e) {
    $('modStatus').textContent = '';
    toast(t('搜索失败：', 'Search failed: ') + e.message, 4000);
  }
});

$('modQuery').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('modSearch').click();
});

// ---- 自动检测安装目标（已安装的 MC 版本）----
$('modDetect').addEventListener('click', detectInstallTargets);

async function detectInstallTargets() {
  const mcFolder = mcFolderNow2();
  if (!mcFolder) return toast(t('请先在「版本下载与启动」里选好 .minecraft 目录', 'Choose your .minecraft folder in Versions & Launch first'));
  if (currentKind === 'modpack') return toast(t('整合包是装成独立实例的，不用指定目标', 'A modpack installs as its own instance — no target needed'));
  const k = KIND_META[currentKind] || {};
  $('modTargetHint').textContent = t('正在扫描已安装的版本…', 'Scanning installed versions…');
  try {
    const r = unwrap(
      await window.api.detectTargets(mcFolder, {
        kind: currentKind,
        folder: k.folder || 'mods',
        gameVersion: $('modGameVersion').value.trim(),
        loader: currentKind === 'mod' ? $('modLoader').value : '',
      })
    );
    const sel = $('modTarget');
    sel.innerHTML = '<option value="">' + t('（不指定，就用上面的「下载到」文件夹）', '(none — use the "Download to" folder above)') + '</option>';
    (r.targets || []).forEach((tg) => {
      const o = document.createElement('option');
      o.value = tg.targetDir;
      o.textContent =
        `${tg.versionId}${t('（MC ', '(MC ')}${tg.baseVersion}${tg.loader ? ' · ' + tg.loader : ''}` +
        `${tg.isolated ? t(' · 独立目录', ' · isolated folder') : t(' · 共享根目录', ' · shared root folder')}${tg.exists ? '' : t(' · 文件夹待创建', ' · folder will be created')}${t('）', ')')}`;
      sel.appendChild(o);
    });
    if (r.best) {
      sel.value = r.best.targetDir;
      $('modsDir').value = r.best.targetDir;
      $('modTargetHint').innerHTML =
        `✅ ${t('自动选中 ', 'auto-selected ')}<b>${escapeHtml(r.best.versionId)}</b> → <b>${escapeHtml(r.best.targetDir)}</b><br>${escapeHtml(r.best.reason)}`;
    } else {
      $('modTargetHint').innerHTML =
        t('没找到匹配的已安装版本 —— 可以在左边填「游戏版本」再检测，或者直接用上面的「下载到」文件夹', 'No matching installed version — fill in the game version on the left and detect again, or just use the "Download to" folder above');
    }
  } catch (e) {
    $('modTargetHint').textContent = t('检测失败：', 'Detection failed: ') + e.message;
  }
}

// ---- 手动指定 mods 目录（有些 mod 找不到时用）----
$('modsPathPick').addEventListener('click', async () => {
  const d = unwrap(
    await window.api.pickDir(t('选择 mods 文件夹（里面放 .jar）', 'Choose the mods folder (put .jar files inside)'), $('modsPath').value.trim() || undefined)
  );
  if (!d) return;
  $('modsPath').value = d;
  $('modsDir').value = d;
  $('modTarget').value = '';
  config.modsDir = d;
  try {
    unwrap(await window.api.saveModConfig(config));
  } catch (e) {
    /* ignore */
  }
  $('modsPathHint').innerHTML = t('✅ <b>已手动指定</b>这个 mods 目录，下载也会放到这里。<br>', '✅ This mods folder was set manually — downloads go here too.<br>') + $('modsPathHint').innerHTML;
  toast(t('已指定 mods 目录：', 'mods folder set to: ') + d, 4200);
});

function renderModResults() {
  const el = $('modResults');
  el.innerHTML = '';
  modResults.forEach((m) => {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.innerHTML = `
      <div class="mod-head">
        ${m.icon ? `<img class="mod-icon" src="${m.icon}" onerror="this.style.visibility='hidden'">` : '<div class="mod-icon"></div>'}
        <div class="grow">
          <div class="mod-title">${escapeHtml(m.title)}</div>
          <div class="mod-author">${escapeHtml(m.author || '')} · ⬇ ${(m.downloads || 0).toLocaleString()}</div>
        </div>
      </div>
      <div class="mod-desc">${escapeHtml(m.description || '')}</div>
      <div class="mod-foot">
        <span class="hint">${(m.versions || []).slice(0, 3).map((v) => escapeHtml(v)).join(' · ')}</span>
        <button class="primary" style="padding:6px 13px">${t('选择版本', 'Choose version')}</button>
      </div>
      <div class="hint mod-result" style="display:none; word-break:break-all"></div>
      <div class="mod-versions" style="display:none; max-height:260px; overflow:auto"></div>`;
    card.querySelector('button').addEventListener('click', () => showModVersions(m, card));
    el.appendChild(card);
  });
}

async function showModVersions(m, card) {
  const btn = card.querySelector('button');
  const box = card.querySelector('.mod-versions');
  if (box.style.display === 'block') {
    box.style.display = 'none';
    btn.textContent = t('选择版本', 'Choose version');
    return;
  }
  btn.disabled = true;
  btn.textContent = t('获取中…', 'Fetching…');
  const gameVersion = $('modGameVersion').value.trim();
  const loader = $('modLoader').value;
  try {
    const list = unwrap(await window.api.modVersions({ source: m.source, projectId: m.id, gameVersion, loader }));
    if (!list || !list.length) throw new Error(t('没有匹配该游戏版本 / 加载器的文件', 'No files match that game version / loader'));
    box.innerHTML = '';
    list.slice(0, 30).forEach((v) => {
      const row = document.createElement('div');
      row.className = 'list-item';
      row.style.padding = '7px 10px';
      const size = v.size ? (v.size / 1024 / 1024).toFixed(1) + ' MB' : '';
      row.innerHTML = `
        <div class="li-main">
          <div class="li-title" style="font-size:12.6px">${escapeHtml(v.name || v.fileName || String(v.versionNumber))}</div>
          <div class="li-sub">${escapeHtml(v.fileName || '')}${size ? ' · ' + size : ''} · ${(v.gameVersions || []).slice(0, 4).join(', ')}</div>
        </div>
        <button class="primary" style="padding:5px 11px;font-size:12px">${t('下载', 'Download')}</button>`;
      row.querySelector('button').addEventListener('click', (ev) => {
        ev.stopPropagation();
        downloadModFile(m, v, card, ev.target);
      });
      box.appendChild(row);
    });
    box.style.display = 'block';
    btn.textContent = t('收起', 'Collapse');
  } catch (e) {
    box.innerHTML = '<div class="hint">' + t('获取失败：', 'Failed to fetch: ') + escapeHtml(e.message) + '</div>';
    box.style.display = 'block';
    btn.textContent = t('收起', 'Collapse');
  } finally {
    btn.disabled = false;
  }
}

async function downloadModFile(m, v, card, btn) {
  if (currentKind === 'modpack') return installModpackFromSearch(m, v, card, btn);
  const res = card.querySelector('.mod-result');
  // 优先用"自动检测到的目标版本"，其次手动「下载到」
  const target = $('modTarget') ? $('modTarget').value.trim() : '';
  const dir = target || $('modsDir').value.trim() || defaultModsDir();
  if (!dir) {
    toast(t('请先设置下载目录，或点「自动检测」选一个已装版本', 'Set a download folder first, or click "Auto-detect" to pick an installed version'));
    return;
  }
  res.style.display = 'block';
  res.innerHTML =
    t('正在下载到：', 'Downloading to: ') + escapeHtml(dir) +
    (target ? '<br><span class="hint">' + t('（已自动匹配到对应的 MC 版本目录）', '(matched to the matching MC version folder automatically)') + '</span>' : '') +
    ' …';
  if (btn) btn.disabled = true;
  try {
    const r = unwrap(
      await window.api.installMod({
        source: m.source,
        projectId: m.id,
        versionId: v.versionId,
        modsDir: dir,
        kind: currentKind,
      })
    );
    res.innerHTML =
      `${t('✅ 已下载：', '✅ Downloaded: ')}<b>${escapeHtml(r.dest)}</b> (${(r.size / 1024 / 1024).toFixed(1)} MB) ` +
      `<button class="ghost small" style="width:auto;margin-left:6px">${t('打开文件夹', 'Open folder')}</button>`;
    res.querySelector('button').addEventListener('click', () => window.api.reveal(r.dest));
    toast(t('已下载 ', 'Downloaded ') + r.fileName);
  } catch (e) {
    res.innerHTML = t('❌ 下载失败：', '❌ Download failed: ') + escapeHtml(e.message);
    toast(t('下载失败：', 'Download failed: ') + e.message, 4000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** 整合包：下载 .mrpack / .zip 并安装成独立实例 */
async function installModpackFromSearch(m, v, card, btn) {
  const mcFolder = mcFolderNow2();
  if (!mcFolder) return toast(t('请先在「版本下载与启动」里选好 .minecraft 文件夹', 'Choose your .minecraft folder in Versions & Launch first'));
  const res = card.querySelector('.mod-result');
  res.style.display = 'block';
  res.innerHTML = `${t('正在下载并安装整合包：', 'Downloading and installing modpack: ')}<b>${escapeHtml(m.title)}</b>…<br><span id="packProgress" class="hint">${t('准备中…', 'Preparing…')}</span>`;
  if (btn) btn.disabled = true;
  packProgressEl = 'packProgress';
  try {
    const r = unwrap(
      await window.api.installPackFromUrl({
        source: m.source,
        projectId: m.id,
        versionId: v.versionId,
        mcFolder,
      })
    );
    res.innerHTML =
      `✅ ${t('整合包已安装为<b>独立实例</b>：', 'Modpack installed as <b>its own instance</b>: ')}<b>${escapeHtml(r.instanceId)}</b><br>` +
      `${t('基础版本 Minecraft ', 'Base version Minecraft ')}${escapeHtml(r.mcVersion || '')}${t(' · 加载器 ', ' · loader ')}${escapeHtml(String(r.parentId || ''))}<br>` +
      `${t('文件 ', 'Files ')}${r.done}/${r.total}${r.failed ? `${t('，失败 ', ', failed ')}${r.failed}` : ''}<br>` +
      `<span class="hint">${t('去「版本下载与启动」找这个名字就能启动它', 'Find this name in Versions & Launch to start it')}</span><br>` +
      `<button class="ghost small" style="width:auto;margin-top:6px">${t('打开实例文件夹', 'Open instance folder')}</button>`;
    res.querySelector('button').addEventListener('click', () => window.api.openPath(r.instanceDir));
    toast(t('整合包安装完成：', 'Modpack installed: ') + r.instanceId, 5000);
    await scanVersions();
  } catch (e) {
    res.innerHTML = t('❌ 安装失败：', '❌ Install failed: ') + escapeHtml(e.message);
    toast(t('安装失败：', 'Install failed: ') + e.message, 7000);
  } finally {
    packProgressEl = null;
    if (btn) btn.disabled = false;
  }
}

// ================================================================ 7. 异地联机

let lanEnv = null;
let vpnMeta = null;
let pickedVpn = null;
let tunnelClientList = [];
let pickedTunnel = null;
let pickedIp = null;
let portTimer = null;
let lastPort = null;

function rlog(line) {
  const el = $('rmLog');
  el.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

document.querySelectorAll('#remoteTabs .subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#remoteTabs .subtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const t = btn.dataset.rtab;
    $('rtab-host').style.display = t === 'host' ? 'block' : 'none';
    $('rtab-client').style.display = t === 'client' ? 'block' : 'none';
    if (t === 'client') fillClientVersions();
  });
});

$('rmMode').addEventListener('change', applyMode);
function applyMode() {
  const m = $('rmMode').value;
  $('rmLanBox').style.display = m === 'lan' ? 'block' : 'none';
  $('rmTunnelBox').style.display = m === 'tunnel' ? 'block' : 'none';
  $('rmModeHint').innerHTML =
    m === 'lan'
      ? t('虚拟组网：<b>双方都要连同一个虚拟网络</b>（Radmin / ZeroTier / Tailscale），之后用虚拟 IP 直连，延迟最低、最稳定。', 'Virtual LAN: <b>both sides must join the same virtual network</b> (Radmin / ZeroTier / Tailscale), then connect directly over the virtual IP — lowest latency and the most stable.')
      : t('内网穿透：<b>只有房主需要装工具</b>，朋友用普通 IP:端口 直接连。延迟略高，免费版地址可能会变（变了要重新发）。', 'Tunneling: <b>only the host installs anything</b>; friends connect with a plain IP:port. Latency is a bit higher and free-tier addresses can change (resend it if it does).');
}

$('rmRefreshNet').addEventListener('click', loadRemoteEnv);

async function loadRemoteEnv() {
  $('rmVpnList').innerHTML = '<div class="hint">' + t('检测中…', 'Detecting…') + '</div>';
  try {
    if (!vpnMeta) vpnMeta = unwrap(await window.api.vpnInfo());
  } catch (e) {
    /* ignore */
  }
  try {
    lanEnv = unwrap(await window.api.lanOverview());
    renderVpnList();
    renderTsState();
    rlog(t('环境检测完成', 'Environment check finished'));
  } catch (e) {
    $('rmVpnList').innerHTML = '<div class="hint">' + t('检测失败：', 'Detection failed: ') + escapeHtml(e.message) + '</div>';
  }
  try {
    tunnelClientList = unwrap(await window.api.tunnelClients()) || [];
    renderTunnelList();
  } catch (e) {
    /* ignore */
  }
  await checkFw(true);
}

function renderTsState() {
  const ts = lanEnv && lanEnv.tailscale;
  const el = $('rmTsState');
  if (!el) return;
  if (!ts) {
    el.textContent = '';
    return;
  }
  if (!ts.installed) {
    el.innerHTML =
      t('状态：<span style="color:#c0392b"><b>未安装</b></span> —— 这就是你点「启动并登录」提示「未检测到 Tailscale」的原因。<br>', 'Status: <span style="color:#c0392b"><b>not installed</b></span> — this is why "Start and sign in" reports "Tailscale not found".<br>') +
      t('先点下面的 <b>「下载并安装 Tailscale」</b>（会自动下载官方安装包并启动安装程序）。', 'First click <b>"Download and install Tailscale"</b> below (it downloads the official installer and starts it).');
  } else if (!ts.running) {    el.innerHTML =
      t('状态：<span style="color:#b8860b"><b>已安装，但未登录 / 未启动</b></span> —— 点「启动并登录」，浏览器会打开让你登录。', 'Status: <span style="color:#b8860b"><b>installed, but not signed in / not running</b></span> — click "Start and sign in"; the browser opens so you can sign in.');
  } else {
    el.innerHTML =
      t('状态：<span style="color:#1a7f37"><b>已就绪</b></span>', 'Status: <span style="color:#1a7f37"><b>ready</b></span>') +
      (ts.ip ? t(' · 虚拟 IP: ', ' · virtual IP: ') + '<b>' + escapeHtml(ts.ip) + '</b>' : '');
  }
  // 装好了就不必再显示安装按钮，突出「启动并登录」
  $('rmTsInstall').style.display = ts.installed ? 'none' : 'inline-flex';
  $('rmTsUp').className = ts.installed ? 'primary' : 'ghost';
}

function renderVpnList() {
  const el = $('rmVpnList');
  const v = lanEnv;
  if (!v) return;
  const meta = vpnMeta || {};
  const tools = [v.radmin, v.zerotier, v.tailscale];

  const rows = tools.map((o) => {
    const m = meta[o.id] || {};
    const installed = !!o.installed;
    const ready = installed && !!o.ip;
    const tag = ready
      ? '<span class="tag release">' + t('已就绪', 'Ready') + '</span>'
      : installed
      ? '<span class="tag snapshot">' + t('已安装·未连接', 'Installed · not connected') + '</span>'
      : '<span class="tag unknown">' + t('未安装', 'Not installed') + '</span>';

    const badges = [];
    if (o.id === 'radmin' && ready) badges.push('<span class="badge">' + t('推荐 · 你已装好', 'Recommended · already installed') + '</span>');
    if (m.needAccount) badges.push('<span class="badge">' + t('需注册账号', 'Account required') + '</span>');
    else if (installed) badges.push('<span class="badge">' + t('无需账号', 'No account needed') + '</span>');

    const acts = [];
    if (o.ip) {
      acts.push(`<button class="primary small" style="width:auto" data-ip="${escapeHtml(o.ip)}" data-id="${o.id}">${t('用这个 IP', 'Use this IP')}</button>`);
    }
    if (!installed) {
      if (m.installer) acts.push(`<button class="primary small" style="width:auto" data-install="${o.id}">${t('下载安装', 'Download installer')}</button>`);
      if (m.page) acts.push(`<button class="ghost small" style="width:auto" data-page="${escapeHtml(m.page)}">${t('去官网下载', 'Download from the official site')}</button>`);
    }
    acts.push(`<button class="ghost small" style="width:auto" data-guide="${o.id}">${t('怎么用？', 'How do I use it?')}</button>`);

    return `
      <div class="list-item" style="cursor:default">
        ${tag}
        <div class="li-main">
          <div class="li-title">${escapeHtml(o.name)} ${badges.join(' ')}</div>
          <div class="li-sub">${escapeHtml(m.why || o.note || '')}${
      o.ip ? '<br>' + t('虚拟 IP: ', 'virtual IP: ') + '<b>' + escapeHtml(o.ip) + '</b>' : ''
    }</div>
        </div>
        ${acts.join('')}
      </div>`;
  });
  el.innerHTML = rows.join('');

  el.querySelectorAll('[data-ip]').forEach((b) =>
    b.addEventListener('click', () => {
      pickedIp = b.dataset.ip;
      pickedVpn = b.dataset.id;
      renderGuide(pickedVpn);
      toast(t('已选择虚拟 IP：', 'Virtual IP selected: ') + pickedIp + t('（', ' (') + b.dataset.id + t('）', ')'));
      buildAddress();
    })
  );
  el.querySelectorAll('[data-install]').forEach((b) =>
    b.addEventListener('click', () => installVpnTool(b.dataset.install))
  );
  el.querySelectorAll('[data-page]').forEach((b) =>
    b.addEventListener('click', () => window.api.openPath(b.dataset.page))
  );
  el.querySelectorAll('[data-guide]').forEach((b) =>
    b.addEventListener('click', () => {
      pickedVpn = b.dataset.guide;
      renderGuide(pickedVpn);
      $('rmGuide').scrollIntoView({ behavior: 'smooth', block: 'center' });
    })
  );

  // 自动选一个"已经装好并且拿到 IP"的
  const first = tools.find((x) => x && x.ip);
  if (first && !pickedIp) {
    pickedIp = first.ip;
    pickedVpn = first.id;
    renderGuide(pickedVpn);
    rlog(t('自动选用虚拟 IP：', 'Using virtual IP automatically: ') + pickedIp + t('（', ' (') + first.name + t('）', ')'));
    buildAddress();
  } else if (!pickedVpn) {
    const anyInstalled = tools.find((x) => x && x.installed);
    renderGuide((anyInstalled || tools[0]).id);
  }
}

function renderGuide(id) {
  const m = (vpnMeta || {})[id];
  const el = $('rmGuide');
  if (!m) {
    el.innerHTML = '<div class="hint">' + t('点上面任意一个工具的「怎么用？」看详细步骤', 'Click "How do I use it?" on any tool above to see the detailed steps') + '</div>';
    return;
  }
  const indent = (s) => escapeHtml(s).replace(/^ +/, (sp) => '&nbsp;'.repeat(sp.length * 2));
  el.innerHTML =
    `<div class="li-title" style="margin-bottom:4px">${escapeHtml(m.name)}${
      m.needAccount ? t('（需要注册账号）', ' (account required)') : t('（不需要注册账号）', ' (no account needed)')
    }</div>` +
    `<ol style="margin:0 0 0 20px; line-height:1.95">${m.steps.map((s) => '<li>' + indent(s) + '</li>').join('')}</ol>` +
    (m.tip ? `<div class="hint" style="margin-top:8px">💡 ${escapeHtml(m.tip)}</div>` : '') +
    (m.console
      ? `<div class="row" style="margin-top:8px"><button class="ghost small" style="width:auto" data-open="${escapeHtml(
          m.console
        )}">${t('打开后台管理页', 'Open the console page')}</button></div>`
      : '');
  const ob = el.querySelector('[data-open]');
  if (ob) ob.addEventListener('click', () => window.api.openPath(ob.dataset.open));
}

async function installVpnTool(id) {
  const m = (vpnMeta || {})[id] || {};
  rlog(t('开始下载安装 ', 'Downloading and installing ') + (m.name || id) + ' …');
  toast(t('正在下载安装包，请稍候…', 'Downloading the installer, please wait…'), 4000);
  try {
    unwrap(await window.api.installVpn(id));
    rlog((m.name || id) + t(' 安装程序已结束，正在重新检测…', ' installer finished — re-detecting…'));
    toast(t('安装完成，正在重新检测', 'Installed — re-detecting'));
    await loadRemoteEnv();
  } catch (e) {
    rlog(t('安装失败：', 'Install failed: ') + e.message);
    toast(e.message, 6000);
    if (m.page) window.api.openPath(m.page);
  }
}

$('rmTsInstall').addEventListener('click', () => installVpnTool('tailscale'));
$('rmZtSite').addEventListener('click', () => window.api.openPath('https://my.zerotier.com'));
$('rmZtAuth').addEventListener('click', () => window.api.openPath('https://my.zerotier.com'));

$('rmZtJoin').addEventListener('click', async () => {
  const id = $('rmZtId').value.trim();
  const zt = lanEnv && lanEnv.zerotier;
  if (!id) return toast(t('先把 my.zerotier.com 给你的 16 位编号粘到输入框里', 'Paste the 16-character network ID from my.zerotier.com into the box first'));
  if (!zt || !zt.installed) {
    rlog(t('ZeroTier 未安装，无法加入网络', 'ZeroTier is not installed — cannot join the network'));
    toast(t('还没装 ZeroTier 客户端 —— 请先点「去官网下载」装好，再回来加入网络', 'The ZeroTier client is not installed — click "Download from the official site", install it, then join the network'), 6000);
    return;
  }
  rlog(t('正在加入 ZeroTier 网络 ', 'Joining the ZeroTier network ') + id + ' …');
  try {
    const r = unwrap(await window.api.zerotierJoin(id));
    rlog('ZeroTier: ' + (r.output || t('已发送加入请求', 'join request sent')));
    $('rmZtHint').innerHTML =
      t('✅ 已发送加入请求。现在去 <b>my.zerotier.com</b> 的 Members 列表，勾选新设备前面的 <b>Auth</b> 复选框授权，否则连不通。', '✅ Join request sent. Now open the Members list on <b>my.zerotier.com</b> and tick the <b>Auth</b> box next to the new device, otherwise it will not connect.');
    setTimeout(loadRemoteEnv, 2500);
  } catch (e) {
    rlog(t('加入失败：', 'Join failed: ') + e.message);
    $('rmZtHint').innerHTML = '<span style="color:#c0392b">' + escapeHtml(e.message) + '</span>';
    toast(e.message, 6000);
  }
});

$('rmTsUp').addEventListener('click', async () => {
  const ts = lanEnv && lanEnv.tailscale;
  if (!ts || !ts.installed) {
    renderTsState();
    rlog(t('Tailscale 未安装，无法启动', 'Tailscale is not installed — cannot start it'));
    toast(t('还没装 Tailscale —— 请先点左边的「下载并安装」', 'Tailscale is not installed — click "Download and install" on the left first'), 6000);
    return;
  }
  rlog(t('正在启动 Tailscale（可能会弹出浏览器让你登录）…', 'Starting Tailscale (your browser may open so you can sign in)…'));
  try {
    const r = unwrap(await window.api.tailscaleUp());
    rlog('Tailscale: ' + (r.output || 'ok'));
    setTimeout(loadRemoteEnv, 3000);
  } catch (e) {
    rlog(t('Tailscale 启动失败：', 'Failed to start Tailscale: ') + e.message);
    toast(e.message, 5000);
  }
});

// ---- 穿透 ----
function renderTunnelList() {
  const el = $('rmTunnelList');
  el.innerHTML = '';
  tunnelClientList.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.style.cursor = 'default';
    item.innerHTML = `
      <span class="tag ${c.installed ? 'release' : 'unknown'}">${c.installed ? t('已安装', 'Installed') : t('未安装', 'Not installed')}</span>
      <div class="li-main">
        <div class="li-title">${escapeHtml(c.name)}${pickedTunnel === c.id ? ' <span class="badge">' + t('已选用', 'In use') + '</span>' : ''}</div>
        <div class="li-sub">${escapeHtml(c.note || '')}${c.path ? '<br>' + escapeHtml(c.path) : ''}</div>
      </div>
      ${
        c.installed
          ? `<button class="primary small" style="width:auto" data-use="${c.id}">${t('用这个', 'Use this one')}</button>
             <button class="ghost small" style="width:auto" data-open="${escapeHtml(c.download)}">${t('官网', 'Official site')}</button>`
          : `<button class="primary small" style="width:auto" data-dl="${c.id}">${t('自动下载', 'Auto-download')}</button>
             <button class="ghost small" style="width:auto" data-pick="${c.id}">${t('手动指定', 'Set manually')}</button>
             <button class="ghost small" style="width:auto" data-open="${escapeHtml(c.download)}">${t('官网', 'Official site')}</button>`
      }`;
    const use = item.querySelector('[data-use]');
    if (use) use.addEventListener('click', () => { pickedTunnel = c.id; renderTunnelList(); toast(t('已选用 ', 'Now using ') + c.name); });
    const dl = item.querySelector('[data-dl]');
    if (dl) dl.addEventListener('click', () => installTunnel(c));
    const pick = item.querySelector('[data-pick]');
    if (pick) pick.addEventListener('click', async () => {
      const p = unwrap(await window.api.pickFile(t('选择 ', 'Choose ') + c.exe, [{ name: t('可执行文件', 'Executable'), extensions: ['exe'] }]));
      if (!p) return;
      c.path = p; c.installed = true; pickedTunnel = c.id;
      renderTunnelList();
      toast(t('已指定：', 'Set to: ') + p, 4000);
    });
    const open = item.querySelector('[data-open]');
    if (open) open.addEventListener('click', () => window.api.openPath(open.dataset.open));
    el.appendChild(item);
  });
}

async function installTunnel(c) {
  rlog(t('开始下载 ', 'Downloading ') + c.name + t(' …（从官方源，可能要一会儿）', ' … (from the official source, this may take a while)'));
  try {
    const r = unwrap(await window.api.tunnelInstall(c.id));
    rlog((r.already ? t('已存在：', 'Already present: ') : t('下载完成：', 'Downloaded: ')) + r.path);
    toast(c.name + t(' 就绪', ' is ready'));
    await loadRemoteEnv();
  } catch (e) {
    rlog(t('下载失败：', 'Download failed: ') + e.message + t('（可点「官网」手动下载，再用「手动指定」选路径）', ' (you can download it from the official site and then use "Set manually")'));
    toast(t('下载失败：', 'Download failed: ') + e.message, 5000);
  }
}

$('rmPickCfg').addEventListener('click', async () => {
  const p = unwrap(await window.api.pickFile(t('选择 frpc 配置文件', 'Choose the frpc config file'), [{ name: t('frp 配置', 'frp config'), extensions: ['toml', 'ini', 'yaml', 'yml'] }]));
  if (p) $('rmFrpCfg').value = p;
});

$('rmTunnelStart').addEventListener('click', async () => {
  if (!pickedTunnel) return toast(t('请先选一个穿透工具', 'Pick a tunneling tool first'));
  const port = Number($('rmPort').value);
  if (!port) return toast(t('请先填/读取本地端口', 'Enter or read the local port first'));
  try {
    const r = unwrap(
      await window.api.tunnelStart({
        id: pickedTunnel,
        port,
        token: $('rmToken').value.trim(),
        configPath: $('rmFrpCfg').value.trim(),
      })
    );
    rlog(t('已启动：', 'Started: ') + r.mode + t('（PID ', ' (PID ') + r.pid + t('）', ')'));
    $('rmTunnelHint').textContent = t('运行中，等待分配公网地址…', 'Running — waiting for a public address…');
    toast(t('穿透已启动，等待地址…', 'Tunnel started — waiting for an address…'));
  } catch (e) {
    rlog(t('启动失败：', 'Launch failed: ') + e.message);
    toast(e.message, 5000);
  }
});

$('rmTunnelStop').addEventListener('click', async () => {
  if (!pickedTunnel) return;
  unwrap(await window.api.tunnelStop(pickedTunnel));
  rlog(t('已停止穿透', 'Tunnel stopped'));
  $('rmTunnelHint').textContent = '';
});

async function pollTunnel() {
  if (!pickedTunnel) return;
  try {
    const st = unwrap(await window.api.tunnelStatus(pickedTunnel));
    if (st && st.running && st.address) {
      const addr = st.address.host + ':' + st.address.port;
      $('rmTunnelHint').innerHTML = t('公网地址：', 'Public address: ') + '<b>' + escapeHtml(addr) + '</b>';
      pickedIp = st.address.host;
      $('rmPort').value = st.address.port;
      if ($('srvPublicAddr')) {
        $('srvPublicAddr').value = addr;
        $('srvTunnelHint').innerHTML =
          t('✅ 公网地址就绪：', '✅ Public address ready: ') + '<b>' + escapeHtml(addr) + '</b><br>' +
          t('朋友在 MC 的「多人游戏 → 直接连接」里输入这个地址就能进，<b>不用装任何东西</b>。', 'Friends can just enter this address in Minecraft under Multiplayer → Direct Connect — <b>they install nothing</b>.');
      }
    }
    if (st && st.claim) {
      $('rmTunnelHint').innerHTML += `<br>${t('需要在浏览器认领隧道：', 'Claim the tunnel in your browser: ')}<b>${escapeHtml(st.claim)}</b>`;
      if ($('srvTunnelHint')) {
        $('srvTunnelHint').innerHTML += `<br>👉 ${t('请打开这个链接认领一次：', 'Open this link to claim it once: ')}<b>${escapeHtml(st.claim)}</b>`;
      }
    }
  } catch (e) {
    /* ignore */
  }
}

// ---- 端口 ----
function mcFolderNow() {
  return $('mcFolder').value.trim() || config.mcFolder || '';
}

$('rmReadPort').addEventListener('click', () => readPortOnce(true));

async function readPortOnce(verbose) {
  const folder = mcFolderNow();
  if (!folder) { if (verbose) toast(t('请先在「版本下载与启动」里选好 .minecraft 目录', 'Choose your .minecraft folder in Versions & Launch first')); return; }
  const r = unwrap(await window.api.readLanPort(folder));
  if (r.found) {
    if (lastPort !== r.port) {
      lastPort = r.port;
      $('rmPort').value = r.port;
      $('rmPortHint').innerHTML = `${t('已读到端口 ', 'Port found: ')}<b>${r.port}</b>${t('（来自日志：', ' (from the log: ')}${escapeHtml(r.line.slice(0, 70))}${t('）', ')')}`;
      rlog(t('读到局域网端口：', 'LAN port read: ') + r.port);
      buildAddress();
    }
  } else if (verbose) {
    $('rmPortHint').innerHTML = escapeHtml(r.reason || t('没读到端口', 'no port found'));
  }
}

$('rmWatchPort').addEventListener('click', () => {
  if (portTimer) {
    clearInterval(portTimer);
    portTimer = null;
    $('rmWatchPort').textContent = t('持续监听', 'Keep watching');
    rlog(t('已停止监听端口', 'Stopped watching the port'));
    return;
  }
  portTimer = setInterval(readPortOnce, 2500);
  $('rmWatchPort').textContent = t('停止监听', 'Stop watching');
  rlog(t('开始监听 logs/latest.log 里的「对局域网开放」端口…', 'Watching logs/latest.log for the "Open to LAN" port…'));
  toast(t('正在监听，去游戏里点「对局域网开放」即可自动读到', 'Watching now — press "Open to LAN" in-game and the port is picked up automatically'));
  readPortOnce(false);
});

// ---- 生成地址 ----
async function buildAddress() {
  const port = Number($('rmPort').value);
  if (!pickedIp || !port) {
    if (!pickedIp) toast(t('还没选到虚拟 IP，请先点「用这个 IP」', 'No virtual IP selected yet — click "Use this IP" first'));
    return;
  }
  $('rmAddr').value = pickedIp + ':' + port;
  const mcFolder = mcFolderNow();
  let fp = null;
  const vid = selectedVersion ? selectedVersion.id : null;
  if (mcFolder && vid) {
    try { fp = unwrap(await window.api.lanFingerprint(mcFolder, vid)); } catch (e) {}
  }
  const modeText = $('rmMode').value === 'lan' ? t('虚拟组网直连', 'Virtual LAN direct') : t('内网穿透', 'Tunneling');
  const txt = unwrap(await window.api.buildShare({ address: pickedIp, port, mode: modeText, fp, note: '' }));
  $('rmShare').style.display = 'block';
  $('rmShare').textContent = txt;
  $('rmCopy').dataset.text = txt;
  rlog(t('已生成联机地址：', 'Join address generated: ') + pickedIp + ':' + port);
}

$('rmBuild').addEventListener('click', buildAddress);

$('rmCopy').addEventListener('click', () => {
  const txt = $('rmCopy').dataset.text || $('rmAddr').value;
  if (!txt) return toast(t('还没有生成地址', 'No address generated yet'));
  toast(copyText(txt) ? t('已复制，发给朋友即可', 'Copied — send it to your friends') : txt, 4000);
  rlog(t('已复制联机地址', 'Join address copied'));
});

// ---- 防火墙 ----
async function checkFw(silent) {
  const java = $('mcJava').value || '';
  const el = $('rmFw');
  el.innerHTML = '<span style="color:#7a8b99">' + t('正在检查防火墙规则…（约 1~2 秒）', 'Checking firewall rules… (about 1–2 seconds)') + '</span>';
  try {
    const r = unwrap(await window.api.checkFirewall(java));
    if (r.ok) {
      el.innerHTML = `<span style="color:#1a7f37">✅ ${t('已放行', 'allowed')}</span><br>${t('规则：', 'Rule: ')}${escapeHtml((r.rule && r.rule.program) || '')}${r.warn ? '<br>⚠️ ' + escapeHtml(r.warn) : ''}`;
      $('rmFwFix').style.display = r.warn ? 'inline-flex' : 'none';
    } else {
      el.innerHTML = `<span style="color:#c0392b">⚠️ ${escapeHtml(r.reason || t('未放行', 'not allowed'))}</span>`;
      $('rmFwFix').style.display = r.unknown ? 'none' : 'inline-flex';
      if (!silent) toast(t('防火墙可能拦住朋友，建议点「一键放行」', 'The firewall may block your friends — click "Allow it"'), 4500);
    }
  } catch (e) {
    el.textContent = t('检查失败：', 'Check failed: ') + e.message;
  }
}

$('rmFwCheck').addEventListener('click', () => checkFw(false));
$('rmFwFix').addEventListener('click', async () => {
  const java = $('mcJava').value;
  if (!java) return toast(t('先在「版本下载与启动」里选一个 Java', 'Pick a Java in Versions & Launch first'));
  rlog(t('正在添加防火墙规则（会弹 UAC，请点「是」）…', 'Adding the firewall rule (a UAC prompt appears — click Yes)…'));
  try {
    unwrap(await window.api.fixFirewall(java));
    rlog(t('防火墙规则已添加：', 'Firewall rule added: ') + java);
    toast(t('已放行，朋友现在能连了', 'Allowed — your friends can connect now'));
    await checkFw(true);
  } catch (e) {
    rlog(t('放行失败：', 'Failed to allow: ') + e.message);
    toast(e.message, 4500);
  }
});

// ---- 玩家页 ----
// ---- 玩家页：每种方式玩家自己要做什么 ----
let playerMeta = null;
let pickedPg = 'tunnel';

document.querySelectorAll('#playerGuides .subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#playerGuides .subtab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    pickedPg = btn.dataset.pg;
    renderPlayerGuide(pickedPg);
  });
});

async function loadPlayerGuides() {
  if (!playerMeta) {
    try {
      playerMeta = unwrap(await window.api.playerGuides());
    } catch (e) {
      /* ignore */
    }
  }
  renderPlayerGuide(pickedPg);
}

function selectPlayerGuide(id) {
  const btn = document.querySelector('#playerGuides .subtab[data-pg="' + id + '"]');
  if (!btn) return;
  document.querySelectorAll('#playerGuides .subtab').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  pickedPg = id;
  renderPlayerGuide(id);
}

function renderPlayerGuide(id) {
  const el = $('pgBody');
  const m = (playerMeta || {})[id];
  if (!m) {
    el.innerHTML = '<div class="hint">' + t('加载中…', 'Loading…') + '</div>';
    return;
  }
  const indent = (s) => escapeHtml(s).replace(/^ +/, (sp) => '&nbsp;'.repeat(sp.length * 2));
  let html =
    '<div class="li-sub" style="margin-bottom:8px">' +
    (m.needInstall
      ? '<span class="tag snapshot">' + t('你也要装东西', 'You install something too') + '</span>'
      : '<span class="tag release">' + t('你什么都不用装', 'You install nothing') + '</span>') +
    ' ' +
    escapeHtml(m.why || '') +
    '</div>' +
    `<ol style="margin:0 0 0 20px; line-height:1.95">${m.steps.map((s) => '<li>' + indent(s) + '</li>').join('')}</ol>`;
  if (m.tip) html += `<div class="hint" style="margin-top:8px">💡 ${escapeHtml(m.tip)}</div>`;

  const acts = [];
  if (m.installer) {
    acts.push(`<button class="primary small" style="width:auto" data-pginstall="${m.id}">${t('下载并安装 ', 'Download and install ')}${escapeHtml(m.name)}</button>`);
  }
  if (m.page) {
    acts.push(`<button class="ghost small" style="width:auto" data-pgpage="${escapeHtml(m.page)}">${t('去官网下载', 'Download from the official site')}</button>`);
  }
  if (acts.length) html += `<div class="row" style="margin-top:10px">${acts.join('')}</div>`;
  el.innerHTML = html;

  const ib = el.querySelector('[data-pginstall]');
  if (ib) ib.addEventListener('click', () => installVpnTool(ib.dataset.pginstall));
  const pb = el.querySelector('[data-pgpage]');
  if (pb) pb.addEventListener('click', () => window.api.openPath(pb.dataset.pgpage));
}

function fillClientVersions() {
  const sel = $('clVersion');
  const cur = sel.value;
  sel.innerHTML = '';
  versions.forEach((v) => {
    const o = document.createElement('option');
    o.value = v.id;
    o.textContent = v.id + (v.launchable ? '' : t('（缺文件）', ' (files missing)'));
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
  else if (selectedVersion) sel.value = selectedVersion.id;
  loadPlayerGuides();
}

$('clTest').addEventListener('click', async () => {
  const text = $('clText').value;
  const box = $('clResult');
  if (!text.trim()) return toast(t('请先粘贴房主发的地址', 'Paste the address the host sent you first'));
  const p = unwrap(await window.api.parseShare(text));
  if (!p.host || !p.port) {
    box.innerHTML = t('<div class="hint">没解析出「IP:端口」，请把房主发的内容<b>整段</b>粘进来</div>', '<div class="hint">No "IP:port" found — paste the host message <b>in full</b></div>');
    return;
  }
  box.innerHTML = `<div class="hint">${t('正在连接 ', 'Connecting to ')}${escapeHtml(p.host)}:${escapeHtml(String(p.port))} …</div>`;
  rlog(t('测试连接 ', 'Testing the connection to ') + p.host + ':' + p.port);

  // 根据地址自动判断房主用的方式，并跳到对应的「你要做什么」
  if (p.method && p.method !== 'unknown') {
    selectPlayerGuide(p.method);
    $('pgHint').innerHTML = `🔎 ${t('根据地址判断：', 'Based on the address: ')}${escapeHtml(p.methodReason || '')}${t(' —— 已自动切到对应的说明', ' — switched to the matching guide automatically')}`;
  } else {
    $('pgHint').innerHTML = p.methodReason ? '🔎 ' + escapeHtml(p.methodReason) : '';
  }
  const r = unwrap(await window.api.tcpTest(p.host, p.port, 6000));
  if (r.ok) {
    box.innerHTML =
      `<div class="hint"><span style="color:#1a7f37">${t('✅ 通了！', '✅ Connected!')}</span>${t(' 延迟 ', ' · latency ')}<b>${r.latency} ms</b>` +
      `${r.latency < 60 ? t('（很快）', ' (fast)') : r.latency < 150 ? t('（正常）', ' (normal)') : t('（偏高，可能走的是穿透线路）', ' (high — this is probably going through a relay)')}</div>` +
      `<div class="hint">${t('下一步：在 MC 里「多人游戏 → 直接连接」输入 ', 'Next: in Minecraft open Multiplayer → Direct Connect and enter ')}<b>${escapeHtml(p.host + ':' + p.port)}</b>${t(' 就能进', ' to join')}</div>`;
    rlog(t('连接成功，延迟 ', 'Connected, latency ') + r.latency + 'ms');
  } else {
    box.innerHTML =
      `<div class="hint"><span style="color:#c0392b">❌ ${escapeHtml(r.error || t('连接失败', 'connection failed'))}</span>` +
      `${r.hint ? '<br>💡 ' + escapeHtml(r.hint) : ''}</div>`;
    rlog(t('连接失败：', 'Connection failed: ') + r.error);
  }
  if (p.version || p.modCount !== null) await compareVersions(p, box);
});

$('clParse').addEventListener('click', async () => {
  const p = unwrap(await window.api.parseShare($('clText').value));
  $('clResult').innerHTML = p.host
    ? `<div class="hint">${t('解析结果：', 'Parsed: ')}<b>${escapeHtml(p.host)}:${p.port}</b>${p.version ? t(' · 版本 ', ' · version ') + escapeHtml(p.version) : ''}${p.modCount !== null ? t(' · Mods ' + p.modCount + ' 个', ' · ' + p.modCount + ' mods') : ''}</div>`
    : '<div class="hint">' + t('没能解析出地址', 'Could not parse an address') + '</div>';
});

$('clCompare').addEventListener('click', async () => {
  const p = unwrap(await window.api.parseShare($('clText').value));
  await compareVersions(p, $('clCompareResult'));
});

async function compareVersions(p, box) {
  const mcFolder = mcFolderNow();
  const myId = $('clVersion').value;
  if (!mcFolder || !myId) {
    box.innerHTML += '<div class="hint">' + t('没法对比：请先在「版本下载与启动」里扫描出你的版本', 'Cannot compare — scan your versions in Versions & Launch first') + '</div>';
    return;
  }
  const mine = unwrap(await window.api.lanFingerprint(mcFolder, myId));
  const rows = [];
  const hostVer = String(p.version || '').trim();
  const myVer = String(mine.versionId || '').trim();
  if (hostVer) {
    const same = hostVer === myVer;
    rows.push(`${same ? '✅' : '❌'}${t(' 版本：房主 ', ' version — host: ')}<b>${escapeHtml(hostVer)}</b>${t(' / 你 ', ' / yours: ')}<b>${escapeHtml(myVer)}</b>${same ? '' : t(' —— <b>必须一致</b>，否则进不去', ' — <b>they must match</b>, otherwise you cannot join')}`);
  }
  if (p.loader || mine.loader) {
    const same = (p.loader || t('原版', 'Vanilla')) === (mine.loader || t('原版', 'Vanilla'));
    rows.push(`${same ? '✅' : '❌'}${t(' 加载器：房主 ', ' loader — host: ')}<b>${escapeHtml(p.loader || t('原版', 'Vanilla'))}</b>${t(' / 你 ', ' / yours: ')}<b>${escapeHtml(mine.loader || t('原版', 'Vanilla'))}</b>${same ? '' : t(' —— 加载器不同也进不去', ' — a different loader also blocks joining')}`);
  }
  if (p.modCount !== null && p.modCount !== undefined) {
    if (p.modCount === 0 && mine.modCount === 0) {
      rows.push(t('✅ 双方都没有 mod', '✅ Neither side has mods'));
    } else {
      const hostMods = new Set(p.modNames || []);
      const myMods = new Set(mine.mods.map((m) => m.name));
      const hostOnly = [...hostMods].filter((m) => !myMods.has(m));
      const myOnly = [...myMods].filter((m) => !hostMods.has(m));
      if (!hostOnly.length && !myOnly.length && p.modNames.length) {
        rows.push(`✅ ${t('Mod 一致（' + mine.modCount + ' 个）', 'Mods match (' + mine.modCount + ')')}`);
      } else {
        rows.push(`⚠️ ${t('Mod 不一致：房主 ' + p.modCount + ' 个 / 你 ' + mine.modCount + ' 个', 'Mods differ — host: ' + p.modCount + ', yours: ' + mine.modCount)}`);
        if (hostOnly.length) rows.push(`${t('&nbsp;&nbsp;你缺少：', '&nbsp;&nbsp;You are missing: ')}${escapeHtml(hostOnly.slice(0, 6).join(', '))}${hostOnly.length > 6 ? ' …' : ''}`);
        if (myOnly.length) rows.push(`${t('&nbsp;&nbsp;你多出：', '&nbsp;&nbsp;You have extra: ')}${escapeHtml(myOnly.slice(0, 6).join(', '))}${myOnly.length > 6 ? ' …' : ''}`);
      }
    }
  } else {
    rows.push(t('ℹ️ 房主没发版本信息（让他用本工具「生成」后再发一次）', 'ℹ️ The host did not send version info (ask them to click Generate in this tool and send it again)'));
  }
  box.innerHTML += '<div class="hint" style="line-height:1.9">' + rows.join('<br>') + '</div>';
}

// ================================================================ 8. 一键开服

let srvRoot = '';
let srvListData = [];
let currentSrv = null;
let srvPollTimer = null;
let srvVersionsLoaded = false;
let srvTunnelTimer = null;

function srvLog(line) {
  const el = $('srvConsole');
  el.textContent += line + '\n';
  if (el.textContent.length > 200000) el.textContent = el.textContent.slice(-150000);
  el.scrollTop = el.scrollHeight;
}

async function initSrv() {
  if (!srvRoot) {
    srvRoot = config.srvRoot || '';
    if (!srvRoot) {
      try {
        srvRoot = unwrap(await window.api.srvDefaultRoot()) || '';
      } catch (e) {
        srvRoot = '';
      }
    }
    $('srvRoot').value = srvRoot;
  }
  await loadServerList();
}

async function loadServerList() {
  const el = $('srvList');
  const root = $('srvRoot').value.trim();
  if (!root) {
    el.innerHTML = '<div class="hint">' + t('请先选择服务器目录', 'Choose a servers folder first') + '</div>';
    return;
  }
  el.innerHTML = '<div class="hint">' + t('正在扫描服务器目录…', 'Scanning the servers folder…') + '</div>';
  try {
    srvListData = unwrap(await window.api.srvList(root)) || [];
  } catch (e) {
    el.innerHTML = '<div class="hint">' + t('读取失败：', 'Read failed: ') + escapeHtml(e.message) + '</div>';
    return;
  }
  if (!srvListData.length) {
    el.innerHTML = '<div class="hint">' + t('这个目录下还没有服务器 —— 用上面的表单创建一个吧', 'There are no servers in this folder yet — create one with the form above') + '</div>';
    return;
  }
  el.innerHTML = '';
  srvListData.forEach((s) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <span class="tag ${s.running ? 'release' : 'unknown'}">${s.running ? (s.ready ? t('运行中', 'Running') : t('启动中…', 'Starting…')) : t('已停止', 'Stopped')}</span>
      <div class="li-main">
        <div class="li-title">${escapeHtml(s.name)}</div>
        <div class="li-sub">${escapeHtml(String(s.type || '').toUpperCase())}${s.mcVersion ? ' ' + escapeHtml(s.mcVersion) : ''}${t(' · 端口 ', ' · port ')}${s.port} · ${escapeHtml(s.jar || '')}${s.requiredJava ? t(' · <b>需要 Java ', ' · <b>needs Java ') + s.requiredJava + '</b>' : ''}${s.hasMods ? t(' · 有 mods', ' · has mods') : ''}
          <br>${escapeHtml(s.dir)}</div>
      </div>
      <button class="primary small" style="width:auto" data-act="startstop">${s.running ? t('停止', 'Stop') : t('启动', 'Launch')}</button>
      <button class="ghost small" style="width:auto" data-act="console">${t('控制台', 'Console')}</button>
      <button class="ghost small" style="width:auto" data-act="open">${t('打开文件夹', 'Open folder')}</button>`;
    item.querySelector('[data-act="startstop"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (s.running) stopServer(s);
      else startServer(s);
    });
    item.querySelector('[data-act="console"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      openServerConsole(s);
    });
    item.querySelector('[data-act="open"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      window.api.openPath(s.dir);
    });
    el.appendChild(item);
  });
}

async function startServer(s) {
  // 按服务器的 MC 版本自动挑一个够用的 Java（1.21.x 需要 Java 21）
  const need = s.requiredJava || null;
  const pick = pickJavaFor(need);
  if (!pick) {
    const msg = need
      ? `${t('这个服务器（', 'This server (')}${s.mcVersion || '?'}${t('）需要 Java ', ') needs Java ')}${need}${t('，但你机器上没找到符合的 Java —— 请先装一个 Java ', ', but no matching Java was found on this PC — install Java ')}${need}`
      : t('没有可用的 Java，请先到「版本下载与启动」刷新 Java 列表', 'No usable Java — refresh the Java list in Versions & Launch first');
    toast(msg, 10000);
    srvLog(t('[错误] ', '[Error] ') + msg);
    if (currentSrv && currentSrv.dir === s.dir) openServerConsole(s);
    return;
  }
  if (need && $('mcJava').value !== pick.path) {
    $('mcJava').value = pick.path;
    selectBestJava();
  }
  toast(t('正在用 Java ', 'Starting with Java ') + pick.major + t(' 启动 ', ' — launching ') + s.name + ' …');
  try {
    unwrap(
      await window.api.srvStart({
        dir: s.dir,
        javaPath: pick.path,
        javaMajor: pick.major,
        memory: Number($('srvMem').value) || undefined,
      })
    );
    openServerConsole(s);
    await loadServerList();
    startSrvPoll(s.dir);
  } catch (e) {
    toast(t('启动失败：', 'Launch failed: ') + e.message, 9000);
    srvLog(t('[错误] ', '[Error] ') + e.message);
    if (currentSrv && currentSrv.dir === s.dir) openServerConsole(s);
  }
}

/** 从 Java 下拉框里挑一个满足版本要求的（优先挑刚好够用的那个） */
function pickJavaFor(need) {
  const sel = $('mcJava');
  if (!sel) return null;
  const out = [];
  for (const o of sel.options) {
    const maj = Number(o.dataset.major || 0);
    if (maj > 0 && o.value) out.push({ path: o.value, major: maj });
  }
  if (!out.length) return null;
  if (!need) return out.sort((a, b) => b.major - a.major)[0];
  const ok = out.filter((x) => x.major >= need).sort((a, b) => a.major - b.major);
  return ok.length ? ok[0] : null;
}

async function stopServer(s) {
  try {
    unwrap(await window.api.srvStop(s.dir, false));
    toast(t('已发送 stop，等服务器保存并退出…', 'Sent stop — waiting for the server to save and exit…'), 4000);
  } catch (e) {
    toast(t('停止失败：', 'Failed to stop: ') + e.message, 5000);
  }
  setTimeout(loadServerList, 2000);
}

function openServerConsole(s) {
  currentSrv = s;
  $('srvCtrlCard').style.display = 'block';
  $('srvCtrlTitle').textContent = t('控制台 · ', 'Console · ') + s.name;
  $('srvCtrlBar').innerHTML =
    `<span class="tag ${s.running ? 'release' : 'unknown'}">${s.running ? t('运行中', 'Running') : t('已停止', 'Stopped')}</span>` +
    `<span class="hint">${escapeHtml(s.dir)}</span>` +
    `<button class="ghost small" style="width:auto;margin-left:auto" id="srvBtnOpen">${t('打开文件夹', 'Open folder')}</button>` +
    `<button class="ghost small" style="width:auto" id="srvBtnStop">${t('停止服务器', 'Stop server')}</button>` +
    `<button class="ghost small" style="width:auto" id="srvBtnClear">${t('清空日志', 'Clear log')}</button>`;
  $('srvBtnOpen').onclick = () => window.api.openPath(s.dir);
  $('srvBtnStop').onclick = () => stopServer(s);
  $('srvBtnClear').onclick = () => ($('srvConsole').textContent = '');
  $('srvConsole').textContent = '';
  refreshSrvConsole(s.dir);
  refreshSrvAddr(s);
  initSrvTunnel();
  $('srvCtrlCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- 让朋友直接连（内网穿透，朋友什么都不用装）----
async function initSrvTunnel() {
  const sel = $('srvTunnel');
  if (!sel) return;
  try {
    const list = unwrap(await window.api.tunnelClients()) || [];
    const order = ['bore', 'playit', 'ngrok', 'frpc'];
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    const cur = sel.value;
    sel.innerHTML = '';
    list.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent =
        c.name + (c.installed ? t('（已装好）', ' (installed)') : t('（未安装，会自动下载）', ' (not installed — downloads automatically)'));
      sel.appendChild(o);
    });
    if (cur && list.some((c) => c.id === cur)) sel.value = cur;
    else sel.value = (list.find((c) => c.best) || list[0] || {}).id || 'bore';
  } catch (e) {
    /* ignore */
  }
}

$('srvTunnelStart').addEventListener('click', async () => {
  if (!currentSrv) return toast(t('先点某个服务器的「控制台」，再点公开', 'Open a server\'s "Console" first, then click Make public'));
  const id = $('srvTunnel').value;
  const port = currentSrv.port || 25565;
  const hint = $('srvTunnelHint');
  hint.textContent = t('正在准备 ', 'Preparing ') + id + ' …';
  try {
    const list = unwrap(await window.api.tunnelClients()) || [];
    const c = list.find((x) => x.id === id);
    if (c && !c.installed) {
      hint.textContent = t('正在下载 ', 'Downloading ') + c.name + t(' …（从官方源，可能要一会儿）', ' … (from the official source, this may take a while)');
      await window.api.tunnelInstall(id);
    }
    const r = unwrap(
      await window.api.tunnelStart({
        id,
        port,
        token: $('rmToken').value.trim(),
        configPath: $('rmFrpCfg').value.trim(),
      })
    );
    pickedTunnel = id;
    hint.innerHTML = t('✅ 已启动 ', '✅ Started ') + escapeHtml(r.mode) + '<br>' + tunnelStartHint(id);
    toast(t('已开始公开，等待公网地址…', 'Sharing started — waiting for a public address…'));

    // 40 秒还没地址就给下一步建议（playit 新版拿不到地址是常见情况）
    if (srvTunnelTimer) clearTimeout(srvTunnelTimer);
    srvTunnelTimer = setTimeout(() => {
      if ($('srvPublicAddr').value) return;
      if (id === 'playit') {
        $('srvTunnelHint').innerHTML +=
          '<br><span style="color:#b8860b">' + t('⚠️ 40 秒还没拿到地址 —— playit 新版需要它自己的桌面客户端才能建隧道。', '⚠️ No address after 40 seconds — the new playit needs its own desktop client to create a tunnel.') +
          t('建议把上面的工具换成 <b>bore</b>（不用注册，点一下就给地址），', 'Try switching the tool above to <b>bore</b> (no sign-up, one click for an address),') +
          t('或者去 playit 网页把给你的地址手动粘到下面的框里。', 'or paste the address from the playit website into the box below.') + '</span>';
      } else if (id === 'bore') {
        $('srvTunnelHint').innerHTML +=
          '<br><span style="color:#b8860b">' + t('⚠️ 40 秒还没拿到地址 —— bore.pub 是公共免费服务器，可能正忙。', '⚠️ No address after 40 seconds — bore.pub is a free public relay and may be busy.') +
          t('再点一次「公开服务器」试试，或者换 playit / 自己搭 frp。', 'Click "Make public" once more, or switch to playit / set up your own frp.') + '</span>';
      }
    }, 40000);
  } catch (e) {
    hint.innerHTML = '<span style="color:#c0392b">' + t('公开失败：', 'Failed to share: ') + escapeHtml(e.message) + '</span>';
    toast(t('公开失败：', 'Failed to share: ') + e.message, 8000);
  }
});

/** 每种穿透工具启动后该说什么（别把 playit 的话套到 bore 上） */
function tunnelStartHint(id) {
  if (id === 'bore') {
    return t('正在连接 bore.pub 公共服务器，一般 5~20 秒就会给出地址。bore 不需要注册、也不需要认领。', 'Connecting to the public bore.pub server — an address usually appears within 5–20 seconds. bore needs no sign-up and no claiming.');
  }
  if (id === 'playit') {
    return (
      t('⚠️ <b>playit 新版说明</b>：现在的 playit.exe 只是个守护进程，需要它<b>自己的桌面客户端</b>来配置隧道，', '⚠️ <b>Note for the new playit</b>: the current playit.exe is only a daemon — it needs its <b>own desktop client</b> to configure a tunnel,') +
      t('单独运行不会自动给出地址。', 'so running it alone never produces an address.') + '<br>' +
      t('（老版本会打印一个 https://playit.gg/claim/xxxx 链接，点一次就把这台设备绑定到你的账号，', '(older builds printed a https://playit.gg/claim/xxxx link; clicking it once binds this machine to your account,') +
      t('这一步就叫「认领」，一辈子只要做一次。新版改成在客户端里做了。）', 'that step is called "claiming" and you only ever do it once; the new version moved it into the client.)') + '<br>' +
      t('想省事就用 <b>bore</b>；想用 playit 请到 playit.gg 下载它的客户端并认领，', 'To keep things simple use <b>bore</b>; to use playit, download its client from playit.gg and claim it,') +
      t('然后把网页上显示的地址手动粘到下面的框里。', 'then paste the address shown on the website into the box below.')
    );
  }
  if (id === 'ngrok') {
    return t('正在用 ngrok 建立隧道…（注意：官网免费版通常不含 TCP 隧道，报错就换成 bore）', 'Creating a tunnel with ngrok… (note: the free plan usually has no TCP tunnels — if it errors, switch to bore)');
  }
  return t('正在按你的 frpc 配置建立隧道…', 'Creating the tunnel from your frpc config…');
}

$('srvTunnelStop').addEventListener('click', async () => {
  const id = $('srvTunnel').value;
  try {
    unwrap(await window.api.tunnelStop(id));
  } catch (e) {
    /* ignore */
  }
  if (pickedTunnel === id) pickedTunnel = null;
  $('srvPublicAddr').value = '';
  $('srvTunnelHint').textContent = t('已停止公开', 'Sharing stopped');
  toast(t('已停止公开', 'Sharing stopped'));
});

$('srvPublicCopy').addEventListener('click', () => {
  const addr = $('srvPublicAddr').value;
  if (!addr) return toast(t('还没有公网地址', 'No public address yet'));
  toast(copyText(addr) ? t('已复制：', 'Copied: ') + addr + t('　发给朋友就能连', ' — send it to your friends to join') : addr, 5000);
});

async function refreshSrvConsole(dir) {
  try {
    const st = unwrap(await window.api.srvStatus(dir));
    if (st && st.running && st.log) {
      $('srvConsole').textContent = st.log.join('\n');
      $('srvConsole').scrollTop = $('srvConsole').scrollHeight;
      if (st.port && currentSrv) currentSrv.port = st.port;
    }
  } catch (e) {
    /* ignore */
  }
}

function startSrvPoll(dir) {
  if (srvPollTimer) clearInterval(srvPollTimer);
  srvPollTimer = setInterval(async () => {
    if (!currentSrv || currentSrv.dir !== dir) return;
    try {
      const st = unwrap(await window.api.srvStatus(dir));
      if (st && st.port && currentSrv) currentSrv.port = st.port;
      if (st && !st.running) {
        clearInterval(srvPollTimer);
        srvPollTimer = null;
        await loadServerList();
      }
    } catch (e) {
      /* ignore */
    }
  }, 3000);
}

/** 生成联机地址：优先虚拟组网 IP（异地可用），其次局域网 IP */
async function refreshSrvAddr(s) {
  const port = (s && s.port) || 25565;
  const box = $('srvAddr');
  const hint = $('srvAddrHint');
  box.value = '';
  hint.textContent = t('正在获取本机地址…', 'Getting this PC\'s address…');
  try {
    const ov = unwrap(await window.api.lanOverview());
    const ads = (ov.adapters || []).filter((a) => a.usable);
    const vpn = ads.filter((a) => a.isVpn);
    const lan = ads.filter((a) => !a.isVpn);
    const pick = vpn[0] || lan[0];
    if (!pick) {
      hint.textContent = t('没有找到可用的网卡地址', 'No usable network adapter address found');
      return;
    }
    box.value = pick.address + ':' + port;
    box.dataset.text = pick.address + ':' + port;
    const lines = [];
    lines.push(
      pick.isVpn
        ? `✅ ${t('用的是<b>虚拟组网</b>地址（', 'using a <b>virtual LAN</b> address (')}${escapeHtml(pick.label)}${t('）—— 朋友也要连同一个虚拟网络才能用这个地址', ') — friends must join the same virtual network to use it')}`
        : `⚠️ ${t('用的是<b>局域网</b>地址（', 'using a <b>LAN</b> address (')}${escapeHtml(pick.label)}${t('）—— 只有同一个 WiFi 下的朋友能连；异地请到「异地联机」用虚拟组网或内网穿透', ') — only friends on the same WiFi can join; for remote play use Virtual LAN or tunneling under Play Together')}`
    );
    const others = ads.filter((a) => a.address !== pick.address);
    if (others.length) {
      lines.push(
        t('其他可用地址：', 'Other usable addresses: ') +
          others.map((a) => `<b>${escapeHtml(a.address)}:${port}</b>${t('（', ' (')}${escapeHtml(a.label)}${t('）', ')')}`).join('　')
      );
    }
    hint.innerHTML = lines.join('<br>');
  } catch (e) {
    hint.textContent = t('获取地址失败：', 'Failed to get the address: ') + e.message;
  }
}

$('srvAddrCopy').addEventListener('click', () => {
  const addr = $('srvAddr').value;
  if (!addr) return toast(t('还没有地址', 'No address yet'));
  toast(copyText(addr) ? t('已复制：', 'Copied: ') + addr : addr, 4000);
});
$('srvAddrRefresh').addEventListener('click', () => currentSrv && refreshSrvAddr(currentSrv));

$('srvCmdSend').addEventListener('click', sendSrvCommand);
$('srvCmd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendSrvCommand();
});
async function sendSrvCommand() {
  const cmd = $('srvCmd').value.trim();
  if (!cmd || !currentSrv) return;
  $('srvCmd').value = '';
  try {
    unwrap(await window.api.srvSend(currentSrv.dir, cmd));
  } catch (e) {
    toast(t('发送失败：', 'Send failed: ') + e.message, 5000);
  }
}

$('srvPickRoot').addEventListener('click', async () => {
  const d = unwrap(await window.api.pickDir(t('选择服务器存放目录', 'Choose the servers folder'), $('srvRoot').value.trim() || undefined));
  if (!d) return;
  $('srvRoot').value = d;
  srvRoot = d;
  config.srvRoot = d;
  try {
    unwrap(await window.api.saveModConfig(config));
  } catch (e) {
    /* ignore */
  }
  await loadServerList();
});

$('srvType').addEventListener('change', () => {
  // 换类型后重新拉版本列表
  srvVersionsLoaded = false;
  $('srvCreateHint').textContent = t('点了「获取可用版本」才能从列表里选；也可以直接在左边手填版本号', 'Click "Fetch available versions" to pick from the list, or just type a version on the left');
});

$('srvLoadVersions').addEventListener('click', async () => {
  const type = $('srvType').value;
  $('srvCreateHint').textContent = t('正在获取版本列表…', 'Fetching the version list…');
  try {
    let list = [];
    if (type === 'paper') {
      list = unwrap(await window.api.srvPaperVersions()) || [];
    } else {
      const man = unwrap(await window.api.versionManifest());
      list = (man.versions || []).filter((v) => v.type === 'release').map((v) => v.id);
    }
    const sel = $('srvVersion');
    const cur = sel.value;
    sel.innerHTML = '';
    list.forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
    srvVersionsLoaded = true;
    $('srvCreateHint').innerHTML = `${t('已获取 ', 'Fetched ')}<b>${list.length}</b>${t(' 个可用版本，从下拉框里选一个即可', ' available versions — just pick one from the dropdown')}`;
  } catch (e) {
    $('srvCreateHint').textContent = t('获取失败：', 'Fetch failed: ') + e.message + t('（可以直接手填版本号）', ' (you can also type the version in manually)');
  }
});

$('srvCreate').addEventListener('click', async () => {
  const type = $('srvType').value;
  const mcVersion = $('srvVersion').value.trim();
  if (!mcVersion) return toast(t('请选择或填写要开的 Minecraft 版本', 'Pick or type the Minecraft version for the server'));
  const name = $('srvName').value.trim() || type + '-' + mcVersion;
  $('srvCreate').disabled = true;
  $('srvCreateHint').textContent = t('正在创建…（下载服务端，可能需要一会儿）', 'Creating… (downloading the server, this may take a while)');
  $('srvConsole').textContent = '';
  try {
    const r = unwrap(
      await window.api.srvCreate({
        root: $('srvRoot').value.trim(),
        name,
        type,
        mcVersion,
        memory: Number($('srvMem').value) || 2048,
        port: Number($('srvPort').value) || 25565,
        motd: $('srvMotd').value.trim() || name,
        onlineMode: $('srvOnlineMode').checked,
      })
    );
    $('srvCreateHint').innerHTML = `✅ ${t('服务器已创建：', 'Server created: ')}<b>${escapeHtml(r.dir)}</b>${t('（启动文件 ', ' (startup file ')}${escapeHtml(r.jar)}${t('）', ')')}`;
    toast(t('服务器创建完成：', 'Server created: ') + r.name, 5000);
    await loadServerList();
  } catch (e) {
    $('srvCreateHint').innerHTML = '<span style="color:#c0392b">' + t('创建失败：', 'Create failed: ') + escapeHtml(e.message) + '</span>';
    toast(t('创建失败：', 'Create failed: ') + e.message, 7000);
  } finally {
    $('srvCreate').disabled = false;
  }
});

// ================================================================ 初始化

(async function init() {
  await loadConfig();
  try {
    const def = unwrap(await window.api.defaultMcFolder());
    if (config.mcFolder) $('mcFolder').value = config.mcFolder;
    else if (def) $('mcFolder').value = def;
  } catch (e) {}
  if (config.username) $('mcUser').value = config.username;
  if (config.assetsDir) $('mcAssets').value = config.assetsDir;
  $('modsDir').value = config.modsDir || defaultModsDir();
  updateModsPath();
  applyKind();
  await refreshAccount();

  window.api.onAuthStatus((s) => appendLog(t('[账号] ', '[Account] ') + s + '\n'));
  window.api.onDohFallback((info) => {
    toast(`${t('检测到 ', 'Detected that ')}${info.host}${t(' 的 DNS 被运营商劫持，已自动改用加密 DNS 绕过', ' has its DNS hijacked by your ISP — switched to encrypted DNS automatically')}`, 7000);
    rlog(t('[网络] DNS 被劫持：', '[Network] DNS hijacked: ') + info.host + t(' → 已用加密 DNS 解析到 ', ' → resolved via encrypted DNS to ') + info.ip);
  });
  window.api.onPackLog((s) => rlog(t('[整合包] ', '[Modpack] ') + s));
  window.api.onPackProgress((p) => {
    const txt = `${t('进度 ', 'Progress ')}${p.done}/${p.total} · ${String(p.name || '').slice(-52)}`;
    if (packProgressEl && $(packProgressEl)) $(packProgressEl).textContent = txt;
    $('modStatus').textContent = t('整合包处理中… ', 'Processing modpack… ') + txt;
  });

  window.api.onGameLog((line) => appendLog(line));
  window.api.onRepairProgress((info) => {
    $('launchStatus').innerHTML = `${t('正在补全… ', 'Repairing… ')}${info.done}/${info.total} · ${escapeHtml(info.label || '')}`;
  });
  window.api.onTunnelLog((line) => {
    rlog(line);
    setTimeout(pollTunnel, 400);
  });
  setInterval(() => {
    if (pickedTunnel) pollTunnel();
  }, 2500);

  renderImageList();
  initBlueprint();
  resizeBpCanvas();

  // 版本页是默认页，进来就自动扫一次
  if ($('mcFolder').value.trim()) {
    setTimeout(() => scanVersions(), 400);
  }

  // 服务器控制台输出
  window.api.onSrvLine((x) => {
    if (currentSrv && x && x.dir === currentSrv.dir) srvLog(x.line);
    if (x && x.line && /Done \(|Starting Minecraft server on|Stopping server/.test(x.line)) {
      setTimeout(loadServerList, 500);
      if (currentSrv && x.dir === currentSrv.dir) setTimeout(() => refreshSrvAddr(currentSrv), 500);
    }
  });
  window.api.onSrvLog((s) => {
    const el = $('srvCreateHint');
    if (el) el.textContent = s;
    srvLog(t('[创建] ', '[Create] ') + s);
  });
})();
