<img src="public/brand/icon-128.png" width="80" height="80" alt="MindNB" />

# MindNB

**简体中文 · [English](README.md)**

### 把想法连起来，把文件留在自己手里。

MindNB 是一款免费开源的桌面思维导图、可视化笔记与图文手帐编辑器。从一个想法开始，展开分支，加入图片和可编辑图表，再排成自由画布或纸页。桌面文档与图片保存在你选择的本地文件夹中，日常编辑无需账号，离线也能使用。

[下载版本](https://github.com/Ethan-Tang-2035/MindNB/releases) · [源码运行](docs/development.zh-CN.md) · [参与贡献](CONTRIBUTING.md) · [AGPL-3.0 许可证](LICENSE)

![MindNB 思维导图编辑器](docs/screenshots/editor.png)

## 下载

**当前为 0.1.0 早期预览阶段，安装包正在准备。** 只有出现在已发布 [GitHub Release](https://github.com/Ethan-Tang-2035/MindNB/releases) 附件中的文件才是可下载版本。下表是构建目标，不代表已经通过实机验收；目前尚未宣布公开安装包。

| 系统 | 处理器架构 | 下载文件 |
| --- | --- | --- |
| macOS，Apple Silicon | arm64 | `MindNB-<版本>-mac-arm64.dmg` 或 `.zip` |
| macOS，Intel | x64 | `MindNB-<版本>-mac-x64.dmg` 或 `.zip` |
| Windows | x64 | `MindNB-<版本>-win-x64.exe` 安装版或 `.zip` |
| Linux | x64 | `MindNB-<版本>-linux-x86_64.AppImage` |

在版本页的 **Assets** 中选择系统和架构。GitHub 自动生成的 “Source code” 是源码，普通用户请选择安装包。每个发布版本应附安装说明、签名状态和 `SHA256SUMS.txt` 校验文件，操作见[安装与校验](docs/open-source/install.md)。Windows ARM、Linux ARM、移动端与自动更新暂未纳入已验证的发布范围。

## 产品特色

- **从整理思路到图文表达，一份文档完成。** 思维导图可以与文本框、图片、贴纸、可编辑表格、时间轴、流程图和手绘笔迹混排，也能整理成适合分享的纸页。
- **每个分支都能选择合适的结构。** 支持逻辑图、平衡导图、组织结构图、树形图、鱼骨图和手帐结构；折叠与子树聚焦帮助查看细节。
- **编辑动作直接可见。** Tab / Enter 快速建节点，拖动时预览落点，分支可以脱离成游离节点，再重新挂接，配合撤销与重做整理内容。
- **有纸感，也能精细调整。** 纸张纹理、手写字体、分支色彩与明暗主题营造手绘质感；需要时可单独调整节点样式。
- **自己的内容可以带走。** `.mindnb` 可携带文档和资源；另支持 PNG、JPEG、SVG、PDF、Markdown、Word、Excel、OPML 与 TextBundle。不同格式的还原程度不同，保留可编辑结构请使用 `.mindnb`。
- **可选的 Agent 集成。** 随桌面构建提供 MCP 服务，兼容的本地客户端可通过桌面桥接读写文档。客户端可能调用外部 AI 服务，连接私人文档前请检查客户端的数据设置。

![样式与可视化笔记](docs/screenshots/styling.png)

## 第一次使用

1. 安装对应系统版本，选择本地资料库文件夹。
2. 新建文档，用 **Tab** 添加子节点，用 **Enter** 添加兄弟节点。
3. 加入图片或图表，为分支选择结构，或整理成纸页。
4. 导出 `.mindnb` 带走可编辑副本，导出 PDF 或图片分享。

可以从读书笔记、项目计划或图文手帐开始。当前界面以中文为主；提供英文说明不代表已经完成英文界面本地化。

## 存储与当前边界

桌面版使用本地资料库。导入 `.mindnb` 时会复制进资料库，之后的修改不会回写原导入文件，需要分享时请重新导出。升级预览版前请备份资料库。MindNB 不会为资料库文件自动加密。

网页版使用浏览器存储，也可连接自行部署的远端服务。远端服务采用共享访问密钥，面向单用户或私有部署，不适合作为公开的多用户服务。包括 iCloud 在内的云文件夹同步尚未完成并发编辑认证。详见[隐私与安全](SECURITY.md)。

## 开发与参与

使用 Node.js 24 或更新版本：

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build:desktop
npm run package:desktop -- --publish never
```

macOS 桌面构建需要可用的 Swift 工具链并接受 SDK 许可。安装包应在对应系统构建；检查方法见[开发指南](docs/development.zh-CN.md)和[发布指南](docs/open-source/releasing.md)。

反馈请附系统、处理器架构、应用版本、复现步骤，以及移除私人内容的最小示例。详见[贡献指南](CONTRIBUTING.md)；内部开发使用本地 Markdown 工单。

## 许可证与致谢

项目原创代码采用 [AGPL-3.0 许可证](LICENSE)，允许商业使用和再分发。字体、插图与依赖保留[各自的许可](THIRD_PARTY_NOTICES.md)。MindNB 是独立项目，提及第三方名称不表示存在关联或背书。
