# 报错修复日志（Troubleshooting Log）

按「现象 → 原因 → 修法」记录这个分支踩过的坑。表格里的文件路径相对 `demo2apk-win/`。

## 1. `Cannot find module .../typescript/bin/tsc`

**现象**：复制了别人的 `node_modules` 后，`pnpm build` 直接报找不到模块。

**原因**：pnpm 用 junction/符号链接组织 `node_modules`，跨目录复制后链接指向失效，
包目录看起来还在，实际是空壳。

**修法**：

```bash
CI=true pnpm install --offline --frozen-lockfile
```

从本地 store 重建，不需要联网。

## 2. Windows 上找不到 Android SDK / JDK / Gradle

**现象**：`spawn gradlew ENOENT`、`JAVA_HOME is not set`、`SDK location not found`。

**原因**：上游按 Linux/Docker 的路径写死；Windows 的路径和可执行文件后缀都不同。

**修法**：

- SDK：依次探测 `ANDROID_HOME`、`%LOCALAPPDATA%\Android\Sdk`、`C:\Android\Sdk`；
- JDK：`JAVA_HOME` → `~/.jdks/jdk-*` → Android Studio 自带 JBR；
- Gradle：**实际只走** `~/.gradle/gradle-dist/gradle-8.14/bin/gradle.bat`，不会回退到 `gradlew.bat`，也不会自动下载——详见第 9 条；
- 子进程统一带 `.bat`，不要直接 spawn 无后缀命令。

## 3. `cordova prepare` 找不到 Android platform

**现象**：`Error: Current working directory is not a Cordova-based project.`

**原因**：pnpm workspace 把 cordova 的依赖提升到根目录，cordova 在自己的 cwd 里解析不到 platform。

**修法**：安装 platform 时加 `--ignore-workspace`，让它落在工程目录里：

```bash
pnpm add cordova-android@14 -D --ignore-workspace
```

## 4. 控制台中文乱码 / 构建日志乱码

**现象**：`start-local.cmd` 里中文全是问号或方块。

**修法**：脚本开头 `chcp 65001 >nul`，Node 侧输出统一 UTF-8。

## 5. 状态栏、导航栏纯黑（Cordova 分支）

**现象**：打包后状态栏和底部导航栏全黑，与页面主题色不一致。

**原因**（三件事叠加）：

1. `applyAndroidSystemBarTheme` 把两条栏写成 `@android:color/transparent`；
2. 页面没有铺窗口背景，透明栏露出的就是系统默认黑；
3. 就算在注入里写了颜色，**执行顺序**也可能被主题覆盖。

**修法**（`packages/core/src/utils/android-system-bars.ts`）：

- 在主题里写不透明颜色，并**先删掉同名旧项**；
- Activity 运行时再设一次，且 `setStatusBarColor` / `setNavigationBarColor` /
  `setBackgroundDrawable` **各自一个 try**，任何一步失败不连累其它两步；
- 调用顺序固定为 `applyAndroidSystemBarTheme` → `applyClassicSystemBars`。

**验证**：截屏取像素，状态栏应为 `#0F1115`、导航栏 `#0C0E12`，与页面一致。

## 6. `setStatusBarColor` 在 dex 里找不到

**现象**：反编译查 `classes6.dex` 没有 `setStatusBarColor`，怀疑没编进去。

**原因**：多 dex 分包，方法在 `classes5.dex` 里，只是查错了文件。

**修法**：先按字符串在**所有** dex 里搜，再下结论。

## 7. 构建排队、等很久

**现象**：上游公共服务提交后要排队，产物两小时后清理。

**原因**：那是「面向多租户」的设计（限流、队列、清理）。

**修法**：本地部署后这些机制没有意义——dev 环境关闭限流，产物落在 `packages/backend/builds/`，
构建完立刻可取。

## 8. 改了核心代码但打包结果没变

**现象**：`pnpm --filter @demo2apk/core build` 之后重新打包，行为还是旧的。

**原因**：worker 进程加载的是已编译的 `dist`，没有热重载。

**修法**：每次改完 core 都要**重启 worker**。

## 9. 新机器打包报 `spawn ...\gradle-8.14\bin\gradle.bat ENOENT`

**现象**：服务能起、网页能开、上传正常，进度走到「Setting up Gradle...」或「Building APK...」后失败，
错误里带：

```text
Error: spawn C:\Users\<用户名>\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat ENOENT
```

**原因**：Windows 上三处构建代码都硬编码了同一个路径
`%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat`
（`html-builder.ts` 两处、`react-builder.ts` 一处），**并不使用工程里的 `gradlew.bat`**。
`ensureGradleWrapper()` 的自动下载只在工程缺少 `gradlew` / `gradle-wrapper.jar` 时触发；
Cordova 生成的工程通常两者都有，于是直接跳过下载，去执行一个不存在的文件。

**修法**：把 Gradle 8.14 解压到 `%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\`，
确认 `bin\gradle.bat` 存在。完整步骤见
[WINDOWS_LOCAL_SETUP.md §二.6](../WINDOWS_LOCAL_SETUP.md)。

**注意**：Gradle 不随项目走，换一台机器就要重新放一次。这是本分支在别人电脑上
最容易翻车的一步，排在其他所有构建问题之前。

**根治方向**（尚未实施）：Windows 分支优先执行工程内的 `gradlew.bat`，
找不到时再用 `~/.gradle/gradle-dist/...`；或在启动脚本里检查并自动补齐 Gradle。
