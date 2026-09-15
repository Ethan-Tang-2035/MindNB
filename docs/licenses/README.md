# Dependency license supplements

`dependencies/manifest.json` records complete license files found at the exact Git revision (or matching version tag) associated with a locked npm release. Each record includes its original URL and SHA-256.

`spdx/` contains canonical license terms from the pinned SPDX License List release recorded in its manifest. These terms supplement packages that explicitly declare the matching SPDX identifier in `package.json` but omit the full text. The generated notices retain upstream author/contributor metadata and README declarations; SPDX template placeholders are not invented copyright attributions.

The generator prefers license/notice files included in the installed package, then a complete upstream README grant, then exact-version source files, then explicitly declared SPDX terms. Missing or ambiguous declarations fail the build. It verifies supplement hashes before use.

The former `buffers` dependency had no license declaration and its published repository was unavailable. MindNB removes that legacy dependency chain by using the maintained unzipper dependency under ExcelJS; it does not assign a license to the old package.

Asset/font licenses remain in THIRD_PARTY_NOTICES.md and the corresponding asset directories. Electron runtime notices remain in the application distribution. Regenerate dependency notices with `npm run licenses:generate` after installing the lockfile.
