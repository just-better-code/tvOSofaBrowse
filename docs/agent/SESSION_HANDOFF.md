# Continue on another computer

Snapshot: 2026-11-07. This handoff records task context, not a new authorization to use a physical Apple TV. Check live GitHub state before repeating a release operation.

## Open the project

```sh
git clone https://github.com/just-better-code/tvOSofaBrowse.git
cd tvOSofaBrowse
```

If the repository is already present, inspect `git status` and update the intended branch without discarding local changes. Open this repository folder in Codex. Read root `AGENTS.md`, this handoff and only the other notes relevant to the task. Durable rules were merged into root `AGENTS.md`; no separate machine-local instruction file is required.

## Published state

- Latest is [tvOSofaBrowse 2.21.3](https://github.com/just-better-code/tvOSofaBrowse/releases/tag/v2.21.3), build 3024. Immutable tag `v2.21.3` points to `acef30c26eee3f08f2eb99848aa79c974135038f`. The preceding PR #17 merge is `4474b4e`.
- [Release CI 42319189344](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/42319189344) passed Simulator Debug, Device Release and release upload. The unsigned IPA (20,574,073 bytes), notices and SHA256SUMS are attached; CI package verification passed.
- The user reports TV full Preparation time 27.0 s, conversion 11.4 s, WebKit 25.7 s, network 21.3 s and page rules/scripts 19.8 s. Page opening under ten seconds is separate. This is one reported run; controlled repeatability, peak memory and broad rule equivalence remain unmeasured.
- The user confirms the native menu buttons look good. The 2.21.2 gray preparation backdrop obscured the page, so 2.21.3 removes it completely while preserving the buttons and filter acceleration.
- Earlier releases v2.21.1/build 3022 and v2.20.4 remain published. Preserve historical tag `2.20.4` and the separate release/2.20.4 branch; do not rewrite them.

## Release work is complete

Do not recreate 2.21.3, move its tag or rerun successful builds merely to resume. The user requested notification only for 2.21.3; no new Downloads copy was made. No agent physical-TV discovery, install or launch ran;
the user installs and configures atvloadly updates independently. Automatic updating
and renewal are not established by CI or a successful manual installation.

Read [the detailed preparation plan](plans/brave-preparation-lifecycle.md) for cache,
rule-preservation and navigation contracts. Per-frame payload specialization and
host-side on-demand generic retrieval remain open; local class/ID surveying is done.
Future app fixes advance from published 2.21.3 to the next patch version. Documentation
changes alone do not bump the app. Ask the user which remaining task to take next.

## Local setup that Git does not transfer

- Install/authenticate GitHub CLI if managing releases. Publishing these workflows may require the `workflow` scope; use `gh auth login -s workflow` or refresh an existing account's scope interactively.
- For code and GitHub builds, a Linux computer is sufficient. The build itself runs on GitHub-hosted macOS. Manual workflow dispatch builds branch artifacts; manual release publication also uploads release assets. Push, tags alone and PRs do not build.
- For local Xcode/device work on a Mac, transfer private `scripts/Deployment.local.env` and `_Project/Browser/Config/Signing.local.xcconfig` separately and securely only if needed. The former contains the configured device UUID and expected bundle identity. Never commit them. Preserve their effective settings and obtain authorization before physical-TV access.
- Download media dependencies with the two bootstrap scripts when needed. The source index replaces local `.references/` checkouts; `.data/`, generated graphs, copied containers and raw diagnostics are intentionally not transferred through Git.
- For the home-Linux signing host, follow [DEPLOYMENT.md](../DEPLOYMENT.md). atvloadly's private persistent data is separate from the source repository.

## Starter prompt

> Read AGENTS.md and docs/agent/SESSION_HANDOFF.md. We are continuing this project on another computer. Release 2.21.3 is complete; use the repository notes for earlier decisions and ask me for the next task. Do not recreate releases, move existing tags or access a physical Apple TV without a new request.
