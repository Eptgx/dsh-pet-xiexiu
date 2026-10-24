# 架构（Architecture）

## 两条链路

### A. 桌宠运行时

```
Activity (Cordova WebView)
  │  addJavascriptInterface("FloatingPet")
  ▼
FloatingPetBridge ──► FloatingPetService（前台服务）
  │                        │
  │                        ├─ 宠物窗   overlay.html + pet.js
  │                        ├─ 菜单窗   menu.html + menu.js
  │                        └─ 气泡窗   TextView（自动消失）
  │
  └─ 权限 / 设置 / 聊天历史 / AI 请求
```

- 页面只负责「画宠物、处理触摸」，所有跨窗口的事都走 Bridge；
- 三个窗口彼此独立：宠物窗小、菜单窗大、气泡窗不可触摸；
- TTS 在服务里，`onStart` 回调驱动气泡、口型和动作。

### B. 打包链路

```
上传（HTML / ZIP / 工程） → 类型识别 → 生成 Cordova 或 Capacitor 工程
  → 改 manifest / 主题 / 图标 → cordova prepare → gradle assembleDebug → APK
```

- 两条分支（Cordova / Capacitor）互不影响；
- 系统栏颜色在 Cordova 分支里单独修（见 `demo2apk-win/docs/WINDOWS.md`）；
- 每条分支具体做什么、产物落在哪、失败会怎样：见
  [demo2apk-win/docs/BUILD_PIPELINE.md](../demo2apk-win/docs/BUILD_PIPELINE.md)。

## 关键取舍

| 取舍 | 选择 | 原因 |
|---|---|---|
| 渲染方式 | 透明 WebM 视频 | 不需要骨骼/引擎，素材可以直接生成 |
| 裁切 | 400×320 | 让角色占满窗口；宽动作靠包围盒自适应 |
| 菜单 | 独立窗口 | 塞进宠物窗会被裁，而且没法单独拖动 |
| 气泡 | 独立 TextView | 宠物窗太小，画不下气泡 |
| 语音 | 系统 TTS | 不依赖第三方 App 的私有接口 |
| 口型 | 说话时循环一段动画 | 视频没有 viseme，做不到逐字对 |
| 动作 | CSS 动画 + 标签 | 不需要额外素材，成本最低 |

## 目录边界

- `pet-framework/` 不知道打包器存在；
- `demo2apk-win/` 不知道宠物存在；
- 唯一的接触点是 `injector/`：把它放进打包器的 `packages/core/src/utils/` 即可。
