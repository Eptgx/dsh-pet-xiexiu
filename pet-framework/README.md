# pet-framework · 安卓桌面宠物 Web 框架

把一段**透明视频**变成能浮在桌面上的桌宠：悬浮窗、拖拽甩抛、长按菜单、语音朗读、动作标签。

> Android overlay desktop pet built on Cordova + WebView. Transparent WebM sprites,
> drag/throw physics, long-press menu, TTS lip-sync-ish animation and `[动作:x]` tags.
> **本仓库不附带任何第三方动画素材**，请自备（见 [docs/ASSETS.md](docs/ASSETS.md)）。

## 它是什么

- 一个 **Cordova/WebView 页面**（`web/`）负责画宠物、处理触摸、播动画；
- 一个 **Android 前台服务**（`native/`）负责悬浮窗、菜单窗、气泡、TTS、AI 请求；
- 一个 **注入器**（`injector/android-overlay.ts`）把上面两样塞进 `cordova create` 生成的工程；
- 两条素材脚本：把 dsh-pet 的动画转成运行时资源包，并计算每段的透明包围盒。

## 目录

```
web/       悬浮窗页面（宠物窗 + 菜单窗）
native/    Java：服务、桥、AI 客户端、TTS
injector/  构建期注入（拷贝文件 / 改 manifest / 挂 Activity 桥）
scripts/   素材流水线（占位素材生成、资源打包、包围盒分析）
examples/  最小示例 App（开启悬浮窗、大小、锁定、语音、动作）
assets/    占位素材（占位角色，非第三方版权）
docs/      坐标系、素材、悬浮窗、语音、动作标签
```

## 快速开始

1. 用 [demo2apk-win](../demo2apk-win/) 或任意 Cordova 工程打一个包；
2. 把 `web/*`、`native/*`、`assets/placeholder/*` 和 `injector/android-overlay.ts` 按
   [injector/README.md](injector/README.md) 接进工程；
3. 把 `examples/demo-app/index.html` 作为 App 首页上传；
4. 首次运行授予「显示在其他应用上层」权限。

想换成自己的素材：

```bash
node scripts/build-pet-assets.mjs <dsh-pet 目录> assets/pet
python scripts/analyze-anim-bounds.py assets/pet
```

没有素材也可以直接跑——`assets/placeholder/` 里是一个自己画的占位角色。

## 关键设计

| 问题 | 做法 | 文档 |
|---|---|---|
| 视频太大、角色太小 | 裁切到 400×320，角色填满窗口 | [COORDS](docs/COORDS.md) |
| 宽动作被裁 | 逐段计算透明包围盒，超出就缩到完整可见 | [COORDS](docs/COORDS.md) |
| 窗口跟着手指跑 | 用 `screenX/screenY`，不用 `clientX` | [COORDS](docs/COORDS.md) |
| 点输入框光标不动 | 全局 `user-select:none` 要给输入框开例外 | [TTS](docs/TTS.md) |
| 气泡和声音不同步 | 气泡挂在 TTS 的 `onStart` 上 | [TTS](docs/TTS.md) |
| AI 回复带动作 | `[动作:跳]` → 白名单 → `onStart` 时播 CSS 动画 | [ACTIONS](docs/ACTIONS.md) |

## 许可

代码 MIT。素材（动画、立绘、图标）版权归各自作者，**不在本仓库内**。
