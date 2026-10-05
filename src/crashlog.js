const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { M } = require('./i18n');

/**
 * 崩溃日志分析：按关键字归类出「崩溃原因」+「优化建议」，
 * 并额外提取 Java 版本、内存、模组数量等环境信息。
 */

// 每次分析时重建：语言可能在窗口启动后才通过 IPC 切换
const buildRules = () => [
  {
    id: 'oom',
    test: /OutOfMemoryError|Java heap space|GC overhead limit exceeded|unable to create new native thread/i,
    title: M('内存不足 (OutOfMemoryError)', 'Out of memory (OutOfMemoryError)'),
    reason: M(
      '游戏分配到的内存被耗尽，整合包/大量模组时最常见。',
      'The memory allocated to the game ran out - most common with modpacks or a large number of mods.'
    ),
    advice: [
      M('把启动器里的最大内存调大，例如 -Xmx4G ~ -Xmx8G', 'Increase the maximum memory in your launcher, for example -Xmx4G to -Xmx8G'),
      M('确认用的是 64 位 Java（32 位最多只能用约 1.5GB）', 'Make sure you are using 64-bit Java (32-bit is limited to about 1.5GB)'),
      M('减少同时加载的模组数量，尤其是大型整合包', 'Load fewer mods at the same time, especially with large modpacks'),
      M('降低渲染距离、关闭光影、换用更低分辨率的材质包', 'Lower the render distance, turn off shaders, and use a lower-resolution resource pack'),
    ],
  },
  {
    id: 'unsupported-class',
    test: /UnsupportedClassVersionError|class file version (\d+)/i,
    title: M('Java 版本不匹配', 'Java version mismatch'),
    reason: M('当前 Java 版本低于该 Minecraft 版本/模组要求。', 'Your Java version is lower than what this Minecraft version/mod requires.'),
    advice: [
      M('1.17+ 需要 Java 17，1.20.5+ / 1.21+ 建议 Java 21', '1.17+ requires Java 17; 1.20.5+ / 1.21+ works best with Java 21'),
      M('在启动器里切换 Java 路径到 21（或对应版本）', 'Switch the Java path in your launcher to 21 (or the matching version)'),
      M('换了 Java 后请重新下载对应的 Forge/Fabric 安装包', 'After changing Java, re-download the matching Forge/Fabric installer'),
    ],
  },
  {
    id: 'missing-dep',
    test: /Missing or unsupported mandatory dependencies|Missing dependency|requires .* which is missing|Mod .* requires .*/i,
    title: M('模组缺少前置依赖', 'Mod is missing a required dependency'),
    reason: M('某个模组依赖的其他模组没有安装，或版本不匹配。', 'A mod depends on another mod that is not installed, or whose version does not match.'),
    advice: [
      M('按日志里提示的名字去补齐前置模组', 'Install the missing dependency mods using the names shown in the log'),
      M('常见前置：Fabric API、Architectury API、Cloth Config、GeckoLib、Kotlin 库', 'Common dependencies: Fabric API, Architectury API, Cloth Config, GeckoLib, Kotlin libraries'),
      M('确保前置模组的版本区间覆盖你的游戏版本', 'Make sure the dependency version range covers your game version'),
    ],
  },
  {
    id: 'duplicate',
    test: /DuplicateModsFoundException|Duplicate mods|Found duplicate mods|已找到重复/i,
    title: M('存在重复模组', 'Duplicate mods found'),
    reason: M('mods 文件夹里同一个模组放了多个版本。', 'The mods folder contains several versions of the same mod.'),
    advice: [
      M('打开 .minecraft/mods 删除旧版本，只保留一个版本', 'Open .minecraft/mods, delete the old version and keep only one copy'),
      M('注意 .jar.disabled / .jar.bak 之类也要清理', 'Also clean up leftovers such as .jar.disabled / .jar.bak'),
    ],
  },
  {
    id: 'mixin',
    test: /Mixin apply failed|MixinTransformerError|Mixin.*failed|mixin.*refmap/i,
    title: M('Mixin 注入失败（模组不兼容）', 'Mixin injection failed (incompatible mods)'),
    reason: M('模组改写了游戏代码但目标不一致，通常是模组之间冲突或版本不匹配。', 'A mod rewrote game code but the target does not match - usually a conflict between mods or a version mismatch.'),
    advice: [
      M('把报错里提到的那个模组单独移除后测试', 'Remove just the mod named in the error, then test again'),
      M('检查是否有同功能的两个模组同时安装', 'Check whether two mods that do the same thing are installed at once'),
      M('升级/降级冲突模组到与该 Minecraft 版本匹配的版本', 'Upgrade/downgrade the conflicting mod to a build that matches your Minecraft version'),
    ],
  },
  {
    id: 'linkage',
    test: /NoSuchMethodError|NoSuchFieldError|IllegalAccessError|AbstractMethodError|IncompatibleClassChangeError|VerifyError/i,
    title: M('模组冲突（方法/字段找不到）', 'Mod conflict (missing method/field)'),
    reason: M('某个模组调用了已被其他模组或游戏本体改动的方法。', 'A mod called a method that another mod or the game itself has changed.'),
    advice: [
      M('这种多半是「模组冲突」，逐个禁用最近新加的模组定位', 'This is usually a mod conflict - disable your recently added mods one by one to find the culprit'),
      M('特别留意同类的优化模组（如多个渲染优化同时装）', 'Pay special attention to similar performance mods (for example several rendering optimizers installed together)'),
      M('确保所有模组都是同一游戏版本的构建', 'Make sure every mod is built for the same game version'),
    ],
  },
  {
    id: 'gl',
    test: /Pixel format not accelerated|GLFW error|OpenGL|WGL|Failed to create window|EXCEPTION_ACCESS_VIOLATION/i,
    title: M('显卡 / OpenGL 问题', 'Graphics card / OpenGL problem'),
    reason: M('显卡驱动异常，或 JVM 底层崩溃（EXCEPTION_ACCESS_VIOLATION）。', 'A graphics driver problem, or a low-level JVM crash (EXCEPTION_ACCESS_VIOLATION).'),
    advice: [
      M('更新显卡驱动（NVIDIA / AMD / Intel 官网驱动）', 'Update your graphics driver (use the official NVIDIA / AMD / Intel driver)'),
      M('关掉显卡超频、关闭「硬件加速 GPU 计划」再试', 'Turn off GPU overclocking and "Hardware-accelerated GPU scheduling", then try again'),
      M('删除 options.txt 里的图形设置重开', 'Delete the graphics settings in options.txt and start the game again'),
      M('如用笔记本双显卡，强制用独显运行 Java', 'On a laptop with dual GPUs, force Java to run on the dedicated GPU'),
    ],
  },
  {
    id: 'network',
    test: /UnknownHostException|Connection timed out|ConnectException|Failed to download|SocketException|Read timed out/i,
    title: M('网络连接失败', 'Network connection failed'),
    reason: M('下载资源 / 依赖时连不上服务器。', 'The game could not reach the server while downloading assets/dependencies.'),
    advice: [
      M('检查网络与代理设置', 'Check your network and proxy settings'),
      M('国内可给启动器配置国内镜像源', 'Players in mainland China can configure a domestic mirror source in the launcher'),
      M('用离线模式先进入游戏，再补下资源', 'Launch the game in offline mode first, then download the missing assets afterwards'),
    ],
  },
  {
    id: 'forge-load',
    test: /LoadingFailedException|has failed to load correctly|Mod loading has failed|Forge mod loading|fml\.i18n/i,
    title: M('Forge 加载模组失败', 'Forge failed to load a mod'),
    reason: M('Forge 在加载阶段就判定模组不可用（通常是版本或依赖问题）。', 'Forge rejected a mod during loading (usually a version or dependency problem).'),
    advice: [
      M('查看日志里紧跟其后的 "Caused by" 段落，那里才是真正原因', 'Read the "Caused by" section right after it in the log - that is the real cause'),
      M('确认 Forge 版本与 Minecraft 版本对应', 'Make sure the Forge version matches your Minecraft version'),
      M('删除最近新加入的模组后再启动', 'Remove the mods you added most recently, then start the game again'),
    ],
  },
  {
    id: 'fabric-resolve',
    test: /Mod resolution failed|Failed to start Minecraft|fabric.*resolve/i,
    title: M('Fabric 模组解析失败', 'Fabric mod resolution failed'),
    reason: M('存在版本区间不满足的模组或缺失前置。', 'Some mod has an unsatisfied version range, or a dependency is missing.'),
    advice: [
      M('日志会明确写出 "requires version X of Y"，按提示替换', 'The log states "requires version X of Y" - replace the mod as indicated'),
      M('确认 Fabric Loader / Fabric API 为较新版本', 'Make sure Fabric Loader / Fabric API are reasonably up to date'),
    ],
  },
  {
    id: 'npe-mod',
    test: /NullPointerException|ArrayIndexOutOfBoundsException|IndexOutOfBoundsException/i,
    title: M('模组内部空指针 / 越界异常', 'Null pointer / index out of bounds inside a mod'),
    reason: M('某个模组代码出错，常见于不匹配的版本。', 'A mod has a bug in its code, which is common with mismatched versions.'),
    advice: [
      M('看堆栈里第一个非 minecraft/net.minecraft 开头的包名，那就是出问题的模组', 'Look at the first package name in the stack that does not start with minecraft/net.minecraft - that is the mod at fault'),
      M('把该模组升级或移除', 'Update or remove that mod'),
    ],
  },
];

function readText(filePath) {
  const buf = fs.readFileSync(filePath);
  // .gz 日志先解压
  if (filePath.toLowerCase().endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b)) {
    try {
      return zlib.gunzipSync(buf).toString('utf8');
    } catch (e) {
      /* 不是 gzip，按文本处理 */
    }
  }
  return buf.toString('utf8');
}

function flattenChat(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenChat).join('');
  let out = node.text || '';
  if (node.extra) out += flattenChat(node.extra);
  return out;
}

function analyze(filePath) {
  const raw = readText(filePath);
  const lines = raw.split(/\r?\n/);

  const hits = [];
  for (const rule of buildRules()) {
    const m = raw.match(rule.test);
    if (m) {
      // 找到第一次出现所在行，方便定位
      const idx = lines.findIndex((l) => rule.test.test(l));
      hits.push({
        id: rule.id,
        title: rule.title,
        reason: rule.reason,
        advice: rule.advice,
        line: idx >= 0 ? idx + 1 : null,
        sample: idx >= 0 ? lines[idx].trim().slice(0, 300) : String(m[0]).slice(0, 300),
      });
    }
  }

  // 提取关键堆栈行（前几条 Caused by / at）
  const causes = [];
  for (let i = 0; i < lines.length && causes.length < 12; i++) {
    const l = lines[i].trim();
    if (/^(Caused by:|java\.|net\.minecraftforge\.|net\.fabricmc\.|org\.spongepowered\.)/.test(l)) {
      causes.push({ line: i + 1, text: l.slice(0, 300) });
    }
  }

  // 环境信息
  const env = {};
  const grab = (re) => {
    const m = raw.match(re);
    return m ? m[1].trim() : null;
  };
  env.java = grab(/Java Version:\s*([^\n,]+)/i) || grab(/Java version\s*([^\n,]+)/i);
  env.mcVersion = grab(/Minecraft Version:\s*([^\n,]+)/i) || grab(/--fml\.mcVersion\s+(\S+)/);
  env.os = grab(/(?:Operating System|OS):\s*([^\n]+)/i);
  env.cpu = grab(/(?:CPU|Processor):\s*([^\n]+)/i);
  const mem = raw.match(
    /Memory:\s*(\d+)\s*bytes\s*\((\d+)\s*MB\)\s*\/\s*(\d+)\s*bytes\s*\((\d+)\s*MB\)\s*up to\s*(\d+)\s*bytes\s*\((\d+)\s*MB\)/i
  );
  if (mem) {
    env.memory = M('已用 ', 'Used ') + mem[2] + M('MB / 上限 ', 'MB / Max ') + mem[6] + 'MB';
  } else {
    const mem2 = raw.match(/(\d+)\s*MB\s*up to\s*(\d+)\s*MB/i);
    if (mem2) env.memory = M('已用 ', 'Used ') + mem2[1] + M('MB / 上限 ', 'MB / Max ') + mem2[2] + 'MB';
  }
  const modCount = raw.match(/Loaded (\d+) mods/i) || raw.match(/(\d+) mods? loaded/i);
  if (modCount) env.modCount = modCount[1];
  env.lines = lines.length;
  env.size = (fs.statSync(filePath).size / 1024).toFixed(1) + ' KB';

  // 崩溃标题（"The game crashed whilst ..."）
  const crashTitle = grab(/The game crashed whilst ([^\n]+)/i);

  // 汇总结论
  let summary;
  if (hits.length === 0) {
    summary = M(
      '没有匹配到已知的典型错误特征。可以看看下面的关键堆栈行，或把日志发到社区求助。',
      'No known common error patterns were matched. Take a look at the key stack lines below, or post the log in a community forum for help.'
    );
  } else {
    summary = M('检测到 ', 'Detected ') + hits.length + M(' 类可疑问题，可能性最高的：', ' suspicious issue(s); most likely: ') + hits[0].title;
  }

  return { file: filePath, name: path.basename(filePath), summary, crashTitle, hits, causes, env };
}

/** 在 .minecraft 里找最近改动的崩溃日志 */
function findRecentLogs(mcFolder) {
  const out = [];
  const push = (p) => {
    try {
      const st = fs.statSync(p);
      out.push({ path: p, name: path.basename(p), mtime: st.mtimeMs, size: st.size });
    } catch (e) {
      /* ignore */
    }
  };
  if (!mcFolder || !fs.existsSync(mcFolder)) return out;
  for (const rel of ['logs/latest.log', 'logs/debug.log', 'crash-reports']) {
    const p = path.join(mcFolder, rel);
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        if (f.endsWith('.txt')) push(path.join(p, f));
      }
    } else {
      push(p);
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 20);
}

module.exports = { analyze, findRecentLogs, flattenChat };
