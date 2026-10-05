/**
 * 界面多语言（中文 / English）
 *
 * 用法：
 *   - 静态 HTML 文本：走下面的词典 + applyStaticLang() 自动遍历替换文本节点与
 *     placeholder / title 属性（只要中文原文在词典里就会被替换）。
 *   - JS 里动态拼出来的文字：用 t('中文', 'English')。
 */

export const HTML_DICT = {
  // ---- 侧栏 / 通用 ----
  'MC 工具箱': 'MC Toolbox',
  'Java 版助手': 'Java Edition helper',
  '⚙ 设置': '⚙ Settings',
  '版本下载与启动': 'Versions & Launch',
  '一键开服': 'Host a Server',
  '资源下载': 'Download Content',
  '异地联机': 'Play Together',
  '崩溃日志解析': 'Crash Log Analyzer',
  '服务器查询': 'Server Lookup',
  'JPG 转 PNG': 'JPG to PNG',
  '蓝图 3D 预览': 'Blueprint 3D Viewer',
  '设置': 'Settings',
  '保存': 'Save',
  '取消': 'Cancel',
  '复制': 'Copy',
  '查询': 'Query',
  '搜索': 'Search',
  '检查': 'Check',
  '清空': 'Clear',
  '开始转换': 'Start converting',
  '发送': 'Send',
  '停止': 'Stop',
  '生成': 'Generate',
  '浏览…': 'Browse…',

  // ---- 崩溃日志 ----
  '导入 latest.log / crash-report，自动判断崩溃原因并给出优化建议':
    'Import latest.log / crash-report — it works out why it crashed and suggests fixes',
  '选择日志文件': 'Choose a log file',
  '扫描最近日志': 'Scan recent logs',
  '最近的日志 / 崩溃报告': 'Recent logs / crash reports',
  '未选择文件': 'No file selected',
  '关键堆栈': 'Key stack trace',

  // ---- 服务器查询 ----
  '输入服务器 IP（可带端口），查询在线人数、版本、MOTD 与延迟':
    'Enter a server IP (port optional) to see players online, version, MOTD and ping',
  '例如 play.hypixel.net 或 mc.example.com:25565': 'e.g. play.hypixel.net or mc.example.com:25565',
  '在线玩家': 'Players online',

  // ---- 图片 ----
  '批量把 JPG/JPEG 转成 PNG，可自定义输出目录':
    'Batch convert JPG/JPEG to PNG, with an optional output folder',
  '添加 JPG 图片': 'Add JPG images',
  '选择输出目录': 'Choose output folder',
  '输出目录：与源文件相同': 'Output folder: same as source files',

  // ---- 蓝图 ----
  '导入 .litematic，鼠标左键拖拽旋转，滚轮缩放，右键平移':
    'Import a .litematic — drag with the left mouse button to rotate, wheel to zoom, right button to pan',
  '选择 .litematic': 'Choose .litematic',
  '重置视角': 'Reset view',
  '↻ 绕X轴 90°': '↻ Rotate X 90°',
  '↻ 绕Y轴 90°': '↻ Rotate Y 90°',
  '未加载蓝图': 'No blueprint loaded',
  '未加载': 'Not loaded',

  // ---- 版本下载与启动 ----
  '检测已安装的版本并直接启动；也可以从 Mojang 官方源下载安装任意版本':
    'Detects installed versions and launches them; you can also download any version from Mojang',
  '.minecraft 文件夹路径': '.minecraft folder path',
  '自动查找': 'Auto-find',
  '扫描已安装': 'Scan installed',
  '找到的游戏目录（点击选用）': 'Game folders found (click to use)',
  '📁 Mod 文件夹（把 mod 的 .jar 放进这里）':
    '📁 Mods folder (put mod .jar files here)',
  'mods 文件夹路径': 'mods folder path',
  '选择其他目录…': 'Choose another folder…',
  '打开文件夹': 'Open folder',
  '复制路径': 'Copy path',
  '离线模式（游客）': 'Offline mode (guest)',
  '用用户名直接进游戏；想要正版皮肤 / 联机验证请点右边登录':
    'Play with just a username; sign in on the right for a real skin and online-play auth',
  '正版登录（微软）': 'Sign in (Microsoft)',
  '退出登录': 'Sign out',
  '启动选中版本': 'Launch selected version',
  '补全缺失文件': 'Repair missing files',
  '刷新 Java': 'Refresh Java',
  '用户名': 'Username',
  '内存(MB)': 'Memory (MB)',
  '资源目录 assets：': 'Assets folder:',
  '留空 = 用当前 .minecraft\\assets；缺资源时可指向另一个完整游戏目录':
    'Leave empty to use <mc>\\assets; point it at another complete game folder if assets are missing',
  '自动找': 'Auto',
  '只显示完全可启动的版本': 'Only show fully launchable versions',
  '进度 / 启动状态': 'Progress / launch status',
  '下载新版本': 'Download new version',
  '已安装版本': 'Installed versions',
  '搜索版本号，例如 1.21.11 / 26.3': 'Search a version, e.g. 1.21.11 / 26.3',
  '正式版': 'Release',
  '预览版/快照': 'Snapshot',
  '远古版本': 'Ancient',
  '全部': 'All',
  '获取官方清单': 'Fetch official list',
  '强制刷新': 'Force refresh',
  '点「获取官方清单」从 Mojang 拉取全部可下载版本':
    'Click "Fetch official list" to pull every downloadable version from Mojang',

  // ---- 资源下载 ----
  '从 Modrinth / CurseForge 搜索并下载 mod、整合包、资源包、光影包、数据包':
    'Search and download mods, modpacks, resource packs, shaders and data packs from Modrinth / CurseForge',
  '🧩 Mod': '🧩 Mods',
  '📚 整合包': '📚 Modpacks',
  '🎨 资源包': '🎨 Resource packs',
  '✨ 光影包': '✨ Shaders',
  '🗂️ 数据包': '🗂️ Data packs',
  '全部加载器': 'Any loader',
  '搜索 mod，例如 sodium / jei': 'Search mods, e.g. sodium / jei',
  '下载到：': 'Download to:',
  'mods 文件夹路径（默认 .minecraft\\mods）': 'mods folder path (default .minecraft\\mods)',
  '安装到已装版本：': 'Install into an installed version:',
  '（不指定，就用上面的「下载到」文件夹）': '(none — use the "Download to" folder above)',
  '自动检测': 'Auto-detect',

  // ---- 一键开服 ----
  '创建 Paper / Fabric / 原版服务器 —— 点一下就能开，自动生成联机地址发给朋友':
    'Create a Paper / Fabric / Vanilla server — one click to start, plus a join address to share',
  '① 新建服务器': '① New server',
  'Paper（插件服，最推荐）': 'Paper (plugins — recommended)',
  'Fabric（模组服）': 'Fabric (modded)',
  '原版（Vanilla）': 'Vanilla',
  '服务器名（同时作为文件夹名）': 'Server name (also the folder name)',
  '端口': 'Port',
  '服务器列表里显示的名字': 'Name shown in the server list',
  '正版验证': 'Online mode',
  '服务器目录：': 'Servers folder:',
  '获取可用版本': 'Fetch available versions',
  '创建服务器': 'Create server',
  '点「获取可用版本」拉取 Paper 支持的版本列表；也可以直接手填版本号':
    'Click "Fetch available versions" for Paper\'s supported list, or just type a version',
  '服务器控制台': 'Server console',
  '② 联机地址（复制给朋友）': '② Join address (copy for your friends)',
  '服务器启动后自动生成': 'Generated once the server is running',
  '刷新地址': 'Refresh address',
  '输入服务器命令，例如 list / op 玩家名 / stop':
    'Type a server command, e.g. list / op <player> / stop',
  '③ 让朋友直接连（他们什么都不用装）':
    '③ Let friends join directly (they install nothing)',
  '用': 'Use',
  '公开服务器': 'Make public',
  '停止公开': 'Stop sharing',
  '公开成功后自动显示；也可以把 playit 网页上给的地址粘到这里':
    'Shown automatically once public; you can also paste the address from playit\'s website',

  // ---- 异地联机 ----
  '和朋友在不同网络 / 不同城市也能进同一个世界 —— 不需要进路由器做端口映射':
    'Play in the same world from different networks or cities — no router port forwarding needed',
  '🏠 我是房主': '🏠 I am the host',
  '🎯 我是玩家': '🎯 I am a player',
  '第一步 · 选择联机方式': 'Step 1 · Choose how to connect',
  'A. 虚拟组网（Radmin / ZeroTier / Tailscale）—— 最稳，延迟低':
    'A. Virtual LAN (Radmin / ZeroTier / Tailscale) — most stable, lowest ping',
  'B. 内网穿透（playit / ngrok / frp）—— 朋友什么都不用装':
    'B. Tunneling (playit / ngrok / frp) — friends install nothing',
  '重新检测环境': 'Re-detect environment',
  '第二步 · 虚拟组网状态': 'Step 2 · Virtual LAN status',
  '下面三种工具': 'Pick any one of these three tools',
  '任选一种': '',
  '就行（你和朋友必须用同一种）。 带 ✅ 的是你电脑上':
    ' (you and your friends must use the same one). Anything marked ✅ is already',
  '已经装好': 'installed on your PC',
  '的，优先用那个。': ' — prefer that one.',
  '📖 照着做就行（步骤）': '📖 Just follow these steps',
  '下面三种工具任选一种就行（你和朋友必须用同一种）。带 ✅ 的是你电脑上已经装好的，优先用那个。':
    'Pick any one of these three tools (you and your friends must use the same one). Anything marked ✅ is already installed on your PC — prefer that one.',
  'Network ID 是什么、去哪拿？': 'What is a Network ID and where do I get one?',
  '它不是账号也不是密码。你要先去 my.zerotier.com 免费注册，点「Create A Network」自己创建一个虚拟局域网，网站会分给这个网络一串 16 位十六进制编号 —— 那就是 Network ID。':
    'It is neither an account nor a password. First go to my.zerotier.com and sign up for free, click "Create A Network" to create your own virtual LAN, and the site gives that network a 16-character hex ID — that is the Network ID.',
  '不知道房主用的哪种？先把地址粘到下面点「测试连接」，工具箱会自动判断并跳到对应的说明。':
    'Not sure which method the host used? Paste the address below and click "Test connection" — the toolbox works it out and jumps to the right guide.',
  '① 打开 my.zerotier.com 创建网络': '① Open my.zerotier.com and create a network',
  '② 去后台授权设备': '② Authorize the device in the console',
  '把网站给你的 16 位编号粘到这里，例如 8056c2e21c000001':
    'Paste the 16-character ID the site gave you, e.g. 8056c2e21c000001',
  '③ 加入网络': '③ Join network',
  'Tailscale · 安装 / 启动 / 登录': 'Tailscale · Install / Start / Sign in',
  '下载并安装 Tailscale': 'Download and install Tailscale',
  '启动并登录': 'Start and sign in',
  '必须先装客户端 + 在浏览器里登录成功，Tailscale 才会分配 100.x.x.x 的虚拟 IP； 没装就点「启动并登录」就会提示「未检测到 Tailscale」。':
    'Tailscale only assigns a 100.x.x.x virtual IP after the client is installed and you have signed in through the browser; clicking "Start and sign in" without it installed reports "Tailscale not found".',
  '穿透工具': 'Tunneling tools',
  '参数': 'Parameters',
  'ngrok auth token（用 ngrok 时必填）': 'ngrok auth token (required for ngrok)',
  'frpc 配置文件路径（.toml / .ini）': 'frpc config file path (.toml / .ini)',
  '选择配置': 'Choose config',
  '启动穿透': 'Start tunnel',
  '第三步 · 读取 MC 局域网端口': 'Step 3 · Read the Minecraft LAN port',
  '端口填好后点「生成」': 'Fill in the port, then click Generate',
  '从游戏日志读取': 'Read from game log',
  '持续监听': 'Keep watching',
  '先在游戏里按 Esc → 「对局域网开放」，端口每次都不一样，这里能自动读到':
    'In-game press Esc → "Open to LAN" first; the port changes every time and this reads it automatically',
  '第四步 · 生成地址发给朋友': 'Step 4 · Generate an address to share',
  '防火墙检查（最常见的坑）': 'Firewall check (the most common pitfall)',
  '点右边「检查」看看你启动游戏用的 Java 有没有被防火墙放行':
    'Click "Check" to see whether the Java you launch the game with is allowed through the firewall',
  '一键放行（会弹 UAC）': 'Allow it (asks for UAC)',
  '第一步 · 你需要做什么？（按房主用的方式选）':
    'Step 1 · What do you need to do? (match the host\'s method)',
  '不知道房主用的哪种？': 'Not sure which method the host used?',
  '先把地址粘到下面点「测试连接」，工具箱会自动判断并跳到对应的说明。':
    'Paste the address below and click "Test connection" — the toolbox works it out and jumps to the right guide.',
  '内网穿透（你什么都不用装）': 'Tunneling (you install nothing)',
  '内网穿透': 'Tunneling',
  '第二步 · 粘贴房主给你的地址并测试': 'Step 2 · Paste the host\'s address and test it',
  '把房主发的整段内容粘进来，例如：\n26.178.253.189:54321\n版本: 1.21.11\nMods(3): sodium.jar, lithium.jar':
    'Paste the whole message from the host, e.g.:\n26.178.253.189:54321\nVersion: 1.21.11\nMods(3): sodium.jar, lithium.jar',
  '测试连接': 'Test connection',
  '只解析': 'Parse only',
  '版本 / Mod 一致性检查': 'Version / mod consistency check',
  '和我本地对比': 'Compare with mine',
  '状态 / 日志': 'Status / log',

  // ---- 设置 ----
  '没有就留空（CurseForge 官方要求 API Key）':
    'Leave empty if you do not have one (CurseForge requires an API key)',
  '默认 .minecraft 文件夹': 'Default .minecraft folder',
  'C:\\Users\\你\\AppData\\Roaming\\.minecraft': 'C:\\Users\\you\\AppData\\Roaming\\.minecraft',
  '游戏用户名（离线模式）': 'In-game username (offline mode)',
  '申请 CurseForge Key：console.curseforge.com → API Keys':
    'Get a CurseForge key: console.curseforge.com → API Keys',
  '启动与窗口': 'Startup & window',
  '开机自动启动': 'Start with Windows',
  '开机后自动打开 MC 工具箱（默认关闭）':
    'Open MC Toolbox automatically after you sign in (off by default)',
  '关闭后最小化到托盘': 'Minimize to tray on close',
  '点右上角 × 时不退出，收进右下角托盘；双击托盘图标可恢复（默认关闭）':
    'Clicking × hides it in the system tray instead of quitting; double-click the tray icon to restore (off by default)',
  '高级': 'Advanced',
  '微软登录 Client ID': 'Microsoft sign-in client ID',
  '留空则用默认值': 'Leave empty to use the default',
  '只有在默认值登录失败时才需要改（要填你自己在 Azure 注册的应用 ID）':
    'Only change this if the default fails (use the app ID you registered in Azure)',
  '❤️ 为爱发电': '❤️ Support the author',
  '如果这个工具箱帮到你了，可以请作者喝杯奶茶（完全自愿，不影响任何功能）':
    'If this toolbox helped you, you can buy the author a milk tea (entirely optional — no features are affected)',
  '微信扫码 · hehehegood6723': 'WeChat scan · hehehegood6723',
  '语言 / Language': 'Language / 语言',
  '界面语言': 'Interface language',
  '中文': '中文 (Chinese)',
  'English': 'English',

  // ---- 开服面板里剩下的小字 ----
  '用内网穿透把服务器公开到公网 —— 朋友只要在「多人游戏 → 直接连接」里输入地址就能进，不需要装 Radmin / ZeroTier。':
    'Publish the server to the internet — friends just enter the address in Multiplayer → Direct Connect, with no Radmin / ZeroTier needed.',
  '默认用 bore：不用注册、不用认领、点一下就给地址（走公共免费服务器，速度一般）。playit.gg 更稳定但需要装它自己的客户端并在网页认领。':
    'By default it uses bore: no sign-up, no claiming, one click for an address (a public free relay, so speed is average). playit.gg is more stable but needs its own client and a one-time claim on the web.',
  '如果没自动识别出来：去 playit.gg 网页（或 ngrok 后台）复制给你的地址，粘贴到上面的框里也一样能用。':
    'If it is not detected automatically, copy the address from playit.gg (or the ngrok dashboard) and paste it into the box above — that works just as well.',
  'ZeroTier · 加入网络': 'ZeroTier · Join a network',
  '免费': 'Free',
};

const LS_KEY = 'mctoolbox-lang';
let current = 'zh';

export function getLang() {
  return current;
}

export function setLang(l) {
  current = l === 'en' ? 'en' : 'zh';
  try {
    localStorage.setItem(LS_KEY, current);
  } catch (e) {
    /* ignore */
  }
  applyStaticLang();
  return current;
}

/** 动态文字：t('中文', 'English') */
export function t(zh, en) {
  return current === 'en' && en ? en : zh;
}

const savedNodes = new WeakMap();

/**
 * 遍历 DOM，把中文文本节点 / placeholder / title 换成英文。
 * 每个节点第一次被处理时同时记下「中文原文 + 英文」，之后只按当前语言设置，
 * 这样来回切换不会出现"翻不回去"或"二次翻译"的问题。
 */
export function applyStaticLang() {
  const en = current === 'en';

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  for (const node of nodes) {
    let rec = savedNodes.get(node);
    if (!rec) {
      const raw = node.nodeValue;
      if (!raw) continue;
      const key = raw.replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const tr = HTML_DICT[key];
      if (tr === undefined) continue; // 不需要翻译的节点，跳过
      rec = {
        zh: key,
        en: tr,
        lead: raw.match(/^\s*/)[0],
        trail: raw.match(/\s*$/)[0],
      };
      savedNodes.set(node, rec);
    }
    node.nodeValue = en ? rec.lead + rec.en + rec.trail : rec.lead + rec.zh + rec.trail;
  }

  document.querySelectorAll('[placeholder]').forEach((el) => {
    const raw = el.getAttribute('placeholder');
    if (raw === null) return;
    if (!el.dataset.zhPh) {
      const key = raw.replace(/\s+/g, ' ').trim();
      const tr = HTML_DICT[key];
      if (tr === undefined) return; // 不在词典里就不动它
      el.dataset.zhPh = raw;
      el.dataset.enPh = tr;
    }
    el.setAttribute('placeholder', en ? el.dataset.enPh : el.dataset.zhPh);
  });

  document.querySelectorAll('[title]').forEach((el) => {
    const raw = el.getAttribute('title');
    if (raw === null) return;
    if (!el.dataset.zhTitle) {
      const key = raw.replace(/\s+/g, ' ').trim();
      const tr = HTML_DICT[key];
      if (tr === undefined) return;
      el.dataset.zhTitle = raw;
      el.dataset.enTitle = tr;
    }
    el.setAttribute('title', en ? el.dataset.enTitle : el.dataset.zhTitle);
  });

  document.documentElement.setAttribute('lang', en ? 'en' : 'zh-CN');
}

/** 读取上次保存的语言 */
export function restoreLang() {
  let l = 'zh';
  try {
    l = localStorage.getItem(LS_KEY) || 'zh';
  } catch (e) {
    /* ignore */
  }
  current = l === 'en' ? 'en' : 'zh';
  return current;
}
