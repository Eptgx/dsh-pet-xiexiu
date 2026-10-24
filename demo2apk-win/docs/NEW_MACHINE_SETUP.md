# 新机器部署清单（Windows）

目标：一台**干净的 Windows**，从零到能打开网页、上传 HTML / ZIP 并打出 APK。
这里只讲「缺什么、装什么、怎么验证」；逐步细节见 [WINDOWS_LOCAL_SETUP.md](../WINDOWS_LOCAL_SETUP.md)，报错见 [ERROR_FIXES.md](ERROR_FIXES.md)。

手头已经有一整套离线安装包（JDK / SDK / Gradle / Redis）的话，直接看 **§三**，可以跳过下载。

> 先说结论：新机器最容易缺的不是 Node，而是 **Gradle 8.14**——它没有安装包、代码也不会自己下，
> 还必须放在一个写死的目录里。§四 的第 5 步是全文最关键的一步。

## 一、最低配置与系统版本

| 项目 | 最低 | 推荐 | 说明 |
|---|---|---|---|
| 操作系统 | **Windows 10 64 位（1809 及以上）** | Windows 11 64 位 | Node.js 20+、JDK 21、Android SDK 35 都要求 64 位 Win10 1809+；Win7/8 不支持 |
| 架构 | x64 | x64 | **ARM64 Windows 未验证**，不建议；x64 模拟运行风险高 |
| CPU | 4 核 | 8 核 | Gradle 编译吃单核性能，React 分支还叠加 npm 构建 |
| 内存 | **8 GB** | 16 GB | Windows 自身 3–4 GB，Gradle 堆上限 1 GB（代码里写死），React 工程 `npm install` 峰值较高 |
| 磁盘 | **20 GB 可用** | 40 GB SSD | 首次全套约 4–6 GB（SDK + Gradle + 依赖 + 缓存）；SSD 强烈推荐，Gradle 小文件极多 |
| 显卡 | 不需要独显 | — | 不打模拟器，不做图形渲染 |
| 网络 | 能访问 npm 与 Maven | 宽带 + 可用镜像 | 首次构建要下载 cordova-android、Gradle 依赖，约 1–2 GB |
| 权限 | 管理员 | 管理员 | 装 Redis 服务、装 SDK 组件、改 PATH 都需要 |

不支持 / 未验证：

- Windows 7 / 8 / 8.1；
- 32 位系统；
- ARM64 Windows（含 Surface Pro X 一类）；
- Windows Server（理论上能跑，但本分支没有验证过）；
- 完全没有管理员权限的共享电脑（Redis 服务、SDK 安装、PATH 修改都会受限）。

> 不需要：Android Studio、Android 模拟器、Docker、WSL、Visual Studio、独立显卡。

## 二、需要装什么（总表）

| 组件 | 版本 | 作用 | 缺了会怎样 |
|---|---|---|---|
| Node.js | **20+**（推荐 22 LTS） | 运行后端 / Worker / 前端构建 | 所有命令都找不到 |
| pnpm | **9.x** | monorepo 依赖管理 | `pnpm install` 不可用 |
| JDK | **21** | Gradle 编译 APK | Gradle 报 `JAVA_HOME is not set` |
| Android SDK | `platform-tools` + `platforms;android-35` + `build-tools;35.0.0` | 编译 Android | 构建直接判「Android SDK not found」 |
| Cordova CLI | 最新（13.x） | 生成 Cordova 工程 | 代码会自动 `npm i -g cordova`，但会多花几分钟 |
| **Gradle** | **8.14（固定）** | 执行 `assembleDebug` | **最后一步报 `spawn ...gradle.bat ENOENT`** |
| Redis | 5.x（Memurai 或 Windows 版） | BullMQ 队列 | 页面能开，提交构建返回 503 |
| Git | 任意 | 拉代码（可选） | 手动拷文件夹也能用 |
| 浏览器 | 自带 Edge 即可 | 访问 5173 | — |

## 三、如果已经有离线包（免下载）

手上有这五样时，可以跳过大部分下载步骤，直接按表放置：

| 文件 | 放到 | 解压后应看到 | 验证 |
|---|---|---|---|
| `jdk-21.0.11+10.zip` | `%USERPROFILE%\.jdks\` | `.jdks\jdk-21.0.11+10\bin\java.exe` | 见下方统一验证 |
| `Sdk.zip` | `%USERPROFILE%\Android\` | `Android\Sdk\platform-tools\`、`platforms\android-35\`、`build-tools\35.0.0\`、`licenses\` | 同上 |
| `gradle-8.14-bin.zip` | `%USERPROFILE%\.gradle\gradle-dist\` | `gradle-8.14\bin\gradle.bat` | 同上 |
| `Redis-x64-5.0.14.1.msi` | 双击安装（默认端口 6379） | 服务自动启动 | `redis-cli ping` |
| 项目源码 zip | 短路径，如 `D:\demo2apk-win` | `package.json`、`pnpm-lock.yaml` | `Test-Path .\package.json` |

解压命令（PowerShell；文件名按实际改）：

```powershell
Expand-Archive .\jdk-21.0.11+10.zip  -DestinationPath "$env:USERPROFILE\.jdks" -Force
Expand-Archive .\Sdk.zip             -DestinationPath "$env:USERPROFILE\Android" -Force
Expand-Archive .\gradle-8.14-bin.zip -DestinationPath "$env:USERPROFILE\.gradle\gradle-dist" -Force
```

> ⚠️ 目录层级必须和上表一致：`Sdk` 下要直接看到 `platform-tools`，`gradle-dist` 下要直接看到
> `gradle-8.14`。多套一层，代码就找不到。
>
> ⚠️ JDK 解压出来的文件夹名必须是 `jdk-21.0.11+10`——代码的回退路径写死了这个名字。
> 如果 zip 里是别的名字，改过来。
>
> ⚠️ 如果 `Sdk.zip` 解压出来是 `Android\platform-tools`（没有 `Sdk` 这一层），
> 把 `platform-tools`、`platforms`、`build-tools`、`licenses` 移进 `%USERPROFILE%\Android\Sdk`。

放置后统一验证：

```powershell
Test-Path "$env:USERPROFILE\.jdks\jdk-21.0.11+10\bin\java.exe"
Test-Path "$env:USERPROFILE\Android\Sdk\platform-tools"
Test-Path "$env:USERPROFILE\Android\Sdk\platforms\android-35"
Test-Path "$env:USERPROFILE\Android\Sdk\build-tools\35.0.0"
Test-Path "$env:USERPROFILE\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat"
redis-cli ping
```

六项全是 `True` / `PONG` 时，**不需要设置** `JAVA_HOME`、`ANDROID_HOME`——这些路径正好在代码的探测范围内。
如果 JDK / SDK 放到了别处，就必须回到 §四 第 3、4 步手动设变量和 PATH。

### 还差 Node.js

离线包里没有 Node，必须单独装（§四 第 1 步）。装完执行 `npm i -g pnpm@9`，确认 `pnpm -v` 是 9.x。

想把这套包补完整，可以再加一个 Node 便携版 zip（如 `node-v22.x-x64.zip`）：解压后把目录加进 `PATH` 即可，不必装 MSI。

### 离线程度：工具链 vs 构建依赖

| 级别 | 需要准备 | 第一次构建 |
|---|---|---|
| **L1 半离线（推荐）** | 上面五样 + Node 安装包 | 需要联网：`cordova-android@14`、AGP/AndroidX、React 工程依赖都会现下 |
| L2 构建也离线 | 再加 pnpm store 与 `%USERPROFILE%\.gradle\caches` | 代码里的 `pnpm add` 没带 `--offline`，仍可能联网；体积大，不建议 |

> 一句话：这五样解决的是「装工具链」的离线，不是「构建依赖」的离线。

### ⚠️ 不要用旧的整包

如果项目包里带 `node_modules/`、`dist/`、`.env`、`builds/`，多半是从旧目录直接压的：

- 可能是 `demo2apk-main`，**不含**本分支的 Windows 修复；
- pnpm 的 `node_modules` 是 junction，换机器解压后链接会断；
- `.env` / `builds/` 会把你本机的配置和产物一起发出去。

正确做法：只带源码 + `pnpm-lock.yaml` + 文档，依赖现场 `pnpm install`。

## 四、30 分钟安装步骤

> 以下命令都在 **PowerShell** 里执行；装完记得**重开终端**，环境变量才会生效。
> 时间估算按「网络正常」算，慢网可能翻倍。

### 0. 先确认系统（1 分钟）

```powershell
[Environment]::Is64BitOperatingSystem      # 必须是 True
$env:PROCESSOR_ARCHITECTURE                # 必须是 AMD64
winver                                     # 确认 Windows 10/11
```

### 1. 安装 Node.js（5 分钟）

```powershell
winget install OpenJS.NodeJS.LTS
```

或从 <https://nodejs.org/> 下载 LTS 安装包。验证：

```powershell
node -v    # v20.x 或更高
npm -v
```

### 2. 安装 pnpm 9（2 分钟）

```powershell
npm install -g pnpm@9
pnpm -v    # 必须是 9.x
```

> ⚠️ 不要用不带版本的 `npm i -g pnpm`：现在会装 10.x，和项目锁定的 `pnpm@9.12.0` 不一致，
> 可能触发联网切版本，还默认拦截依赖的 postinstall 脚本。

### 3. 安装 JDK 21（5 分钟）

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
```

安装后设置 `JAVA_HOME`（路径按实际安装位置改）：

```powershell
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
```

验证（**重开终端后**）：

```powershell
java -version    # 21.x
```

### 4. 安装 Android SDK（10–15 分钟）

1. 下载 command-line tools：<https://developer.android.com/studio#command-line-tools-only>
2. 解压到 `%USERPROFILE%\Android\Sdk\cmdline-tools\latest\`
   （zip 里的 `cmdline-tools` 目录内容放进 `latest`，最终能看到 `latest\bin\sdkmanager.bat`）
3. 设环境变量：

```powershell
setx ANDROID_HOME "$env:USERPROFILE\Android\Sdk"
setx ANDROID_SDK_ROOT "$env:USERPROFILE\Android\Sdk"
```

4. 把它们加入 `PATH`（用户级，追加即可）：

```powershell
$old = [Environment]::GetEnvironmentVariable('Path','User')
$add = "$env:USERPROFILE\Android\Sdk\platform-tools;$env:USERPROFILE\Android\Sdk\cmdline-tools\latest\bin;$env:APPDATA\npm"
[Environment]::SetEnvironmentVariable('Path', "$old;$add", 'User')
```

5. **重开终端**，安装组件并接受许可：

```powershell
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
sdkmanager --licenses      # 一路输入 y
```

验证：

```powershell
Test-Path "$env:USERPROFILE\Android\Sdk\platform-tools"
Test-Path "$env:USERPROFILE\Android\Sdk\platforms\android-35"
Test-Path "$env:USERPROFILE\Android\Sdk\build-tools\35.0.0"
```

> ⚠️ 三个 `Test-Path` 都必须是 `True`。少 `platform-tools` 会直接判 SDK 无效；
> 没执行 `sdkmanager --licenses`，Gradle 第一次编译会因「license not accepted」失败。

### 5. 放置 Gradle 8.14（最关键，3 分钟）

代码在 Windows 上**不使用** Cordova 生成的 `gradlew.bat`，而是直接执行固定路径：

```text
%USERPROFILE%\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat
```

这个目录没有安装包，也不会自动生成，必须手动放：

```powershell
# 1. 下载（代码里用的就是这个镜像）
Invoke-WebRequest "https://mirrors.cloud.tencent.com/gradle/gradle-8.14-bin.zip" -OutFile "$env:TEMP\gradle-8.14-bin.zip"

# 2. 解压到 ~/.gradle/gradle-dist/，会得到 gradle-8.14 目录
New-Item -ItemType Directory -Force "$env:USERPROFILE\.gradle\gradle-dist" | Out-Null
Expand-Archive "$env:TEMP\gradle-8.14-bin.zip" -DestinationPath "$env:USERPROFILE\.gradle\gradle-dist" -Force

# 3. 验证（必须是 True）
Test-Path "$env:USERPROFILE\.gradle\gradle-dist\gradle-8.14\bin\gradle.bat"
```

> ⚠️ 不要多套一层目录（不要出现 `gradle-8.14\gradle-8.14\bin`），也不要改目录名——
> 路径是写死在代码里的。

### 6. 安装 Redis（5 分钟）

二选一：

- **Memurai**（Windows 原生，商业/开发者版）：<https://www.memurai.com/>
- **Redis for Windows 5.x**：<https://github.com/tporadowski/redis/releases>

装完启动服务并验证：

```powershell
redis-cli ping    # 期望 PONG
```

> ⚠️ Redis 没起时，网页能打开、也能上传，但提交构建会返回 503，很容易误以为是项目坏了。

### 7. 安装 Cordova CLI（可选，2 分钟）

```powershell
npm install -g cordova
cordova -v
```

不装也能跑：构建时检测不到会自动执行 `npm i -g cordova`，只是第一次会多花几分钟。

### 8. 准备项目（5 分钟）

建议把项目放在**短路径、纯英文**目录下，例如 `D:\demo2apk-win`。

```powershell
cd D:\demo2apk-win
pnpm install
Copy-Item .env.example .env    # 可选；不建也能跑
pnpm build
```

说明：

- `.env` 不是必需：限流默认关闭，端口写死 3000 / 5173；
- `pnpm build` 会编译 `core` 与 `backend`——Worker 运行的是 `dist`，不编译跑不起来。

### 9. 启动（2 分钟）

方式一：双击 `start-local.cmd`（会检查 Redis，起 API / Worker / Web 并打开浏览器）。

方式二：开三个终端，分别在项目根目录执行：

```powershell
pnpm dev        # API      http://127.0.0.1:3000
pnpm worker     # 构建 Worker
pnpm frontend   # 网页     http://127.0.0.1:5173
```

验证：

```powershell
curl http://127.0.0.1:3000/health    # {"status":"ok",...}
```

## 五、第一次验证：先假构建，再真打包

1. 在 `.env` 里设 `MOCK_BUILD=true`，重启 Worker；
2. 打开 <http://127.0.0.1:5173>，上传任意 HTML，几秒后能下载到一个占位 APK → 说明 API / Redis / Worker / Web 全通；
3. 改回 `MOCK_BUILD=false`，重启 Worker，再传真实 HTML；
4. 真包产物在 **`packages\backend\builds\`**（不是根目录 `builds\`）。

## 六、必踩的坑（按出现顺序）

| 现象 | 原因 | 处理 |
|---|---|---|
| `spawn ...gradle-8.14\bin\gradle.bat ENOENT` | 第 5 步没做或目录层级不对 | 回到第 5 步，用 `Test-Path` 确认 |
| `Android SDK not found` / `SDK location not found` | `ANDROID_HOME` 没设，或缺 `platform-tools` | 设变量 + 装 platform-tools，重开终端 |
| `JAVA_HOME is not set` | 没设 JDK，且 `~/.jdks/jdk-21.0.11+10` 不存在 | 设 `JAVA_HOME`，重开终端 |
| `Failed to install ... licenses` | SDK 许可没接受 | `sdkmanager --licenses` |
| `pnpm: 无法将...识别为命令` | pnpm 没装 / npm 全局 bin 不在 PATH | `npm i -g pnpm@9`，确认 `%APPDATA%\npm` 在 PATH |
| 提交构建返回 503 | Redis 没启动 | 启动 Redis，`redis-cli ping` |
| 界面报 `OPERATION TIMED OUT`，但任务没结束 | 前端轮询上限约 10 分钟 | Worker 仍在跑；刷新页面（带 taskId）会继续查，产物仍会生成 |
| 打出的 APK 白屏 | React 项目没配 `base: './'` 与 legacy 插件 | 见 [REACT_PROJECT_REQUIREMENTS.md](REACT_PROJECT_REQUIREMENTS.md) |
| 端口 3000 / 5173 被占用 | 旧进程没退干净 | 结束占用进程；`.env` 里改端口不生效 |

## 七、Windows 上的两个非软件问题

- **路径长度**：工程会落在 `builds\<应用名>\platforms\android\...`，很容易超过 260 字符。
  把项目放短路径（如 `D:\demo2apk-win`），或开启长路径支持（需管理员）：

  ```powershell
  New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
  ```

- **杀毒软件**：实时防护会明显拖慢 Gradle。可以把项目目录和 `%USERPROFILE%\.gradle` 加进白名单（需管理员）：

  ```powershell
  Add-MpPreference -ExclusionPath "D:\demo2apk-win"
  Add-MpPreference -ExclusionPath "$env:USERPROFILE\.gradle"
  ```

## 八、时间预算

| 阶段 | 正常网络 | 慢网 |
|---|---|---|
| Node + pnpm | 5 分钟 | 10 分钟 |
| JDK | 5 分钟 | 10 分钟 |
| Android SDK（含下载） | 10–15 分钟 | 25 分钟+ |
| Gradle 8.14（约 130 MB） | 2–3 分钟 | 10 分钟 |
| Redis | 5 分钟 | 5 分钟 |
| 项目依赖与编译 | 3–5 分钟 | 10 分钟 |
| **合计** | **约 30–40 分钟** | 1 小时以上 |

## 相关文档

- [WINDOWS_LOCAL_SETUP.md](../WINDOWS_LOCAL_SETUP.md) — 环境细节、验证命令、常见问题
- [BUILD_PIPELINE.md](BUILD_PIPELINE.md) — 上传到 APK 的内部流程
- [ERROR_FIXES.md](ERROR_FIXES.md) — 按报错组织的修复记录
- [REACT_PROJECT_REQUIREMENTS.md](REACT_PROJECT_REQUIREMENTS.md) — React 项目白屏的配置要求
