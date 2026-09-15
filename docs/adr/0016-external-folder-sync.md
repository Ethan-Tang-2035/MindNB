---
status: proposed
---

# iCloud Drive 作为可选外部同步方式

用户已确认资料库可位于 iCloud Drive。建议应用负责本地可靠保存与处理可观测外部变化，系统负责传输；正式支持 macOS iCloud 前实现原生文件协调并通过双设备验收，Windows 单独验证，Linux 不承诺 Apple 官方桌面同步。目录放置不等于已获得 CloudKit 事务或自动内容合并。

用户 Q1/Q9 已确认以最后编辑的最新整文档为准，不要求节点级自动合并或每次手动比较。A 的 10:00 离线编辑在 12:00 才到达，也不应覆盖 B 的 11:00 编辑；后台保留本机及可取得的被替换版本以供恢复。不能将 watcher 到达时间、文件下载或自动回写当成新的内容编辑。

Q4 已确认 macOS 与 Windows 首发，Linux 后续，手机和平板不纳入首版。产品行为已确认；本 ADR 保留 proposed，表示真实 iCloud 双设备与 Windows 同步仍需验收；原生协调、本机时钟偏差排序与模拟外部更新已实现并通过本地自动化测试，不把产品同意写成已证明的同步保证。

用户 Q8 已确认视图按设备分别记忆，桌面模式不沿用 ADR-0005 的视图同步。文件与资源任意顺序到达、下载占位、根目录不可用和原生冲突版本仍必须可解释。文件监听不是同步完成通知，单文件原子替换和本机文件协调也不是跨设备事务。

这能推迟自建账号/云同步服务，但牺牲统一全平台同步与强并发保证。保留本机恢复历史，不依赖同步充当备份；同一资料库不叠加 iCloud 与未来官方 Sync 两套写入机制。

Apple 当前文件访问约束见 [Files and directories](https://developer.apple.com/documentation/technologyoverviews/files-and-directories)；机制、支持边界、外部来源与验收矩阵见 [本地资料库决策](0017-local-vault-storage.md)。
