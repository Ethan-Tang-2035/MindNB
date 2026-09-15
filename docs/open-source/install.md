# Installation and verification / 安装与校验

Download the files attached to [MindNB 0.1.0 Preview](https://github.com/Ethan-Tang-2035/MindNB/releases/tag/v0.1.0). Packages are available for macOS arm64/x64, Windows x64 and Linux x64. Read the release notes for the automated installation checks and their limits. These are unsigned preview packages; macOS packages are not Apple-notarized.

| Package | Installation |
| --- | --- |
| macOS `.dmg` | Open the disk image and drag MindNB into Applications. Choose arm64 for Apple Silicon, x64 for Intel. |
| macOS `.zip` | Extract, then move MindNB.app into Applications. |
| Windows `.exe` | Run the installer and choose the installation location. |
| Windows `.zip` | Extract the entire directory and run MindNB.exe. This is an unpacked app; settings still use the normal user-data directory. |
| Linux `.AppImage` | Make the file executable (`chmod +x <file>.AppImage`), then launch. AppImage/FUSE support varies by distribution. |

Read each release's minimum OS and signing notes. An unsigned/unnotarized macOS app or unsigned Windows app may trigger system warnings. Verify the source and checksum; do not globally disable Gatekeeper, SmartScreen or the Electron sandbox. If launch fails, report the exact message and system version.

## Verify a download

Download `SHA256SUMS.txt` from the same release. Compare the checksum of the exact filename:

```bash
# macOS
shasum -a 256 MindNB-0.1.0-mac-arm64.dmg
# Linux
sha256sum MindNB-0.1.0-linux-x86_64.AppImage
```

```powershell
# Windows PowerShell
Get-FileHash .\MindNB-0.1.0-win-x64.exe -Algorithm SHA256
```

Checksums detect mismatches with the published files; they do not replace publisher signing or independent trust in the release account.

## Upgrade and removal

Back up the complete vault before installing a new preview. Replace the app using the new installer; no automatic updater is currently configured. Keep the previous version and test a copy of your vault before rolling back, because older versions may not understand newer document schemas. Removing the app does not constitute deleting or backing up your vault.

## 中文提示

在 [MindNB 0.1.0 预览版](https://github.com/Ethan-Tang-2035/MindNB/releases/tag/v0.1.0) 的 Assets 选择系统和架构匹配的文件。下载页的“Source code”是开发者源码，不是安装包。macOS 用 DMG 拖入“应用程序”，Windows 用 EXE 安装，Linux 用 AppImage。ZIP 版不等于“所有设置都存放在程序目录”。

下载后用上面的命令计算 SHA-256，与同一版本的 `SHA256SUMS.txt` 比对。未签名或未公证的预览版可能触发系统提示，请先确认来源，不要关闭系统整体保护或 Electron 沙箱。升级前备份完整资料库；目前需要手动下载更新。最低系统版本与签名状态以每次发布的实际验收为准。
