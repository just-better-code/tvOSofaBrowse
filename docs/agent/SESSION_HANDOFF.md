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

## Release work is complete

[CI 41901991988](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/41901991988) passed: version validation, Simulator Debug, Apple TV Release and asset upload all succeeded. The release contains `tvOSofaBrowse-2.20.4-unsigned.ipa` (19,189,997 bytes), license notices and `SHA256SUMS`. The published files were downloaded; both checksums and the arm64 AppleTVOS IPA checks passed. GitHub Latest remains `v2.21.1`. No physical-TV installation, playback or automatic renewal was observed.

There is no unfinished release operation. Do not create duplicate releases, move existing tags or rerun a completed build merely to resume this session. Ask the user for the next task. For reference, the verifier on `release/2.20.4` handles that older app; the master verifier additionally requires uBlock files that 2.20.4 does not contain.

## Local setup that Git does not transfer

- Install/authenticate GitHub CLI if managing releases. Publishing these workflows may require the `workflow` scope; use `gh auth login -s workflow` or refresh an existing account's scope interactively.
- For code and GitHub builds, a Linux computer is sufficient. The build itself runs on GitHub-hosted macOS. Manual workflow dispatch builds branch artifacts; manual release publication also uploads release assets. Push, tags alone and PRs do not build.
- For local Xcode/device work on a Mac, transfer private `scripts/Deployment.local.env` and `_Project/Browser/Config/Signing.local.xcconfig` separately and securely only if needed. The former contains the configured device UUID and expected bundle identity. Never commit them. Preserve their effective settings and obtain authorization before physical-TV access.
- Download media dependencies with the two bootstrap scripts when needed. The source index replaces local `.references/` checkouts; `.data/`, generated graphs, copied containers and raw diagnostics are intentionally not transferred through Git.
- For the home-Linux signing host, follow [DEPLOYMENT.md](../DEPLOYMENT.md). atvloadly's private persistent data is separate from the source repository.

## Starter prompt

> Read AGENTS.md and docs/agent/SESSION_HANDOFF.md. We are continuing this project on another computer. Both release tasks are complete; use the repository notes for earlier decisions and ask me for the next task. Do not recreate releases, move existing tags or access a physical Apple TV without a new request.
