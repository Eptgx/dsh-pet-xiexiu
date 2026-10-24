# Windows 本地化改动（Windows Port Notes）

记录这个分支相对上游的每一处改动，便于阅读与向上游提 PR。

## 1. 环境探测

| 文件 | 改动 |
|---|---|
| `packages/core/src/utils/android-sdk.ts` | 增加 `%LOCALAPPDATA%\Android\Sdk`、`C:\Android\Sdk`、`ANDROID_HOME` 等探测顺序 |
| `packages/core/src/utils/build-env.ts` | JDK 探测：`JAVA_HOME` 优先，其次 `~/.jdks/jdk-*`、Android Studio 自带 JBR |
| `packages/core/src/builders/html-builder.ts` | Gradle 优先用工程里的 `gradlew.bat`；找不到就用 `~/.gradle/gradle-dist/gradle-8.14` 的 `gradle.bat` |

Windows 上 `execa('gradlew')` 不能直接执行，必须带 `.bat` 后缀——这是最常见的「命令找不到」。

## 2. 依赖安装

- `pnpm add cordova-android@14 -D --ignore-workspace`：pnpm workspace 会把 cordova 的依赖树打平，
  导致 `cordova prepare` 找不到 platform，加 `--ignore-workspace` 让它在工程目录独立安装；
- 复制过别人的 `node_modules` 后，pnpm 的 junction 会断，`tsc` 报 `MODULE_NOT_FOUND`：
  用 `CI=true pnpm install --offline --frozen-lockfile` 从本地 store 重建。

## 3. 编码与路径

- `start-local.cmd` 里 `chcp 65001`：否则中文路径、中文日志在控制台乱码；
- 所有子进程用 `shell: true` 或 `.cmd` 包装，避免 Node 直接 spawn 失败；
- 构建产物路径统一用 `path.join`，不要拼 `/`。

## 4. 去 Docker

上游的 `Dockerfile` / `docker-compose.yml` 在这个分支不参与运行；本地直接：

```
node → tsx (API) → bullmq → worker → cordova/capacitor → gradle → apk
```

好处：Gradle 缓存、SDK、JDK 都是现成的，改一行核心代码只要 `pnpm --filter @demo2apk/core build`。

## 5. 系统栏颜色（Cordova 分支）

`applyAndroidSystemBarTheme` 会把 `statusBarColor` / `navigationBarColor` 写成透明。
不开边到边时，两条栏露出的是窗口背景，没设就是纯黑。

修复在新文件 `packages/core/src/utils/android-system-bars.ts`：

1. 主题里写不透明颜色（并把同名旧项删掉）；
2. Activity 运行时再设一次，三步各自 `try`；
3. **必须在 `applyAndroidSystemBarTheme` 之后调用**，否则会被它覆盖。

React/Capacitor 分支不受影响：它走 `setDecorFitsSystemWindows(false)`，由页面自己铺满。

## 6. 其他

- 前端与 API 的端口、CORS 默认值改成本地；
- 限流改为**默认关闭**（代码默认值），避免本地连续构建被拦；需要时在 `.env` 里设 `RATE_LIMIT_ENABLED=true`。
