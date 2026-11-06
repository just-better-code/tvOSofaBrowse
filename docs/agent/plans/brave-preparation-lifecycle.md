# Brave-inspired filter preparation around uBlock Origin

## Objective and constraints

Preserve the existing uBO engines, every supported rule, exception, source order,
trust boundary and website preference while adopting Brave's preparation lifecycle.
Target full cold readiness within 30 seconds on tvOS 27 with source lists already
present; early protection and warm restoration are separate measurements.

Reference: Brave Core `3281ce16a8846681c7b059be5d49debd97a806e2`, especially
LaunchHelper, AdBlockEngineManager, ContentBlockerManager, PageData and ScriptFactory.
Do not copy slim-list substitution, rule truncation, first-party exemptions, long
startup debounce delays or the Rust matcher. Do not change website storage.

## Stages

1. Separate network preparation from extended conversion to allow independent work.
2. Add shared startup preparation and an early navigation barrier. Reuse a complete
   bundled-source native artifact as early protection; install document-start scripts
   before allowing navigation, independently of full native compilation.
3. Introduce lazy source loading, independent native artifacts, compatible last-good
   restoration, conditional downloads and cancellation of obsolete scheduling.
4. Reuse immutable extended WKUserScripts with fresh per-document configuration and
   bounded caches; retain complete all-frame delivery. Host-selected frame payloads
   and class/ID-driven generic selector retrieval require a later lifecycle audit.
5. Compile native artifacts through bounded independent stores, simplify equivalent
   DNS patterns and preserve exceptions when splitting oversized native lists.

## Acceptance and evidence

- Every native artifact is accepted; no supported rules are truncated. Oversized
  groups that cannot retain their following exceptions fail without replacing the
  installed protection.
- Early readiness does not report full readiness or overwrite full bake timing.
- Global/site OFF, source changes, rapid navigation and stale callbacks preserve
  policy, document-start timing and one-shot navigation decisions.
- Warm cache restoration avoids unnecessary source parsing; unchanged native
  artifacts survive updates to another source.
- Preserve iframe playback, history, tabs, cookies, signing and physical-TV consent.
- Record five complete cold measurements, warm restoration, single-source update,
  peak memory and rule-equivalence evidence before claiming the 30-second target.

Implementation is occurring on Linux. Xcode, tvOS compilation and device interaction
are not available locally; source changes do not establish TV performance.

## Recovery checkpoint — 2026-11-07, implementation in progress

Branch: `feature/brave-preparation`, based on `248b9dcec59d49a2ccbda11cf2df51e1a2b7c7c7`.
The initial working tree was clean. No implementation commit, app build, application
test, Simulator delivery, physical-TV access or Git remote push has occurred yet.

- Root: extracted `BrowserNetworkFilterEngine.swift`, registered it in Xcode and
  updated the existing macOS probe's source path without running the probe. Added
  `BrowserNativeRuleConverter.swift` and optional vendor `preserveAllRules` mode.
  Lists that fit are passed through; oversized lists retain each action's following
  exceptions in every required split. Native helper and Xcode entries are on disk.
- Early-readiness agent: `AppDelegate.m` and `BrowserWebView.m` changes are on disk:
  launch prewarm, early navigation/redirect barriers, independent runtime installation
  and bounded immutable WKUserScript reuse. Final integration review remains pending.
- Cache/update agent: owns `BrowserAdBlockService.m/.h`, the extracted network Swift
  class and `Vendor/UBlock/network.js`. Independent native artifacts/four stores,
  lazy inputs, source compiled caches, last-good restoration, ETag and prewarming
  overlap are still being integrated. Do not assume intermediate selectors compile.
- Extended-payload agent: v4 separate configuration, immutable bundle-resource and
  parsed-library caches are on disk. Configuration is consumed and removed before
  scriptlets execute. Full page/frame personalization was deliberately deferred;
  no filtering coverage is removed and no unused range-index scaffolding is added.
- Reviews identified manifest previous-filename consistency, corrupt-reference
  validation, stale native queue draining and v4 config/cache eligibility as explicit
  integration checks. Cache/early agents are addressing these findings.
- Preliminary JavaScript syntax parsing and `git diff --check` succeeded for the
  revisions read at the time; repeat after the last edits. No runtime or performance
  result is established. Application version/changelog still await completed code.

Resume by inspecting this plan, the development-history entry and `git diff`, then
finish the cache/update agent's integration and review all cross-agent selectors.
Keep user-authorized local commits separate from any unrequested build or delivery.
