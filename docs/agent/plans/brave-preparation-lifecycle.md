# Brave-inspired filter preparation around uBlock Origin

## Latest status — 2026-11-07

Source integration is committed as `8d7681c` on `feature/brave-preparation`, app
version 2.21.2/build 3022. Three subagents completed implementation and static peer
review; root resolved the remaining runtime-loading path issue, regenerated shipped
assets and checked project references. The historical checkpoints below describe
earlier intermediate states; use this section and the final evidence entry first.

Implemented: early navigation protection, coherent compatible last-good restoration,
independent native/source caches, four bounded native stores, conversion/compilation
overlap, conditional/coalesced updates, cancellation, lossless native splitting,
integrity-checked network records and reusable complete v4 scripts. No filtering
engine replacement, slim full-list substitution or website-state migration occurred.

Passed: final JavaScript syntax parsing for five maintained/generated adapters,
Python probe AST parsing without execution, exact adapter inclusion in the generated
network bundle, Xcode source-reference checks, matching Debug/Release marketing
versions and whitespace checks. These are static checks, not Apple compilation or
rule-equivalence/runtime tests. No app build, Simulator/TV action or remote push ran.

Remaining platform work: on an authorized macOS environment, compile the application
and perform requested rule/lifecycle verification; on an explicitly authorized tvOS
27 target, measure full cold readiness and memory. The <=30 s outcome is unverified.
The follow-up source stage adds local generic class/ID surveying, indexed exceptions
and one network-bundle read per preparation/restoration. Full per-frame payload
specialization and host-side on-demand retrieval remain deferred.

### Follow-up checkpoint — generic cosmetics and remaining cold-path work

The first follow-up is committed as `88d2933`. Its final assembled ISOLATED runtime
also passed syntax parsing without execution. Version remains 2.21.2.

The user authorized local commits and asked fast workers to take the next plan
steps, then supplied a further ten-minute window. The follow-up changes are:

- `UBlockCosmetics.js`: after the original applicability/exception/dedup checks,
  defer only exact ordinary ASCII `.class`/`#id` rules without positive domain
  scopes. Keep domain-specific, escaped, compound and procedural paths unchanged;
  quirks-mode documents move every deferred candidate back to eager installation.
  Survey the initial tree, added subtrees and changed class/ID elements. Keep an
  active TreeWalker across cooperative 8 ms batches, coalesce queued mutation roots
  without restarting that walk, and install each rule once. Full root replacement
  replays retained CSS through the bounded queue because reattaching a style can
  recreate its sheet. BFcache return queues a fresh full scan to cover mutations
  discarded by observer disconnection. No node-count or fruitless-survey cutoff
  permanently disables rules.
- `UBlockRuntime.js`: build `Map(kind) -> Set(key)` from applicable exceptions once;
  exact keys and wildcard `*` preserve the previous boolean exception behavior.
- `BrowserNetworkFilterEngine.swift`: load immutable engine source, PSL and the
  unchanged fingerprint once per prepare/restore operation, then pass that value
  into `createContext`. Do not retain another process-global copy of large assets.

Reference inspection: Brave's `ios/browser/brave_shields/cosmetic_filtering/resources/
cosmetic_filtering.ts` class/ID queues and uBO `contentscript.js` DOM surveyor plus
`cosmetic-filtering.js` generic-selector/Set-based exception retrieval. The tvOS
adapter keeps the full universal payload and filters locally; it does not add
Brave's synchronous messaging, first-party policy or native Rust matcher.

Peer review caught and resolved shared/duplicate survey timers, BFcache resurvey,
quirks case matching, mutation-flood starvation and CSSOM replay after root replacement.
Syntax parsing of the changed adapters and whitespace checks passed. Apple
compilation, browser behavior and rule-equivalence measurements remain unperformed.

Next independent implementation candidates, after platform compilation/measurement:

1. Source text currently opens/decodes independently for native, extended and core
   cold paths. Do not simply retain every full list forever: design a bounded,
   generation-bound per-source handoff, release it when all subscribed backends
   finish, and reject a file/configuration change before publication. Keep lazy
   cache-hit paths that never read source text. Measure peak memory before enabling.
2. Nondefault native allow/block variants parse and serialize every base chunk to
   append policy. Cache policy variants by the complete base chunk and policy, or
   safely append serialized array contents without changing order. Keep integrity
   validation, empty-array handling, native limits and following-exception behavior.
3. For host/frame-specific delivery, first specify a document-start transport with
   authoritative frame URL/origin, top/ancestor context and navigation generation.
   Keep universal fallback for initial/dynamic/nested/about:blank/srcdoc/blob realms;
   never send an asynchronous reply into a new document. Compare ordered selected
   records, negative scopes and dependency closure before reducing injected bytes.

Exact follow-up verification when requested: inspect ordinary and quirks documents,
generic/domain-specific exceptions and wildcard exceptions, late class/ID mutation,
large continuously mutating trees, root replacement and BFcache return. Compare
the eventually installed selector set with the original eager path. Compile the
Swift resource refactor on macOS and confirm existing network cache fingerprints
remain valid. These changes alone do not establish the <=30 s goal.

## Objective and constraints

Final follow-up: `compile.js` now checks a per-compilation
`browserExtendedPreparationCancelled` hook at source boundaries and every 256 input
lines, including lists that emit no extended records. The scoped Swift context owns
the bridged block; both closure parameters are escaping and a JS exception rejects
partial results. `BrowserAdBlockService.m` publishes its main-owned generation into
an atomic cancellation tag at all three increment sites; worker polling no longer
dispatches synchronously to main. The standard asset builder regenerated the parser;
syntax parsing and exact maintained-adapter inclusion passed without execution.

Branch provenance checked at the user's request: remote PR `ublock #15` head
`451ca21` has zero code diff under `_Project/Browser` and `_Project/Vendor` against
our base `248b9dc`. Its squash `fb46ce4` is already in base history. The historical
2026-10-17 removal note does not describe the actual code present in this checkout;
do not infer removal from that note. No feature merge or remote push was performed.

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

### Integration checkpoint

The initial checkpoint is committed as `e312bb1`. Source changes remain in the
working tree. Extended v4 and early-navigation ownership work is complete; peer
review continues while cache/update integration finishes. The standard asset builder
has regenerated `UBlockNetwork.js` once through the available Node runtime; regenerate
again after the pending network-adapter review fixes. The existing macOS probe now
imports CryptoKit and uses v4 cache paths, but it has not been run.

Required fixes reported to the cache/update owner include source-cache integrity and
balanced serialized block markers, skipping empty lines in the legacy collecting
adapter, newest-wins handling when a request returns to the currently installed
identity, binding last-good metadata to its actual cache/configuration, and letting
the first successful early path win over another path's earlier failure. FullReady
must reject stale/mismatched network state. The native dispatcher also needs complete
reference validation, coherent previous-manifest names and retained-artifact pruning.

## Detailed continuation instructions

This section is deliberately implementation-specific. Do not infer completion from
the checklist: inspect the current diff because the cache/update owner may have
written a fix after this checkpoint. Symbol names below are more stable than line
numbers. Do not reset, stash or overwrite the working tree to recover this task.

### 1. Establish state and ownership

Run `git status --short`, `git branch --show-current`, `git log -3 --oneline` and
`git diff --stat`. The branch must be `feature/brave-preparation`; `e312bb1` contains
the first documentation checkpoint, not the implementation. The starting app was
2.21.1/build 3022. No build, delivery, remote push or performance observation is
authorized merely by a historical development note.

Current code ownership is split as follows; coordinate before editing another role's
files, especially while agents are still running:

| Role | Files and responsibility |
| --- | --- |
| Cache/update | `BrowserAdBlockService.m/.h`, `BrowserNetworkFilterEngine.swift`, `Vendor/UBlock/network.js`: native stores, identities, descriptors, restoration, updates and cancellation |
| Early readiness | `AppDelegate.m`, `BrowserWebView.m`: startup, navigation decisions, script installation, immutable WK cache and UI readiness |
| Extended payload | `BrowserAdBlockConverter.swift`, `Vendor/UBlock/UBlockRuntime.js`: v4 output, resource caches, safe configuration handoff and parser cancellation |
| Root integration | `BrowserNativeRuleConverter.swift`, local AdGuard extension, Xcode references, asset regeneration, existing probe compatibility, version and documentation |

All application files above are under `_Project/Browser/` unless a different root
is given. The package extension is under `_Project/Vendor/AdGuardConverter/`.

### 2. Keep the public and internal contracts consistent

- `BrowserAdBlockService +prepareForLaunch` is main-queue, idempotent startup work;
  AppDelegate invokes it only when the global switch is on. It must not block app UI.
- `+prepareEarlyProtectionForPolicy:completion:` returns native lists, an extended
  runtime and an error. A successful result needs usable native protection and an
  available compatible network engine. A nil runtime or a partial native failure is
  not success. Every subscriber must complete exactly once.
- `BrowserLoadAdBlockRuleList` remains the full native loader. `BrowserLoadUBlockRuntime`
  remains the full current core/extended loader; an old early result must not satisfy
  its current-ready fast path.
- `+runtimeCurrent` must mean current extended identity AND available network state
  with the same current identity AND `stale != true`. Use it in FullReady and bake
  recording, not just `networkSummary.available`.
- Network Objective-C selectors are `prepareSources:identity:configuration:completion:`,
  `restoreIdentity:configuration:completion:`, `restoreLastGoodForConfiguration:completion:`
  and `cancelPreparation`. Retain `prepareLists:identity:completion:` for existing tools.
- Extended conversion retains `compileUBlockLists:` and adds
  `compileUBlockLists:cancelled:`. Check cancellation between batches of at most 512
  records, before each world's assembly and before returning the completed artifact.
- Native conversion is the separate `BrowserNativeRuleConverter +convertRuleChunks:`.
  Return `{chunks:[JSON strings], rules, advanced, discarded, errors}`. Its vendor call
  uses `preserveAllRules:true`; legacy converter callers retain the default behavior.

### 3. Preserve rule and cache semantics

Native conversion:

1. For results of at most 149,999 entries, return the existing JSON directly; do not
   decode/re-encode it unnecessarily.
2. For larger results, partition contiguous actions. Append every later
   `ignore-previous-rules` entry that can cancel an action in that partition. Do not
   copy earlier exceptions after later actions. Reserve one slot for the per-policy
   action appended by the service.
3. If the required exceptions cannot fit with one action, fail preparation. Keep
   installed protection and report Not ready; never truncate to make compilation pass.
4. DNS keeps every valid distinct host, the existing HTTP(S)/subdomain/third-party
   conditions and source order. The new form uses a canonical-host `[:/]` boundary
   and `url-filter-is-case-sensitive:true`. It does not use `|`, broaden schemes or
   replace destination matching with WebKit `if-domain`.

Native artifacts and dispatch:

- `ConvertedSource-<sourceKey>.plist` has `format:lossless-native-v2`, JSON chunks and
  counts. The source key binds source ID, complete text, generator version and forced
  rebuild epoch. Empty chunks may be valid for advanced-only sources.
- Compiled IDs bind the source, ordered chunk contents, policy and forced rebuild
  epoch. A normal update must preserve unchanged IDs; Rebuild Filters must bypass
  all old generated artifacts as full results.
- `Compiled-0` through `Compiled-3` are independent WebKit store directories below
  `BrowserContentRules`. At most one task per store runs at once. Main-queue state
  tracks shared in-flight identifiers, subscribers, generation and failures.
- `BrowserAdBlockRuleChunks` reports each prepared chunk through its callback so
  compilation can overlap later source conversion. The final collector joins those
  same in-flight IDs instead of recompiling them. A failure must be memoized for the
  generation, not automatically retried by the final collector.
- `NativeManifest-<early|full>-<policy>.plist` uses `native-manifest-v2` and an ordered
  `chunks` array containing `identifier`, `shard` and `source`; it also binds global
  input identity and enabled-source configuration. Validate every reference before
  subscripting it. Only a complete successful set may replace the current manifest.
- Keep previous-manifest filenames identical between writer and pruner. Pruning
  retains installed, in-flight, current, previous and last-successful references.
  Never remove source TXT or website storage as part of generated-cache cleanup.

Network artifacts:

- `network-v4-<identity>.json` binds format, identity, configuration, engine/PSL
  fingerprint, ready snapshot, ordered source references and source statistics.
- `source-v1-<key>.json` binds format, source key, engine fingerprint, source ID,
  compiled blocks and statistics. Source keys also bind trust and rebuild epoch.
- Cache JSON uses canonical sorted-key SHA-256 integrity plus atomic writes. Validate
  provenance and integrity before consuming a compiled string. Validate balanced
  `#block-start-N`/`#block-end-N` sections before constructing upstream readers: a
  missing end marker can loop forever, not merely throw.
- Initialize PSL before compiling any source. Reassemble with `snfe.reset()`, one
  `snfe.fromCompiled(new CompiledListReader(source.compiled))` per ordered source,
  then one `snfe.freeze()`. Never concatenate texts with repeated section IDs.
- The compatibility collecting wrapper must skip empty trailing block lines when
  rebuilding its one output writer. `JSON.parse('')` in a later restore is a defect.
- Descriptor `available:false` means an optional remote source was not downloaded
  yet. An available file that cannot be read is an error, not an empty successful
  source. Leave the old engine installed on read/parse/cache failures.

### 4. Finish restoration, update and race handling

Work through these checks before calling integration complete:

1. For installed A, pending B, then a new request A, cancel/invalidate B even when A
   is an exact installed-cache hit. Publication must correspond to the newest request.
2. `LastSuccessfulFilters.plist` is written only after a fully successful coherent
   pipeline. It binds configuration, full identity, extended filename/fingerprint,
   native policy manifests and the exact network identity to restore.
3. A last-good result may be stale by source revision but must match enabled sources,
   custom-rule text/trust configuration and engine/adapter fingerprints. Validate
   both pointer and referenced cache; reject path traversal, mismatched format,
   identity or configuration. Never label last-good data FullReady for a newer input.
4. Early preparation races current preparation against last-good restoration. The
   first successful result wins; a fast failure must wait for other eligible paths
   before reporting failure. Recheck generation/configuration before callback.
5. The actual runtime's `artifactIdentity` defines its script identity. Never assign
   the current global identity to an old dictionary captured by an earlier callback.
6. ETag metadata under `AdBlockSourceHTTP.<id>` is paired with the cached source file's
   signature. Send `If-None-Match` only for the matching existing file. A valid 304
   updates last-check without a generation bump; failed/invalid 200 preserves old
   text and metadata. A changed valid 200 atomically replaces text before publishing
   one coalesced source-change generation.
7. Stop obsolete native scheduling, source compilation and extended batches at safe
   boundaries. Do not attempt to forcibly interrupt a WebKit call or synchronous
   matcher execution. Completion and installed-engine safety still need final guards.
8. Apply native rules by ordered identifier difference: retain common installed
   lists, add required new lists, then remove superseded lists. Update reference
   counts only for additions/removals so shared baseline protection stays installed.

### 5. Preserve navigation and v4 script behavior

- The main HTTP(S) navigation barrier runs before the normal strict-document/network
  decision. Start that decision's existing short watchdog only after early preparation.
- Keep one-shot decisions plus document, navigation and policy generations. An old
  callback must cancel its own navigation; it must not mutate or complete a newer one.
- Redirect responses must establish the destination site's enabled/OFF policy before
  the document starts. OFF removes app-owned rules/scripts without waiting for caches.
- After EarlyReady, full native preparation continues. A native-only upgrade must
  not reload the page or disturb iframe playback. Explicit rebuild/source/site actions
  keep their intentional reload behavior and existing busy/fullscreen safeguards.
- Extended v4 artifacts contain `format:4`, `configurationMode:separate-v1`, `scripts`,
  `stats`, `rejected` and an artifact identity supplied by the service.
- Register one small configuration script immediately before each world's immutable
  runtime. The runtime consumes an own configurable data-property descriptor and
  removes it before invoking library/website code. Never leave its token in a global.
- Separate configuration is required even without artifact identity. Only immutable
  WK cache eligibility depends on artifact identity; missing identity uses an uncached
  v4 script, not a legacy configuration path.
- WK cache budget is 64 MiB of UTF-8 source and eight entries, keyed by artifact/world.
  Memory warnings clear only recoverable cached objects, not installed rules/engines.
- Do not force fresh semantic policy IDs on every same-host navigation: BFcache does
  not rerun WKUserScripts, so this requires a separate protocol. Preserve existing
  page-cache behavior and use generation checks to reject stale asynchronous replies.

### 6. Integration, validation and completion order

1. Obtain final readiness from the cache/update owner, then cross-review all selectors
   with the early owner. Resolve each defect above or explicitly document a remaining
   limitation; do not silently delete the checkpoint findings.
2. Regenerate assets with `node scripts/build-ublock-assets.mjs` after the last adapter
   edit. This session has Node only through `mcp__node_repl`; it can dynamically import
   the standard builder by absolute file URL with a fresh query suffix. Do not hand-edit
   the generated network bundle. Expected current inventory is parser 4 modules,
   174 scriptlet/helper entries and network core 20 modules.
3. Run appropriate non-runtime syntax/whitespace/project-reference checks. The existing
   macOS runtime probe was updated for the extracted Swift path, CryptoKit and v4 cache
   names; these edits are compatibility maintenance, not a passed test result.
4. Follow AGENTS.md before tests/builds/delivery. This request authorized implementation;
   no app tests, app build, TV discovery or TV installation have been run here. Linux
   lacks Xcode and the tvOS SDK. Manual branch CI is now supported through workflow_dispatch once registered on the default branch; remote Git push still requires explicit authorization.
5. Once source integration is complete, update the user guide, uBO/component README,
   development history and both marketing versions together. Use patch 2.21.2 for this
   refinement of existing Ad Block; keep build number/signing unchanged. Add one
   unreleased changelog entry dated for implementation without inventing a release.
6. Commit coherent implementation stages locally; no Git remote push. Git author config
   is absent on this host. Inspect `git log -2 --format='%an <%ae>'` and reuse the
   established public noreply identity with per-command `git -c user.name='<name>'
   -c user.email='<public-noreply-email>' commit ...`, as the documentation checkpoint
   did. Do not change global configuration or copy private identity values into docs.
7. Before ending, update this checkpoint and development history with actual commit IDs,
   checks performed, checks not performed and remaining platform-dependent work.

When verification is requested on macOS/tvOS, cover complete rule-record and native
decision equivalence, source-spanning badfilter/exceptions, corrupt caches, A→B→A
requests, OFF during preparation, redirects, two WebViews, dynamic/nested/about:blank
frames, BFcache, full-native completion during iframe playback and forced rebuild.
Measure five full cold runs against the same source digests: each must finish within
30 s. Record EarlyReady, FullReady, applied-to-page duration and peak memory separately.
Warm restoration and a one-source update must demonstrate reuse of unchanged native
artifacts. Do not derive TV timing or memory limits from Node/macOS-only observations.

### Deliberately deferred work

Page/frame-specific payload delivery and host-side class/ID selector retrieval
are not implemented. The follow-up adds local surveying of simple generic selectors;
current v4 still reuses complete immutable
all-frame scripts; it does not claim smaller per-frame rule sets. A later implementation
must first define how every dynamic realm receives matching document-start scriptlets,
including inherited origins, srcdoc/blob, path/entity/regex/ancestor scopes and all
negative rules. Until that is proven, keep universal delivery as the lossless fallback.
The new native performance changes also need actual tvOS measurements; no 30-second
achievement or memory/jetsam improvement is established by source edits alone.

## Final source-integration evidence

- Implementation commit: `8d7681c`; documentation checkpoints: `e312bb1`, `b4d48f6`.
- Peer-review defects were resolved: compiled-record integrity/provenance and balanced
  blocks, empty-line aggregation, available-file read failure, A→B→A newest-wins,
  exact last-good binding, first-success early races, current-only FullReady and
  runtime/artifact identity separation. The last asset regeneration includes those
  adapter fixes; the shipped bundle contains the exact maintained `network.js`.
- Root also made startup load WebKit from the same public/private/staged locations
  as BrowserWebView, since prewarm runs before the WebView's own runtime loader.
- The standard Node asset builder reported parser 4 modules, 174 scriptlet/helper
  entries and network core 20 modules. Syntax parsing accepted `UBlockRuntime.js`,
  `network.js`, `UBlockNetwork.js`, `UBlockParser.js` and `UBlockDomains.js`.
- Static project inspection confirmed each extracted/new Swift file has one file
  reference and source-phase membership, both marketing versions are 2.21.2 and the
  existing updated Python probe parses. The probe itself was not executed.
- The user supplied a 15-minute final integration window. Source commit and static
  checks completed within that window; platform-dependent acceptance remains open.

### Exact next validation steps when the necessary authorization/environment exists

1. Confirm the checkout contains `8d7681c` and this final checkpoint; inspect the
   working tree before any checkout, merge or build. Do not use historical TV
   deliveries as permission to inspect or install a physical device.
2. Read the installed apple-tv-deploy skill and Simulator runbook. For a requested
   Simulator build use the existing delivery script with the Browser scheme; keep
   signing overrides/local settings intact. Fix any Apple SDK diagnostics before
   interpreting static-review confidence as compilation evidence.
3. When testing is requested, run the updated macOS network-runtime probe and existing
   targeted parser/domain/request/worker checks. Verify per-source compiled output
   against monolithic compilation, including cross-source exceptions and badfilter.
   Compare ordered extended records and rejection counters, not only total counts.
4. Exercise cold/warm launch, one changed source, forced rebuild, rapid A→B→A,
   source/global/site OFF during preparation, redirects, two WebViews and failures
   of each early restoration path. Observe that every navigation decides once and
   stale/partial data never reports FullReady.
5. Test iframe playback and page cache explicitly. Native-only completion must leave
   the running player/document intact; script-runtime changes retain guarded reloads.
   Check nested/dynamic/about:blank frames and both configuration worlds.
6. On an authorized TV, retain exact source digests and run five full cold rebuilds.
   Rebuild Filters changes the epoch in source/chunk cache keys; do not delete site
   data to force a measurement. Record each EarlyReady/FullReady/applied duration,
   WebKit/conversion/core/extended stage and process memory observation window.
7. If any full run exceeds 30 s, identify the measured critical stage. Tune native
   shard count/chunk size or equivalent regex generation using that evidence; retain
   rules and exceptions. Do not relabel early readiness as full success. Record the
   selected tradeoff and repeat only relevant checks after each actual change.
