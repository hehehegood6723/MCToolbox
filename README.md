<div align="center">

# MC Toolbox · MC 工具箱

**Minecraft Java 版一站式工具箱**
**An all-in-one toolbox for Minecraft Java Edition**

版本管理 / 启动 · 正版登录 · 一键开服 · 资源下载 · 异地联机 · 崩溃分析 · 蓝图预览

[![test](https://github.com/hehehegood6723/MCToolbox/actions/workflows/test.yml/badge.svg)](https://github.com/hehehegood6723/MCToolbox/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-0078d4.svg)](#系统要求)

[中文](#-中文文档) · [English](#-english-docs)

</div>

---

## 📖 中文文档

### 这是什么

一个给 **Minecraft Java 版玩家**用的 Windows 桌面工具箱（Electron 写的），把平时要装好几个软件才能干的事都放进了一个界面里：

| 功能 | 说明 |
|---|---|
| 🎮 **版本下载与启动** | 自动识别你电脑上**所有** `.minecraft`（含 PCL 版本隔离、整合包实例），列出能启动的版本；也能直接从 Mojang 官方源下载安装任意版本。**缺文件一键补全**（依赖库 / 客户端 jar / 资源文件） |
| ⚡ **一键开服** | 点一下创建 **Paper / Fabric / 原版**服务器并启动，自带控制台可以打字发命令；自动挑对 Java 版本 |
| 🌐 **异地联机** | 支持虚拟组网（Radmin / ZeroTier / Tailscale）和**内网穿透**（bore / playit.gg / ngrok / frp）；玩家页支持粘贴地址、TCP 连通与延迟测试、版本/Mod 一致性对比 |
| 📦 **资源下载** | 从 Modrinth / CurseForge 搜索下载 **Mod / 整合包 / 资源包 / 光影包 / 数据包**；整合包会装成**独立实例**，不污染原有版本 |
| 🧾 **崩溃日志解析** | 导入 `latest.log` 或 crash-report，自动判断崩溃原因并给出中文/英文优化建议 |
| 🧱 **蓝图 3D 预览** | 导入 `.litematic`，鼠标拖拽旋转、滚轮缩放，实时 3D 预览（three.js） |
| 🖼️ **JPG 转 PNG** | 批量转换，可自定义输出目录 |
| 📡 **服务器查询** | 输入 IP 查在线人数、版本、MOTD、延迟、玩家列表、服务器图标 |
| 🔑 **正版登录** | 微软账户登录（Xbox Live → XSTS → Minecraft 服务），保存令牌并自动续期 |
| 🌏 **中英文切换** | 界面与所有提示支持中文 / English，实时切换并记住 |

### 下载

到 [Releases](https://github.com/hehehegood6723/MCToolbox/releases) 下载压缩包，解压后双击 `MCToolbox.exe`，**不需要安装 Java 或 Node**。

> ⚠️ **不要把程序放在 OneDrive / 网盘同步目录里！**
> OneDrive 的「按需下载」会把 Electron 的文件变成占位符，导致双击后闪退、没有任何反应。
> 请放在 `C:\MCToolbox` 或 `D:\MCToolbox` 这类本地目录。

### 系统要求

- Windows 10 / 11（64 位）
- 想启动游戏的话需要 Java：**1.21.x 需要 Java 21**，1.18~1.20.4 需要 Java 17，1.16 及更早需要 Java 8
  （工具箱会自动从你机器上挑一个符合要求的 Java）

### 从源码运行 / 构建

```bash
# 1. 克隆
git clone https://github.com/hehehegood6723/MCToolbox.git
cd MCToolbox

# 2. 装依赖（只需要 three 和 electron）
npm install

# 3. 直接跑
npm start

# 4. 跑测试（180+ 项，包含真实网络与文件操作）
npm test

# 5. 打包成免安装 exe（Windows）
npm run build
```

打包脚本 `build.ps1` 会把 Electron 解压到输出目录、把源码放进 `resources/app`、再把 `electron.exe` 改名成 `MCToolbox.exe`。
它默认输出到 `C:\MCToolbox`，可以自己改：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1 -OutDir "D:\MyBuild"
```

> 打包脚本需要一份 Electron 的 Windows 发行包（`build\electron.zip`）。
> 从 [Electron Releases](https://github.com/electron/electron/releases) 下载 `electron-v33.x.x-win32-x64.zip` 放到 `build\` 目录即可。

### 常见问题

**Q：双击没反应 / 一闪而过？**
先看有没有放在 OneDrive 里（见上面的警告）。还不行就看诊断日志：`%TEMP%\mctoolbox-boot.log`。

**Q：开服报 `UnsupportedClassVersionError`（class file version 65.0 之类）？**
Java 版本不对。`65.0` = Java 21，`61.0` = Java 17。工具箱会自动挑 Java，但如果你机器上没有够用的版本就会提示你装。

**Q：搜索 Mod 失败 / 一直转圈？**
部分运营商 DNS 会**劫持** `modrinth.com` 的解析。工具箱内置了 DoH（加密 DNS）自动兜底，正常情况下无感。
如果连兜底也不行，把电脑 DNS 改成 `223.5.5.5` 或 `119.29.29.29`。

**Q：模组数量显示不对？**
MC 的 mod 可能放在三个地方：共享的 `.minecraft\mods`、PCL 版本隔离的 `versions\<版本名>\mods`、整合包实例自己的目录。
工具箱三种都会统计，**点一下某个版本就会显示它真正的 mods 路径**。找不到的话可以手动指定目录。

**Q：CurseForge 搜不到东西？**
CurseForge 官方要求 API Key，去 [console.curseforge.com](https://console.curseforge.com) 申请后填到「设置」里。
用 Modrinth 不需要任何配置。

**Q：想让朋友"只输 IP 就能连"，他们不想装 Radmin？**
用「一键开服」→ 控制台下方的「③ 让朋友直接连」→「公开服务器」。默认用 **bore**：不用注册、不用认领，点一下就给一个 `bore.pub:端口`，朋友直接输入就能进。

### 技术说明

- **没有用任何 Minecraft 协议库**：Server List Ping、NBT 解析、litematic 位解压、版本 JSON 继承合并、离线 UUID（MD5）、zip 解压、asar 打包全部手写实现
- **版本 JSON 继承**：支持 `整合包 → Fabric → 原版` 这样的多级继承合并
- **DNS 兜底**：请求失败且错误像证书/DNS 问题时，自动用 DoH（阿里 223.5.5.5）查真实 IP 重试一次
- **GitHub 加速**：下载 GitHub Releases 失败时自动换 `ghproxy.net` / `gh-proxy.com` 镜像
- **界面 3D**：three.js + InstancedMesh 渲染体素蓝图
- **多语言**：静态文本走中心词典 + DOM 遍历，动态文本用行内双语 `t('中文','English')` / `M('中文','English')`

### 隐私

- 工具箱**不会上传你的任何数据**，所有配置都存在本地（`%APPDATA%\mc-toolbox\`）
- 微软登录的 refresh token 用系统加密 API（Electron `safeStorage`）加密后保存，可随时「退出登录」清除
- 会联网的地方只有：Mojang 官方源、Modrinth / CurseForge、以及你自己选择启用的穿透服务

### 免责声明

- 本项目**与 Mojang / Microsoft 没有任何关系**，也不包含任何 Minecraft 游戏文件或素材
- 「正版登录」用的是公开的微软授权流程；第三方启动器使用微软官方 client_id 可能不符合微软条款，**使用者需自行承担风险**
- 内置的 bore / playit.gg / ngrok 走的是第三方免费中转服务，请自行评估隐私风险
- 请支持正版 Minecraft

---

## 📖 English docs

### What is this

A Windows desktop toolbox (Electron) for **Minecraft Java Edition players** that bundles the jobs you would otherwise need several programs for:

| Feature | Description |
|---|---|
| 🎮 **Version manager & launcher** | Finds **every** `.minecraft` on your PC (including PCL isolated versions and modpack instances) and lists the launchable ones. Can also download any version straight from Mojang. **One-click repair** for missing libraries / client jar / assets |
| ⚡ **One-click server** | Create and start a **Paper / Fabric / Vanilla** server in one click, with a built-in console for typing commands. Picks the right Java automatically |
| 🌐 **Play together** | Virtual LAN (Radmin / ZeroTier / Tailscale) and **tunneling** (bore / playit.gg / ngrok / frp). The player page can paste an address, run TCP + latency tests and compare version/mod consistency |
| 📦 **Download content** | Search and download **mods / modpacks / resource packs / shaders / data packs** from Modrinth and CurseForge. Modpacks install as **isolated instances** |
| 🧾 **Crash log analyzer** | Import `latest.log` or a crash-report and get a diagnosis plus concrete advice |
| 🧱 **Blueprint 3D viewer** | Import `.litematic` and inspect it in real-time 3D (drag to rotate, wheel to zoom) |
| 🖼️ **JPG to PNG** | Batch conversion with a configurable output folder |
| 📡 **Server lookup** | Enter an IP to see players online, version, MOTD, latency, player list and favicon |
| 🔑 **Microsoft sign-in** | Xbox Live → XSTS → Minecraft services, with token storage and silent refresh |
| 🌏 **Bilingual UI** | Chinese / English, switchable on the fly and remembered |

### Download

Grab a zip from [Releases](https://github.com/hehehegood6723/MCToolbox/releases), extract it and double-click `MCToolbox.exe`. **No Java or Node install required.**

> ⚠️ **Do not put the app in OneDrive or any cloud-sync folder.**
> OneDrive Files On-Demand turns Electron's files into placeholders and the app will exit silently on launch.
> Use a local path such as `C:\MCToolbox`.

### Requirements

- Windows 10 / 11 (64-bit)
- To launch the game you need a suitable Java: **1.21.x needs Java 21**, 1.18–1.20.4 need Java 17, 1.16 and older need Java 8.
  The toolbox picks a matching Java for you automatically.

### Build from source

```bash
git clone https://github.com/hehehegood6723/MCToolbox.git
cd MCToolbox
npm install      # only needs three + electron
npm start        # run it
npm test         # 180+ assertions, including real network and file operations
npm run build    # build a portable .exe (Windows)
```

`build.ps1` extracts Electron into the output folder, copies the sources into `resources/app` and renames `electron.exe` to `MCToolbox.exe`.
Output defaults to `C:\MCToolbox` and can be changed with `-OutDir`.

> The build script expects an Electron Windows distribution at `build\electron.zip`.
> Download `electron-v33.x.x-win32-x64.zip` from [Electron Releases](https://github.com/electron/electron/releases) into `build\`.

### FAQ

**Nothing happens when I double-click it.** Check the OneDrive warning above, then look at `%TEMP%\mctoolbox-boot.log`.

**Starting a server throws `UnsupportedClassVersionError`.** Wrong Java version — `65.0` means Java 21, `61.0` means Java 17.

**Mod search fails or hangs.** Some ISPs hijack DNS for `modrinth.com`. The toolbox has a built-in DoH fallback; if that still fails, set your DNS to `223.5.5.5`.

**The mod count looks wrong.** Minecraft mods can live in the shared `.minecraft\mods`, in a PCL-isolated `versions\<name>\mods`, or inside a modpack instance. The toolbox counts all three — click a version to see its real mods path, or point it at a folder manually.

**CurseForge returns nothing.** CurseForge requires an API key ([console.curseforge.com](https://console.curseforge.com)); Modrinth needs no configuration.

**My friends don't want to install Radmin.** Use Host a Server → "Let friends join directly" → "Make public". The default `bore` needs no sign-up: it gives you a `bore.pub:port` address your friends can type straight in.

### Disclaimer

- This project is **not affiliated with Mojang or Microsoft** and ships **no Minecraft game files or assets**
- Sign-in uses the public Microsoft OAuth flow; using Microsoft's own client_id from a third-party launcher may not comply with Microsoft's terms — **use at your own risk**
- bore / playit.gg / ngrok are third-party free relay services — evaluate the privacy implications yourself
- Please buy Minecraft if you play it

---

## 🗂 项目结构 / Project structure

```
main.js                 Electron 主进程：窗口、托盘、所有 IPC
preload.js              contextBridge 暴露给界面的 API
src/
  i18n.js               主进程侧多语言 M('中文','English')
  auth.js               微软正版登录（OAuth → XBL → XSTS → Minecraft）
  account.js            登录信息加密存储
  mcrun.js              版本 JSON 解析/继承合并、依赖库、JVM 参数、启动
  mcscan.js             扫描游戏目录、版本隔离识别、安装目标检测
  server.js             Paper / Fabric / 原版 服务端创建与进程管理
  tunnel.js             bore / playit / ngrok / frp 内网穿透
  lan.js                网卡识别、虚拟组网、LAN 端口、防火墙、连通性测试
  mods.js               Modrinth / CurseForge 分类搜索与下载
  modpack.js            .mrpack / CurseForge 整合包安装（独立实例）
  crashlog.js           崩溃日志规则引擎
  litematic.js          .litematic 解析（位解压）
  nbt.js                极简 NBT 解析器
  serverping.js         Minecraft Server List Ping
  doh.js                DNS 被劫持时的加密 DNS 兜底
  account.js / mods.js ...
renderer/
  index.html            界面结构
  app.js                界面逻辑
  i18n.js               界面多语言词典 + DOM 遍历
  style.css             浅蓝 + 白 主题
  vendor/three.module.js  three.js（内置，无需 npm）
  assets/               托盘图标、捐款二维码
test/run-tests.js       测试套件（180+ 项）
build.ps1               免安装 exe 打包脚本
```

## 🤝 贡献 / Contributing

欢迎提 Issue 和 PR！

1. Fork 本仓库
2. 新建分支：`git checkout -b feature/your-feature`
3. 改完先跑测试：`npm test`（必须全绿）
4. 提交并发起 Pull Request

**多语言注意事项**：新增任何用户可见的文字，请同时提供中英文 —— 主进程用 `M('中文','English')`，界面动态文本用 `t('中文','English')`，界面静态文本请往 `renderer/i18n.js` 的 `HTML_DICT` 里加一条。

**Adding user-visible text?** Please provide both languages: use `M('中文','English')` in the main process, `t('中文','English')` for dynamic renderer strings, and add an entry to `HTML_DICT` in `renderer/i18n.js` for static HTML.

## ❤️ 支持作者 / Donate

如果这个工具箱帮到你了，可以请作者喝杯奶茶（完全自愿，不影响任何功能）：

<img src="renderer/assets/donate.jpg" width="200" alt="微信收款码">

## 📄 License

[MIT](LICENSE) © 2026 hehehegood6723
