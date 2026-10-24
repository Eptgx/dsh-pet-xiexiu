/**
 * 从一份 dsh-pet 安装里提取桌宠运行时资源，生成 Android 悬浮桌宠要用的资源包。
 *
 * 产物（默认写到 pet-framework/assets/pet/）：
 *   ├─ config.json       动画池 / 权重 / 物理参数 + 动画名 → 文件名映射
 *   ├─ config.js         同上，但用 <script> 赋值（file:// 下 fetch 会被拦）
 *   ├─ shared-core.js    dsh-pet 的纯逻辑 bundle（选片 / 物理，window.PetShared）
 *   └─ anim/aNNN.webm    按索引重命名的透明动画（避开中文路径在 file:// 下的编码问题）
 *
 * 用法：
 *   node scripts/build-pet-assets.mjs <dsh-pet 目录> [输出目录]
 *
 * 说明：素材版权归各自作者所有，本仓库不附带任何动画文件。
 *       生成后记得再跑一次 scripts/analyze-anim-bounds.py 计算每段的内容包围盒。
 */
import { access, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(REPO_ROOT, 'assets', 'pet');

const srcArg = process.argv[2];
if (!srcArg) {
  console.error('用法：node scripts/build-pet-assets.mjs <dsh-pet 目录> [输出目录]');
  process.exit(1);
}
const srcDir = path.resolve(srcArg);
const OUT_DIR = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_OUT;

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 去掉 JSONC 的 // 与块注释（字符串内的 // 不动） */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

async function main() {
  const configPath = path.join(srcDir, 'assets', 'config.jsonc');
  const webmDir = path.join(srcDir, 'assets', 'webm');
  const sharedCore = path.join(srcDir, 'runtime', 'electron-helper', 'shared-core.js');

  for (const p of [configPath, webmDir, sharedCore]) {
    if (!(await exists(p))) throw new Error(`缺少输入：${p}`);
  }

  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(stripJsonc(raw));
  const anim = config.animations;

  // 随机链会用到的动画 + 说话池（碎碎念那三段，桌面聊天回复时用的就是它们）
  const used = new Set();
  const add = (name) => {
    if (typeof name === 'string' && name.trim() !== '') used.add(name);
  };
  (anim.idle ?? []).forEach(add);
  (anim.turn ?? []).forEach(add);
  (anim.drag ?? []).forEach(add);
  (anim.clicks ?? []).forEach(add);
  ((anim.moves && anim.moves.actions) || []).forEach((a) => add(a.name));
  for (const cat of anim.categories ?? []) (cat.actions ?? []).forEach(add);
  const talkAnims = (anim.events && anim.events.whisper) || [];
  talkAnims.forEach(add);

  const available = new Set(
    (await readdir(webmDir)).filter((f) => f.endsWith('.webm')).map((f) => f.slice(0, -5)),
  );
  const missing = [...used].filter((name) => !available.has(name));
  if (missing.length > 0) {
    throw new Error(`这些动画在 assets/webm 里找不到：${missing.join('、')}`);
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(path.join(OUT_DIR, 'anim'), { recursive: true });

  const files = {};
  const names = [...used].sort();
  let index = 0;
  let bytes = 0;
  for (const name of names) {
    index += 1;
    const id = `a${String(index).padStart(3, '0')}`;
    files[name] = id;
    const to = path.join(OUT_DIR, 'anim', `${id}.webm`);
    await cp(path.join(webmDir, `${name}.webm`), to);
    bytes += (await stat(to)).size;
  }

  await cp(sharedCore, path.join(OUT_DIR, 'shared-core.js'));

  const payload = {
    version: 1,
    source: 'dsh-pet',
    size: config.pets && config.pets[0] ? config.pets[0].size : 462,
    files,
    /** 说话池：TTS 朗读时随机抽一段循环播放（与桌面聊天回复同一套素材） */
    talkAnims,
    animations: {
      idle: anim.idle ?? [],
      turn: anim.turn ?? [],
      drag: anim.drag ?? [],
      clicks: anim.clicks ?? [],
      moves: anim.moves ?? { default: {}, actions: [] },
      categories: anim.categories ?? [],
    },
    animationWeights: config.animationWeights ?? { idle: 10, turn: 5, move: 5 },
    physics: config.physics ?? {},
  };
  const json = JSON.stringify(payload, null, 2);
  await writeFile(path.join(OUT_DIR, 'config.json'), `${json}\n`, 'utf8');
  // file:// 下 fetch('pet/config.json') 会被 CORS 拦掉，页面改用 <script> 直接赋值
  await writeFile(
    path.join(OUT_DIR, 'config.js'),
    `/* 自动生成：node scripts/build-pet-assets.mjs */\nwindow.PET_CONFIG = ${json};\n`,
    'utf8',
  );

  console.log(`素材包已生成：${OUT_DIR}`);
  console.log(`动画 ${names.length} 段，${(bytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
