# 坐标系与裁切（Coordinates & Cropping）

## 三层坐标

| 层 | 单位 | 谁在用 |
|---|---|---|
| 原生窗口 | 物理像素（px） | `WindowManager.LayoutParams.x/y`、`getWindowRect()` |
| 页面 CSS | CSS px | DOM、`clientX`、`stage.style.width` |
| 视频画布 | 固定 640×360 | WebM 素材本身 |

换算：`css = px / devicePixelRatio`。

## 为什么拖拽用 screenX/screenY

悬浮窗会跟着手指移动。如果用 `clientX`，参考系是「窗口」，窗口一动坐标就乱；
`screenX/screenY` 是屏幕绝对坐标，和窗口位置无关。

```js
var p = point(event);          // 取 screenX/screenY
drag = { x: p.x, y: p.y };     // 记录起点
// move 时：window.x += (now.x - start.x)
```

## 裁切（Crop）

素材 640×360，角色只占中间约 240px 宽。为了「宠物看起来大」，窗口只取：

```
x: 120 .. 520   (宽 400)
y:  20 .. 340   (高 320)
```

窗口高度 = 宽度 × 0.8（320/400）。这样角色占窗口宽度的约 60%。

## 每段动画的包围盒

裁切会切掉超出 400×320 的内容——文字气泡、风筝、烟花都在边缘。
`scripts/analyze-anim-bounds.py` 用 ffmpeg 抽取每段视频的 alpha，
取所有帧的并集包围盒，写进 `pet/bounds.js`：

```js
window.PET_BOUNDS = { "是啊，吃什么": [53, 40, 607, 333], ... };
```

页面在播放时判断：

- 包围盒在裁切框内 → 用默认裁切（角色最大）；
- 超出 → 按包围盒缩放到「完整可见」，脚底线仍贴舞台底部，且**不会放大超过默认比例**。

代价：宽动作播放时会「缩一下」，像镜头拉远。

## 边缘留白

窗口四周留 12dp，避免贴边：

```
minX = margin - sideAllow
maxX = screenW - margin - width + sideAllow
minY = margin
maxY = screenH - margin - height
```

`sideAllow` 是因为裁切后角色可以部分超出窗口（宽动作）留的余量。

## 气泡与输入框的定位

气泡和输入框都是**独立窗口**，位置按宠物窗口矩形算：

- 输入框默认在宠物上方，上方放不下就翻到脚下（`tail-up` / `tail-down`）；
- 翻下去时如果会掉进键盘区（屏幕高度 45% 以下），退回上方；
- 气泡（气泡是一条独立的 TextView 窗口）同理。
