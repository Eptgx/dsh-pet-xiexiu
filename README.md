# dsh-pet-xiexiu

一个 **安卓桌面宠物** 的完整实现，拆成两个可以独立使用的部分：

| 目录 | 是什么 | 能单独用吗 |
|---|---|---|
| [`pet-framework/`](pet-framework/) | 安卓桌宠的 Web + 原生框架：悬浮窗、透明视频、拖拽、菜单、TTS、动作标签 | 能，接进任意 Cordova 工程 |
| [`demo2apk-win/`](demo2apk-win/) | Windows 本地打包器：网页/ZIP → APK，去 Docker、即时构建 | 能，和宠物无关的通用打包 |

> A desktop pet for Android, split into a reusable overlay framework and a
> Windows-local APK packager. The packager is generic and runs standalone.

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
