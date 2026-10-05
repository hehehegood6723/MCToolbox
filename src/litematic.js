const fs = require('fs');
const zlib = require('zlib');
const nbt = require('./nbt');
const { M } = require('./i18n');

/** litematic 蓝图解析：解压 -> NBT -> 解码位压缩方块数组 -> 生成 3D 预览数据 */

const MAX_BLOCKS = 150000;

// ---------------- 颜色表 ----------------

const EXACT = {
  stone: '#7d7d7d',
  cobblestone: '#6f6f6f',
  mossy_cobblestone: '#5d6b4a',
  smooth_stone: '#9a9a9a',
  stone_bricks: '#787878',
  mossy_stone_bricks: '#67735a',
  cracked_stone_bricks: '#6e6e6e',
  chiseled_stone_bricks: '#757575',
  granite: '#9a6560',
  diorite: '#c9c9cb',
  andesite: '#8b8b8d',
  deepslate: '#4d4d51',
  cobbled_deepslate: '#4b4b4f',
  polished_deepslate: '#4a4a4e',
  tuff: '#6b6b62',
  calcite: '#dfded8',
  dirt: '#8b6544',
  coarse_dirt: '#7c5a3c',
  rooted_dirt: '#8a6a4a',
  grass_block: '#6a9b3d',
  podzol: '#5c3f1c',
  mycelium: '#6f6470',
  farmland: '#6b4a2a',
  sand: '#dbd2a0',
  red_sand: '#bf6a23',
  gravel: '#837f7c',
  clay: '#a4a8b8',
  sandstone: '#d9d1a2',
  red_sandstone: '#c66b22',
  bedrock: '#555555',
  obsidian: '#150d20',
  crying_obsidian: '#241a3c',
  netherrack: '#713434',
  soul_sand: '#544232',
  soul_soil: '#4a3a2c',
  magma_block: '#8e420f',
  glowstone: '#f4d17a',
  end_stone: '#dbdfa4',
  purpur_block: '#aa7daa',
  prismarine: '#63a297',
  dark_prismarine: '#33574a',
  sea_lantern: '#c6dcd5',
  terracotta: '#9a5a3c',
  bricks: '#96564b',
  snow_block: '#f4fafa',
  ice: '#a5c9f0',
  packed_ice: '#93b8e8',
  blue_ice: '#74a3f0',
  water: '#3a63c8',
  lava: '#e0641b',
  glass: '#c8e6f2',
  iron_block: '#d6d6d6',
  gold_block: '#f6e04c',
  diamond_block: '#5ce6d6',
  emerald_block: '#2fe06a',
  redstone_block: '#c81e1e',
  lapis_block: '#1e4fc8',
  coal_block: '#191919',
  netherite_block: '#3b3336',
  copper_block: '#c1714f',
  quartz_block: '#eae6dd',
  smooth_quartz: '#ece8df',
  hay_block: '#c3a01f',
  bookshelf: '#9d8657',
  crafting_table: '#8a6a44',
  furnace: '#7a7a7a',
  chest: '#9a7c45',
  barrel: '#8a6c3c',
  oak_planks: '#b58a4d',
  spruce_planks: '#7a5a34',
  birch_planks: '#d7c99a',
  jungle_planks: '#b0865a',
  acacia_planks: '#ba6236',
  dark_oak_planks: '#4c3018',
  mangrove_planks: '#7a3b2e',
  cherry_planks: '#e3b7b0',
  bamboo_planks: '#c5a758',
  crimson_planks: '#6a2b47',
  warped_planks: '#2b6a5e',
  oak_log: '#6b5433',
  spruce_log: '#4b3621',
  birch_log: '#d7cba3',
  jungle_log: '#57431f',
  acacia_log: '#6a5533',
  dark_oak_log: '#3b2c17',
  cherry_log: '#3a2424',
  stripped_oak_log: '#b3945f',
  stripped_spruce_log: '#7a5a34',
  oak_leaves: '#3f7f2a',
  spruce_leaves: '#2f5a2a',
  birch_leaves: '#5f9c46',
  jungle_leaves: '#2f7a24',
  acacia_leaves: '#5c8f2c',
  dark_oak_leaves: '#2f6b21',
  azalea_leaves: '#4c8a34',
  flowering_azalea_leaves: '#5d9440',
  torch: '#f2c14a',
  lantern: '#e0a94a',
  sea_pickle: '#4a7a3a',
  glow_lichen: '#7a9a80',
  shroomlight: '#e08a3a',
  honey_block: '#e0a33a',
  slime_block: '#6fcc50',
  nether_wart_block: '#7a1a1a',
  warped_wart_block: '#1a6a6a',
  target: '#e8e0d0',
  lodestone: '#8a8a8a',
  anvil: '#4a4a4a',
  cauldron: '#3a3a3a',
  beacon: '#6ce0d0',
  conduit: '#9ad8d0',
  sculk: '#1d2b2b',
  sculk_catalyst: '#1a3333',
  amethyst_block: '#8a5cc8',
  budding_amethyst: '#9a6cd8',
  ochre_froglight: '#e0dca0',
  verdant_froglight: '#a0e0a8',
  pearlescent_froglight: '#e8c8e0',
  mud: '#3c3a4a',
  packed_mud: '#8a6844',
  dripstone_block: '#8a7060',
  pointed_dripstone: '#8a7060',
  cobweb: '#e8e8e8',
  iron_bars: '#a0a0a0',
  ladder: '#9a7c45',
  rail: '#9a9a9a',
  glass_pane: '#c8e6f2',
};

const DYE = {
  white: '#e9ecec',
  orange: '#f07613',
  magenta: '#bd44b3',
  light_blue: '#3ab3da',
  yellow: '#f8c627',
  lime: '#70b919',
  pink: '#ed8dac',
  gray: '#3e4447',
  light_gray: '#8e8e86',
  cyan: '#158991',
  purple: '#792aac',
  blue: '#35399d',
  brown: '#724728',
  green: '#546d1b',
  red: '#a12722',
  black: '#141519',
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function mix(hex, target, t) {
  const [r, g, b] = hexToRgb(hex);
  const [tr, tg, tb] = hexToRgb(target);
  return rgbToHex(r + (tr - r) * t, g + (tg - g) * t, b + (tb - b) * t);
}
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return rgbToHex(120 + (h % 100), 130 + ((h >> 8) % 90), 140 + ((h >> 16) % 90));
}

function colorOf(fullName) {
  const name = fullName.replace(/^minecraft:/, '');
  const isGlass = name.includes('glass');
  if (EXACT[name]) return { color: EXACT[name], glass: isGlass };

  const m = name.match(
    /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(.+)$/
  );
  if (m) {
    const base = DYE[m[1]];
    const mat = m[2];
    if (mat.startsWith('stained_glass')) return { color: mix(base, '#ffffff', 0.25), glass: true };
    if (mat === 'concrete' || mat === 'concrete_powder') return { color: base, glass: false };
    if (mat === 'wool' || mat === 'carpet') return { color: mix(base, '#ffffff', 0.12), glass: false };
    if (mat.includes('terracotta')) return { color: mix(base, '#8a5a44', 0.45), glass: false };
    if (mat === 'shulker_box' || mat === 'bed' || mat === 'banner') return { color: base, glass: false };
  }

  if (name.includes('glass')) return { color: '#c8e6f2', glass: true };
  if (name.endsWith('_planks')) return { color: '#b58a4d', glass: false };
  if (name.endsWith('_log') || name.endsWith('_wood')) return { color: '#6b5433', glass: false };
  if (name.endsWith('_leaves')) return { color: '#3f7f2a', glass: false };
  if (name.endsWith('_concrete')) return { color: '#9a9a9a', glass: false };
  if (name.endsWith('_wool')) return { color: '#dcdcdc', glass: false };

  return { color: hashColor(name), glass: false };
}

// ---------------- 位压缩解码 ----------------

function readBits(longs, index, bits) {
  const perLong = 64;
  const startBit = index * bits;
  const startLong = Math.floor(startBit / perLong);
  const offset = startBit % perLong;
  const mask = (1n << BigInt(bits)) - 1n;

  let value = BigInt(longs[startLong]) >> BigInt(offset);
  const bitsLeft = perLong - offset;
  if (bitsLeft < bits && startLong + 1 < longs.length) {
    value |= BigInt(longs[startLong + 1]) << BigInt(bitsLeft);
  }
  return Number(value & mask);
}

function load(filePath) {
  const raw = fs.readFileSync(filePath);
  let buf = raw;
  if (raw[0] === 0x1f && raw[1] === 0x8b) buf = zlib.gunzipSync(raw);

  const root = nbt.parse(buf);
  if (!root) throw new Error(M('无法解析 NBT（文件可能不是 litematic）', 'Could not parse the NBT (the file may not be a litematic)'));
  if (!root.Regions) throw new Error(M('这不是 litematic 文件（缺少 Regions）', 'This is not a litematic file (Regions is missing)'));

  const meta = root.Metadata || {};
  const enclosing = meta.EnclosingSize || { x: 0, y: 0, z: 0 };

  // 收集所有区域的方块
  const paletteNames = [];
  const paletteIndex = new Map();
  const positions = [];

  const regionNames = Object.keys(root.Regions);
  for (const rn of regionNames) {
    const region = root.Regions[rn];
    if (!region || !region.BlockStates || !region.BlockStatePalette) continue;
    const pal = region.BlockStatePalette;
    const longs = region.BlockStates.map((v) => BigInt.asUintN(64, BigInt(v)));
    const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, pal.length))));

    const size = region.Size || { x: 0, y: 0, z: 0 };
    const pos = region.Position || { x: 0, y: 0, z: 0 };
    const sx = Math.abs(size.x), sy = Math.abs(size.y), sz = Math.abs(size.z);

    // 区域可能带负号（相对原点方向），统一取整
    const ox = pos.x, oy = pos.y, oz = pos.z;

    let idx = 0;
    for (let y = 0; y < sy; y++) {
      for (let z = 0; z < sz; z++) {
        for (let x = 0; x < sx; x++) {
          const pi = readBits(longs, idx++, bits);
          const entry = pal[pi];
          if (!entry || !entry.Name) continue;
          if (entry.Name === 'minecraft:air' || entry.Name === 'minecraft:cave_air' || entry.Name === 'minecraft:void_air') continue;

          let key = entry.Name;
          if (entry.Properties && Object.keys(entry.Properties).length) {
            key += '[' + Object.entries(entry.Properties).map(([k, v]) => k + '=' + v).join(',') + ']';
          }
          let pidx = paletteIndex.get(key);
          if (pidx === undefined) {
            pidx = paletteNames.length;
            paletteIndex.set(key, pidx);
            paletteNames.push(key);
          }
          if (positions.length / 4 < MAX_BLOCKS) {
            // 世界坐标：区域坐标是不对称的，统一做偏移
            const wx = size.x < 0 ? ox - x : ox + x;
            const wy = oy + y;
            const wz = size.z < 0 ? oz - z : oz + z;
            positions.push(wx, wy, wz, pidx);
          }
        }
      }
    }
  }

  const total = positions.length / 4;

  // 归一化到以 0 为中心
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 4) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  for (let i = 0; i < positions.length; i += 4) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }

  const palette = paletteNames.map((key) => {
    const id = key.split('[')[0];
    const c = colorOf(id);
    return { key, id, color: c.color, glass: c.glass };
  });

  return {
    file: filePath,
    name: (meta.Name && String(meta.Name)) || require('path').basename(filePath, '.litematic'),
    author: meta.Author ? String(meta.Author) : '',
    description: meta.Description ? String(meta.Description) : '',
    mcDataVersion: root.MinecraftDataVersion || null,
    size: { x: Math.abs(enclosing.x), y: Math.abs(enclosing.y), z: Math.abs(enclosing.z) },
    regions: regionNames.length,
    totalBlocks: total,
    truncated: total >= MAX_BLOCKS,
    palette,
    data: positions,
  };
}

module.exports = { load, colorOf };
