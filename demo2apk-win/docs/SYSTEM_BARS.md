# 系统栏配色（状态栏 / 导航栏）

本文记录 HTML/Cordova 分支状态栏、底部手势条“露黑底”的原因与修复方式，避免下次再踩。

## 现象

APK 装到设备上后：

- 顶部状态栏是一条纯黑（`#000000`），与页面底色（例如 `#0F1115`）之间有明显分界；
- 底部手势条区域偶尔同样发黑；
- Web 预览、React/Capacitor 构建的包却没有这个问题。

## 根因

`applyAndroidSystemBarTheme`（`packages/core/src/utils/android-theme.ts`）对 **AppTheme** 写入的是：

```xml
<item name="android:statusBarColor">@android:color/transparent</item>
<item name="android:navigationBarColor">@android:color/transparent</item>
```

两条栏透明没问题，但**透明之后露出来的是“窗口背景”**。窗口背景仍是系统/AppCompat 的默认值（深色主题下是黑），所以看到的是黑条，而不是页面颜色。

页面自己画不到那里：WebView 的内容被系统栏内缩了（非边到边），栏后面不属于网页。

## 两条分支的现状

| | React / Capacitor | HTML / Cordova |
|---|---|---|
| 做法 | 边到边（`WindowCompat.setDecorFitsSystemWindows(false)`）+ 透明栏 + `setBackgroundDrawable(主题色)` | 只改主题 XML（透明栏），运行时补窗口背景与栏色 |
| 内容位置 | 网页铺到栏后面，页面自己留安全区 | 网页内缩，栏用不透明色填充 |
| 适用条件 | 页面已处理 `safe-area-inset-*` / IME | 页面未处理安全区（绝大多数 HTML 上传项目都是这种） |

对应实现：React 分支见 `react-builder.ts` 的 `Demo2APK_applySystemBars()` / `Demo2APK_setWindowBackground()`；HTML 分支见 `android-overlay.ts` 的 `patchWindowBackground()` 与 `MainActivity` 注入片段。

## HTML 分支的修复要点

1. **主题层**：把三个候选主题（`AppTheme`、`AppTheme.NoActionBar`、`AppTheme.NoActionBarLaunch`）里的
   `windowBackground` / `statusBarColor` / `navigationBarColor` 全部替换成不透明色。
   不能只写 `AppTheme`——Cordova 的 Activity 实际用的主题名不保证是它。
2. **顺序**：`injectFloatingOverlay` 必须在 `applyAndroidSystemBarTheme` **之后**执行。
   前者会先写透明色，后者负责覆盖成不透明色；顺序反过来就会被覆盖，表现为“改了没生效”。
3. **运行时兜底**：在 `MainActivity.onCreate` 里再设一遍：

   ```java
   try { getWindow().setStatusBarColor(0xFF0F1115); } catch (Throwable ignored) { }
   try { getWindow().setNavigationBarColor(0xFF0C0E12); } catch (Throwable ignored) { }
   try { getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFF0F1115)); } catch (Throwable ignored) { }
   ```

   **三步必须各自 try**：合成一个 try 时，任意一步抛异常都会把后面的跳过（曾导致“窗口背景设了、栏色没设”的假象）。

## 配色约定

| 位置 | 颜色 | 说明 |
|---|---|---|
| 状态栏 | 页面顶部背景色 | 与内容连成一片 |
| 导航栏 / 手势区 | 底部导航栏背景色 | 不要用页面色，否则导航栏和手势条之间出现色差 |
| 窗口背景 | 同状态栏色 | 同时消掉启动白屏 |

## 为什么 targetSdk 固定 34

Android 15（API 35）起，targetSdk ≥ 35 的应用被强制边到边，`statusBarColor` / `navigationBarColor` **静默失效**。
`android-gradle.ts` 的 `ANDROID_TARGET_SDK = 34` 就是为保留经典系统栏行为；改成 35 之前，必须先把两条分支都切到边到边 + 安全区方案。

## 排查方法

装到设备后截图，直接取像素：

```python
from PIL import Image
im = Image.open("screenshot.jpg").convert("RGB")
print(im.getpixel((600, 40)))    # 状态栏
print(im.getpixel((50, 600)))    # 页面
print(im.getpixel((100, 2620)))  # 导航栏
```

- 状态栏 ≈ 页面色 → 正常；
- 状态栏是 `(0,0,0)` 而页面不是 → 窗口背景没染上，检查注入顺序与主题名；
- 导航栏与页面色不同但等于导航栏底色 → 正常。

## 相关文件

- `packages/core/src/utils/android-theme.ts` —— 主题项写入 / 清理
- `packages/core/src/utils/android-gradle.ts` —— targetSdk 固定 34 的原因
- `packages/core/src/utils/android-overlay.ts` —— `patchWindowBackground()`、`MainActivity` 注入
- `packages/core/src/builders/react-builder.ts` —— Capacitor 分支的边到边实现（参考）
