# Contributing / 参与贡献

MindNB welcomes focused bug fixes, documentation improvements and reproducible feedback. The current interface is primarily Chinese; translation contributions are welcome.

## Report a problem

Use the repository's issue tracker if enabled. Include app version, OS and architecture, steps, expected/actual behavior, and a minimal sample stripped of private content. Report vulnerabilities through the private route in [SECURITY.md]. Do not attach your full vault, access keys or private AI conversations.

## Change the project

1. Read `CONTEXT.md` for product terminology and `docs/adr/` for relevant decisions.
2. Install Node.js 24+ and run `npm ci`.
3. Keep one focused change per pull request. Include the problem, result and validation.
4. Run `npm run typecheck` and `npm test`; use `npm run test:web` for browser changes and `npm run test:desktop` for desktop behavior. A local vault or production credentials must never be required for tests.
5. Keep `README.md` and `README.zh-CN.md` aligned. Record user-visible changes in `CHANGELOG.md`.

Internal implementation tickets remain local Markdown under `.scratch/<feature>/` as documented in [agent conventions](docs/agents/issue-tracker.md). They are not automatically exported in the public-source package. Public bug reports and contributions can be triaged into that workflow.

By submitting contributions, you confirm you have the right to contribute them under AGPL-3.0-only. Preserve third-party notices. Do not include copied commercial app assets, private documents, generated build output or credentials. No CLA is currently required. Be respectful and describe disagreements in terms of the behavior or change being discussed.

## 中文说明

欢迎提交可复现的问题、聚焦的修复和文档改进。反馈中请提供应用版本、系统和架构、复现步骤及预期结果；示例应去除私人内容。代码修改先运行类型检查和单元测试，涉及桌面或网页交互时补对应验证。提交贡献意味着你有权以 AGPL-3.0-only 提供这些内容；请保留第三方许可。内部任务仍使用本地 Markdown 工单，维护者可将公开反馈转入该流程。
