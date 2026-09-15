# Release guide / 发布指南

## First public release

1. Review the current source, Git history, screenshots and embedded fixture documents. `.gitignore` does not remove tracked files or historical data. Rotate exposed credentials before any history cleanup.
2. Keep the existing repository and URL. Archive private process files outside the checkout, remove tracked private paths, and repair documentation/build references. Before changing visibility, audit and clean every branch/tag and relevant historical path; preserve a private backup of the old history. GitHub pull-request references and cached commits require a separate server-side review—deleting current files or force-pushing alone is not proof of removal. `npm run release:source` remains the matching-source export for releases, not a second development repository.
3. Set the final public repository URL in both READMEs, package metadata and release guidance. Confirm AGPL-3.0-only authorization for original code and redistribution rights for fonts, artwork and fixtures. Retain license notices. Ship corresponding source and build instructions with every binary release.
4. Enable private vulnerability reporting, secret scanning/push protection where available, protected default-branch checks and review of external contributions. Configure the public feedback route. Review Actions permissions and billing before builds.
5. Run the preview workflow. Only publish after installed-app checks for every advertised target. The workflow retains successfully packaged installers even if a later regression fails; those are diagnostic previews, and a failed build job prevents release assembly. Record signing and minimum tested OS versions; the runner version alone is not a minimum supported OS guarantee.

## Build and package

Node.js 24+ and `npm ci` are required. Run `npm run typecheck`, `npm test`, and relevant browser/desktop tests first. Build **on the target architecture** so the Swift helper and Electron architecture agree:

```bash
npm run release:check
npm run build:desktop
# On macOS arm64 (use --x64 on Intel)
npx electron-builder --mac --arm64 --publish never
# On Windows x64
npx electron-builder --win --x64 --publish never
# On Linux x64
npx electron-builder --linux --x64 --publish never
npm run release:source
npm run release:checksums
```

`release/` contains generated output and is not committed. `build:desktop` generates bundled dependency notices. Inspect any missing notice markers; package metadata alone is not a complete license review. Retain Electron runtime notices. For AGPL distribution, supply the matching source archive with instructions, required assets and lockfile—not just a link to the latest branch.

macOS builds need Swift and an accepted SDK license. Use the appropriate installed developer toolchain, e.g. `DEVELOPER_DIR=/Library/Developer/CommandLineTools` where a standalone CLT installation is available. Do not compile the helper for one architecture and package it with another.

The workflow uses native macOS arm64, macOS Intel, Windows x64 and Linux x64 runners. It installs the NSIS package on Windows, copies the app from the DMG on macOS, and extracts the AppImage on Linux runners without FUSE. `scripts/smoke-packaged.mjs` verifies the packaged application can create, save, reopen and export a document using an isolated profile. This does not verify OS trust prompts or Linux FUSE integration; those remain manual acceptance items. See [GitHub runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and [electron-builder platform guidance](https://www.electron.build/docs/features/multi-platform-build/). Linux AppImage builds use Linux; Windows and macOS signing have platform-specific requirements.

## Workflow and versions

`.github/workflows/release.yml` runs only on manual dispatch and `v*` tags. Pull requests run verification without building or uploading complete applications; obsolete verification runs on the same branch are cancelled. Manual dispatch becomes available after the workflow is on the default branch. A manual run uploads Actions artifacts only; it does not publish a Release. A version tag must equal `v` plus `package.json` and lockfile versions. Successful tagged builds assemble files and create a **draft prerelease**, with checksums and matching source. Drafts are reviewed before publishing; repeat runs do not overwrite an existing Release.

Failed-test diagnostics expire after 3 days. Installer/source staging artifacts expire after 1 day; the assembled review bundle expires after 7 days. Download anything needed for longer review before expiry. Published Release assets have their own lifecycle.

For an already successful manual build, `Stage tested preview assets` can transfer its `release-bundle` directly to an existing draft without rebuilding or routing large files through your computer. Supply the build run ID and an existing lightweight version tag that points to the exact tested commit. The workflow runs from `main`, checks the build's origin and result, verifies the bundle's file set and SHA-256 checksums, and compares uploaded sizes and digests. It can replace draft assets only; review the notes and publish separately. Creating a new `v*` tag normally triggers a build, so avoid a second build when preparing a tag for this route. After the published files and local backup are verified, remove redundant Actions artifacts while retaining the successful run record.

The application entry points bundle their JavaScript dependencies. Packaging excludes the extra `node_modules` tree; dependency license notices and required fonts/assets are retained. Validate the installed app and bundled MCP server after dependency/build changes.

Keep preview versions distinct (`0.1.0`, `0.1.1`, etc.; use a new version for new bytes). Do not silently replace a released file. When bumping versions, update package + lockfile, changelog, README status and release notes. Keep previous releases available and document data migration and rollback limits. There is no auto-updater configured.

## Signing

The supplied workflow deliberately identifies artifacts as **unsigned previews**. For a trusted general-user launch, configure Apple Developer signing + notarization and Windows signing using CI secrets, then verify installed builds. Never commit certificates, passwords, API keys or provisioning files. Do not claim a build is signed based solely on successful compilation. Signing setup depends on the maintainer's publisher identity and credentials.

## Acceptance checklist

For each attached installer: install, launch, select a fresh vault, create/edit/save, quit/reopen, import/export `.mindnb` with images, export PDF/PNG, and open a file by association. Test filenames containing Chinese characters and spaces. Check macOS native helper architecture and file operations. Verify a backup/upgrade path without relying on production data. Checksum the final packaged bytes. If a target fails, do not label it supported.

## 中文摘要

保留现有仓库与 URL，把内部过程资料归档到仓库外，清理已跟踪文件及所有分支、标签的相关历史，再审核 GitHub PR 引用和缓存。已有跟踪文件不受 `.gitignore` 保护；强推也不代表服务端旧记录全部消失。只维护这一份开发仓库，白名单源码包用于提供每个 AGPL 安装包的对应源码，并保留构建说明及第三方许可。

日常 PR 只运行验证，失败诊断保留 3 天；同分支新提交取消过时验证。完整打包仅手动或通过版本 tag 触发，中间安装包/源码附件保留 1 天，汇总审核包保留 7 天。手动 workflow 只产出 Actions 附件，版本 tag 才创建草稿预发布；通过实机安装验收后再公开。当前流程是未签名预览构建，正式面向普通用户推广前需处理 Apple 签名/公证、Windows 签名及可信下载说明。发布新版本时同步更新版本号、README、变更日志和已知问题，不覆盖旧版本文件。

已有成功的手动构建时，可从 `main` 运行 `Stage tested preview assets`，输入构建编号及对应的版本标签，将汇总包直接转入已有草稿。该流程校验受测提交、文件集合、SHA-256 和上传结果；无需在本机中转整套安装包。它只修改草稿，公开发布仍需核对版本说明。准备版本标签时注意避免触发重复构建。正式附件及本地备份验证完成后，可清理 Actions 临时附件，保留成功运行记录。

Reference: [GitHub guidance on sensitive history](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
