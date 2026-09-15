# 开发指南

## 快速开始

```bash
npm ci
npm run dev        # 启动开发服务器
npm test           # 运行测试（vitest）
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建到 dist/
```

## 项目结构

开发环境使用 Node.js 24 或更新版本。网页测试首次执行前运行 `npx playwright install chromium`，之后使用 `npm run test:web`；也可以设置 `PLAYWRIGHT_CHANNEL=chrome` 使用已安装的 Chrome。

`npm run build:desktop` 构建 Electron 和独立 MCP 服务。macOS 需要可用的 Swift/Xcode 命令行工具并接受其许可；`npm run package:desktop` 将安装包输出到 `release/`。

`npm run clean` 清除生成的 `dist/`、`dist-desktop/`、`release/`、`test-results/` 和 `playwright-report/`。清理后须重新构建才能启动桌面版或 MCP 服务。已退役检查及替代入口见[维护说明](maintenance.md)。

```
src/
  model.ts        # 树数据模型与结构操作（增/移动/删/折叠）
  docs.ts         # 文档存储：索引、按文档持久化、迁移
  layout.ts       # 节点级结构、盒布局、树包围盒
  render.ts       # SVG 渲染：节点、连线、装饰
  theme.ts        # 主题与文档级样式默认值
  panel.ts        # 格式面板（样式与画布控件）
  objects.ts      # 画布对象：图片、贴纸、分组框、关系线
  drag.ts         # 磁吸解析：落点占位符、盒缘判定
  selection.ts    # 单选与多选、框选
  editing.ts      # 文字编辑、自动换行
  nav.ts          # 键盘导航
  history.ts      # 撤销/重做快照
  exporter.ts     # PNG 导出
  home.ts         # 文档首页
  ...
api/
  ping.ts         # 鉴权探针：204 / 401 / 500（远端真源票 01）
server/
  auth.ts         # API Routes 共享的 Bearer 密钥鉴权（放 api/ 外，避免被注册为函数）
vercel.json       # Vercel 上的 vite 构建 + api/ functions
docs/
  adr/            # 架构决策记录（ADR）
  screenshots/    # README 截图
CONTEXT.md        # 统一语言词汇表（项目术语的唯一权威定义）
.scratch/         # 仅本地的规格与工单（忽略提交，可能不存在）
```

## 部署（Vercel）

远端真源存储（[ADR-0005](adr/0005-remote-truth-on-vercel-blob.md)）：静态 Vite 构建 + `api/` functions + Vercel Blob。环境变量约定只有两个（仓库里只出现变量名，值在部署时设置）：

| 变量 | 谁来设置 | 含义 |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Blob store 关联项目后 Vercel 自动注入（控制台 → Storage → Blob → Connect） | 服务端读写私有 Blob store 的凭据 |
| `MINDNB_ACCESS_KEY` | 自己执行 `vercel env add MINDNB_ACCESS_KEY` | 共享密钥：所有设备要输入的**访问密码**就是它（见 CONTEXT.md 词汇；无账号体系） |

应用内输入的访问密码必须与 `MINDNB_ACCESS_KEY` 一致；轮换该 env 即同时换掉所有设备的密码。

一次性接线与部署：

```bash
npx vercel link                                   # 关联 Vercel 项目
# 控制台 → Storage → Blob → Connect to project（自动注入 BLOB_READ_WRITE_TOKEN）
npx vercel env add MINDNB_ACCESS_KEY production  # 设置访问密码
npx vercel env pull .env.local                    # 本地开发环境变量（*.local 已 gitignore）
npx vercel dev                                    # Vite 页面与 /api functions 同起
npx vercel --prod                                 # 部署
```

纯 `npm run dev` 没有 `/api`——同步引擎 fail-soft 转纯缓存模式（见远端真源 spec）。

## 开发流程

本项目以 Agent 协作为主开发方式：里程碑规格、票据与验收证据仅保存在忽略提交的本地 `.scratch/<里程碑>/`，术语由 [`CONTEXT.md`](../CONTEXT.md) 词汇表统一约束，重要设计决策以 ADR 形式记录在 [`docs/adr/`](adr/)。约定细节见 [`AGENTS.md`](../AGENTS.md) 与 [`docs/agents/`](agents/)。

使用 `npm test` 获取当前单元与集成测试结果，`npm run test:web` 执行网页回归测试，`npm run test:desktop` 验证桌面版。

## 品牌与旧版数据

项目现名 **MindNB**，桌面可编辑文档后缀为 `.mindnb`。旧版文档包仍可导入，导出统一使用新后缀。同一网站下的旧浏览器数据会迁移到新命名空间并保留原副本；桌面版保留旧资料库、文档和设备身份。已有旧后缀的资料库文件继续兼容，新建文件使用 `.mindnb.json`。

部署配置统一使用 `MINDNB_ACCESS_KEY`；过渡期兼容旧配置。详细范围见 `内部品牌迁移记录（不随公开源码包分发）`。
