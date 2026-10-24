# dsh-pet-xiexiu

> **作者自述**
>
> 大家好，我和 dsh + DeepSeek V4.1 Flash 是安卓版「大肥鱼」项目的作者。我喜欢称呼自己为“AI 邪修”——因为我完全看不懂代码，全是由自己和 AI 工具、AI 模型配合完成的。
>
> 用到的工具和模型：VS Code + Claude Code 插件 + CCSwitch + DeepSeek V4，完成对 demo2apk 项目的二次开发；dsh + DeepSeek V4.1 Flash，完成对 dsh-pet 的二次开发。
>
> 由于用到的素材有版权，我就直接用 AI 随机生成的素材占位了，其它有兴趣就看文档。
>
> 本项目为个人 AI 辅助开发项目，仅供 Windows 本地打包测试小项目、学习交流使用。作者精力有限，不保证 Issue 及时回复，欢迎 Fork 自行折腾。

一个 **安卓桌面宠物** 的完整实现，拆成两个可以独立使用的部分：

| 目录 | 是什么 | 能单独用吗 |
|---|---|---|
| [`pet-framework/`](pet-framework/) | 安卓桌宠的 Web + 原生框架：悬浮窗、透明视频、拖拽、菜单、TTS、动作标签 | 能，接进任意 Cordova 工程 |
| [`demo2apk-win/`](demo2apk-win/) | Windows 本地打包器：网页/ZIP → APK，去 Docker、即时构建 | 能，和宠物无关的通用打包 |

> A desktop pet for Android, split into a reusable overlay framework and a
> Windows-local APK packager. The packager is generic and runs standalone.

## 上游项目

本仓库基于两个 MIT 项目，是在它们之上的二次开发与整合，**非官方分支**：

| 项目 | 开源地址 | 在本仓库中的角色 |
|---|---|---|
| **dsh-pet** | <https://github.com/PC2005-cloud/dsh-pet> | 桌宠悬浮窗框架的上游 |
| **demo2apk** | <https://github.com/DeadWaveWave/demo2apk> | Windows 本地打包器的上游 |

> 版权与许可归各自作者所有；本仓库的修改同样以 MIT 发布，见 [LICENSE](LICENSE)。

## 两者怎么配合

```
examples/demo-app/index.html  ──upload──▶  demo2apk-win  ──build──▶  APK
        ▲                                        │
        │                                        ├─ cordova create
        └──────── pet-framework/web ─────────────┘  injector 注入
                  pet-framework/native
```

- 只想打自己的网页：用 `demo2apk-win`，不需要宠物代码；
- 想要桌宠：把 `pet-framework` 的注入逻辑接进打包流程，见
  [pet-framework/injector](pet-framework/injector/README.md)。

## 素材版权

本仓库**不包含任何第三方动画、立绘、图标**。
`pet-framework/assets/placeholder/` 是脚本生成的几何占位角色（可自由使用），
真实素材请自备，格式见 [docs/ASSETS.md](pet-framework/docs/ASSETS.md)。

## 文档

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)：两条链路的数据流与关键取舍
- [pet-framework/docs/](pet-framework/docs/)：坐标系、素材、悬浮窗、语音、动作标签
- [demo2apk-win/docs/WINDOWS.md](demo2apk-win/docs/WINDOWS.md)：Windows 适配改动
- [demo2apk-win/docs/ERROR_FIXES.md](demo2apk-win/docs/ERROR_FIXES.md)：报错修复日志

## License

MIT，见 [LICENSE](LICENSE)。上游项目（demo2apk、dsh-pet）的版权归各自作者。
