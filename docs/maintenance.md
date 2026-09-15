# 构建与测试维护

## 当前入口

| 命令 | 覆盖范围 |
| --- | --- |
| `npm run typecheck` | 应用、服务端、桌面、MCP、脚本和 Playwright 配置 |
| `npm test` | 模型、兼容读取、布局、持久化、导出、资料库与 MCP 集成 |
| `npm run test:web` | 网页纸页与文本框，含真实下载、导出尺寸和保存重开 |
| `npm run test:desktop` | Electron 编辑器、完整功能审核、菜单、资料库、纸页、手账与 MCP |
| `npm run test:pages` / `npm run test:textbox` | 对应功能的定向回归 |
| `npm run build` / `npm run build:desktop` / `npm run build:mcp` | 网页、完整桌面、独立 MCP 构建 |
| `npm run package:desktop` | 安装包输出到 `release/` |
| `npm run clean` | 清除构建、安装包和自动化测试产物 |

浏览器测试共用 `playwright.web.config.ts`，默认使用 Playwright Chromium。首次运行前安装 `npx playwright install chromium`；`PLAYWRIGHT_CHANNEL=chrome` 可使用本机 Chrome。桌面测试独立使用 `playwright.desktop.config.ts`。macOS 原生文件协调测试需要先构建 Swift 辅助程序，并设置 `MINDNB_TEST_NATIVE=1`。

## 2026-09 清理

- 退役 `scripts/v10-check.mjs` 至 `v15-check.mjs`、`cursor-feedback-check.mjs`、`visual-refine-check.mjs`、`visual-refine-report.mjs` 和 `ui-check.mjs`。这些里程碑脚本包含旧界面选择器、本机浏览器缓存探测或一次性截图流程；后续回归使用正式单测和 `tests/desktop/full-audit.e2e.ts` 等 Playwright 测试。旧票据与验收证据中的路径保留为历史记录。
- 删除写死文档 ID 与临时 socket 的 `update-journal-cover.mjs`。依赖私人内容的手帐演示驱动及预览脚本已归档；可复现 MCP 验收使用 `tests/desktop/agent-mcp.e2e.ts`。
- 持久化兼容测试更名为 `src/content-persistence.test.ts`；旧文档、品牌迁移和格式兼容测试继续保留。
- 网页纸页示例夹具放在 `tests/fixtures/paper-pages.html`，测试不再依赖 `.scratch/` 中的演示页面。
- MCP 的独立构建、桌面构建和集成测试共用 `scripts/mcp-build.ts`；集成测试在临时目录构建，避免覆盖桌面产物。安装包只在 `Resources/mcp/` 放置一份 MCP 服务。
- 桌面构建先检查 Swift 工具链，再清空 `dist-desktop/`，防止旧入口残留进入安装包。
- 修复首页资源加载期间关闭应用会挂起的问题：关闭事件在导航前注册，正常关闭导致的加载中断不再弹出启动失败对话框。`tests/desktop/startup-close.e2e.ts` 延迟首页图标加载，验证该真实退出路径。

`output/` 中的用户内容、设计源文件、正式夹具、资料库和 `.scratch/` 票据不属于构建缓存，清理命令不删除它们。
