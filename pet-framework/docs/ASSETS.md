# 素材（Assets）

本框架**不附带任何第三方动画**。你需要准备一份与 [dsh-pet](https://github.com/) 兼容的素材目录，
或者直接用仓库里的 `assets/placeholder/`（自己画的占位角色，可自由使用）。

## 运行时需要的文件

```
assets/pet/
├─ config.json    动画池 / 权重 / 物理参数 + 动画名 → 文件名
├─ config.js      同上，`window.PET_CONFIG = {...}`（file:// 下 fetch 会被 CORS 拦）
├─ bounds.js      每段动画的透明包围盒（可选，缺了就不做缩放）
├─ shared-core.js 选片 / 物理逻辑（window.PetShared）
└─ anim/a001.webm ... 透明动画
```

`config.json` 结构：

```json
{
  "version": 1,
  "size": 320,
  "files": { "动画名": "a001" },
  "talkAnims": ["说话时循环播放的动画名"],
  "animations": {
    "idle": ["..."], "turn": ["..."], "drag": ["..."], "clicks": ["..."],
    "moves": { "default": {}, "actions": [] },
    "categories": [{ "id": "分类", "actions": ["..."] }]
  },
  "animationWeights": { "idle": 10, "turn": 5, "move": 5 },
  "physics": {}
}
```

## 视频要求

- **VP9 + alpha**（`yuva420p`）的 WebM，透明背景；
- 画面固定 **640×360**，角色居中、脚底约在 y=330；
- 24fps、10 秒左右比较合适；循环动作要能被 `loop` 播放。

Chromium 的 `<video>` 支持 VP9 alpha 解码，这也是选 WebM 而不是 MOV 的原因。

## 从 dsh-pet 生成

```bash
node scripts/build-pet-assets.mjs "C:/Users/you/.dsh/profiles/desktop/node_modules/dsh-pet" assets/pet
python scripts/analyze-anim-bounds.py assets/pet
```

`build-pet-assets.mjs` 会：

1. 读 `assets/config.jsonc`，收集 idle/turn/drag/clicks/moves/categories 以及
   `events.whisper`（说话池）用到的全部动画；
2. 把 `assets/webm/<名字>.webm` 复制成 `anim/aNNN.webm`（避开中文路径在 `file://` 下的编码问题）；
3. 生成 `config.json` 与 `config.js`。

`analyze-anim-bounds.py` 用 ffmpeg 抽取 alpha 计算包围盒，需要 `pip install imageio-ffmpeg`
或系统里有 `ffmpeg`。

## 自己画素材

`scripts/make-placeholder.py` 是一个最小例子：用 Pillow 画一个会呼吸、眨眼、张嘴的几何角色，
再用 ffmpeg 编码成透明 WebM。改颜色、形状、动作都可以，不依赖任何第三方美术。

## 尺寸与性能

- 10 秒 640×360 的 VP9 alpha 约 400–600KB；
- 90 段大约 45–50MB，APK 体积主要来自这里；
- 想减体积：降到 480×270（角色仍占同样比例），或缩短单段时长。
