# Continue on another computer

Snapshot: 2026-11-04. This handoff records task context, not a new authorization to use a physical Apple TV. Check live GitHub state before repeating a release operation.

## Open the project

```sh
git clone https://github.com/just-better-code/tvOSofaBrowse.git
cd tvOSofaBrowse
```

If the repository is already present, inspect `git status` and update the intended branch without discarding local changes. Open this repository folder in Codex. Read root `AGENTS.md`, this handoff and only the other notes relevant to the task. Durable rules were merged into root `AGENTS.md`; no separate machine-local instruction file is required.

## Published state

- `master` includes PR #16: release-only CI, sanitized research/development notes, a source index and reusable delivery scripts.
- Version 2.21.1: Git tag `v2.21.1`, release title `tvOSofaBrowse 2.21.1`, app build 3022. [CI 41897244825](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/41897244825) passed and the release contains the unsigned IPA, license notices and SHA-256 manifest. This remains Latest.
- Historical base 2.20.4: original tag `2.20.4` points to `c4502da` and is unchanged.
- New release `v2.20.4` / title `tvOSofaBrowse 2.20.4` points to `082cf197adf615a04883c40e09e3fc7a5b22bbf6` on `release/2.20.4`. It preserves `_Project` byte-for-byte from `c4502da`; only five CI/packaging/license files were added. It is deliberately not Latest.

## Current work: finish the 2.20.4 release

The release is already published. Do not create a duplicate release or move either existing tag. At the time this handoff was written, [CI 41901991988](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/41901991988) was compiling Simulator Debug and Apple TV Release. Check its actual state:

```sh
gh run view 41901991988
gh run watch 41901991988 --exit-status
gh release view v2.20.4
gh release download v2.20.4 --dir build/release-2.20.4
```

After both builds and asset upload succeed, validate the downloaded manifest and IPA with the verifier from `release/2.20.4` (the master verifier additionally requires uBlock files that this older app does not contain). Confirm Latest remains `v2.21.1`, then record the result in development history and update the changelog's retrospective notice to account for the additional published older version. No physical-TV installation, playback or automatic renewal has been verified in this release work.

## Local setup that Git does not transfer

- Install/authenticate GitHub CLI if managing releases. Publishing these workflows may require the `workflow` scope; use `gh auth login -s workflow` or refresh an existing account's scope interactively.
- For code and GitHub builds, a Linux computer is sufficient. The build itself runs on GitHub-hosted macOS and is triggered only by manual release publication; push, tags alone and PRs do not build.
- For local Xcode/device work on a Mac, transfer private `scripts/Deployment.local.env` and `_Project/Browser/Config/Signing.local.xcconfig` separately and securely only if needed. The former contains the configured device UUID and expected bundle identity. Never commit them. Preserve their effective settings and obtain authorization before physical-TV access.
- Download media dependencies with the two bootstrap scripts when needed. The source index replaces local `.references/` checkouts; `.data/`, generated graphs, copied containers and raw diagnostics are intentionally not transferred through Git.
- For the home-Linux signing host, follow [DEPLOYMENT.md](../DEPLOYMENT.md). atvloadly's private persistent data is separate from the source repository.

## Starter prompt

> Read AGENTS.md and docs/agent/SESSION_HANDOFF.md. Continue the existing 2.20.4 release task: check CI 41901991988, verify its published IPA and checksums, and preserve 2.21.1 as Latest. Do not recreate releases or move existing tags. Use the repository notes for earlier decisions. Git pushes for this task are authorized; physical Apple TV work is not authorized.
