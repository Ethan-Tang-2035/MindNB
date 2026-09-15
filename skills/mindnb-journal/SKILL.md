---
name: mindnb-journal
description: Create and refine editable, multi-page journals in MindNB through its MCP tools, using supplied content or researched sources. Use for illustrated journals, reading notebooks, and knowledge pages that must remain editable in MindNB.
---

# MindNB 可编辑手账

把内容变成可继续编辑的 MindNB 文档。外部 agent 负责资料、结构和视觉编排，MindNB 负责原生对象、渲染与保存。风格、页数和内容密度服从用户任务，不固定成某一本示例册。

## 接入与当前能力

首版需要运行已启用 agent bridge 的 MindNB，并连接它的 MCP server。配置见 MindNB 仓库的 [docs/agent-access.md](../../docs/agent-access.md)；若此 Skill 已独立安装，该相对链接可能不可用，改从当前 MindNB 项目根目录读取同一路径。

先调用 `describe_capabilities`，按返回的当前 schema、支持的格式和限制执行，并遵守启动时配置的资产目录。以下是工具名称，不是可直接套用的参数模板：

| 工具 | 用途 |
| --- | --- |
| `describe_capabilities` | 查询当前操作 schema、导出和资源能力 |
| `read_document` | 读取文档结构、对象 ID 与编辑版本 |
| `create_document` | 创建本次任务的文档 |
| `list_assets` | 查询内置贴纸目录 |
| `apply_operations` | 批量创建、修改纸页及原生对象 |
| `render_preview` | 获取实际文档渲染预览 |
| `export_document` | 导出当前版本文档及视觉结果 |

工具不可用时，先检查连接和正在运行的应用；不要把手写 JSON、独立 HTML 或自制截图当作成功调用的结果，也不要猜测旧接口。

## 从材料到作品

1. **明确内容依据。** 使用用户材料；用户要求搜索时，定位原始发布者并记录标题、作者、日期和 URL。区分原观点、简短摘要与原创练习，不逐段翻译受版权保护的长文。个人经历由用户填写，不能替用户编造答案。
2. **规划可读页面。** 先确定每页作用、阅读顺序及主要内容，再分配纸面。首次编排或出现拥挤时，读 [journal-design.md](references/journal-design.md)。用户要求插画或生成纸面图时，先制作无文字的纸面／装饰图片，为正文留白；用当前可用的图片生成能力，不让图片承担唯一正文。
3. **准备资产。** 图片只从配置的 `agent-assets` 目录导入。将本次授权生成或用户提供的图片放入该目录，再以该目录内的 `assetPath` 导入；`list_assets` 只用于查询内置贴纸，不枚举本机图片。不要传远程 URL、任意本地路径或修改 bridge 的目录限制来绕过导入范围。没有合适图像能力时，可使用支持的原生纸纹与形状，不声称生成了图片。
4. **创建原生内容。** 新册调用 `create_document`；修改已有作品先 `read_document`。标题、正文、练习提示用真实文本框，层级知识用真实节点及父子关系。纸页归属按 schema 显式设置；几何上落在纸内不等于已经归属于该页。装饰与知识结构分开，避免把每段普通文字都变成节点。
5. **分批排版并修正。** 按页或完整内容组提交操作，读回返回的 ID 与版本。调用 `render_preview` 逐页查看：有没有丢字、遮挡、越界、难读的对比或被装饰占满的书写区。结合工具返回的检查信息修改相关对象，再看受影响页面。不要仅凭成功响应推断视觉质量。
6. **保存与交付。** 使用当前能力支持的保存／导出路径保留可编辑 `.mindnb`；按任务交付逐页 PNG、PDF。导出前确认最后一批修改已写入，导出后核对返回文件与版本。只声明实际生成的格式，并说明仍未支持的请求。交付真实文件位置、简短内容来源，以及用户在 UI 中可以继续改哪些内容。

## 修改一致性

- `apply_operations` 批次携带最新 `expectedEditRevision` 和唯一 `requestId`。一个逻辑请求使用一个 ID；只有完全相同请求的网络重试才复用该 ID，不能拿旧 ID 提交不同内容。
- 遇到版本冲突或不确定是否已执行，先 `read_document` 对齐状态，再决定剩余修改。不原样重放可能重复创建纸页、文本或节点的批次；以当前 schema 的幂等规则为准。
- 保留用户现有内容与当前编辑状态，使用可撤销的应用操作。不要直接覆盖 vault JSON 或绕开工具写入文档内部文件。
- “可编辑”必须能通过修改真实文本或节点验证；整页图片、转成路径的字形、仅有 SVG 扩展名都不能替代这个要求。
