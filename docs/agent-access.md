# MindNB 本地 MCP 接入

MindNB 保留现有编辑器、纸页、导图、文字与图片能力。外部 agent 负责资料整理和编排，通过本地 MCP 调用正在运行的桌面实例。没有内置模型、远程 HTTP 服务或任意 JavaScript 执行入口。

配套工作方法：[mindnb-journal Skill](../skills/mindnb-journal/SKILL.md)。先读能力，再创建原生对象，最后查看实际渲染并导出 `.mindnb`。

## 构建与隔离运行（macOS / Linux）

需要 Node.js 20 或更新版本、当前项目依赖，以及支持本地 stdio MCP 的客户端。以下命令在项目根目录执行；不会改客户端配置，也不会覆盖已有资料库。

```sh
npm install
npm run build:desktop && npm run build:mcp

MINDNB_AGENT_RUN=$(mktemp -d /tmp/mindnb-agent-XXXXXX)
chmod 700 "$MINDNB_AGENT_RUN"
mkdir "$MINDNB_AGENT_RUN/profile" "$MINDNB_AGENT_RUN/vault" "$MINDNB_AGENT_RUN/assets" "$MINDNB_AGENT_RUN/exports"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({path:process.argv[2]}))' \
  "$MINDNB_AGENT_RUN/profile/vault-location.json" "$MINDNB_AGENT_RUN/vault"

./node_modules/.bin/electron . \
  --user-data-dir="$MINDNB_AGENT_RUN/profile" \
  --agent-bridge="$MINDNB_AGENT_RUN/bridge.sock" \
  --agent-assets="$MINDNB_AGENT_RUN/assets" \
  --agent-output="$MINDNB_AGENT_RUN/exports"
```

`MINDNB_AGENT_RUN` 是本次运行目录；在另一个终端配置 MCP 时，使用它的实际绝对路径。保留这个目录及其资料库，才能下次继续编辑。macOS 的 `/tmp` 实际指向 `/private/tmp`，两种形式都支持。

`--user-data-dir` 将 Electron 用户状态和单实例锁隔离；新 profile 中的 `vault-location.json` 指向专用资料库。正式打包版同样读取这个配置。不要通过 `MINDNB_DESKTOP_VAULT`、`MINDNB_DESKTOP_DATA` 等测试环境变量配置正式版；生产启动请用命令行 profile 和正常资料库配置。

只运行 MCP server 不会自动启动编辑器：

```sh
node /absolute/MindNB/dist-desktop/mcp-server.mjs \
  --socket=/absolute/private-run-directory/bridge.sock
```

也可以设置 `MINDNB_AGENT_SOCKET`，或者使用 `--socket /absolute/path`。标准输入输出只传输 MCP 协议消息；诊断写到标准错误。

## 对正常安装版启用

默认不开启 bridge。先退出同一 profile 的旧 MindNB 实例，再启动带参数的新实例；第二实例只聚焦原窗口，不会给原窗口临时加权限。

```sh
mkdir -p "$HOME/Library/Application Support/MindNB-agent"
chmod 700 "$HOME/Library/Application Support/MindNB-agent"

/Applications/MindNB.app/Contents/MacOS/MindNB \
  --agent-bridge="$HOME/Library/Application Support/MindNB-agent/bridge.sock" \
  --agent-assets="$HOME/Pictures/MindNB-agent-assets" \
  --agent-output="$HOME/Documents/MindNB-agent-exports"
```

素材目录必须事先存在；输出目录可以由 bridge 创建。此例使用正常资料库：agent 可以读写该实例中的文档。需要隔离时加上前节的 `--user-data-dir` 和新资料库配置。Socket 完整路径限 100 字节，用户名较长时使用较短的专用私有目录。

打包流程将独立 MCP 单文件复制到：

```text
/Applications/MindNB.app/Contents/Resources/mcp/mcp-server.mjs
```

它可由系统 Node 运行，不依赖仓库内的 `node_modules`。该文件只有在重新打包包含本次功能的版本后才存在，旧安装包不含此入口。

## 客户端配置示例

以下仅是配置说明，本次实现不自动改任何客户端全局配置。把 `/absolute/node`、server 文件和 socket 路径替换成实际值；`command -v node` 可查询 Node 绝对路径。图像工具结果需要客户端支持 MCP image content。

### Codex

本机 `codex mcp add --help` 已核实以下命令格式：

```sh
codex mcp add mindnb \
  --env MINDNB_AGENT_SOCKET=/absolute/private-run-directory/bridge.sock \
  -- /absolute/node /absolute/MindNB/dist-desktop/mcp-server.mjs
```

运行这条命令会写入 Codex 的 MCP 配置。也可以在客户端配置编辑器中添加等价条目：

```toml
[mcp_servers.mindnb]
command = "/absolute/node"
args = ["/absolute/MindNB/dist-desktop/mcp-server.mjs"]

[mcp_servers.mindnb.env]
MINDNB_AGENT_SOCKET = "/absolute/private-run-directory/bridge.sock"
```

在当前工作中让 Codex 读取 `skills/mindnb-journal/SKILL.md` 即可使用项目内方法说明；无需为此修改全局 Skills 目录。

### Claude Code

本机 CLI 帮助和 [Claude Code 官方 MCP 文档](https://code.claude.com/docs/en/mcp) 已核实 stdio 配置方式：

```sh
claude mcp add --transport stdio --scope local mindnb \
  --env MINDNB_AGENT_SOCKET=/absolute/private-run-directory/bridge.sock \
  -- /absolute/node /absolute/MindNB/dist-desktop/mcp-server.mjs
```

`local` 限当前项目范围；此命令会写入 Claude Code 配置。本次测试使用官方 SDK 客户端完成真实 stdio 握手和调用，并未声称完成 Claude Code 界面内验收。

### WorkBuddy

[WorkBuddy 插件系统文档](https://www.codebuddy.cn/docs/workbuddy/Plugins) 提供 MCP 配置能力。参考以下 stdio 内容，通过其 MCP 配置界面填入；具体界面字段以已安装版本为准：

```json
{
  "mcpServers": {
    "mindnb": {
      "command": "/absolute/node",
      "args": ["/absolute/MindNB/dist-desktop/mcp-server.mjs"],
      "env": {
        "MINDNB_AGENT_SOCKET": "/absolute/private-run-directory/bridge.sock"
      }
    }
  }
}
```

WorkBuddy 未在本轮实测，不能把通用 MCP 协议测试等同于该客户端已联调成功。它是否发现独立 Skill 文件也应按其版本确认；可先将项目内 Skill 作为本次任务上下文。

## 七个工具

| 工具 | 参数 | 返回与作用 |
| --- | --- | --- |
| `describe_capabilities` | `{}` | 支持的操作、字段说明、结构、纸纹与限制 |
| `read_document` | `{documentId?,pageId?}` | 当前或指定文档的原生内容、对象 ID、编辑版本与警告 |
| `create_document` | `{name}` | 新文档 ID、编辑版本；不能盲目重试创建 |
| `list_assets` | `{query?,limit?,offset?}` | 查询内置贴纸目录，便于使用 `sticker.create` |
| `apply_operations` | `{documentId,expectedEditRevision,requestId,operations}` | 一批 1–200 个操作，返回新版本及 ref 到真实 ID 的映射 |
| `render_preview` | `{documentId,pageId?,expectedEditRevision?}` | 当前文档或纸页的真实 PNG；以 MCP 图片内容返回 |
| `export_document` | `{documentId,format,pageIds?,expectedEditRevision?,name?}` | `format` 为 `mindnb`、`png`、`pdf`；返回启动时授权目录中的实际文件路径 |

`apply_operations` 的操作以 `type` 区分，具体字段以 `describe_capabilities` 为准：`page.create`、`text.create`、`tree.create`、`image.create`、`sticker.create`、`node.text`、`node.add_child`、`object.text`、`object.move`、`style`、`page.update`。

纸页坐标是世界坐标；页内对象采用页面局部坐标。树的根中心／左上角语义请遵循返回的能力说明。每个页面中可以同时有文字、原生导图和装饰图片。

`list_assets` 列举内置贴纸，不枚举任意本机图片。对于本次已授权图片，可在 `image.create` 中传 `assetPath`（授权素材目录内相对路径或绝对路径），主进程会转换成 `dataURL` 后再传给编辑器。也可直接传内联 `dataURL`，但不能同时传两者。图片扩展名与签名需匹配 PNG、JPEG 或 WebP；每张限 8 MiB，每批图片展开后合计限 32 MiB。完整 socket 请求限 4 MiB，因此较大图片应使用 `assetPath`。

## 权限、并发与错误

- macOS / Linux socket 父目录必须属于当前用户且不可由组或其他用户写入；socket 权限为 `0600`。已经存在的 socket 不会被替换，异常退出后可换一个新的私有运行目录。
- Windows 代码接受以 `\\.\pipe\mindnb-` 开头的命名管道路径；该平台权限、打包和客户端连接尚未验收，不能当作已有 macOS 的验证结论。
- 不传 `--agent-output` 时导出禁用；不传 `--agent-assets` 时从本机路径导入图片禁用。素材 realpath 必须处于授权目录内，指向目录外的符号链接被拒绝。MCP server 不能请求任意保存路径。
- 导出仅允许 `.mindnb`、PNG、PDF，检查文件名、格式签名、100 个文件和 128 MiB 总容量上限。不会跟随目标符号链接；同名同内容的重试返回现有路径，同名不同内容返回 `EXPORT_EXISTS`，不覆盖。跨多个文件发生 I/O 失败时可能已有部分文件写入，修复问题后可安全重试同一导出。
- `.mindnb` 内部 ZIP 时间戳与 PDF 创建时间采用固定值，PDF 文件标识由内容生成，使相同内容可重复导出；这些内部时间不代表实际编辑时间，磁盘文件时间仍由文件系统记录。
- `tree.create` 的 `asRoot` 仅可填充未自定义、未手动定位的空白中心主题；保留原中心 ID 和关系线引用，批内 root ref 解析到该 ID。已有样式、结构或其他节点信息时拒绝整批操作。
- 请求串行执行，最多 16 个排队。编辑器正在输入、拖动或有模态操作时可返回 `BUSY`；待用户操作完成后重新读取文档。
- 批量编辑使用 `expectedEditRevision`，冲突时读回状态。相同逻辑请求才复用 `requestId`；新意图必须用新 ID。
- renderer 超过 45 秒不响应时返回 `REQUEST_TIMEOUT`，其结果可能已执行。bridge 会返回 `RESTART_REQUIRED` 阻止后续请求；先查看并保存应用当前状态，再重启授权实例，读回文档后决定是否继续。不要无条件重放创建操作。
- 导出、图片、文本与页面编排均复用现有产品对象与渲染；不会因接入 MCP 就自动获得智能分页或防遮挡布局，agent 仍应逐页检查预览。

## 验证

```sh
npm run typecheck
npm test -- desktop/agent-bridge.test.ts mcp/server.test.ts
```

测试包含真实本地 socket 和官方 SDK stdio 客户端，覆盖握手、七工具发现、输入校验、调用、图片内容、串行、超时、导出与素材边界。受限沙箱可能不允许监听本地 socket，需要运行环境授予本地 IPC 权限。产品级回归位于 `tests/desktop/agent-mcp.e2e.ts`，已通过隔离 Electron 实例验证两页原生文字／树／图片、真实预览、三种导出，以及关闭时最后一笔与重启恢复。运行：`npx playwright test --config playwright.desktop.config.ts tests/desktop/agent-mcp.e2e.ts`。

## 示例与编辑约定

MCP 创建、编辑、预览、导出及重开恢复的可复现示例见 `tests/desktop/agent-mcp.e2e.ts`。该测试使用隔离资料库和合成内容，不依赖私人手帐、研究材料或历史运行目录。

编辑版本是不可推算的安全整数；重新加载后旧版本失效。若返回 `persisted:false`，检查 `saveError`；`SAVE_SUPERSEDED` 表示内容已被更新版本取代，需重新读取当前文档。请求去重在单次 renderer 会话中有效，重启之后应先读取文档再制定新操作。

`object.remove` 接收 `{ids:[id,...]}`，删除指定独立对象并清理关联与纸页归属；不能传入节点或纸页 ID。与同批新对象组合，可一次撤销整组封面替换。先读取并核对目标页成员，避免移除其他页面内容。
