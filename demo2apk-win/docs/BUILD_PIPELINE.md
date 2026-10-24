# 打包流程（Build Pipeline）

本文讲「上传之后到 APK 出来」的内部实现，面向需要改打包逻辑的人。
安装部署见 [WINDOWS_LOCAL_SETUP.md](../WINDOWS_LOCAL_SETUP.md)，接口见 [API.md](API.md)，报错排查见 [ERROR_FIXES.md](ERROR_FIXES.md)。

## 总览

```text
POST /api/build/{html|zip|code}
  │  存文件到 uploads/<taskId>/
  │  判定类型 → 决定 buildType
  ▼
BullMQ 队列 "build"（jobId = taskId）
  ▼
Worker.processBuildJob
  ├─ html          → buildHtmlToApk()         Cordova
  ├─ html-project  → buildHtmlProjectToApk()  Cordova（先解压）
  └─ zip           → buildReactToApk()        Capacitor（先 npm/pnpm 构建）
        │
        │  公共后半段：注入图标/权限/版本 → 原生补丁 → Gradle assembleDebug
        ▼
builds/<appName>--<taskId>.apk
  → 前端轮询状态 → 下载（文件名去掉 --taskId）
```

三条分支的公共点：

- 都先探测 Android SDK，并把 `ANDROID_HOME` / `PATH` 注入当前进程；
- 最终都调用同一个 Gradle 任务 `assembleDebug --no-daemon`；
- APK 都带 `--<taskId>` 后缀，避免并发覆盖。

## 一、上传与类型判定

### 1.1 三个入口

| 入口 | 代码 | 说明 |
|---|---|---|
| `POST /api/build/html` | [build.ts:141](../packages/backend/src/routes/build.ts#L141) | 单文件 `.html/.htm/.js/.jsx/.ts/.tsx` |
| `POST /api/build/zip` | [build.ts:367](../packages/backend/src/routes/build.ts#L367) | ZIP 工程，自动判 React / 静态 HTML |
| `POST /api/build/code` | [build.ts:591](../packages/backend/src/routes/build.ts#L591) | 粘贴的代码文本 |

上传文件落在 `uploads/<taskId>/`（默认 `%TEMP%\demo2apk-uploads`，可用 `UPLOADS_DIR` 覆盖）。

### 1.2 单文件代码：`detectCodeType`

打分制，见 [code-detector.ts:78](../packages/core/src/utils/code-detector.ts#L78)：

| 特征 | 加分 |
|---|---|
| `<html>` / `<head>` / `<body>` / `<!DOCTYPE html>`，每命中一项 | +25 |
| 内嵌 React 线索（`text/babel`、CDN React、`ReactDOM.render` 等） | 每项 +20 |
| `import React` / `from 'react'` | +30（只计一次） |
| `export default function/class/memo(...)` | +25（只计一次） |
| JSX 特征（PascalCase 标签、`className`、`useState` 等） | 每个 +5，最多 +25 |
| TypeScript 特征（`interface`、类型注解等） | 每个 +3，最多 +15 |

判定顺序：

1. HTML 分 ≥ 25：有内嵌 React 分（≥20）→ `html-react`，否则 → `html`；
2. 否则 React 分 ≥ 30 → `react-component`；
3. 否则 React 分 > HTML 分 → `react-component`；
4. 否则 HTML 分 > 0 → `html`；否则 `unknown`。

> ⚠️ 只有 `react-component` 且 `confidence >= 50` 才会被包装成 React 工程
> （见 [build.ts:253](../packages/backend/src/routes/build.ts#L253)）。`html-react`
> 不会触发包装，按普通 HTML 保存后直接走 Cordova。

### 1.3 ZIP：`detectZipProjectType`

先定位 `projectRoot`：如果所有文件都在同一个顶层目录下，就以它为根；再往下探一层找
`package.json` / `index.html`（见 [zip-detector.ts:79](../packages/core/src/utils/zip-detector.ts#L79)）。

判定优先级（[zip-detector.ts:243](../packages/core/src/utils/zip-detector.ts#L243)）：

| 条件 | 类型 | 置信度 |
|---|---|---|
| 有 `vite.config.js/ts` 且有 `package.json` | `react-project` | 95 |
| 有 `package.json`，且有 React 依赖或 `build` 脚本 | `react-project` | 90 |
| 有 `index.html`，且只有它（或只有一个 HTML、无 JS/CSS） | `html-single` | 90 |
| 有 `index.html` + 其他资源 | `html-project` | 85 |
| 没有 `index.html` 但有别的 `.html` | `html-project` | 70 |
| 其他 | `unknown` | 0 |

### 1.4 映射到 buildType

[build.ts:497](../packages/backend/src/routes/build.ts#L497) 的映射：

| ZIP 判定 | buildType | 走哪个 builder |
|---|---|---|
| `react-project` | `zip` | `buildReactToApk` |
| `html-project` / `html-single` | `html-project` | `buildHtmlProjectToApk` |
| `unknown` + 有 `package.json` | `zip` | `buildReactToApk` |
| `unknown` + 无 `package.json` | `html-project` | `buildHtmlProjectToApk` |

> 注意：ZIP 里的 `html-single` **不会**走单文件分支，仍然先解压再走 Cordova。

## 二、入队与分发

- 队列名 `build`，`jobId = taskId`；`attempts: 1`（不自动重试）；完成的 job 保留 24 小时 / 1000 条，失败的保留 7 天（[queue.ts:54](../packages/backend/src/services/queue.ts#L54)）。
- Worker 并发数取 `WORKER_CONCURRENCY`，默认 2（[queue.ts:245](../packages/backend/src/services/queue.ts#L245)）。
- 分发逻辑在 [worker.ts:108](../packages/backend/src/worker.ts#L108)：

| buildType | 调用 |
|---|---|
| `html` | `buildHtmlToApk` |
| `html-project` | `buildHtmlProjectToApk` |
| `zip` | `buildReactToApk` |

- `MOCK_BUILD=true` 时在真正构建前短路，1 秒一级假进度，最后生成占位 APK（[worker.ts:64](../packages/backend/src/worker.ts#L64)）。
- 每条 `onProgress(message, percent)` 都会写入 BullMQ 的 job progress，前端进度条读的就是它（[worker.ts:54](../packages/backend/src/worker.ts#L54)）。

## 三、分支 A：单文件 HTML（Cordova）

入口 [html-builder.ts:607](../packages/core/src/builders/html-builder.ts#L607)。括号里是该步上报的进度。

1. **探测环境**（5%）：`detectAndroidSdk`，要求 `platform-tools` 存在；`setupAndroidEnv` 写入 `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `PATH`。
2. **确认 Cordova**（10%）：`detectCordova` 失败则执行 `npm install -g cordova`。
3. **离线化**（15%，可选）：`needsOfflineify` 命中 CDN 规则（Tailwind CDN、unpkg、Google Fonts、Babel standalone、cdnjs、canvas-confetti）或页面里有 `text/babel` 时，下载资源并内联重写（[offlineify.ts:45](../packages/core/src/utils/offlineify.ts#L45)）。
4. **建工作目录**（25%）：`builds/<拼音化 app 名>`，先 `remove` 再 `ensureDir`。
5. **生成工程**：`cordova create . <appId> <appName> --no-telemetry`。
6. **预装平台**（32%）：`pnpm add cordova-android@14 -D --ignore-workspace`（需要联网，超时 120s）。
7. **加平台**（38%）：`cordova platform add android`。
8. **注入**（42–44%）：图标 → 权限 → `config.xml` 版本号。
9. **摊平 web 资源**（45%）：清空 `www`，拷入 HTML 目录；`prepareHtmlForCordova` 改写页面；写入运行时脚本。
10. **同步原生工程**（55%）：`cordova prepare android`。
11. **打补丁**（58%）：改 `MainActivity`，支持 blob/data 下载保存。
12. **系统栏**（55–60% 之间）：`applyAndroidSystemBarTheme` → `applyClassicSystemBars` → `setAndroidTargetSdk`（顺序不能反）。
13. **Gradle**（60% → 70%）：`ensureGradleWrapper` 后执行 `assembleDebug --no-daemon`。
14. **拷产物**（95%）：`app/build/outputs/apk/debug/app-debug.apk` → `builds/<appName>--<taskId>.apk`。
15. **清理**（100%）：`CLEANUP_BUILD_ARTIFACTS` 默认 true 时删工作目录。

## 四、分支 B：HTML 多文件 ZIP（Cordova）

入口 [html-builder.ts:883](../packages/core/src/builders/html-builder.ts#L883)。与 A 的区别只有前半段：

1. 工作目录是 `builds/<拼音名>-html-build`，ZIP 解到 `extracted/`；
2. 按 `projectRoot` 定位工程；没有 `index.html` 时找任一 HTML 并改名；
3. Cordova 工程建在 `cordova/` 子目录，而不是工作目录本身；
4. 之后从「预装 cordova-android」开始与 A 完全一致。

## 五、分支 C：React / Vite ZIP（Capacitor）

入口 [react-builder.ts:886](../packages/core/src/builders/react-builder.ts#L886)。括号里是进度。

1. **探测环境**（5%）：同 A，只查 SDK。
2. **解压**（10%）：`builds/<拼音名>-build`，`runUnzip` 解到工作目录。
3. **定位工程**（15%）：优先用 `projectRoot`，否则递归找 `package.json`（最多 3 层）；目录名再拼音化一次。
4. **写版本号**（15%）：把 `package.json.version` 改成请求里的版本。
5. **判框架与包管理器**（15–18%）：`vite.config.*` → `dist`；`next.config.*` → `out`；`react-scripts` → `build`；否则按 `dist`。包管理器按 lockfile 顺序尝试 pnpm / yarn / npm。
6. **修工程**（20–23%）：Next 加静态导出；Vite 修 `base: './'`、补 CSS 入口；删掉工程里已有的 `capacitor.config.js`。
7. **装依赖**（25%）：`npm install --legacy-peer-deps` 或用对应包管理器；强制 `NODE_ENV=development`，限制 Node 堆内存，`NPM_REGISTRY` 生效。
8. **构建前端**（40%）：`<pm> run build`，长任务用心跳维持进度。
9. **注入运行时**（40% 之后）：往构建产物里塞文件选择 / blob 下载桥。
10. **PWA 导出**（54%，可选）：`publishPwa=true` 且服务端启用时，额外导出一份静态站点。
11. **装 Capacitor**（55%）：`@capacitor/core`、`cli`、`android`。
12. **写配置**（60%）：生成 `capacitor.config.ts`（`appId` / `appName` / `webDir`）。
13. **加平台并同步**（65–70%）：`npx cap add android` → `npx cap sync android`；强制 `npm_config_user_agent`，避免继承 monorepo 的 pnpm 身份导致 Gradle 路径错。
14. **注入与补丁**（75–79%）：图标、权限、系统栏、targetSdk；`patchKotlinDuplicateClasses` 排除重复的 Kotlin stdlib；修 `capacitor.settings.gradle` 里的 `.pnpm` 路径。
15. **Gradle**（80%）：`ensureGradleWrapper` + `assembleDebug --no-daemon`。
16. **拷产物**（95%）：同样命名成 `builds/<appName>--<taskId>.apk`，并校验源/目标文件大小一致。
17. **清理**（100%）：同 A。

## 六、公共注入与原生补丁

| 注入项 | Cordova（A/B） | Capacitor（C） | 代码 |
|---|---|---|---|
| 图标 | `res/mipmap-*` | 同 | [html-builder:99](../packages/core/src/builders/html-builder.ts#L99) / [react-builder:118](../packages/core/src/builders/react-builder.ts#L118) |
| 权限 | `config.xml` + Manifest | `AndroidManifest.xml` | [html-builder:169](../packages/core/src/builders/html-builder.ts#L169) / [react-builder:818](../packages/core/src/builders/react-builder.ts#L818) |
| 版本 | `config.xml` | `package.json`（cap sync 带进工程） | [html-builder:700](../packages/core/src/builders/html-builder.ts#L700) |
| 运行时桥 | 写进 `www` | 写进构建产物 | [webview-compat:414](../packages/core/src/utils/webview-compat.ts#L414) / [react-builder:387](../packages/core/src/builders/react-builder.ts#L387) |
| 系统栏 | 主题 + Activity 覆盖 | 同 | [android-theme:184](../packages/core/src/utils/android-theme.ts#L184) → [android-system-bars:131](../packages/core/src/utils/android-system-bars.ts#L131) |
| targetSdk | `app/build.gradle` | `variables.gradle` | [android-gradle:21](../packages/core/src/utils/android-gradle.ts#L21) |

两条硬约束：

- **顺序**：`applyAndroidSystemBarTheme` 必须早于 `applyClassicSystemBars`，否则透明栏会把颜色覆盖回去；`setAndroidTargetSdk` 在两者之后调用。
- **targetSdk = 34**（[android-gradle.ts:10](../packages/core/src/utils/android-gradle.ts#L10)）：Android 15+ 在 targetSdk ≥ 35 时强制 edge-to-edge 并忽略 `statusBarColor`，所以这里主动降到 34。和「安装 platform 35」是两件事，详见 [SYSTEM_BARS.md](SYSTEM_BARS.md)。

## 七、产物、命名与清理

| 分支 | 工作目录（构建成功后默认删除） | APK |
|---|---|---|
| A 单文件 HTML | `builds/<拼音名>/` | `builds/<appName>--<taskId>.apk` |
| B HTML 多文件 | `builds/<拼音名>-html-build/` | 同上 |
| C React/Vite | `builds/<拼音名>-build/` | 同上 |

- 目录名用拼音（`sanitizeDirName`），避免 Java/Gradle 处理非 ASCII 路径出问题；APK 文件名保留原始 app 名。
- 下载时把 `--<taskId>` 去掉再发给浏览器（[status.ts:168](../packages/backend/src/routes/status.ts#L168)）。
- 上传文件在任务结束后随 `CLEANUP_UPLOADS_ON_COMPLETE`（默认 true）删除。
- Worker 每 `FILE_CLEANUP_INTERVAL_MINUTES`（默认 30 分钟）扫一次 `builds/` 和 `uploads/`，删掉超过 `FILE_RETENTION_HOURS`（默认 2 小时）的条目。
- 想留现场排查，把 `CLEANUP_BUILD_ARTIFACTS=false`、`CLEANUP_UPLOADS_ON_COMPLETE=false`，工作目录会留在 `builds/` 下。

## 八、状态与进度

- 状态接口直接读 BullMQ 的 job 状态；`completed` 但 `result.success=false` 会对外报 `failed`（[status.ts:49](../packages/backend/src/routes/status.ts#L49)）。
- `pending` 时附带 `queuePosition` / `queueTotal`；完成时附带 `downloadUrl`、`apkSize`、`expiresAt`（创建时间 + 保留时长）。
- 下载接口只在 `completed` 且 `success` 时返回文件流，否则 400/404。
- `DELETE` 不能取消正在构建的任务（`active` 直接拒绝）。

## 九、已知限制

1. **Worker 跑的是 `dist`**：改 `packages/core` 后必须重新 `pnpm build` 并重启 Worker，否则行为还是旧的（见 [ERROR_FIXES.md 第 8 条](ERROR_FIXES.md)）。
2. **Windows 上 Gradle 路径写死**：三处构建都执行 `%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat`，不会自动下载，也不回退到 `gradlew.bat`（见 [ERROR_FIXES.md 第 9 条](ERROR_FIXES.md)）。
3. **同名应用并发会互相踩**：工作目录由 `appName` 派生（不含 taskId），两个同名任务同时跑时，后启动的会 `remove` 掉前一个的目录。默认并发 2，建议错开 app 名或调低 `WORKER_CONCURRENCY`。
4. **不自动重试**：`attempts: 1`，构建失败需要重新上传。
5. **每次构建都要联网的部分**：`pnpm add cordova-android@14`、`cordova platform add`、Gradle 依赖、React 工程的依赖安装；`NPM_REGISTRY` 只覆盖 npm 类安装，不覆盖 Gradle/Maven。
6. **路径长度**：工作目录在 `builds/` 下再套 `platforms/android/...`，项目本身放太深容易撞 Windows 260 字符限制。

## 相关文档

- [WINDOWS_LOCAL_SETUP.md](../WINDOWS_LOCAL_SETUP.md) — 环境依赖、Gradle / pnpm、启动与验证
- [ERROR_FIXES.md](ERROR_FIXES.md) — 按报错组织的排查记录
- [SYSTEM_BARS.md](SYSTEM_BARS.md) — 系统栏补丁的来龙去脉
- [API.md](API.md) — 接口定义
- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — 整体架构，本文是其中「打包链路」的展开
