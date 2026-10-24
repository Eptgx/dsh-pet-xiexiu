# 注入器（Injector）

`android-overlay.ts` 在构建期把悬浮桌宠接入一个 **Cordova** 工程。它做四件事：

1. **拷贝文件**
   - `web/*` → `assets/www/`
   - `native/*.java` → `app/src/main/java/com/demo2apk/floatingpet/`
   - `assets/pet/` → `assets/www/pet/`
2. **改 manifest**：加权限、`<service foregroundServiceType="specialUse">`、`<queries>`（TTS 引擎可见性）
3. **改主题**：写不透明的状态栏/导航栏色与窗口背景（见打包器文档）
4. **挂 Activity 桥**：`MainActivity` 里 `addJavascriptInterface(new FloatingPetBridge(this, webView), "FloatingPet")`

## 接到自己的工程

本仓库的注入器是按 [demo2apk-win](../demo2apk-win/) 的目录结构写的
（`packages/core/src/utils/android-overlay.ts`）。接到别的工程时，需要摆好这个结构：

```
packages/core/src/utils/android-overlay.ts   ← 本目录的文件
packages/core/assets/android-overlay/        ← 资源和页面
├─ overlay.html  pet.js  pet.css
├─ menu.html     menu.js  menu.css
├─ FloatingPetService.java  FloatingPetBridge.java
├─ AiClient.java  TtsSpeaker.java
└─ pet/  ← config.js / config.json / bounds.js / shared-core.js / anim/*.webm
```

对应关系：

| 本仓库 | 复制到 |
|---|---|
| `web/*` | `packages/core/assets/android-overlay/` |
| `native/*.java` | 同上 |
| `assets/pet/*` | `packages/core/assets/android-overlay/pet/` |

然后只需要改三处常量：

```ts
const WEB_FILES  = ['overlay.html','pet.js','pet.css','menu.html','menu.js','menu.css'];
const JAVA_FILES = ['FloatingPetService.java','FloatingPetBridge.java','AiClient.java','TtsSpeaker.java'];
const NATIVE_PACKAGE = 'com.demo2apk.floatingpet';
```

> `assetDir()` 是按 `dist/utils/android-overlay.js → ../../assets/android-overlay` 找资源的，
> 换目录结构时记得同步改它。

## 顺序很重要

```ts
await applyAndroidSystemBarTheme(...);
await injectFloatingOverlay(...);   // 必须在这之后
```

注入器会覆盖主题里的 `statusBarColor / navigationBarColor / windowBackground`。
如果顺序反了，主题那一步会把颜色改回透明，出现「状态栏纯黑」。

## 没有注入器怎么办

手动做同样的四件事也能跑，只是每次 `cordova prepare` 后要重做。
更彻底的做法是把它写成 Cordova 插件（`plugin.xml` + `source-file` + `config-file`），
这样 `cordova plugin add` 一次即可——本项目暂时没做成插件，欢迎 PR。
