# 悬浮窗（Overlay）

## 权限

```xml
<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_SPECIAL_USE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

- `SYSTEM_ALERT_WINDOW` 需要用户手动授权，`Settings.canDrawOverlays()` 判断；
- Android 14（targetSdk 34）起前台服务必须声明类型，悬浮窗用
  `foregroundServiceType="specialUse"` + `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`；
- Android 13+ 通知要 `POST_NOTIFICATIONS` 运行时权限。

## 窗口

宠物窗：

```java
TYPE_APPLICATION_OVERLAY
FLAG_NOT_FOCUSABLE          // 不抢输入
PixelFormat.TRANSLUCENT     // 透明
setBackgroundColor(TRANSPARENT)
```

高宽由内容决定，拖动时同步 `updateViewLayout`。

菜单窗是**第二个窗口**，理由：菜单比宠物大得多，塞进宠物窗会被裁；独立窗口还能单独拖动。

气泡是**第三个窗口**（`TextView`），`FLAG_NOT_TOUCHABLE`，几秒后自动移除。

## 触摸穿透（锁定）

```java
if (locked || hidden) params.flags |= FLAG_NOT_TOUCHABLE;
else                  params.flags &= ~FLAG_NOT_TOUCHABLE;
```

锁定时宠物只观赏，桌面照常滑动。

## 焦点与键盘

输入框需要键盘时临时去掉 `FLAG_NOT_FOCUSABLE`，并加 `FLAG_NOT_TOUCH_MODAL`
——后者让窗口外的触摸落到宠物窗，才能实现「点宠物取消输入」。

```java
params.flags &= ~FLAG_NOT_FOCUSABLE;
params.flags |= FLAG_NOT_TOUCH_MODAL;
params.softInputMode = SOFT_INPUT_ADJUST_RESIZE | SOFT_INPUT_STATE_VISIBLE;
```

## 生命周期

- `onStartCommand` 处理 `START / STOP / LOCK / UNLOCK / CENTER / RESIZE / RELOAD / SHOW / HIDE /
  TALK_START / TALK_STOP`；
- 服务被杀后由 `START_STICKY` 重启；
- 位置、大小、锁定状态存在 `SharedPreferences`（`dsh_pet_overlay`）。

## 常见坑

| 现象 | 原因 |
|---|---|
| 宠物跟着每个触摸走 | 窗口被设成 `MATCH_PARENT` 全屏 |
| 菜单画在角落 | WebView 子 View 用了固定 px 的 `LayoutParams` |
| 键盘把整页顶飞 | 没设 `windowSoftInputMode="adjustResize"` |
| 点输入框光标不动 | 页面全局 `user-select:none` 没给输入框开例外 |
| 通知栏/状态栏变黑 | 透明栏 + 没有窗口背景（见打包器文档） |
