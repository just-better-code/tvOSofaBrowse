# Agent instructions

## Project TL;DR

**tvOSofaBrowse** is a local web browser for personal use on Apple TV, designed to make browsing and watching web video convenient with a TV remote. The source repository is public and the app is distributed for personal use outside the App Store. Do not assume a paid Apple Developer membership or introduce App Store publication requirements into implementation decisions.

## Working agreements

- Use the Apple TV Simulator by default. Discovering, inspecting, installing, launching, or interacting with a physical Apple TV requires the user’s permission for that work. A request to deploy to a physical Apple TV grants permission for that device work; local shorthand for this request is documented in `AGENTS.local.md`. An instruction to push immediately remains authorization to build, install and launch subsequent app changes until the user explicitly revokes it; do not restrict it to one task or feature. Consult `AGENTS.local.md` for the current authorization and target.
- Commit completed implementation stages separately, after their requested build/delivery, so each stage can be reviewed and reverted independently.
- Git commits are authorized. Push the Git repository only when the user explicitly asks to push to GitHub or the remote repository.
- Preserve automatic signing and the effective local development-team and bundle-identifier settings. Personal values belong in the ignored `Signing.local.xcconfig`; shared configuration uses neutral defaults.
- Add or run tests only when the user asks for testing or verification. Run builds when requested. Report exactly what was checked; compilation or launch alone does not prove an interaction bug is fixed.
- When a task includes a build, finish the code and build before updating the changelog, user guide, or development history.
- Define completion in terms of the user's observable outcome. Ask for user participation when the required observation cannot be made locally; do not claim device verification without evidence.
- Record durable user instructions and confirmed, reusable project workflows here or in linked agent runbooks. Keep temporary task status, personal diagnostics, and implementation chronology in their appropriate documents.

## Tools and task-specific references

- Prefer `rg` and `rg --files` for targeted text and file discovery.
- Xcode project: `_Project/Browser.xcodeproj`; scheme: `Browser`. Use `xcodebuild` for requested builds and `xcrun devicectl` for device work only with the user’s permission.
- For simulator builds and screenshots, use the local [Apple TV Simulator runbook](docs/agent/SIMULATOR_RUNBOOK.md). Keep simulator setup out of the public README.
- For requested device builds, installation, and launch, use the [Apple TV deployment skill](.codex/skills/apple-tv-deploy/SKILL.md). For history-container backups, read [Apple TV runbook](docs/agent/APPLE_TV_RUNBOOK.md).
- If a paired Apple TV appears in destination discovery but a sandboxed build cannot see it, follow the Xcode service recovery note in that runbook before changing signing or device settings.
- Torrent playback uses pinned [TVVLCKit](https://github.com/videolan/vlckit) 3.7.3 through a loopback HTTP range server backed by verified libtorrent pieces; completed files open locally. `scripts/bootstrap-vlc-deps.sh` installs the ignored binary. Diagnose playback with safe numeric `[TorrentHTTP]`, `[TorrentVLC]`, and `[TorrentState]` events; the [Apple TV runbook](docs/agent/APPLE_TV_RUNBOOK.md) explains fast-resume versus repeated downloading. Keep device observations in the [torrent plan](docs/agent/plans/torrent-client.md).
- For streaming stalls, inspect [torrent architecture](docs/agent/TORRENTS.md): prioritize the file head, tail, and requested HTTP range pieces with libtorrent deadlines; sequential download may delay the pieces VLC needs. Do not add a separate media-duration parser without a confirmed format-specific failure.
- Torrent resume positions are app preferences keyed by torrent hash and file index; clear them when Reset, Remove, or Purge removes payloads. The player's held seek buttons must take priority over its general Center-hold context menu.
- Use the [tvOS background downloads research](docs/agent/TVOS_BACKGROUND_DOWNLOADS.md) before adding Background App Refresh or processing tasks; a system setting alone does not grant continuous libtorrent runtime.
- Keep torrent and VLC diagnostic scaffolding in Debug builds after feature finalization until a separate removal request.
- For complex features, substantial refactors, or work spanning sessions, use [planning guidance](docs/agent/PLANS.md). Small fixes and documentation edits do not need a plan file.
- For torrent file selection and cache removal, read [torrent architecture](docs/agent/TORRENTS.md): libtorrent 1.2 supports per-file priority but has no supported per-file delete operation; never unlink an active payload as a substitute.
- Follow the [tvOS interface style guide](docs/agent/TVOS_STYLE_GUIDE.md) for every app-owned screen, dialog, and playback control. Preserve the approved translucent browser menu layout and style. Do not invent a separate theme for a new feature. Prefer native UIKit controls and tvOS focus behavior over HTML for app UI. Keep actual website content in the web view. Local visual references are in `AGENTS.local.md`.
- Use the browser menu's green ON and gray OFF badge for boolean controls throughout app-owned UI; align filter badges at the right edge with version text before them, and avoid an extra container around the Ad Block heading badge.
- For uBlock Origin adaptation, target maximum practical full-uBO functionality, not a Lite feature ceiling. Use mobile WKWebView/WebKit capabilities as the planning baseline; record concrete tvOS adapter differences rather than assuming limitations. Distinguish shared engine capabilities from Safari WebExtension host APIs. See [the reference review](docs/agent/UBLOCK_REFERENCE_REVIEW.md) and [roadmap](docs/agent/ROADMAP.md).
- On app-owned pages, Center activates or confirms the focused item; holding Center opens its context actions; Play/Pause performs that screen's contextual shortcut. In All History, Play/Pause marks a row. In Torrents, Center and Play/Pause both play a focused playable file. Do not impose this mapping on website content or change the existing browser menu controls.
- Read `docs/USER_GUIDE.md` for existing user-facing controls, `docs/agent/ROADMAP.md` for planned and rejected directions, and `docs/agent/DEVELOPMENT_HISTORY.md` when past decisions or verification matter. Read only what the task needs.
- Repository skills live under `.codex/skills/`. Load a skill's `SKILL.md` when its workflow applies; keep reusable workflow details and supporting scripts with the skill.
- `.codex/hooks.json` configures a `PreToolUse` hook for `Bash` running `graphify hook-check`; a hook notice does not require a graph query or rebuild, or establish that the graph is current.

## Knowledge graph

The knowledge graph under `graphify-out/` is optional. Prefer `rg` and targeted source reads for routine questions and edits.

- Use graphify only when it helps with a complex architecture or cross-file relationship question, or when the user explicitly requests it. No graph-first query is required.
- Do not automatically update or rebuild the graph after code changes. Update it when explicitly requested or when fresh graph data is needed for a chosen architecture investigation.
- Keep queries focused and output bounded; confirm graph findings in the source because the graph can be stale or partially extracted.
- Local references remain useful through direct reading without graph indexing. Retain them independently of graph maintenance.
- Actual token savings have not been measured. A benchmark against reading the entire corpus does not establish savings over targeted searches; avoid indexing the full reference corpus merely to claim token efficiency.
- This user-selected policy takes precedence over the repository graphify skill's default graph-first and automatic-update workflow.

## Data protection and public documentation

- Preserve browsing history and tab state across ordinary launches. Do not introduce automatic age-based history deletion; history is cleared only through an explicit user action.
- Before changing database paths, fallback order, or retention, follow the device backup safeguards in the runbook. Without permission for physical TV work, do not bypass this requirement with assumptions about the live container; leave dependent migration work pending and explain the missing prerequisite.
- Website state should persist through the website's storage mechanisms; do not turn individual dropdown selections or episode choices into app-specific backup features.
- Keep credentials, cookies, authorization headers, signed URL query values, copied databases, and personal diagnostic logs out of tracked files. Redact sensitive runtime values before publishing diagnostic evidence.
- Use placeholders for machine paths and device identifiers in shared instructions. Keep personal setup details and scratch notes in ignored local files.
- Retain legitimate upstream copyright and attribution. File removal does not erase information already present in Git history; any history rewrite requires a separate user request.

## Agent file layout

- Root `AGENTS.md`: project context, durable rules, tool entry points, and links to task-specific procedures. Keep instructions concise and remove obsolete or conflicting rules.
- Nested `AGENTS.md`: instructions specific to that directory, only when needed. `AGENTS.override.md` replaces the instruction file at its directory level; use it only for an intentional override.
- `AGENTS.local.md`: ignored local notes, explicitly read when local context is relevant. This name is not automatically discovered by Codex by default, and a fallback filename does not make it merge alongside an existing root `AGENTS.md`.
- `docs/agent/`: ignored local runbooks, plans, and development history, loaded for the relevant task. They are not public repository links. The public user guide lives at `docs/USER_GUIDE.md`; the single project changelog is the tracked root `CHANGELOG.md`. Do not maintain a separate local changelog.
- `SKILL.md`: a focused reusable workflow with a short, specific trigger description; put optional references and scripts beside it.
- `.codex/hooks.json`: executable hook configuration; keep explanatory project policy here. Do not add duplicate agent files or hooks without a concrete need.

## Documentation and versioning

- Write and maintain project documentation in English. Use the fork name **tvOSofaBrowse**.
- Follow [Common Changelog](https://common-changelog.org/) in `CHANGELOG.md`: `# Changelog`, newest versions first, `## VERSION - YYYY-MM-DD`, and only `Changed`, `Added`, `Removed`, `Fixed` groups in that order, omitting empty groups.
- Write each change as one unnumbered, single-line item starting with an imperative verb, explaining its user impact and ending with relevant Markdown references in parentheses. Order changes by importance, with breaking changes first and prefixed `**Breaking:**`. Merge related changes; omit reverted experiments with no effect on the resulting version.
- Keep release bodies limited to change groups and, when needed, one single-sentence notice before them. Put long explanations in local linked documents; do not add roadmap, process, timeline or source-table sections to `CHANGELOG.md`.
- Keep detailed dialogue history, implementation reasoning, verification evidence and reversals in `docs/agent/DEVELOPMENT_HISTORY.md`; keep planned and rejected directions in `docs/agent/ROADMAP.md`; keep usage instructions in `docs/USER_GUIDE.md`. Link public documents from the changelog when useful.
- Keep process and versioning rules in `AGENTS.md`, rather than mixing them into the changelog or user documentation.
- Use `major.minor.patch`: increment minor only for a substantial, distinct user-visible capability; small additions, refinements and fixes increment patch in the current minor line. The user explicitly classifies unified media controls and shared VLC web playback as minor features, but scoped clearing and Debug Inspector gating as patches. Bundle changes that jointly deliver one feature into one minor version, with patch reset to zero. For example, a feature at `2.16.0` is followed by its first fix or small extension at `2.16.1`.
- Automatically update `CHANGELOG.md` and both Debug and Release `MARKETING_VERSION` settings whenever a user-visible feature or logical bug fix is completed, without waiting for a separate request. Record only the behavior delivered by the resulting version, and update the user guide or development history when needed.
- Documentation or formatting changes alone do not increment the application version. Keep Debug and Release `MARKETING_VERSION` consistent. Treat `CURRENT_PROJECT_VERSION` as a separate technical build number, not the user-facing fix number.
- Preserve the initial retrospective baseline: upstream `e245b8f` is `2.0.0`; the initial snapshot is `2.15.22`, cataloguing 15 feature groups and 22 fix groups. These are reconstructed logical versions, not proof of separately published binaries. Historical fix IDs do not imply every fix occurred after feature 2.15.
- Distinguish commit/package dates from implementation dates in dialogue history. Do not invent release dates, Git tags, published releases or verification results. This personal-use project's retrospective changelog has no matching release tags; explain that status in its release notice.

## Instruction maintenance references

- [OpenAI: AGENTS.md discovery and scope](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [OpenAI: concise instructions and task-specific references](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)
- [OpenAI: skill structure and progressive disclosure](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI: execution plans](https://developers.openai.com/cookbook/articles/codex_exec_plans) — an archived example, adapted to this project's working agreements rather than copied verbatim.
