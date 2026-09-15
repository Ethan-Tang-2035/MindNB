# Security and privacy / 安全与隐私

## Scope

MindNB is in preview. Security fixes target the latest release; older preview versions have no maintenance guarantee. No response-time SLA is promised.

Desktop documents and images are stored in the selected vault. Recovery state and device settings also live in the app's local data directory. MindNB does not encrypt these files. Back up the vault before upgrading and restrict access using OS permissions.

The optional browser backend stores data with the configured Vercel Blob service and uses one shared access key. Treat it as a private, single-user deployment. A shared key is not user isolation, and the current backend is not ready to host unrelated public users. Deployment costs belong to the operator.

MCP is optional local automation. A connected client can read and change the document through the bridge; an AI client may transmit document content to its own model provider. Grant access only to clients you trust. Do not expose the local bridge as a public service.

## Report a vulnerability

Use **Security → Advisories → Report a vulnerability** on the GitHub repository when private vulnerability reporting is enabled. If unavailable, open an issue asking for a private contact route **without exploit details or private data**. The maintainer must enable private reporting before public launch. Never post credentials or a full vault in a public issue.

Provide the affected version, OS, minimal reproduction and impact privately. If a credential was exposed, revoke or rotate it first; deleting a current file does not remove its history.

## 中文说明

安全修复优先覆盖最新预览版，暂不承诺旧版维护或响应时限。桌面资料库、本机恢复数据与设置未自动加密，应使用系统权限保护并定期备份。可选网页版远端服务使用共享密钥，只适合私有单用户部署。连接 MCP 客户端意味着授权其读写文档，客户端可能把内容发给外部 AI 服务。

漏洞请优先通过 GitHub 私密漏洞报告提交。若入口未启用，只公开请求私下联系方式，不公开漏洞细节、密钥或私人文件。泄露凭据应先吊销或轮换；删文件不能消除 Git 历史。
