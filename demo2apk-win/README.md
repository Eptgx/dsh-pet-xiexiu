# demo2apk-win · Windows 本地打包

把网页 / Vite/React 工程 / ZIP 直接打成可安装的 Android APK。
这是 [demo2apk](https://github.com/DeadWaveWave/demo2apk) 的 **Windows 本地化分支**：去掉 Docker，改成在自己电脑上跑。

**可以单独运行**：这个目录不依赖仓库里的 `pet-framework`，删掉它也不影响打包。

## 和上游的差别

| | 上游 | 这个分支 |
|---|---|---|
| 运行方式 | Docker（linux/amd64） | **Windows 本机直接跑** |
| 依赖 | 容器内预装 SDK/JDK | 自动探测本机 Android SDK / JDK；Gradle 需手动放置 |
| 启动 | `docker compose up` | `start-local.cmd` 或 `pnpm dev` + `pnpm worker` |
| 构建等待 | 队列 + 限流 + 产物保留 | 本地即时构建，产物留在本机 |

## 快速开始（Windows）

1. 装 Node.js 20+、pnpm 9、JDK 21、Android SDK（含 build-tools 与 platform 35）；
2. `pnpm install`；
3. 双击 `start-local.cmd`（会检查 Redis、起 API、Worker、前端）；
4. 打开 `http://localhost:5173`，上传 HTML 或 ZIP。

手动启动：

```bash
pnpm dev        # API :3000
pnpm worker     # 构建 worker
pnpm --filter @demo2apk/frontend dev   # 前端 :5173
```

> Redis 是队列依赖。Windows 上可以用 Memurai 或 WSL 里的 Redis；版本低于 6.2 也能跑，只是启动会警告。

## 目录

```
packages/
  core/       构建核心：Cordova / Capacitor 两条分支、系统栏、图标、权限
  backend/    Fastify API + BullMQ 队列 + worker
  frontend/   Vite 上传界面
scripts/      offlineify 等工具
docs/         Windows 改动说明、报错修复日志
```

## 改动说明

- [docs/WINDOWS.md](docs/WINDOWS.md)：每一处 Windows 适配改了什么、为什么
- [docs/ERROR_FIXES.md](docs/ERROR_FIXES.md)：踩过的坑与修法（含系统栏纯黑）

## 许可

MIT。上游版权归原作者所有；本分支的修改同样以 MIT 发布。
（上游作者信息待补——发布前请核对上游仓库的 LICENSE。）
