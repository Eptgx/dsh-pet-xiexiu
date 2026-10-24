# Windows 本地部署指南（不使用 Docker）

本文档说明在 **Windows** 上以本地开发模式运行 Demo2APK 所需的全部环境依赖、VSCode 插件与注意事项。

> 适用场景：不安装 Docker，直接用 Node.js + Redis + Android SDK 在本机构建 APK。

> ## ⚠️ 先读：四个会让构建失败或白折腾的点
>
> 1. **Gradle 8.14 必须手动放好**。Windows 上构建 APK 直接调用
>    `%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat`，
>    这个目录不会自己出现；缺了它，最后一步报 `spawn ...gradle.bat ENOENT`。
>    做法见 **§二.6**。
> 2. **pnpm 必须用 9.x**。项目锁定 `pnpm@9.12.0`，而 `npm i -g pnpm` 现在装 10.x；
>    版本不匹配会触发联网切换，还可能拦截依赖安装脚本。用 `npm i -g pnpm@9`（**§二.1**）。
> 3. **APK 不在根目录 `builds\`**，而在 `packages\backend\builds\`；
>    另外 `.env` 里的 `API_PORT` / `FRONTEND_PORT` **不生效**（**§四**）。
> 4. **首次真打包必须联网**，Gradle/Maven 依赖也不走 `NPM_REGISTRY`；
>    先用 `MOCK_BUILD=true` 验证链路，再打真包（**§六**）。

---

## 一、环境依赖总览

| 依赖 | 版本要求 | 作用 | 是否必需 |
|------|---------|------|---------|
| Node.js | `>= 20.0.0` | 前后端运行 | 必需 |
| pnpm | `>= 9.0.0`（项目锁定 `pnpm@9.12.0`，**必须 9.x**） | monorepo 包管理 | 必需 |
| JDK | `>= 21`（推荐 Temurin 21） | Gradle 构建 APK | 必需 |
| Android SDK | `platform-tools` + `platforms;android-35` + `build-tools;35.0.0` | 打包 Android | 必需 |
| Cordova CLI | 最新版 | 生成 Android 工程 | 必需 |
| Gradle | `8.14`（路径写死） | 编译 APK | 必需（**需手动放置**，见 §二.6） |
| Redis | `>= 5.0`（Windows 推荐 5.x） | BullMQ 任务队列 | 必需 |

> 版本约束来自 [package.json](package.json) 的 `engines` 与 `packageManager` 字段。

---

## 二、逐项安装与验证

### 1. Node.js 与 pnpm

```bash
# 从 https://nodejs.org/ 安装 Node.js 20+ 后，安装 pnpm
npm install -g pnpm@9
```

> ⚠️ **必须装 9.x**：不要执行不带版本号的 `npm install -g pnpm`（现在会装 10.x）。
> 本项目 `packageManager` 锁定 `pnpm@9.12.0`，版本不符时 pnpm 会先联网切换版本，
> 且 10.x 默认拦截依赖的 postinstall 脚本，可能导致装完依赖仍然跑不起来。

验证：

```bash
node -v      # 应输出 v20.x 或更高
pnpm -v      # 应输出 9.x
```

### 2. JDK 21

推荐从 [Adoptium](https://adoptium.net/) 下载，国内镜像：
`https://mirrors.tuna.tsinghua.edu.cn/Adoptium/21/jdk/x64/windows/`

验证：

```bash
java -version   # 应显示 21.x
```

### 3. Android SDK

1. 下载 command-line tools：<https://developer.android.com/studio#command-line-tools-only>
2. 解压到 `C:\Users\<用户名>\Android\Sdk\cmdline-tools\latest\`
3. 安装必要组件：

```bash
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

验证是否安装齐全：

```bash
ls "%USERPROFILE%\Android\Sdk"
# 期望看到：build-tools  cmdline-tools  licenses  platform-tools  platforms
```

### 4. Cordova CLI

```bash
npm install -g cordova
cordova -v
```

### 5. Redis

从 <https://github.com/tporadowski/redis/releases> 下载 Windows 版，启动：

```bash
redis-server.exe
```

验证：

```bash
redis-cli ping   # 期望返回 PONG
```

### 6. Gradle 8.14（必须手动准备，不能省）

Windows 上的 APK 构建**不使用** Cordova 生成的 `gradlew.bat`，而是直接执行固定路径：

```text
%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat
```

代码里的自动下载分支只在工程缺少 `gradlew` 或 `gradle-wrapper.jar` 时才会触发；
Cordova 生成的工程通常自带这两个文件，因此**它不会替你下载**。新机器不手动放好，
构建最后一步就会报：

```text
Error: spawn C:\Users\<用户名>\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat ENOENT
```

安装步骤（PowerShell）：

```powershell
# 1. 下载 Gradle 8.14（代码里用的就是这个镜像）
#    https://mirrors.cloud.tencent.com/gradle/gradle-8.14-bin.zip
#    官方备用：https://services.gradle.org/distributions/gradle-8.14-bin.zip

# 2. 解压到 %USERPROFILE%\.gradle\gradle-dist\
#    解压后的结构必须是：
#    C:\Users\<用户名>\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat

# 3. 验证（必须返回 True）
Test-Path "$env:USERPROFILE\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat"
```

> ⚠️ 解压时不要多套一层目录（不要出现 `gradle-8.14\gradle-8.14\bin`），
> 也不要把目录名改成 `gradle-8.14.1` 之类的版本号——路径是写死的。

---

## 三、环境变量配置

在 Windows「系统属性 → 环境变量」中新增以下项（或使用 `setx`，设置后需**重开终端**才生效）：

```cmd
setx JAVA_HOME "C:\Users\<用户名>\.jdks\jdk-21.0.11+10"
setx ANDROID_HOME "C:\Users\<用户名>\Android\Sdk"
setx ANDROID_SDK_ROOT "C:\Users\<用户名>\Android\Sdk"
```

并把以下目录加入 `PATH`：

```text
%JAVA_HOME%\bin
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\cmdline-tools\latest\bin
```

### 关于「不设置也能用」

本项目内置了自动探测逻辑，即使不手动配置上述变量通常也能构建：

- **Android SDK 自动探测**：候选路径包含 `~/Android/Sdk`（见 [android-sdk.ts](packages/core/src/utils/android-sdk.ts) 的 `POSSIBLE_SDK_PATHS`），探测成功后会自动注入 `ANDROID_HOME` / `ANDROID_SDK_ROOT` 并追加到 `PATH`。
- **JAVA_HOME 自动回退**：构建时若 `JAVA_HOME` 为空，会回退到 `~/.jdks/jdk-21.0.11+10`（见 [html-builder.ts](packages/core/src/builders/html-builder.ts)、[react-builder.ts](packages/core/src/builders/react-builder.ts)）。

> 建议仍然显式配置，避免个别子进程（Gradle daemon、Cordova）不继承回退值而导致构建失败。

---

## 四、项目初始化

```bash
# 1. 安装依赖（monorepo 一次装全）
pnpm install

# 2. 配置环境变量：复制 .env.example 为 .env
copy .env.example .env

# 3. 构建所有包（core 是 backend 的依赖，必须先构建）
pnpm build
```

`.env` 开发常用配置：

```env
REDIS_URL=redis://localhost:6379
API_PORT=3000
FRONTEND_PORT=5173

# 本地开发建议关闭限流
RATE_LIMIT_ENABLED=false

# 无需真实打包时，可开启假构建做联调
MOCK_BUILD=false

# 并发构建数
WORKER_CONCURRENCY=2
```

> ⚠️ **端口变量目前不生效**，不要指望改 `.env` 换端口：
>
> - 后端读的是 `PORT`（见 `packages/backend/src/index.ts`），不是 `API_PORT`；
> - 前端 Vite 的端口和 `/api` 代理写死在 `packages/frontend/vite.config.ts`
>   （5173 → 3000），`FRONTEND_PORT` 没有任何代码读取。
>
> 所以请保证 **3000 / 5173 空闲**；要让端口真正可配，只能改代码。

> 完整变量说明见 [.env.example](.env.example) 与 [docs/ENV_VARIABLES.md](docs/ENV_VARIABLES.md)。

---

## 五、VSCode 插件推荐

> 项目**未内置** `.vscode/` 推荐插件目录，也未配置 ESLint / Prettier / EditorConfig，以下为基于技术栈的建议。

**核心（贴合本项目技术栈）：**

| 插件 | 用途 |
|------|------|
| Tailwind CSS IntelliSense | 前端使用 Tailwind，类名补全与高亮 |
| ESLint | 代码检查（项目未带配置，需自行添加配置文件后生效） |
| Prettier - Code formatter | 代码格式化（需自行添加配置文件后生效） |
| Vitest（官方） | core / backend 使用 Vitest，可在编辑器内跑测试 |
| Docker | 使用 Docker/Compose 部署时提供支持 |
| dotenv / ENV | 编辑 `.env` 文件语法高亮 |

**可选（提升体验）：**

| 插件 | 用途 |
|------|------|
| Error Lens | 行内直接显示 TypeScript 报错 |
| GitLens | 查看提交历史与 blame |
| EditorConfig for VS Code | 统一缩进/换行（需自行添加 `.editorconfig`） |

> TypeScript、React 的语法高亮与类型检查由 VSCode 内置能力 + 各包的 `tsconfig.json` 提供，无需额外插件。

---

## 六、启动与验证

先确保 Redis 已运行，然后**开 3 个独立终端**分别执行：

```bash
# 终端 1 — API 服务 (端口 3000)
pnpm dev

# 终端 2 — 构建 Worker（负责真正打包 APK）
pnpm worker

# 终端 3 — Web 界面 (端口 5173)
pnpm frontend
```

浏览器访问：**<http://localhost:5173>**

验证 API：

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api
```

测试一次构建（单文件 HTML）：

```bash
curl -X POST http://localhost:3000/api/build/html ^
  -F "file=@test-demo.html" ^
  -F "appName=TestDemo"
```

### 先用假构建验证链路，再打真包

第一次部署建议分两步，避免把环境问题和业务问题混在一起：

1. 在 `.env` 里设 `MOCK_BUILD=true`，重启 Worker。
   上传任意一个 HTML，几秒内能拿到一个占位 APK，说明
   API → Redis → Worker → Web 整条链路是通的。
2. 改回 `MOCK_BUILD=false`，重启 Worker，再传真实 HTML 打真包。

> ⚠️ 真包产物落在 `packages\backend\builds\`，**不是根目录的 `builds\`**。
> 因为 `pnpm --filter @demo2apk/backend ...` 会把工作目录切到 `packages/backend`，
> 而 `BUILDS_DIR=./builds` 是相对它解析的。

---

## 七、注意事项与常见问题

### 1. 改动源码后需重新构建

`pnpm worker` 执行的是 `node dist/worker.js`，依赖已构建的 `dist` 产物。若修改了 `packages/core` 或 `packages/backend` 的源码，必须重新执行：

```bash
pnpm build
```

再重启 Worker。前端（`pnpm frontend`）使用 Vite 热更新，无需此步骤。

### 2. 首次构建会较慢

首次打包会由 Gradle 下载依赖并编译，耗时较长且占用较多 CPU/内存。请耐心等待，不要中途中断。

> ⚠️ 首次构建**必须联网**：`cordova-android@14` 是构建时现装的，
> Android Gradle Plugin / AndroidX 等依赖也要首次下载。断网或网络不稳时，
> 第一次构建大概率失败；失败后重试即可，已下载的部分会缓存。

### 3. React 项目打包后白屏

上传的 React/Vite 项目需满足以下条件，否则 APK 内 WebView 会白屏：

```bash
npm install -D @vitejs/plugin-legacy terser
```

```javascript
// vite.config.js
import legacy from '@vitejs/plugin-legacy'

export default defineConfig({
  plugins: [react(), legacy({ targets: ['chrome >= 52', 'android >= 5'] })],
  base: './'   // APK 必需
})
```

详见 [docs/REACT_PROJECT_REQUIREMENTS.md](docs/REACT_PROJECT_REQUIREMENTS.md)。

### 4. 国内网络加速

npm 安装依赖慢时，设置镜像（Worker 会自动读取此变量）：

```cmd
set NPM_REGISTRY=https://registry.npmmirror.com
```

> ⚠️ `NPM_REGISTRY` 只作用于 Worker 里执行的 npm/pnpm 安装（例如 React 工程的依赖）。
> Gradle / Maven 依赖（AGP、AndroidX 等）**不读**这个变量，首次构建会直接连
> `google()` / `mavenCentral()`；国内网络下若访问不通，会卡在 Gradle 下载阶段。
> Gradle 本体请按 §二.6 手动放好。

### 5. 端口占用

默认端口：API `3000`、Web `5173`、Redis `6379`。**改 `.env` 里的 `API_PORT` / `FRONTEND_PORT` 没有用**（见 §四）；端口被占用时，只能先结束占用进程，或者改代码里的端口与代理配置。

### 6. 构建产物与限流

- 构建产物（APK）默认保留 **2 小时**，由 Worker 每 30 分钟清理一次。
- 限流**默认关闭**（不设置 `RATE_LIMIT_ENABLED` 就不生效），本地可以连续打包。需要时在 `.env` 里设 `RATE_LIMIT_ENABLED=true`，默认按 IP 每小时 5 次。

### 7. Windows 特有提醒

- **路径长度**：Windows 默认 260 字符路径上限可能影响深层 Gradle 构建，建议把项目放在较短的路径下（如 `D:\demo2apk`）。
- **用户名含中文/空格**：可能导致 Cordova/Gradle 构建异常，建议使用纯英文、无空格的用户目录。
- **杀毒软件**：实时防护会显著拖慢 Gradle 构建，可将项目目录与 `%USERPROFILE%\.gradle` 加入白名单。
- **PowerShell 换行符**：`curl` 多行命令在 PowerShell 中换行符为 `` ` ``（反引号），在 cmd 中为 `^`（脱字符）。

---

## 八、命令速查

| 命令 | 说明 |
|------|------|
| `pnpm install` | 安装全部依赖 |
| `pnpm build` | 构建所有包（core / backend / frontend） |
| `pnpm dev` | 启动 API 服务（端口 3000） |
| `pnpm worker` | 启动构建 Worker |
| `pnpm frontend` | 启动 Web 界面（端口 5173） |
| `pnpm test` | 运行全部测试 |
| `pnpm test:core` | 仅测试 core 包 |
| `pnpm test:backend` | 仅测试 backend 包 |
| `redis-cli ping` | 检查 Redis 是否运行 |
| `pnpm clean` | 清理 dist 与 node_modules |

---

## 九、相关文档

- [docs/NEW_MACHINE_SETUP.md](docs/NEW_MACHINE_SETUP.md) — 新机器从零部署清单（最低配置、系统版本、安装顺序）
- [README_CN.md](README_CN.md) — 项目总览与功能特性
- [DEPLOYMENT.md](DEPLOYMENT.md) — 生产环境部署（Docker / Linux）
- [docs/API.md](docs/API.md) — REST API 接口说明
- [docs/ENV_VARIABLES.md](docs/ENV_VARIABLES.md) — 环境变量完整清单
- [docs/REACT_PROJECT_REQUIREMENTS.md](docs/REACT_PROJECT_REQUIREMENTS.md) — React 项目打包要求
