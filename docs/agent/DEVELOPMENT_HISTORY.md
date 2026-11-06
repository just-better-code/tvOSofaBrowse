# Development history

Implementation evidence and decisions, organized by topic and then by development sequence. Dates below are the recorded implementation/observation dates; artifact numbers are retained where needed to identify what was actually built. They do not establish publication, release tags or current authorization. Completed scope and deferred work are not repeated as active tasks here: consult [ROADMAP.md](ROADMAP.md), [USER_GUIDE.md](../USER_GUIDE.md) and the [coverage matrix](plans/ublock-runtime.md).

Build/install/launch proves delivery only. Controlled fixtures, live Inspector observations and user reports are identified separately; missing or failed observations are not passes. Historical physical-TV deliveries do not renew device authorization. Personal URLs, query values, cookies and diagnostic files remain outside tracked documentation.

## Version interpretation and accepted direction

- Retrospective baseline: upstream `e245b8f` is represented as 2.0.0; the initial snapshot is 2.15.22, grouping 15 feature groups and 22 fix groups. These are reconstructed logical versions, not proof of individually published binaries or ordered fix chronology.
- On 2026-10-11, the user classified unified media controls and shared VLC web playback as minor features, and scoped clearing/Inspector gating as patches. Normalize scoped clearing 2.20.0 → 2.19.19; separate-player removal 2.20.1 → 2.19.20; shared VLC 2.21.0 → 2.20.0; Inspector gate 2.22.0 → 2.20.1; EOF fix 2.22.1 → 2.20.2; VLC cookie context 2.22.2 → 2.20.3.
- The async/uBlock development sequence was subsequently mapped from 2.22.0/2.23.0/2.23.1/2.24.0/2.24.1 to 2.21.8/9/10/11/12, then consolidated with later development artifacts into one unreleased 2.21.0 entry. Original artifact labels in evidence below identify historical packages, not additional releases. No tags or Git history were rewritten.
- The user finalized the current uBlock scope at 2.21.0 on 2026-10-11 and deferred its remaining adapters. This scope decision does not establish complete uBO equivalence or public publication; the earlier autonomous-completion request does not activate deferred work.
- Rejected directions: separate native AVPlayer fullscreen web playback (2026-10-11), iframe-to-VLC episode continuation after failed Next/EOF checks (2026-10-11), manual filter entry from the TV remote (2026-10-11), Firefox Account/Sync and YouTube-specific extraction (2026-10-10), PiP and iCloud synchronization (2026-10-01). Google Drive file sync is a separate implementation described below. Local backups remain intact.
- Accepted user outcomes: held scrolling at a 1.2-second ramp and 1800 points/second felt comfortable; per-domain zoom was accepted; the autoplay policy fix allowed the next episode to start with sound; saved player volume survived fullscreen transitions. These are scoped user observations, not exhaustive site/device tests.

## uBlock and network adapters — 2026-10-11

### 2026-10-11 — Full-uBO runtime foundations and broad filtering (2.21.0)

User authorized implementation of the Ad Block/uBlock roadmap and Simulator delivery. Preserve native WebKit protection and add a pinned parser, 153 registered scriptlet/helper descriptors with dependency closure, and the full uBO procedural task/action engine from the supplied 1.75.1.10 snapshot (exact commit unavailable). Vendor only required source, licenses and deterministic generated assets. Pin and flatten official uAssets filters.txt plus all ten include files by individual SHA-256; the bundled source is trusted, remote AdGuard and local custom filters are untrusted. This enables broad library selection, not proof that all scriptlets work on tvOS.

Use serialized JavaScriptCore compilation outside the page, native preprocessor environment for ublock/safari/mobile, source/line metadata and explicit unsupported accounting. Retain advancedRulesText and advanced-only converter results; compile full source lists independently for advanced selection/exception handling. Inject MAIN wrappers and isolated scripts/cosmetics at document start, preserving other user scripts. Add remembered hostname exceptions covering subdomains, global/effective policy separation, early navigation/response preparation, stale async callback rejection, page-cache policy markers/reload, capped redacted Debug events and native Coverage/My Filters controls. Batch CSS/procedural work; defer procedural full-document scans over 15,000 elements. Destructive DOM actions require reload to restore page content.

Build initially failed at sandboxed simulator discovery with CoreSimulator permission errors; an elevated build succeeded. Final 2.21.0 Debug Simulator build, install and launch succeeded. No app tests, filter behavior observations, Release build, Git remote push or physical-TV work. Later entries record network integration, extended scopes and subsequent coverage; broader adaptations are now deferred in the roadmap.

### 2026-10-11 — Preserve navigation during Ad Block preparation (2.21.4)

On feature/ublock after merging master iframe controls, the user requested the about:blank fix and explicitly prohibited physical-TV delivery. Source inspection found a navigation race: setAdBlockEnabled invalidated asynchronous loadRequest policy preparation, then reloaded the current WebKit document while it was still blank. Keep a pending request until WebKit navigation starts, defer source/setting refresh during preparation or loading, avoid initialization reloads of non-HTTP documents, and recheck current enabled/rules state before applying protection. Ignore completion/policy events from an older document while a replacement request is pending; stop, native start-page loading and history traversal cancel obsolete preparation.

Debug Simulator 2.21.4 build, install and launch succeeded. The first opening remained blank for roughly two minutes while WebKit compiled the enabled filter lists. A short process sample showed background ContentRuleListStore compilation with an idle main thread, rather than a main-thread deadlock. Safari Inspector subsequently showed the requested Example site C URL, document.readyState complete, a populated body and visible html/body. A direct simctl screenshot showed the actual Example site C page. The native Simulator window screenshot was stale/white and must not be used as evidence of the current rendered frame.

A second process launch restored 14 compiled chunks without filter conversion, compiled advanced coverage and recorded scriptlet/cosmetic observations. The process was running behind the simulator home screen, so a second foreground-page observation was not established. Cold filter compilation latency remains; do not claim instant first navigation or proof that every original TV failure shared this race. No automated app tests, repeat iframe playback checks, Release build, physical-TV delivery or Git remote push. Private diagnostic logs and samples remain under .data/; do not publish browsing or tracking values.

### 2026-10-11 — Remove manual filter entry from TV settings (2.21.5)

The user requested removal of custom-filter addition because typing filter syntax with a TV remote is inconvenient. Remove Edit My Filters, its entry/clear dialog and the unused filter-writing API. Hide the My Filters source row when no previously saved rules exist; retain existing saved rules and their enable/disable switch without deleting preferences. Keep the bundled requested-gap rules and preset filter sources. Debug Simulator build, install and launch succeeded. No menu interaction observation, automated tests, Release build, physical-TV delivery or Git remote push. The user explicitly prohibited TV delivery during this work.

### 2026-10-11 — Open pages before filter compilation (2.21.6)

The user requested immediate page navigation with currently available protection, followed by background filter preparation and reload. Replace navigation-action/response completion gates with immediate policy decisions. Retain installed rules while asynchronous preparation runs; apply the latest policy and reload only the matching requested URL when preparation changes rules/scripts. Defer the reload only until WebKit reaches that URL, rather than waiting for all resources/iframes to finish. Cached synchronous preparation still precedes the navigation decision and does not schedule an extra reload. Stop, start-page loads and history traversal invalidate obsolete preparation; redirects update the policy URL. Initial loading may expose ads before the protected reload, and reload can interrupt playback or unsaved site input; this is the user's requested tradeoff.

Final Debug Simulator 2.21.6 build, install and launch succeeded. Direct simulator frames showed Example site C populated with the banner before preparation, then populated without that banner after preparation. Private numeric/source logs showed restoration of 14 native chunks, advanced coverage and scriptlet events. This observation used existing compiled native caches; no deliberately forced cold-cache timing run, automated tests, playback checks, Release build, TV delivery or Git remote push. Keep the earlier roughly two-minute cold native compilation finding separate from this run.

The user asked whether compilation blocks remote control. Source inspection found no Ad Block/loading gates in BrowserRemoteInputController or BrowserDOMInteractionService; parser/native rule compilation runs on background queues. Installing prepared WebKit rules/scripts occurs on the main thread, and the resulting reload can briefly disrupt interaction. Existing loading guards remain for native media messages/system track commands; compilation itself does not set the page-loading flag. Remote responsiveness during compilation was not directly measured.

### 2026-10-11 — Full upstream network matching core (2.23.0)

Resume network work after the user's JS priority stage. Vendor the complete static network engine, dynamic hostname firewall and URL filtering engine with their dependency closure; preserve upstream sources/notices and record pinned digests. Bundle 20 modules separately from the page parser. Adapt top-level PSL discovery to the portable pinned implementation; supply JSCore timer, decoder and hostname-normalization host APIs without rewriting upstream modules. Use a dedicated serial worker, compiled-list caching and unchanged enabled-source/trust provenance. Include DNS/HOSTS lists, conditional sections, continued lines, parser error accounting and noop fallback to static filtering. Preserve dynamic URL, then firewall, then static priority. Keep direct resource redirects/URL transformations outside this limited hostname URL shim.

Hook the native navigation-action path with capability-checked frame access, current document generation and a 250 ms asynchronous fallback. Explicit main_frame/sub_frame matches can cancel navigation; disabled/site-excepted policies bypass the core. Do not block the UI while compiling or matching. Existing WebKit rule lists still handle other resource paths, so matching-core completeness does not establish full cross-backend allow/noop or strict generic document semantics. Fetch/XHR and site third-party controls were added in the later stages below. Coverage shows this boundary and core availability/count.

Initial build/install/launch succeeded but startup diagnostics reported core unavailable. Diagnose the generated export map: trailing commas in upstream named exports emitted an empty property. Skip empty export entries, regenerate assets, and rebuild. Swift Debug condition was missing; add it to Debug only for bootstrap diagnostics. Final Debug 2.23.0 Simulator build/install/launch succeeded and startup logged available=1, filters=230765, cached=0, error=0. This confirms actual core compilation, not request-rule correctness or playback/remote interaction. No app tests, warm-cache timing experiment, Release build, TV work or remote Git push.

### 2.24.0 — stage 1: fetch reply bridge (2026-10-11)

Added a capability-checked page-world reply handler and fetch preflight adapter in every frame. Native frame origin and current policy drive upstream matching; stale replies cancel, bounded missing replies allow native networking. Only URL/method/type reach the host, without bodies, headers or cookies. Simulator build, installation and launch succeeded. Normal startup reported bridge=1 and fetch=1, XHR=0. No application tests or request-blocking interaction checks were run. XHR follows in a separate stage commit within this feature version.

### 2.24.0 — stage 2: asynchronous XHR (2026-10-11)

Added native-prototype XHR interception through the shared network reply bridge. Request metadata comes from native frame context; bodies stay in-page and are snapshotted before waiting. Allowed requests retain WebKit responses/cookies/CORS; blocked requests use synthetic error/loadend, status 0 and DONE. Pending abort, reopen, pagehide and timeout cancel the gate; timeout includes the decision delay. Native constructor identity remains intact. Synthetic gate events have isTrusted=false, and allowed loadstart is delayed until native send. Sync XHR and workers remain native/outside this gate. Final Simulator 2.24.0 build, installation and launch succeeded; startup observed bridge=1 and fetch=1/XHR=1. No request-blocking interaction tests, application tests, Release build or physical TV work. Existing native rule lists can still block a core allow; cross-backend equivalence is not delivered.

### 2.24.1 — advanced script stack and startup stabilization (2026-10-11)

Read-only physical-TV Inspector exposed RangeError at the injected script closing IIFE. A reconstructed isolated runtime with 132844 records reproduces Maximum call stack size exceeded on JavaScriptCore with a 256 KiB thread stack; identical JSON-packed records execute. The standalone synthetic regression also checks escaped-string round-trip and succeeds. Pack records through JSON.parse rather than a giant object-array expression.

Apply ready native rule chunks before waiting for network/advanced compilation; reject late upgrades after policy/generation changes. Fingerprint bundled filters by content and length instead of delivery timestamps. One cache-key transition still requires cold compilation: observed native chunks at about 110 seconds after first launch; warm launch restored 14 chunks and applied them 4 ms later, with network cached=1 available about 0.5 seconds later. Advanced script compilation still takes additional time and may trigger a reload; no universal instant-start claim.

Debug Simulator build/install/launch succeeded. Example site D Inspector showed installed fetch/scriptlet sentinels; repeated reloads showed no RangeError, but external player syntax errors and failed requests remained. Live checks observed allowed data fetch, blocked analytics fetch, fetch abort, blocked XHR and allowed same-origin HTTP status 200. Matching correctness for every site request and physical-TV behavior after this fix are unverified. The user temporarily deferred workers while this stabilization was performed; later worker stages resumed that work.

### XHR cancellation stabilization and version correction (2026-10-11)

Live Simulator checks exposed OPENED (1) after aborting an XHR still waiting for a filter decision. Native abort does not reset a request that has never been sent; retain virtual UNSENT (0) after synthetic abort, including reentrant abort, and reject send after synthetic completion until open creates a new request. Ten isolated gate regression scenarios pass (allowed/blocked fetch, late reply after abort, missing reply fallback, XHR guards/abort, blocked completion, reopen, timeout, POST snapshot and pagehide/resume). These mocks do not establish all native XHR semantics.

On Simulator, WPT xhr/abort-after-send.any.html and xhr/event-loadstart.any.html each visibly reported harness OK and one PASS, with native startup reporting fetch=1/xhr=1. The abort-event-order.htm result was not observed (Simulator was on Home); no crash report was found and the available browser logs did not establish a cause. Do not count that attempt as a passed test. Full WPT, worker, physical-TV fixed-build behavior and episode automation remain unverified. Synthetic events remain untrusted and native loadstart remains delayed by the gate.

Final Debug artifact 2.21.12 was built, installed and launched only on Simulator; Example site D rendered visibly with its website player. No physical-TV deployment or Git remote push.

### 2.21.15 — classic Blob dedicated worker requests (2026-10-11)

Connect supported same-realm JavaScript Blob dedicated workers through private transferred MessageChannels. Inject the reusable installer before executing the original script with importScripts, preserving its directive prologue; retain a separate entry Blob URL so immediate site revocation does not race execution. Worker fetch and asynchronous XHR reuse full-core decisions, bounded fallback, cancellation and parent pagehide/pageshow control. Explicit terminate closes the channel and releases owned URLs. Diagnostics count readiness, bypasses and unready bridges without recording request URLs or payloads.

Coverage is limited to text/javascript and application/javascript Blob entries; HTTP/module/shared/service/nested/cross-realm Blob workers retain native paths. The worker observes a generated Blob location, and bootstrap importScripts is subject to site CSP; these are concrete compatibility limits, not transparent full worker coverage. No compatibility claim was verified on a real site worker.

Verification: ten controlled isolated-realm worker bridge scenarios and ten existing page fetch/XHR gate regressions passed. They cover initial requests, allowed/blocked fetch, blocked XHR, strict directives and site messages, lifecycle cancellation/resume, bounded fallback, termination cleanup, unchanged option getters on bypasses and MIME bypass. They do not model WebKit CSP, true thread scheduling or full Worker WebIDL behavior. Final Debug 2.21.15 build, install and launch succeeded on Simulator with the original Example site D URL requested at launch. Launch does not establish page rendering or live worker filtering. No physical-TV work, Release build or Git remote push. Cookie forced-restart investigation remains deferred.

### Live Simulator worker probe — 2026-10-11

The user opened Safari Inspector on Example site D for the classic-worker probe.

Executed a disposable classic JavaScript Blob worker from the Inspector console and revoked its original URL immediately. Screenshot visibly confirmed: worker adapter=true, original strict directive=true, ordinary echo preserved, allowed httpbingo fetch returned ok=true, DoubleClick fixture fetch rejected TypeError, and four probe messages before explicit termination. The stack-name probe for the blocked request returned false, so the rejection alone does not distinguish full-core adapter blocking from native WebKit blocking. Report Only CSP warnings for Blob worker/importScripts/connect appeared without preventing this probe. This is real WKWebView worker execution evidence for this page policy, not coverage of enforcing CSP, HTTP/module/shared/service/nested workers, lifecycle stress or every network decision. No source change, build, version bump or physical-TV action was needed.

### 2.21.16 — nested and module Blob workers (2026-10-11)

Enable the Blob worker adapter inside an instrumented worker whenever the runtime exposes Worker and the required Blob/channel APIs. Child transports relay only URL/method/API and event metadata through parent channels to the original native frame context. The full-core host keeps deriving origin/top context from WebKit. Readiness terminates at each parent record and reports one event, avoiding duplicate descendant counts at every hop.

Module Blob workers retain WorkerOptions.type=module, credentials and name. Their generated root imports a synchronous setup Blob dependency followed by a retained original Blob module entry, rather than concatenating site source into a classic wrapper or awaiting a dynamic loader. This preserves module strictness/scope and installs API interception before original static dependencies execute. HTTP entries are still not refetched or replaced; shared/service workers and foreign-realm Blob URLs remain outside this path. Module import fetches use native resource filtering, not the fetch/XHR adapter. Additional Blob loads remain subject to CSP; worker location and module import.meta.url expose generated aliases. No transparent identity/CSP equivalence claim. The module graph design follows the HTML worker module model: https://html.spec.whatwg.org/multipage/workers.html .

Add worker self-close notification/disposal, dispose channels on nonpersisted document pagehide, retain suspend/resume for back-forward cache, and roll back partially installed constructor/URL/terminate wrappers when descriptors are incompatible.

Verification: 16 isolated-realm worker scenarios passed with Node's experimental SourceTextModule harness (node --experimental-vm-modules scripts/check-ublock-workers.cjs); ten existing page fetch/XHR regressions also passed. New cases cover actual module linking/evaluation order, module-local declarations/strictness/import.meta, nested classic and nested module transport, inherited lifecycle cancellation, once-per-worker readiness, self-close cleanup and noncached document disposal. The fixture isolates constructor/URL/XHR prototypes across realms and models onmessage as well as listeners. These checks do not model real WebKit CSP, Worker WebIDL conversion, thread scheduling or native nested-worker support.

Final Debug 2.21.16 Simulator build/install/launch succeeded with the Banshee Example site D URL passed to launch. Live post-delivery interaction was not verified: two Safari CUA getApp calls timed out (-10005). The earlier 2.21.15 real classic-worker probe remains evidence only for that version/path. No TV work, Release build or Git remote push.

### Live verification of 2.21.16 — 2026-10-11

After user-assisted console input, Safari Inspector on the 1080p Apple TV Simulator showed all eight expected expanded-worker probe messages: dependency adapter=true; root module adapter=true, scoped=true, strict=true, nestedAvailable=true; ordinary fixture echo; blocked advertising fixture TypeError; classic child adapter=true; module child adapter=true; and successful httpbingo fetch ok=true from both children. The earlier inline run also displayed WORKER_EXPANDED_DONE with messages=8; the manually pasted file displayed the same eight results in the observed snapshot. No new worker error, adapter SyntaxError or RangeError appeared. Existing console errors were the previously investigated external fullscreen.js/player_down.js top-level returns and a page fetch rejection at the intentional adapter block branch.

This confirms live WKWebView module setup ordering before a static dependency, native nested-worker availability on this Simulator, successful classic/module child bootstrap and message/fetch operation on the current page. The advertising rejection does not independently distinguish full-core matching from native WebKit blocking. Enforcing CSP, broader lifecycle stress, HTTP/shared/service workers and physical TV remain unverified. No source change, new version, build or commit was needed for this observation.

Diagnostic correction: earlier CUA reads/screenshot did not show the test input/result, so it was reported as not executed. The later console contains that inline input and its successful results; delivery or observation was delayed. Do not treat absent initial AX/screenshot output alone as proof that input never executed, and never retype a potentially pending command merely because no result is visible. User instruction still requires stopping failed actions and reporting them rather than retry loops. The disposable manual probe is saved privately in .data/worker-check/live-probe.js.

### 2.21.17 — extended domain applicability

Remove the domain-pattern rejection for entity, regex/path and ancestor rules. The runtime uses the same pinned PSL as the full core, with its trie generated at asset build time; handle multi-label/public-private/exception suffixes and subdomain entities. Match regex/path targets according to upstream StaticExtFilteringHostnameDB and scriptlet ancestors from location.ancestorOrigins. Exclusions precede positives. Cosmetic ancestor matching is not introduced beyond upstream semantics.

Production parser/runtime checks passed for entity, private/exception PSL, hostname regex, path regex/literal path, scriptlet ancestor matches and exclusions, and misleading hostname suffixes; all ten page and sixteen worker regressions passed. Debug Simulator 2.21.17 build/install/launch succeeded. The first sandbox invocation could not access CoreSimulatorService; an authorized invocation outside sandbox succeeded. No live site correctness claim, physical TV work or Git remote push. HTTP-worker host adapters remain investigation, not delivered.

### 2.21.18 — native action observations and dynamic policy reuse

Connect WebKit _webView:contentRuleListWithIdentifier:performedAction:forURL: to Debug-only numeric/capped action records, capability-check each BOOL getter, omit URLs and chunk identifiers, and report native action counters in Coverage. This callback observes applied actions, not all allowed requests, request type, worker origin or exact filter source/line. Upstream references: WKNavigationDelegatePrivate.h, _WKContentRuleListAction.h and NavigationState.mm under https://github.com/WebKit/WebKit/tree/main/Source/WebKit/UIProcess . Retain no runtime URL/cookies in records.

Cache dynamic host/URL rule strings in the full core and reparse only when changed. The production network bundle passes static exception, dynamic URL/hostname precedence, noop, removal, repeated policy and compiled-cache restore checks. Debug Simulator 2.21.18 build/install/launch succeeded. Live Simulator unified-log observation showed eighteen Browser native-resource-action callbacks with blockedLoad=1; this confirms runtime callback delivery on Example site D, not HTTP-worker-specific coverage. Safari AX access succeeded but Develop Simulator selection closed its menu without opening Inspector; stop this path rather than retry. The alternate redacted unified-log read succeeded. No physical TV or remote push.

### 2.21.19 — fetch query pruning

Deliver upstream filterQuery/removeparam modifiers on nonblocked GET/HEAD fetch in pages and supported Blob worker descendants. Native reply and page reconstruction independently constrain changes to the query of the same origin/path/fragment. Preserve headers/credentials/cache/redirect options using native Request construction, keep POST bodies/native path unchanged, retain action/cancellation/fallback semantics and modifier exceptions. XHR, navigation and other native resources do not apply the modifier result through this adapter; this stage did not deliver general redirects or response changes.

Production full-core checks passed encoded and duplicate query parameters, fragments, removeparam exception, POST skip and blocked-request skip. Eleven page gate checks include Request option preservation and cross-origin/path rejection; sixteen worker regression scenarios passed. Debug Simulator 2.21.19 build/install/launch succeeded. No live modifier fixture verification or TV/remote push. No new diagnostic server.

### 2.21.20 — legacy scriptlet surrogates

Include the pinned upstream redirect resource registry and its 21 text-injectable JavaScript resources in generated scriptlet library (174 entries including helpers). Preserve original GPL notices, resource aliases and requiresTrust metadata; compile aliases before suffix normalization as well as through .js token names. No downloaded list code executes, no global eval injection, and this stage does not implement general network redirection.

All library code parses; controlled checks pass noeval/nofab/popads/popads-dummy/google-ima names, google-ima3 alias, google-ima3-dai trust restriction and exceptions, and functional anti-adblock/noeval/popads stubs. Bundled compilation now accepts 9468 scriptlet and 7354 cosmetic rules; unknown scriptlet-name rejections fall from 69 to zero. Remaining 137 extended rejections comprise 130 HTML response-filter capability rejections, one other syntax rejection and six response-header filters; the initial report grouped the first 131 as syntax; the response-delivery accounting stage below corrected this. Extended-domain regression checks pass. Debug Simulator 2.21.20 build/install/launch succeeded; broad site/advertisement API integration remains unverified. No TV or remote push.

### 2.21.21 — site third-party policy and requested Hraimo removal

Add persisted host policies Block/Allow/Noop/Use Parent, with longest-parent inheritance and the same host rules sent to the upstream dynamic core. Append third-party block or ignore-previous-rules to every native chunk; Noop uses standard chunks. Cache separate native variants without rebuilding the full core for policy-only changes. Preserve a standalone dynamic chunk when no source lists are enabled. WebKit rejects combining if-top-url and unless-top-url, so select policy variants per top-page view rather than invalid intersected triggers. This UI surface did not deliver general URL/destination/type policy reconciliation.

Remove the requested embedded Hraimo list, resource references, loader, blocked-host contribution and source identity; retain My Filters and downloaded lists. Bump native cache generation to v12 to avoid reusing removed rules.

Actual Foundation policy source passes validation, hierarchy/noop, host boundaries, native action shapes and JSON persistence checks. The generated full network core passes existing precedence/exception/cache/query-modifier regressions. Final Debug Simulator 2.21.21 build/install/launch succeeded. No complete menu/policy interaction observation was recorded for that initial delivery; the follow-up below establishes only a partial Allow result. The on-screen Simulator remote and unchanged ineffective Escape path were stopped. Its unreliability is recorded in AGENTS.md and .data/simulator-remote.md. No physical TV or Git remote push.

Follow-up live observation: user found the four technical action names unclear. Action rows were also discarding rowDetailProvider output, hiding the saved policy; support opted-in action detail, show effective/inherited mode and Preparing, use plain action names and mark the selected action. During user-assisted Allow testing, the Simulator preference contained allow while only the standard/block compiled manifests existed. Previous console blocks were still from the old document. Native compilation completed later and applied fourteen chunks; iframe navigation decisions used dynamic-host and allowed them. Final console evaluation failed with noWindowsAvailable and was not retried, so CryptoJS load completion and page correctness remain unverified. No stack-overflow message appeared in the initial observed snapshot. The previously diagnosed external SyntaxErrors were also visible.

Persist converted static chunks under their exact filter-source identity, validate cached shapes and regenerate on a changed identity. New policy variants reuse conversion output instead of parsing every source again; actual WebKit variant compilation still takes time. Final clarified-menu/cache build, install and launch succeeded on Simulator. Do not claim measured speedup or full live backend equivalence.

### 2.21.22 — distinguish parsing from response delivery limitations

Enable response-body parsing in the pinned parser, reject successfully parsed HTML and response-header rules under dedicated pending-delivery reasons, and expose bounded named counts in Coverage. Do not execute either response-filter class or treat this as implemented response rewriting. Fixtures distinguish valid HTML/header filters, unknown scriptlet and malformed HTML syntax. The full pinned list retains 137 unsupported rules: 130 response-body, six response-header and one syntax; no scriptlet-name rejection. Extended-domain regressions pass. Debug Simulator build/install/launch succeeded. No physical TV or remote push. Live popup layout has not been observed after delivery.

### 2.21.23 — strict-document decisions and requested simple default menu

Retain pinned upstream traffic.js strict-block and validateStrictBlock helpers with original GPL notice; call them for main_frame after dynamic URL/firewall evaluation. Preserve explicit/generic important/exception precedence, hostname boundary/end matching and rejection of tokenless or path-only generic strict blocks. Show a UIKit Page Blocked by Ad Block explanation via an optional delegate callback for the active tab; do not claim a temporary bypass. Cancel obsolete policy-generation navigation decisions and evaluate main-page site exceptions using the destination instead of the previous page.

Production bundle checks pass sixteen explicit/generic/important/exception combinations, generic path versus explicit document behavior, tokenless filters, FQDN and hostname boundaries and dynamic allow. Existing network-policy/modifier regressions passed before the native changes. Simulator build/install/launch succeeded; no live blocked-dialog interaction was recorded.

User found the third-party policy explanation unclear and requested its removal and explicit default. Remove the long description, show hostname only, rename the first inherited choice Default, keep the selected checkmark, effective setting row and Preparing. Default with a parent override reports the inherited action; without one it uses filter lists. Final 2.21.23 build/install/launch including this menu change succeeded. No physical TV or Git remote push. Previous Allow runtime preference is preserved rather than changing the user's selection silently.

### Final third-party labels — 2026-10-11

The intermediate Default/Follow Parent labels were superseded by **Block (Strict), Allow (Soft), Use Filters (Default) and Inherit**. Inherit is not Soft because it may inherit Block; no parent override means static filtering. The hostname-only message, selected-mode checkmark, effective-setting row and Preparing indicator remained. Preference values were preserved. Debug Simulator build/install/launch succeeded for the text-only change; no additional screenshot or interaction check was performed.

### Brave-inspired network-engine optimization — unreleased 2.21.0, 2026-10-11

Reviewed restored Brave iOS request_blocking.ts/JavaScriptFeature/native tab bridge, Swift WebFilters managers, Rust bridge and WebKit download wrapper. Brave's inspected request-blocking adapter injects in page frames and invokes original fetch/XHR after a native decision; no complete legacy-protocol HTTP-worker cookie/cancellation solution was found. The page-download helper keeps the native web-view session and completes once on cancellation, but is a download API rather than an all-resource interceptor. The useful engine pattern is a serialized ready-state cache, detached candidate construction, newest-group validation and continued use of the existing engine. Do not copy Brave's 60-second batching delay, first-party exemptions or full-permission mask into our uBO host.

Applied this pattern to the existing pinned full-uBO engine, not a replacement Rust matcher: persist its upstream toSelfie state with typed-array/Map/Set/RegExp reconstruction; validate host format, upstream selfie version and exact bundled engine/PSL fingerprint. Restore directly from the ready snapshot; corrupt snapshots fall back to compiled records, and incompatible caches rebuild from source. Each candidate owns a separate JSContext, serial queue and weakly held timer bridge; optimization and serialization finish before publication so the active decision queue remains responsive. Main-queue generation checks publish only the newest candidate. Failed candidates retain the previous engine; replies queued on a retired engine reevaluate on the installed one. Runtime loader now discards obsolete preparation replies before updating summaries or compiling page helpers.

Requested checks: Node full-core precedence, exceptions, modifiers, fresh-VM snapshot/corrupt-format fallback, strict-document cases, fetch/XHR lifecycle and classic/module/nested Blob-worker harnesses passed. New scripts/check-ublock-network-runtime.py extracts the actual production Swift class, changes only its cache directory, builds a disposable macOS JavaScriptCore bundle and verifies cold/snapshot/compiled-fallback branches, responsive old-engine matching during a 25,000-rule candidate, newest-generation wins and failed replacement retention. With --full, the bundled list plus one synthetic rule measured 1,981 ms cold, 163 ms snapshot, 404 ms compiled fallback in the last local run; these are single macOS fixture observations, not TV benchmarks or complete page-startup times. A Node/V8 comparison had slower JSON snapshot restoration than compiled records, so performance claims are explicitly JavaScriptCore-specific.

Final Debug 2.21.0 Simulator build, install and launch succeeded. The actual Simulator startup log confirmed network available=1, filters=230765, cached=0, snapshot=0, prepare-ms=2053, error=0 on first cache creation. A follow-up Simulator launch confirmed network available=1, filters=230765, cached=1, snapshot=1, prepare-ms=493, error=0: ready-engine preparation decreased from 2,053 ms to 493 ms. This measures engine preparation, not total app or website startup, and is not a physical-TV benchmark. No native app UI/physical-TV interaction was verified in the optimization delivery, no physical TV or Git remote push. Changelog remains one unreleased 2.21.0 entry, with the cache/background-rebuild changes merged into its existing startup fix.

### Reference-first roadmap work and navigation rule explanations — unreleased 2.21.0, 2026-10-11

User requested inspecting existing browsers before implementing uBlock roadmap stages and recording that instruction in AGENTS.md. Added a durable reference-first instruction. Targeted Brave iOS request_blocking.ts inspection still shows boolean native request decisions with original allowed fetch/XHR transport, not replacement-resource delivery. This does not establish that every Brave platform lacks redirects. Avoid inventing a new transport solely to fill this gap; general redirect/surrogate delivery remains pending.

For the decision-diagnostics substage, reused the pinned uBlock traffic.js pattern: its shouldStrictBlock returns the winning decision and logData together and passes logData.raw to the blocked-document explanation. The host previously discarded that data. Retain the winning raw filter for main-frame matches; use the upstream firewall/URL engine toLogData for dynamic decisions. Do not read the static engine's final probe after strict precedence has selected another result. The existing native alert displays that rule (maximum 512 UTF-16 units plus ellipsis); no visited URL, rule text or dynamic URL is added to console logs or page bridge replies. Existing active-tab, document/policy generation, bounded reply and site-exception guards remain in force. Rule text is reconstructed upstream syntax, not exact original list/line attribution. No temporary bypass or surrogate networking added.

Verification: network matcher checks and strict-document checks passed, including 16 precedence combinations, winning explicit/generic filter attribution, important/exception selection, dynamic host/URL rules, noop fallback, rejected strict probes, ready snapshot restoration and absence of reconstruction on ordinary resource matches. The fixture uses supported wildcard dynamic URL type; upstream rejects main_frame as an explicit dynamic URL rule type. Debug 2.21.0 build/install/launch on Simulator succeeded. Actual dialog display/focus with a real blocked navigation was not observed; no physical TV or Git remote push. Changelog stays consolidated at unreleased 2.21.0.

Optimization commit: `ccd79c3`. Winning-rule explanation commit: `bb849f8`.

### Scope acceptance and final delivery — 2026-10-11

The user accepted finalizing the delivered scope at 2.21.0 and deferred broader adapters to the roadmap. Both Debug and Release MARKETING_VERSION were checked as 2.21.0; the requested final Debug Simulator build, ready, installation and launch stages succeeded. No new runtime changes or application tests were needed for finalization; no physical TV or Git remote push occurred. Commit: `b9d7f37`. Earlier fixture/live evidence keeps its original scope and does not prove the still-unobserved dialog/policy/CSP cases.

## HTTP(S)-worker research and browser references — 2026-10-11

### Native HTTP-worker prototype — 2026-10-11

Continue from the detailed HTTP-workers handoff, not repeated Inspector input. Read-only runtime selector checks established legacy custom-protocol registration on the installed Simulator. A disposable WebExtension construction probe crashed and was stopped; use a separate UIKit fixture for the alternate custom-protocol path. The synthetic HTTPS worker kept its original URL and relative import, allowed fetch/XHR and rejected a request blocked by the actual shipped full matcher. Synthetic cookie transport is not faithful yet; the real Browser adapter is not enabled. Record the full evidence and open cookie/context/cancellation/redirect boundaries in plans/ublock-http-workers-handoff.md. The isolated test app has no Browser history/cookie store and is removed after its runner finishes. No physical TV or Git remote push.

### Native-host fidelity matrix — 2026-10-11

Extended the disposable fixture rather than enabling global HTTP(S) registration in Browser. Both nonpersistent and persistent stores of the isolated test bundle produced the same cookie gap: the WK cookie store contains worker_probe, intercepted requests lack it, and synthetic Set-Cookie does not enter WK storage. Persistence mode therefore does not fix the prototype. Credential intent survives: HTTPShouldHandleCookies is false for omit and true for same-origin/include in this same-origin fixture. No cookie values or Browser storage were read.

Confirmed in two fixture runs:
- Classic HTTP worker location and relative importScripts retain original HTTPS URLs.
- Module worker import.meta.url and static dependency retain original URLs; allowed module fetch succeeds.
- Nested HTTP worker location and allowed fetch succeed.
- Worker response CSP connect-src none rejects a forbidden fetch with TypeError before it reaches NSURLProtocol.
- Synthetic 302 redirect reaches its allowed target; another redirect to a static full-core blocked target rejects TypeError. Real-server redirect/authentication/referrer rules are still unverified.
- Abort returns AbortError to worker JavaScript. The delayed protocol still delivers its response; stopLoading arrives after delivery. JS rejection does not prove transport cancellation. The fixture reports transportCancellation=false separately rather than claiming success.

Fixture improvements: serialize matcher-result snapshots with its queue, guard protocol callbacks against stopLoading, distinguish early transport cancellation from normal completion, and preserve timeout output without automatic retry. Runner supports --persistent, uses only its own app/store, removes the test app, and records mode-specific ignored logs. Final Browser 2.21.0 launch succeeded after research. Changes are research harness only, no production behavior or changelog increment.

Production gate remains cookie/storage/credential fidelity, trustworthy frame/type/store attribution and transport lifecycle. Do not solve it by indiscriminately copying every WK cookie into a global request header or claiming the successful synthetic matrix proves ordinary-site compatibility. Shared/service worker coverage and real-network TLS/CORS/partitioning remain unverified.

### Prototype disposition and reference integrity

The HTTP-worker prototype (`bef26f9`) and fidelity matrix (`4016321`) were research-only; no production custom-protocol adapter was enabled. Reproduction: `scripts/check-ublock-http-worker-host.m` and `.py` (`--persistent` for the disposable fixture). After browser-reference review, the user accepted native WebKit fallback for HTTP(S) workers. Cookie/storage transfer and real transport cancellation remain unshipped defects; successful identity/import/CSP/redirect fixtures do not establish real-network TLS/CORS, partitioning, authenticated traffic, reliable frame attribution or Shared/service-worker equivalence. Full-core page/navigation and supported Blob adapters remain separate delivered paths.

Brave reference cleanup reduced 30,625 files / 731.58 MiB to 1,002 original files / 9.56 MiB; 29,623 irrelevant files were removed. Retained SHA-256 hashes and both root licenses passed integrity checks. The manifest is `.data/brave-reference-pruning.json`. The initial slice lacked iOS modules. Later, seven missing trees were restored from the unchanged complete Downloads extraction/archive: BraveShields, BraveShared, Data, Brave/WebFilters and native ios/browser, ios/web, ios/web_view. All 1,077 copied original files passed SHA-256 checks. Waiting-for-source instructions were therefore obsolete. `REFERENCE_SCOPE.md` documents the slice; the exact Brave archive commit remains unknown, and the slice is not a buildable checkout.

Targeted Firefox ContentBlocker used WKContentRuleList. Targeted Brave request_blocking.ts/JavaScriptFeature/bridge checked page fetch/async XHR and invoked the original allowed transport. Its WebKit download wrapper retained native session/cancellation but was not an all-resource interceptor. No faithful custom-protocol worker cookie/cancellation solution was found in those files; this is not a claim about every Brave platform. Brave's ready-state caching/background replacement pattern was adopted above; its 60-second batching, first-party exemptions, broad permission mask and Rust matcher were not copied.

Firefox iOS reference revision: `371a1b51c54645dbcbd7ad41d1479c7a9e5850f8`; the reduced `.references/firefox-ios-research/` preserves core source and provenance in FIREFOX_IOS_IFRAME_RESEARCH.md. Firefox TV is an archived Android/Fire TV reference with no established commit, not a tvOS engine. Source, UI resources, tests, architecture and licenses were retained; unrelated CI/translations/release tooling were removed.

Optional reference-graph work was authorized historically, but no graph update is implied by later code/reference edits. Structural/inventory helper details remain in the ignored graphify-out scripts. AST parsing is partial; token savings against targeted-source workflows were not measured.

## JavaScript, input and cookies

### 2026-10-10 — First asynchronous WebKit stage

Version 2.18.22 follows the completion result/error pattern in the local Firefox iOS WKWebViewExtensions.swift and MetadataFetcherHelper.swift at revision 371a1b51c54645dbcbd7ad41d1479c7a9e5850f8. Add a runtime-adapter API whose reply runs on the main queue exactly once, with a two-second asynchronous deadline. Track document generations across explicit loads, reload/history commands, provisional/committed navigation and web-process termination; changed generations, runtime identity or URL produce cancellation instead of delivering old data. No Firefox source was copied and content worlds were not changed.

Move media diagnostics presentation, fallback media pause and YouTube page configuration into completion flows. Preserve the order of YouTube configuration parsing and network extraction. Check the originating active web view, document generation and URL before delayed diagnostics or extraction completion can present UI/playback. Preserve no-page and failed-diagnostics feedback; suppress cancellation UI. Accepted scrolling constants and remote input are unchanged.

Scope: this completes the first staged migration discussed with the user. The legacy synchronous JavaScript method remains for DOM interaction; cookie collection/restoration and the DOM video-activation polling loops remain subsequent stages. No website-data fallback, storage path or retention changes were made.

Review: inspect the source diff, migrated call sites and remaining synchronous references; run git diff --check. No build, tests, simulator/device launch or interaction checks were requested or performed. The optional graph was not updated. Runtime responsiveness and delayed-result behavior was not observed in this stage. Plan: plans/async-webkit.md.

Following the user’s deployment request, the Debug build succeeded with unchanged automatic signing, and version 2.18.22 was installed and launched on the test Apple TV. No interaction tests were run; asynchronous diagnostics, media pause and stale-result behavior was not observed in this stage. The user clarified that agreed code changes in the ongoing roadmap work should include test-TV build, installation and launch without another reminder; that authorization applied to the then-active TV session, not to later revoked work.

### 2026-10-11 — Asynchronous WebKit operations and script registration (2.22.0)

The user prioritized the asynchronous-operations and managed-scripts roadmap items before continuing the full network engine. Remove BrowserPumpRunLoopUntil and the synchronous JS/cookie APIs. Convert DOM hit testing, target-blank handling, click sequencing and editable field collection to callbacks. Scale cursor coordinates inside the DOM request instead of a separate blocking innerWidth query. Fetch title, placeholder, value and submit metadata in one request. Apply document/URL/runtime cancellation and asynchronous timeouts to both JS entry points; check active tab, overlays and selection generation before delayed native actions. Guard Done/Submit against document changes. Keep the accepted iframe website-player bridge and event sequence.

Fetch, archive and restore cookies asynchronously. Preserve the stored archive on fetch failure; protect saves with a short application background task and save-generation checks. Restore the legacy archive at startup only, rather than overwriting the live persistent cookie store on every foreground/active callback. Gate initial loadRequest asynchronously until restoration completes (bounded at two seconds); no nested run loop or main-thread wait. Pending writes continue after a restoration timeout. Native WebKit storage paths and browsing history are unchanged. VLC requests and torrent imports handle cookie-fetch failures explicitly.

Register scripts under diagnostics, interaction-media-fullscreen and ublock components in a fixed order. Updates replace owned components rather than identify scripts by source prefixes. Centralize script construction with explicit timing, frame scope and optional named WKContentWorld capability checks. Retain page world for diagnostics that intercept site storage and the coupled interaction/media/fullscreen bridge that exposes page APIs and relays frame messages. Retain the named isolated uBlock world when runtime selectors are available; do not silently relocate page-dependent scriptlets. Physical runtime capability and separate extraction of the coupled bridge are not claimed verified.

Final Debug 2.22.0 Simulator build, install and launch succeeded. Source review found no remaining BrowserPumpRunLoopUntil or synchronous JS/cookie callers. No automated tests or remote/text-input/playback interaction checks, Release build, physical-TV delivery or Git remote push. Network integration was a separate subsequent stage.

### 2026-10-11 — JS lifecycle stage 1, 2.21.13

Confirmed stale-result hazards when same-document URL or selected tab changes A→B→A. Added an independent UI JavaScript epoch for tab selection and invalidated document results on URL KVO before queued replies execute. Network request lifecycles are not canceled by tab selection. Text dialogs now retain a token and original connected DOM element, rejecting replacement nodes, newer prompts and obsolete tab/document epochs.

Verification: nine native regression cases using extracted production Objective-C methods, deterministic runtime doubles and tvOS 18.2 Simulator Foundation passed: normal/duplicate delivery, document change, URL ABA, tab ABA, Back, Forward, Stop, timeout and late reply. Four production-JS prompt-body fixtures passed in Node: ordinary input/events, disconnected target, newer prompt and contenteditable. These do not establish full UIKit or real WKWebView interaction behavior. Debug 2.21.13 built, installed and launched on Simulator; no physical TV or remote Git push. Cookie archive compatibility was reproduced separately and fixed in the following cookie stage.

Firefox iOS local reference: BrowserKit/Sources/Shared/Extensions/WKWebViewExtensions.swift uses completion-based evaluation and explicit content worlds; Client/TabManagement/Tab.swift getSessionCookies uses the asynchronous native cookie store. This is source comparison to the retained snapshot, not a claim about current upstream.

### 2026-10-11 — cookie lifecycle stage 2, 2.21.14

The actual cookie archive produced by archivedDataWithRootObject:requiringSecureCoding:NO was rejected by the secure convenience decoder with NSCocoaErrorDomain 4864 because NSHTTPCookie does not adopt NSSecureCoding. Reproduced on macOS Foundation and tvOS 18.2 Simulator Foundation using synthetic fixtures and extracted production methods. Restore now uses the matching NSCoding decoder, validates the root array and every cookie, and handles malformed archives before opening a write batch. Storage paths, archive key/format and retention remain unchanged.

Full native harness passes with deterministic runtime/cookie-store doubles on Simulator: JS lifecycle guards, cookie read timeout/late reply/duplicate completion, archive properties including Secure and HttpOnly, restoration gate ordering, real production loadRequest waiting and latest-request-only delivery, bounded missing write completion, late completion and empty/corrupt/wrong-class archives. Four production prompt-body Node fixtures also passed in stage 1. These tests do not access personal cookies or establish actual website sign-in persistence. Debug 2.21.14 build/install/launch succeeded on Simulator with the original Example site D URL. CUA getScreenshot and Safari getApp calls returned timeoutReached, so no current visible page, UIKit prompt, actual tab-history or cookie-relaunch observation is claimed.  No physical TV work or Git remote push.

Follow-up observation: user reported Back/Forward, tab return and field editing seemed normal on 2.21.14 and opened the Simulator console. CUA access recovered; Simulator screenshot showed the requested Example site D page rendered. Inspector showed native content-blocker reports, one unhandled TypeError at UBlockRequests.js line 71 (the explicit fetch-blocked rejection), the previously confirmed external fullscreen.js/player_down.js top-level-return SyntaxErrors, blocked preroll fetch/XHR followed by VAST errors and eventual Playerjs playOk/fullscreen transitions. No RangeError or new lifecycle failure appeared in this observed console. This is one page/session and a user smoke-test report, not comprehensive lifecycle stress or signed-in cookie persistence verification. No raw URL parameters or cookie data retained here.

### Cookie restart investigation deferred — 2026-10-11

The user chose to defer the remaining cookie investigation and resume uBlock worker work. A live httpbingo fixture confirmed Secure/HttpOnly session cookies, persistent cookies and JavaScript-set persistent cookies before restart. After a forced process restart, the session fixture was absent while both persistent fixtures survived. This does not establish behavior after normal backgrounding, nor real account authentication persistence; no signed-in account was verified. No history-loss or app-crash evidence was observed in this investigation.

An uncommitted cookie-store observer candidate passed controlled harness cases but did not fix the live session-cookie restart fixture. It is not a delivered fix. Its tracked patch and harness are preserved privately in `.data/cookie-lifecycle-deferred/`; the candidate was removed from the source and the app version restored to 2.21.14. Do not publish cookie values or private diagnostics. Revisit native store snapshot/archive timing before proposing another fix. The earlier diagnostic claim that the observer was inactive was incorrect: a pointer-to-BOOL cast caused that reading; subsequent inspection confirmed it was registered.

### Example site D external script SyntaxError diagnosis (2026-10-11)

Simulator Safari Inspector reports Return statements are only valid inside functions at line 2 of templates/common/ajs/fullscreen.js and templates/common/ajs/player_down.js. Same-origin diagnostic fetches returned HTTP 200 and showed both files beginning with an isES6 guard containing a top-level return, followed by an IIFE. Independent direct HTTPS downloads outside tvOSofaBrowse and its filtering returned the same invalid leading guard; parsing each downloaded file as a classic script with Node vm.Script (without executing it) failed with SyntaxError: Illegal return statement. The invalid return is a parse-time error regardless of whether the guard would execute. This establishes an upstream source syntax defect, not a fetch/XHR or async-JS regression. Do not rewrite arbitrary website responses or suppress errors to hide it. No app code, version, build, commit, Simulator delivery or physical-TV work was needed for this diagnosis. Downloaded sources remain temporary and untracked.

### Consolidated live-console interpretation — 2026-10-11

Repeated Example site D console reads showed the independently confirmed external fullscreen.js/player_down.js top-level-return errors, blocked advertising/reporting resources, and TypeError at the intentional blocked-fetch branch. Later reads showed Playerjs playOk, seek and fullscreen transitions without a new RangeError or cache failure. These observations support the specific page/player session; they do not establish all policy decisions, broad lifecycle/CSP correctness or signed-in cookie restart persistence. Older “no live observation yet” comments in the initial delivery stages were superseded only to this scoped extent.

Tool limits: on-screen Simulator Remote and ineffective Escape paths were stopped. Inspector CUA sometimes timed out; user-assisted console input later produced eight worker messages. An initially absent AX/screenshot result was incorrectly classified as nonexecution; later output corrected that claim. Potentially pending commands were not safely repeatable. The archive-observer “inactive” diagnosis was also corrected: a pointer-to-BOOL cast caused the reading; registration was subsequently confirmed. The observer candidate still failed the live restart fixture and was removed, as recorded above.

## Website playback, unified controls and shared VLC

### Unified-control development sequence — 2026-10-11

| Artifact | Result or reversal |
| --- | --- |
| 2.19.0 | Native glass panel over website iframe playback; authenticated all-frame command relay, Media Session/local-video fallback, sanitized progress and seekable bounds, 500 ms polling only for active fullscreen, generation/session cancellation |
| 2.19.1–2 | Pause/cursor visibility experiments; five-second interaction reveal. Later suppress cursor/magnifier while native controls are active, use native focus and restore pointer handling on exit. Previous/Next stayed enabled; synthetic media keys failed to reproduce hardware behavior |
| 2.19.3 | Speaker track switching led to MRMediaRemoteSendCommandToApp NextTrack 4 / PreviousTrack 5 with NULL application/origin; WebKit's Now Playing client may be its GPU process. No second JS command after ambiguous native submission. User confirmed track switching; Next played immediately and Previous retained the site's paused state |
| 2.19.4–9 | Separate Beginning from Previous; short ±5/±10-second seeks, held repeats at twice the short interval and ten-second-button repeats increasing from 20 to 40 seconds after ten seconds of holding; shared native vector symbols, endpoint Previous/Next, Back/Menu exit instead of Close; final central buttons 81.6 points on an aligned stack |
| 2.19.10–14 | Near-end margin changed from 2 to 5 to 1 second; temporary VLC End removal and mute addition. These intermediate choices were later superseded by retained VLC Beginning/End and right-edge track selectors |
| 2.19.15–17 | Volume ±0.1 for iframe and ±10 VLC; player-volume percentage, independent mute; audio group separated from main-row centering, mute between volume buttons and 34-point gap |

All of these recorded Debug builds/installations/launches succeeded on the then-authorized test TV. Source/whitespace review was recorded where applicable; no automated app tests or complete visual/interaction check was performed per refinement. Preserve the specific later user confirmations rather than treating delivery as interaction proof. The stock icon image stayed ignored and was not packaged; BrowserPlaybackSymbols.h rendered vector primitives.

MediaRemote primary references: [WebKit MediaSession helper](https://github.com/WebKit/WebKit/blob/main/Tools/TestWebKitAPI/Tests/WebKit/WKWebView/MediaSession.mm), [ABI/constants](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/PAL/pal/spi/mac/MediaRemoteSPI.h), [command listener](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/cocoa/RemoteCommandListenerCocoa.mm). Source confirms the route, not every tvOS symbol or player interaction.

### 2026-10-11 — Diagnose muted episode transitions and allow playback without a new DOM gesture

The user reproduced the loss of sound on the test Apple TV after Go to End in Example site C’s embedded PlayerJS player. Safari Web Inspector recorded playRejected with NotAllowedError, muted=false and volume=0.8, followed by volumechange with muted=true and volume=0. The inspected player source retries rejected playback by invoking its own mute action and setting video volume to zero. Ad resources were also blocked, but their causal role was not established; the directly observed trigger of the audio change was the playback rejection. A focused JS harness confirmed our near-end command preserves muted and volume and sends duration minus five to seekto.

Version 2.19.13 configures each runtime WKWebView with mediaTypesRequiringUserActionForPlayback=0 before initialization. The installed Xcode WKWebViewConfiguration header identifies zero as WKAudiovisualMediaTypeNone. This is independent of website host or player family and leaves website mute decisions intact. Add Debug-only inspectability and temporary all-frame audio diagnostics containing numeric playback state and a restricted error-name enum; do not log media URLs or page content. User authorized Safari’s developer menu and remote inspection, and asked to use Safari only for a concrete diagnostic purpose. Defer any player postMessage-first fallback while resolving the audio bug.

Validation: Debug 2.19.13 build, installation and launch succeeded on the test Apple TV. The user confirmed that the next episode starts with sound after Go to End. Temporary all-frame audio diagnostics were then removed, and the clean Debug 2.19.13 build, installation and launch also succeeded; Debug inspectability remains available.

### 2026-10-11 — Preserve domain player volume (2.19.18)

Store player volume in app preferences using the top-level HTTP(S) host, shared with the existing page-zoom host normalization. Retrieve it for each fullscreen iframe session before polling video state, forward it through the existing validated frame chain, and apply it once per session/video/source, with metadata changes allowing reapplication. Request immediate state after volume-button commands. Save valid observed volume without repeated identical preference writes. Native AVPlayer starts with the same page-host level and saves it when closing. Mute remains independent; torrent VLC has no page domain and is outside this preference.

Verification: final Debug build succeeded; version 2.19.18 was installed and launched on the test Apple TV after explicit user confirmation. The initial deploy attempt was rejected by automatic approval review because recorded standing permission was not accepted as direct authorization. No tests or playback interaction checks were run. Domain, episode and fullscreen-transition behavior was not observed in this stage on TV.

### 2026-10-11 — Scoped clearing confirmations (2.20.0)

Add a native confirmation to each main-menu Clear Cache, Clear Cookies and Clear History action with This Site, All and Cancel. Capture the page URL before presenting the dialog, disable This Site outside HTTP(S) pages, and avoid reloading a different document if navigation changes during asynchronous clearing. History deletes matching host/subdomain visit identifiers through the existing transaction and backup mutation path; Favorites and session data remain intact. Cookies use normalized domain-boundary matching, including parent-domain cookies. Cache deletion uses WebKit data records scoped to the matching website domain, which WebKit groups using the public suffix list; it may include sibling subdomains. Scoped cache removal never falls back to global clearing.

The user also requested that a relevant clearing action reset app-owned site data. Clear Cache now removes saved host volume and page zoom, resets matching live web views to 100% volume and zoom, and removes matching tab previews from memory and disk. Invalidate pending snapshot callbacks and thumbnail reads so stale previews cannot repopulate the cleared cache; serialize disk removal with thumbnail writes. Global browser settings, history, Favorites, tabs and torrent payloads remain untouched. Reloading/using pages may generate fresh previews.

Verification: final Debug build succeeded, and version 2.20.0 installed and launched successfully on the test Apple TV. No tests or data-deletion interaction checks were run. The initial device delivery was rejected by automatic approval review because it treated the prior confirmation as limited to the volume change; the user then explicitly authorized installation and launch of this and subsequent changes immediately on TV. This historical authorization was later revoked. Confirmation focus, selective clearing and reset behavior were not observed in that stage.

The subsequent user report confirmed 2.19.18 volume persistence across fullscreen transitions on TV.

### 2026-10-11 — Remove separate native fullscreen web player (2.20.1)

Following the direction decision, the user explicitly requested removal of the separate native fullscreen player and its menu setting, retaining unified media commands and the already bundled VLC torrent player. Remove BrowserNativeVideoPlayerViewController, BrowserNativeVideoAssetLoader and BrowserVideoPlaybackCoordinator from source and the Xcode project; remove Full Screen Player, its preference/model/host interfaces, and the AVPlayer path that intercepted page selection. Remove AVPlayer-only global remote touch/press interception and unused DOM media-URL extraction/activation helpers. Retain normal global browser menu/select notifications, website media bridge and shared fullscreen controls, and torrent VLC without changing its implementation. The removed preference key may remain inert in older installations; do not perform a broad preferences reset.

Verification: the final Debug build succeeded, and version 2.20.1 installed and launched on the test Apple TV under the explicit standing permission for subsequent changes. Targeted source reads found no remaining references to the removed classes, option or playback setting in _Project. No tests or playback interaction verification were run.

### 2026-10-11 — Shared VLC and Safari diagnostics (2.21.0 / 2.22.0)

At the user's request, rename the torrent VLC controller to BrowserVLCPlayerViewController and reuse it for accessible HTTP(S) web video on fullscreen. Center on a standard controlled video requests the same container to address the reported unresponsive MDN native widget. Preserve web time, saved containing-domain volume and mute; pass final state back only to the originating video/document. Retain website/unified controls for unsupported sources. Remove external VLC handoff, its file action, keep-alive dependency and URL scheme query; retain the internal torrent range server.

The user requested browser-wide diagnostics and then chose Safari Web Inspector over a custom HTTP channel. Remove the intermediate HTTP diagnostic listener and additional collector from the resulting source. Gate runtime inspectability by both DEBUG compilation and the existing Debug switch, including changes on open pages. Create the local safari-tv-debug skill with an open_url.py helper; the helper launches the already installed Debug app with BROWSER_OPEN_URL and no server token.

Build/install succeeded for 2.21.0 and final 2.22.0 Debug artifacts via the test deployment workflow. Final launch with the original MDN native-controls URL succeeded. Read the existing Debug preference privately: ON. Safari Develop exposed browser targets on the paired TV, including the MDN page; selecting a nested page initially returned AXError.invalidUIElement, and the user navigated the TV page afterward. Do not claim a full Inspector session or working video interaction from this evidence. No application tests or Release build were run. The initial skill validator lacked PyYAML in the default Python; that environment also lacked PyYAML, so validation succeeded with an isolated `uv run --with pyyaml` environment.

After final build/install/launch, the user said “на тв поки не пушим”; cancel standing automatic deliveries in AGENTS.md and apple-tv-deploy. Later device work required new user authorization. Retain all personal preferences and launch diagnostics only in ignored local storage.

### Simulator delivery follow-up

At the user's subsequent request, build 2.22.0 Debug for the 1080p tvOS 18.2 Simulator with signing disabled. Build succeeded; the new local scripts/push-to-simulator.sh then successfully installed and launched the artifact with the original MDN native-controls URL. The Simulator screenshot visibly showed the page, its standard audio controls and rabbit video poster; no playback or remote interaction was checked. Add deploy/build/install/launch modes, launch overrides, simulator selection, Debug --url and private stage logs to the script, and document it in apple-tv-deploy and the simulator runbook. These local workflow/documentation changes do not increment the app version. Validate safari-tv-debug successfully through the standard validator with isolated PyYAML. Physical-TV deliveries had been revoked before this Simulator-only follow-up.

### 2026-10-11 — VLC controls after EOF (2.22.1)

The user reported that controls worked until the video's first completion. Read private simulator unified logs: VLC moved from Ended (3) to Stopped (0), then reported a fixed 6618 ms position with playing=0 for the 7800 ms MDN clip. The simulator screenshot showed the shared VLC screen with Playback finished. Safari Web Inspector does not expose this native player; use existing native [TorrentVLC] logs for it.

Latch EOF through the subsequent Stopped state and recreate the VLC player/input for replay, restart and seeks, reusing its media options and existing torrent server. Preserve volume/mute, defer target seeks until the new input is seekable, route held seeks through the same recovery, and ignore queued callbacks from a replaced player. Keep controls visible at EOF.

Final 2.22.1 Debug simulator build, install and launch with the original MDN page succeeded via push-to-simulator.sh. No physical-TV delivery, automated tests or Release build were performed. The user replied “чудово” during delivery; this alone is not a documented repeat-playback observation. Interaction verification remains separate from the successful build/launch.

### 2026-10-11 — Browser authentication context for VLC (2.22.2)

Add asynchronous native WebKit cookie retrieval, including HttpOnly cookies, followed by document-generation and VLC-session revalidation. Pass only unexpired cookies matching the media host/domain and path, excluding Secure cookies for HTTP and cookies on anonymous cross-origin video. Store them through pinned TVVLCKit's native VLCMedia storeCookie API before play; preserve the media context across the EOF recovery. Never pass cookie values to page JavaScript or log values.

Forward the video's own document URL, referrer policy and crossOrigin mode through the existing validated frame chain. Compute policy-aware Referer (strip user/password/fragment, omit downgrade where required, use origin for cross-origin default), and use the configured User-Agent. The pinned binary/API exposes cookies, User-Agent and Referer, not a generic arbitrary-header option; do not claim JavaScript Bearer/Authorization or DRM support. No new HTTP server is introduced.

Automatic approval review rejected a combined implementation/build/launch command because it interpreted the proposed forwarding as sensitive egress without a named destination. Complete the local code separately; simulator build-only succeeded. Approval then accepted the narrower install/launch on the already requested public static MDN page without initiating VLC playback or transmitting authenticated-site cookies. Final 2.22.2 Debug simulator install and launch succeeded. No physical-TV work, app tests, Release build or authenticated-source playback check was performed. Authentication compatibility on a real site is not established by these stages.

### 2026-10-11 — Iframe video source discovery and routing correction (2.21.1)

During the Ad Block work, the user reported that previous changes had incorrectly moved an iframe player into the native-video player/control path and asked to restore its previous behavior. Static source inspection identified the concrete route: enterFullscreen called requestVLCFullscreen in every injected frame; that function read HTMLVideoElement.currentSrc/src (or a source child), accepted HTTP(S), then forwarded browserTVVLCRequest through the parent frame chain to the native BrowserFullscreenMedia handler. A cross-origin iframe can reveal an accessible direct video URL from its own injected script even when its parent cannot read its DOM.

The user specifically requested that this finding be retained because obtaining the native video stream is interesting. Preserve the distinction: this is an available media URL read from the element, not a universal extractor or network interception. Blob/MSE and DRM are not resolved by this route. Cookie/referrer compatibility and stream playback are not established solely by obtaining a URL. A future explicit Open in VLC action could use this discovery if separately requested.

Restrict controlled-video/VLC requests to the top document, remove iframe VLC relay/response paths, and validate the video document against the native main-frame request. Iframe fullscreen remains in the website, using its existing media bridge and panel including Go to End; top-document direct video and torrents retain VLC. Final 2.21.1 Debug Simulator build, install and launch succeeded. No app tests, iframe interaction verification, Release build or physical-TV work. The reported behavior is user evidence; the cause and correction above are source findings, and restoration was not observed in this stage.

### 2026-10-11 — Retain website episode lifecycle in shared VLC (2.21.2)

The user reversed the temporary iframe routing correction and explicitly selected VLC for available direct streams. Add Previous/Next using retained source-frame Media Session handlers, with system-command fallback for unhandled actions; retain validation through the frame chain after leaving website fullscreen. Watch for a changed HTTP(S) media source for up to 15 seconds, revalidate the document/session and cookie context, then replace the media in the existing VLC controller. Add Go to End beside Play/Pause; retain Go to Beginning and torrent track behavior.

The user clarified the purpose: determine why automatic next-episode navigation stopped under VLC. Source inspection showed that accepting VLC paused the website HTML video and never notified it on native EOF. Add a one-shot EOF callback to the original video, restore volume/mute, seek to its final 50 milliseconds and request playback so WebKit can generate a genuine ended event rather than an untrusted synthetic event. Arm the changed-source watcher before this action. This is an implementation hypothesis, not an observed Example site C episode-transition fix. Playback permission, finite duration, iframe replacement/navigation and unchanged media URLs can prevent continuation.

The first 2.21.2 delivery exposed an unavailable advanced Ad Block runtime in the private simulator log. A targeted Node compilation diagnostic of the pinned uBO list found that generic extended filters queried a missing domain iterator. Guard this path with hasOptions(), regenerate the bundled parser, and compile the pinned input successfully: 6335 cosmetic, 7754 scriptlet, 2870 rejected advanced and 6415 network rules. These are compilation counts, not runtime match counts. The second 2.21.2 Debug Simulator build/install/launch succeeded. Native logs then showed a cosmetic-match source/line event; the requested Example site C page was visibly rendered in Simulator. Safari Web Inspector connected to that simulator page, showing blocked advertising resources and a missing source map, without establishing episode behavior. Automated app tests, Release build, physical-TV work and Git remote push were not performed. The user reported keyboard scrolling unavailable, then confirmed it worked; no scrolling code or speed changes were made. The subsequent user report below rejected the episode-continuation hypothesis.

### 2026-10-11 — Restore website iframe playback and retain failed experiment (2.21.3)

The user reported that neither the 2.21.2 EOF attempt nor Next switched episodes. Safari Inspector read the live top-page PlayerNextCustom/autoplayer functions and the site's PlayerJS finish/next handlers. The website owns the outer playlist and navigates playerfr to another episode; generic Media Session commands and a watcher in the old frame document did not cover that mechanism. A matching Series 1 → Series 2 playlist boundary was observed; no successful native transition was observed. A site-specific adapter and new-frame handshake were drafted, but the user explicitly requested return to the working website iframe mechanism without repeat tests before this approach was built. Remove that draft and the previous native EOF/track/source continuation experiment. Exclude iframe direct URLs from automatic VLC routing and validate native direct-video requests against the main document. Preserve the existing iframe fullscreen controls and source-site lifecycle. Keep the requested VLC Go to Beginning/End controls and move Audio/Subtitles to the right edge.

Final 2.21.3 Debug Simulator build/install/launch succeeded with the requested Example site C URL. No repeat playback checks, automated app tests, Release build, physical-TV work or Git remote push. Retain observations, hypotheses, boundaries and the unbuilt draft distinction in plans/iframe-vlc-investigation.md; do not present the failed EOF hypothesis as a confirmed fix or resume the experiment without a new request.

### 2026-10-11 — Restore iframe controls on the 2.20.3 baseline (2.20.4)

Following restoration of the working copy to 2.20.3, the user requested the iframe controls in this version. Limit direct-VLC opening/request publishing to the main document, remove iframe VLC relays, and validate native direct-video requests against the main frame document URL. Retain the existing iframe website player, fullscreen panel and site episode lifecycle without the advanced uBO implementation or the failed native episode-continuation experiment. Debug and Release MARKETING_VERSION become 2.20.4. Build, install and launch on the explicitly authorized physical TV succeeded via the deployment script under a system-only PATH, using the repaired grep marker check. No repeat playback tests, Release build or Git remote push were performed. This delivery did not verify the about:blank report; later navigation/preparation stages address it.

## Browser UI, tabs, scrolling and application maintenance

### New Tab appearance — 2026-10-11

Artifacts 2.18.27–30 replaced the card with a 144-point circular New Tab button while preserving collection footprint/navigation/accessibility and reuse behavior, then shifted it left by 40 points, another 32, and another 72 (total 144). The middle interpretation used half the plus glyph; the user clarified half the button diameter. Source/whitespace checks and each authorized Debug TV build/install/launch succeeded. No screenshot or direct visual interaction verification was recorded for the final placement.

### 2026-10-11 — Tab previews without background page loading

Version 2.18.25 removes web-view creation, staging, saved-page loading and inactive snapshot requests from prepareTabOverviewThumbnails. Refresh only the active page snapshot; retain snapshots captured on page completion and tab switching. Request a reduced WebKit snapshot and normalize it to 584 × 347 pixels. Serialize JPEG encoding, atomic cache writes, reads and removals on a background queue. Cache entries use validated tab UUID filenames and carry the page URL so a restored preview is accepted only for its saved page. Discard snapshot replies after document changes, web-view replacement or tab closure, and prevent concurrent snapshot requests for one tab. Do not let a delayed cache read replace a newer in-memory image.

Keep previews under the disposable Caches/TabThumbnails directory, outside the history and session stores. Remove previews when tabs close and prune orphaned entries after session restoration. Missing previews show the domain in the existing card thumbnail area, with the title and address below. Preserve the existing focus and remote controls. The previous good-image/black-image heuristic roadmap proposal remains separate.

Validation: source diff reviewed and git diff --check passed. Following the user’s explicit deployment request, the Debug device build succeeded with preserved automatic signing; the built artifact reports 2.18.25. Installation over the existing app and launch on the test Apple TV succeeded with devicectl. No tests or simulator interaction were run. Opening the overview after a cold launch, cached preview restoration and first selection of an unloaded tab was not observed in this stage.

At the user’s request, add the project-local apple-tv-deploy skill and link it from AGENTS.md. Record the successful incremental device build, artifact version lookup, installation and launch commands; keep local target identifiers outside tracked instructions and distinguish ordinary delivery from the existing profile-renewal script. The previously linked Apple TV runbook is absent in this checkout; the skill provides the confirmed delivery workflow without inventing backup or service-recovery procedures.

### 2026-10-11 — Five-minute inactive tab lifetime

The user chose a fixed five-minute inactivity TTL after switching to another tab, without waiting for memory warnings. Version 2.18.26 records an independent uptime deadline when each live WebView becomes inactive. Returning cancels its deadline; leaving again starts a new interval. Document load completion, snapshots and repeated attachment of other tabs do not refresh existing deadlines. A single timer scheduled for the nearest deadline runs in common run-loop modes. Invalidate the timer when the app resigns active and sweep expired entries when it becomes active again; tvOS suspension prevents a guarantee of executing the release at the exact deadline while suspended.

Before releasing an expired WebView, preserve navigation and scroll state, mark the tab for lazy navigation/scroll restoration, detach its delegate, invalidate pending snapshot identity, stop loading and remove it from the staging view and live-view dictionary. Keep the tab and its preview. Snapshot completions use weak WebView references and per-request tokens, so an old callback cannot retain an unloaded view or clear a new request. Guard delayed scroll restoration by WebView identity and document generation, and preserve saved offsets while restoration is pending instead of writing a recreated view’s initial zero offset. Expiry is checked before switching or closing tabs so an overdue destination is recreated rather than reused.

Validation: source diff reviewed and git diff --check passed. Following the user’s explicit TV delivery request, push-to-tv.sh deploy completed successfully: Debug build, artifact version 2.18.26, installation over the existing app and launch on the test Apple TV. No application tests or simulator interaction were run. TTL expiry, release behavior and restored interaction was not observed in this stage. Plan: plans/inactive-tab-ttl.md.

### Held arrow scrolling and touchpad behavior — 2026-10-10 (artifact 2.18.21)

Short presses already felt ideal, but acceleration and maximum speed felt sluggish. The smoothstep ramp changed from 2.4 to 1.2 seconds and maximum speed from 1460 to 1800 points/second; initial speed 560, hold threshold 380 ms, short steps and repeat behavior were preserved. The custom touchpad pan recognizer and release-inertia display link were removed, native page panning stayed disabled, and mouse/drag routing remained.

Initial source review had no build; a subsequent authorized Debug TV build/install/launch succeeded. After deployment, the user confirmed comfort and accepted the tuning, found release stopping comfortable, reported no continuing scroll after menus/tab switches, and considered opposite-direction input unnecessary. No exhaustive interaction test was performed. This supersedes the earlier awaiting-feedback status; no further tuning was accepted without a new concrete report.

### 2026-10-11 — Scroll from the pointer edge (2.23.1)

The user requested vertical scrolling when the cursor reaches the page's upper or lower edge, excluding fullscreen. Convert only outward movement beyond the visible scroll viewport into bounded manual vertical scroll delta; keep the pointer pinned to the edge and leave inward/horizontal movement as cursor movement. Reuse the existing manual offset clamp, without touchpad panning, inertia, timers or changes to accepted arrow scrolling. Sample touches in the stationary root view to avoid contentOffset changes feeding back into the next cursor delta. Exclude native dialogs, tab overview, New Tab, cursor suppression, Center/vertical-button holds and inactive application state.

Report the existing main-frame fullscreen bridge scope through its authenticated native handler, including emulated iframe fullscreen, standard document fullscreen and native video begin/end events. Preserve the player's API substitutions, command routing and website episode lifecycle. Expose readonly pageFullscreenActive for the remote host; reset it on new navigation/native start-page loads. Existing media-control/presented-player gates additionally exclude fullscreen input. Fullscreen scope events may be accepted during loading, while existing VLC/media updates retain the previous loading guard.

Final Debug 2.23.1 Simulator build/install/launch succeeded. Startup reported network available=1, filters=230765, cached=1, error=0, confirming reuse of the network-stage cache after this ordinary delivery. No automated tests, gesture/edge/fullscreen interaction observation, Release build, physical-TV work or Git remote push.

### 2026-10-10 — Per-domain page zoom

The user requested zoom within a domain instead of one global app setting. Version 2.18.16 stores percentages by normalized top-level HTTP(S) host in preferences; paths, schemes and ports share a host setting, while different subdomains remain separate. The old global PageZoomPercent value is left untouched but no longer used, since it cannot be attributed to a particular site. Unsaved hosts and app-owned blank pages use 100%. Menu actions read and update the current host, and Reset Zoom removes only that host setting. Web views apply the saved value on explicit load, committed navigation, completed redirects and history URL changes; the tab coordinator restores it on tab selection. The existing viewScale rendering and 50–200% bounds are unchanged. On the subsequent authorized deployment request, the Debug device build succeeded with automatic signing; version 2.18.16 was installed and launched on the test Apple TV. No interaction tests were run. Cross-domain navigation, same-domain tabs, redirects and relaunch were not observed in that delivery; the later user accepted the zoom behavior.

### 2026-10-10 — Remove retired browser experiments and recover WebKit crashes

Version 2.18.20 removes both fullscreen-hook files whose enable constants were NO, the WKWebView proof-of-concept controller and its unreachable menu action, and unused cookieHeaderValue, prepareWebViewLayoutForSnapshot:, and playVideoUnderCursorAction helpers. Following the user's clarification, also remove BrowserTorrentAssetLoader, its browsertorrent URL branch and torrent-only AVPlayer diagnostics; retain BrowserTorrentManager range reads and prioritization because the current VLC HTTP server uses them. Remove all corresponding Xcode source and group entries.

Forward WebKit content-process termination from BrowserWebView through ViewController to BrowserTabCoordinator. Reload only the active ordinary tab while UIApplication is active, using per-tab transient crash counters and monotonic system uptime. Allow two automatic reloads, saturate the counter at the third termination, and reset the budget only after 60 seconds without a termination. Successful navigation does not reset the budget, preventing a page that crashes just after finishing from creating an unlimited reload loop. Reuse the existing reload and saved-scroll restoration paths. Session serialization, website data, signing, and CURRENT_PROJECT_VERSION remain unchanged.

The bounded active-tab reload is inspired by Mozilla's Firefox iOS BrowserViewController+WebViewDelegates.swift; the local implementation uses a quiet interval instead of resetting the counter at its limit. Reference: https://github.com/mozilla-mobile/firefox-ios/blob/main/firefox-ios/Client/Frontend/Browser/BrowserViewController/Extensions/BrowserViewController%2BWebViewDelegates.swift.

Review: inspect the source diff and remaining references. No build, tests, simulator launch, or physical Apple TV work was requested or performed. No actual termination/recovery/scroll-restoration check was recorded for that source-only change.

### 2026-10-10 — Remove disabled YouTube extraction

At the user’s request, version 2.18.23 removes BrowserYouTubeExtractor.h/.m and all Xcode entries, the disabled native-extraction branch, lazy extractor, YouTube-specific cookie/header helpers and extraction-error UI. Remove the associated user script and finish-navigation hook that captured YouTube player requests through fetch/XMLHttpRequest, despite the native extractor being disabled. Preserve generic native video playback, general media pause behavior, asynchronous diagnostics and accepted scrolling. The user does not use YouTube in this browser and does not want this experiment retained.

The authorized Debug tvOS build succeeded with unchanged automatic signing. Version 2.18.23 was installed and launched on the test Apple TV. Inspect remaining references and run git diff --check; no interaction tests were performed. Changelog and roadmap updated; optional graph not rebuilt.

### 2026-10-10 — Reset All and Delete All torrents

The user requested Reset All beside the former Purge All and clarified that Reset must perform the existing single-torrent Reset for every entry, while Delete must remove torrent entries and their files. Version 2.18.15 adds the two confirmed actions to the library header. Reset All calls the asynchronous reset operation for each listed torrent and keeps the bulk buttons disabled until callbacks finish; Delete All uses the existing libtorrent-backed removal operation for each listed torrent. Both show a count in the confirmation and report failures. Debug device compilation succeeded with automatic signing; version 2.18.15 was installed and launched on the authorized test Apple TV. It also includes the Ad Block header focus change from 2.18.14. No destructive interaction tests or visual focus verification were run; neither action was interaction-tested in that delivery.

### Background-download observation and retention boundary

The user observed playback starting on Apple TV and one 2 GB torrent completing in about five minutes while video played in another app with experimental Keep Alive. This is one successful background session, not a guarantee of sustained tvOS runtime. Wider interruption/seek/restart/delete/cache behavior remains future validation in the torrent roadmap. Whether history survives reinstalling or rebuilding, beyond ordinary launches, was an unresolved local question; no retention/deletion change or proof was recorded during these sessions.

## Ad Block source/backend and native settings foundations — 2026-10-07 to 10

### 2026-10-07 — Broader Ad Block rules

The user reported missed casino ads and clarified that the improvement should cover advertising generally. An initial bundled AdAway snapshot and StevenBlack online source were superseded after the user asked to keep locally only rules unavailable online. The resulting implementation downloads the AdGuard DNS filter, which includes the advertising hosts seen in `.data/site3.html`; the initially empty `AdBlockCustomRules.json` is reserved for requested additions not covered by that online source. The downloaded filter is validated, stored in purgeable cache, checked weekly while Ad Block is enabled, and compiled into WebKit rule lists of up to 25,000 rules each. Hostname matching respects domain boundaries. Existing tabs switch to updated lists after compilation. WebKit prepares rules off the main thread and reuses compiled lists from its cache when available. Script-created windows targeting another host are suppressed; ordinary links and same-host windows retain their existing tab behavior. The custom file is bundled, so future edits require an app rebuild and installation.

The user's `.data/site3.html` sample contains outer-page advertising loaded from `franecki.net`, `franeski.net`, and `ad2the.net`, all present in the online AdGuard DNS filter inspected on 2026-10-07. Its `embed-a.example.test` iframe loads a separate PlayerJS page whose inline configuration includes VAST `preroll` campaigns. The user rejected a site-specific `if-domain` cosmetic rule, so it was removed. Existing community filters handle this type of pre-roll using response substitution or JSON pruning; this implementation does not interpret those advanced rules. The sample does not prove which of the two mechanisms caused the user's observed video ad, and no live playback was observed. The empty custom file intentionally avoids duplicating downloadable host rules or inserting an unverified player rule.

Verification: no build, tests, or website interaction checks were run because none were requested. No ad-coverage, online-compilation or website-breakage observation was recorded for the initial source change.

### 2026-10-07 — AdGuard filter conversion and settings

Added the SafariConverterLib v4.3.0 converter target and a small Objective-C bridge to convert AdGuard Base and Ukrainian source filters downloaded by the Apple TV. The upstream package's unrelated FilterEngine target uses a tvOS 16-only API, so the complete unmodified converter target and upstream license are stored in `_Project/Vendor/AdGuardConverter`; the local Swift package exposes only that target and preserves the app's tvOS 15.6 minimum. Its WebKit-compatible network and cosmetic rules join the existing DNS and bundled custom rules. Each source has a persistent on/off setting, a cache status, a weekly refresh, and an explicit refresh action. Holding Center on the existing Ad Block menu tile opens a native settings alert; a short Center press still toggles protection. Advanced rules that the converter routes to Safari extension JavaScript are counted in Debug logs but are not applied by this integration, since the browser has no Safari extension runtime. The user subsequently confirmed that the player ad disappeared in their test.

Verification: Debug device build passed with automatic signing, and version 2.18.2 was installed and launched on the authorized Apple TV. The player-ad disappearance was a subsequent user report; delivery itself did not verify all menu/download/playback behavior.

### 2026-10-07 — Live Ad Block filter status

The user confirmed the Ad Block long press opens settings and filters do refresh, but the popup stayed on "Updating" until reopened. Added a filter-status notification on each download start and completion and made the currently open settings alert rebuild its status message. Status includes cache time and distinguishes a failed refresh from a cached copy. Verification: Debug device build passed and version 2.18.3 was installed and launched on the authorized Apple TV. The user then confirmed this fixed the popup status and removed the video player's ad in their test, while some other ads remain below the video container. A later photo matched `.data/site4.html` for Example site D.

### 2026-10-07 — Remaining banner and broader online filters

The user's `private-screenshot.jpg` showed an Hraimo.com banner and a Telegram promotion below a player. The matching saved markup is `.data/site4.html` for Example site D, rather than `.data/site3.html` for Example site C. The ad slot is `.rek1`, with a third-party `embed-d.example.test` iframe and a first-party `/templates/common/ajs/player_down.js` fallback; the Telegram promotion uses `.telegram`. Current inspected AdGuard DNS, Base, Ukrainian, and combined Annoyances lists lacked a rule for the ad host or slot. A proposed local rule was removed when the user asked to avoid a site- or banner-specific fix for now; the bundled custom file remains empty.

The user requested all useful, reputable additional sources and said they would disable any that cause trouble. Added the official AdGuard Tracking Protection, Social Media, Mobile Ads, and combined Annoyances sources, each enabled by default and separately switchable in the existing popup. The combined Annoyances source already contains its five specialized lists, so those were not duplicated. URL Tracking depends heavily on unsupported parameter removal rules; Experimental can deliberately break sites; unrelated language and mail filters do not serve this TV browser. The SafariConverterLib integration still applies only WebKit-compatible rules, not advanced scriptlets.

Verification: version 2.18.4 passed an authorized Debug device build, was installed, and was launched on the Apple TV. No additional filter-download or remaining-ad interaction observation was recorded in that delivery. The user also directed that future tasks complete the build before documentation updates.

### 2026-10-08 — Ad Block source selection, settings, and Hraimo rule

After version 2.18.4, the user reported that the player ad returned and clicking video opened Rozetka, despite all seven sources showing as updated. The cause was not established on device; a downloaded source does not prove that WebKit compiled or applied its rules. At the user's direction, retained AdGuard DNS, Base, Ukrainian, Social Media, Mobile Ads, and Annoyances; removed Tracking Protection. Replaced the settings alert's separate status summary with a compact table that shows each source's on/off state and its declared filter version in the same row. The DNS source lacks a version header, so the row shows its last-modified date. Downloads and failures update in place. Changed compilation to retain successful rule lists when another source fails, report conversion or compilation failures, and keep downloaded source files for later retries.

The user later authorized a manual Hraimo rule without limiting it to one website. The bundled rule blocks third-party requests to `embed-d.example.test` and hides iframes bearing the Hraimo title or that source URL on any page. The saved Example site D markup provided that host and iframe title; its first-party ad-rotation fallback may still show another creative. No site-specific `.rek1` or Telegram rule was added.

Verification: version 2.18.5 passed the authorized Debug Apple TV build, was installed, and launched on the physical TV. The first build attempt failed because `UITableView.separatorStyle` is unavailable on tvOS; removing that assignment allowed the build to pass. At that stage, the user had not confirmed settings layout, filter application, Hraimo removal, or the Rozetka click behavior in the installed version. No interaction tests were run.

### 2026-10-10 — Reuse compiled Ad Block rules before conversion

Version 2.18.13 adds a small manifest for complete, successfully compiled rule sets. When the enabled sources, local filter revisions, bundled custom rules, and cache format match, the app looks up all compiled WebKit chunks concurrently and skips filter parsing and AdGuard conversion. A missing chunk or incompatible manifest falls back to the existing preparation and compilation flow; partial failures retain the existing per-source handling and are not saved as a complete cache. An explicit stable fingerprint identifies the cache across launches. Generation and signature checks discard results when source files or settings change during preparation. The first preparation with this cache format still runs normally. The bundled custom file remains part of the rules. This change targets repeated startup work; first navigation can still begin before rules finish installing. Initially reviewed the source without a build. The user subsequently requested deployment to the test Apple TV. The Debug device build succeeded with the existing automatic signing configuration, and version 2.18.13 was installed and launched on that device. No interaction tests or startup timing measurements were run; the user subsequently confirmed that the optimization worked on the Apple TV. This is a user-observed outcome without quantitative startup measurements.

### Settings layout corrections — 2026-10-08 to 10

Artifacts 2.18.6–10 narrowed Options by 50%, made Done a centered 200-point button, placed Update Filters Now left of Done, moved the master control into the heading, replaced the unavailable tvOS UISwitch/drawn switch with menu-style green ON/gray OFF badges, and put versions before right-edge filter badges. Browser-menu styling was preserved after the user clarified that the complaint concerned Options.

Artifact 2.18.11 incorrectly moved the panel up 108 points; 2.18.12 reversed that and increased height by 108 points instead. Artifact 2.18.14 replaced the badge-only heading with one focusable title/badge control to address poor focus visibility, superseding the earlier heading rule.

Artifacts 2.18.6–12 had successful authorized Debug TV build/install/launch; final visual/Center interaction was not observed for each refinement. 2.18.14 itself had no build, but was included in the subsequently delivered 2.18.15 artifact. The user later reported substantially improved blocking after lists loaded; this was not an exhaustive site/policy test. The Hraimo source and custom editor were subsequently removed during the uBlock campaign above.

### 2026-10-11 — Compact site toggle in Ad Block header (2.21.7)

The user requested This Site without parenthesized text immediately to the left of the Ad Block toggle. Add an optional caller-configured leading toggle to BrowserOptionsViewController, reuse BrowserBadgeToggleControl and the shared ON/OFF badges, and remove the site row. Preserve the remembered site exception including subdomains and its independence from the global switch. Refresh both header states on status notifications. Widen only dialogs with two header toggles to at least 640 points so the existing heading and readable controls fit; Debug keeps its existing single-toggle layout. Final Debug Simulator build, install and launch succeeded. No menu interaction/visual observation, automated tests, Release build, physical-TV delivery or Git remote push.

## Diagnostics, delivery and synchronization

### 2026-10-10 — Debug toggle and long-press options

The user requested the same interaction as Ad Block for the Debug tile. Version 2.18.17 gives Debug the existing menu toggle state provider, so Center changes the persistent diagnostics preference and refreshes its shared green ON / gray OFF badge without closing the menu. Holding Center uses the existing long-press handler to open the unchanged diagnostic options. The Tools layout remains unchanged. On the subsequent authorized deployment request, the Debug device build succeeded with automatic signing; version 2.18.17 was installed and launched on the test Apple TV. No interaction tests or visual verification of the Debug toggle were run.

### Shared Debug switch and options controller — 2026-10-10 (artifact 2.18.18)

Make Debug the sole diagnostic switch after the user chose to omit individual settings. Route app-owned console calls through a guarded logger; keep numeric recent-log storage guarded and derive website logging directly from Debug, avoiding a stale independent preference. Stop active background probes on preference changes and reject or cancel probe-only tasks when off while preserving actual transfers. Extract a configurable BrowserOptionsViewController shared by Ad Block and Debug, with caller-supplied header toggle title/actions, rows, badge/detail providers, an optional footer action and optional status notification. Keep future menu options on this shared screen rather than adding feature-specific modes. Keep saved reports readable when off and require Debug on for fresh media/WebKit inspection.

Validation: the final Debug device build completed successfully with xcodebuild. No tests or interaction verification were run. The final shared-options build was installed and launched successfully on the test Apple TV with devicectl. Remote focus and runtime log suppression have not been observed on the device.

### Debug report label constraints — 2026-10-10 (artifact 2.18.19)

Fix truncated Debug report labels: the previous attempt searched contentView constraints for widths, but label width constraints remained active on the labels themselves. Use explicit alternate title constraints, preserving the accessory layout for toggle rows and extending action-row titles to the trailing content inset. This also restores the correct constraints when cells are configured again.

Validation: the Debug device build completed successfully. No tests or visual interaction verification were run.

Deployment: installed and launched version 2.18.19 successfully on the test Apple TV with devicectl. The title rendering was not observed in this stage on TV.

### 2026-10-10 — Website diagnostics on demand

Version 2.18.24 gates website diagnostic polling, player message collection and storage wrappers behind the existing Debug preference. Keep only a lightweight setting bridge installed while disabled. Broadcast setting changes through frame messages, including cross-origin and nested frames; newly loaded frames request the current setting from the top document. Replace the diagnostics bootstrap for future documents while preserving every other user script. Stop the timer and player listener on disable, and restore storage methods only if they still point to our wrappers, preserving subsequent website replacements. Capture each wrapper's original method locally to avoid recursion when a website wraps our wrapper across toggles. Exclude storage key names and use error names rather than exception messages. Native log gates remain in place.

This is a separate change on the restored 2.18.23 codebase after the user stashed the full asynchronous DOM/cookie migration following a reported white screen. Do not attribute the reverted migration to this version. No page loading or cookie behavior was changed. The user clarified that the separate tab proposal concerned thumbnail loading; its subsequent implementation is recorded above.

Review source changes and run git diff --check. No build or interaction tests were requested or performed. No TV deployment was performed for that source-only change. Runtime switching and frame propagation were not observed in that source-only stage.

### 2026-10-11 — Debug launch URL for requested device pages

The user requested opening a page with ordinary HTML5 video on the test TV, then explicitly requested an agent capability to open arbitrary pages in Debug. Existing launch paths had no URL handler or launch-page override. Add a DEBUG-only BROWSER_OPEN_URL process environment parameter in ViewController after normal session restoration, accept HTTP(S) hosts, create a new tab, and suppress initial hints only when the requested tab was accepted. Existing tabs/homepage are preserved; Release excludes the code.  This is agent debugging support, with no product menu change or version increment.

The Debug build succeeded and installed on the authorized test TV. Launch with the MDN native-controls demo URL through devicectl; process launch success alone does not establish page rendering or playback. No automated interaction tests were run.

### 2026-10-11 — Validate local Apple TV delivery scripts

At the user’s explicit request, run 22 isolated scenarios against copies of push-to-tv.sh and build-to-tv.sh with stubbed Xcode/device commands and isolated profile-cache paths. Verify mode routing, Debug/Release selection, optional launch, invalid arguments, missing/wrong-identity artifacts, build/marker/install/launch failure stops, single attempts without retries, scheduled renewal skipping, successful renewal state updates, and profile rollback with unchanged renewal state after build or install failure. All scenarios passed; fixture checks did not access a real device or change real provisioning caches.

Then run the actual push-to-tv.sh deploy on the authorized test Apple TV. The Debug build succeeded, the artifact reported version 2.18.25, installation succeeded, and launch succeeded. No application interaction verification was performed. The skill triggers the scripts directly; their source was inspected for the specifically requested script testing, not as a prerequisite to ordinary deployment.

### 2026-10-11 — Delivery script without ripgrep

The user reported build-to-tv.sh stopped after a successful build because rg was not on PATH, before installation. Replace the build-success-marker check with absolute /usr/bin/grep in both TV and Simulator delivery scripts. Run the TV deploy with PATH restricted to standard system directories, excluding ripgrep; build, artifact check, installation and launch all succeeded. At this point the working copy was clean at 7416ee4 and MARKETING_VERSION 2.20.3, rather than the previously delivered experimental 2.21.3. The delivered artifact was Debug 2.20.3; no app interaction tests or Git remote push. The delivery did not establish recovery of the reported white about:blank page; the later navigation/preparation entries contain the observed recovery evidence. This local workflow fix does not increment app version.

### 2026-10-07 — Google Drive synchronization

The user selected Google Drive as a free file store for up to 100 MB of browser data, with all transfer work performed by the Apple TV app. They clarified that sync should be automatic and bidirectional, and reported that no Google TV OAuth client ID was configured at implementation time.

Implemented Google OAuth device flow with the `drive.appdata` scope, a Keychain-held refresh token, per-device Drive files, stable history record IDs, Favorite revisions, deletion tombstones, and remote tab browsing. Files are JSON and exclude website storage. Changes are synchronized while the app is active; tvOS suspension prevents a continuous background guarantee. The OAuth ID is supplied through ignored local signing configuration.

Verification: no build or tests were run, in line with the project instruction to run these only when requested. No Google sign-in or remote-transfer observation was recorded; the missing OAuth client ID was the concrete verification prerequisite.

## Documentation and workflow reconciliation — 2026-10-11

- `979fdf4` consolidated the unreleased 2.21 changelog; `dc5cc03` removed an obsolete patch-line instruction. Intermediate artifacts/evidence were preserved, without tags or remote publication.
- `b9d7f37` finalized current uBlock coverage; `a83b9e2` removed task-finalization history from AGENTS.md; `cd7098e` kept durable agent rules and moved local chronology/provenance out of the instruction files. At that stage, machine-local instructions and developer notes were ignored and were not part of those tracked commit payloads.
- The roadmap was reduced to current proposals, deferred adapters and concrete validation work. Completed JS/worker/cache stages, deliveries, rejected experiments and stale “next” statements were removed from it; the missing TVOS_BACKGROUND_DOWNLOADS.md link was removed rather than treated as an available runbook.
- This history cleanup replaces duplicate full-file AGENTS/roadmap snapshots with the consolidated decisions, reference provenance and evidence above. No new app-code/version change, build, tests or deployment was performed. Current incomplete verification belongs in the roadmap/coverage matrix, not old awaiting-user status lines.

## 2026-10-11 — Branch stability before merge (unreleased 2.21.0)

At the user's request, coalesce native and extended-runtime preparation into one completion/reload; retain installed native rules on failed or partial replacements while allowing successful partial protection on a cold start. Do not cache a partial compilation as a complete successful policy. Keep the live document request token accepted until the next document commits; page-cache markers restore the cached document token. Background reloads check playback, dirty/focused inputs, native dialogs, foreground/window state and opaque iframe boundaries; defer to next navigation/manual reload when unsafe. Explicit preference changes retain intentional reload behavior. Queue Center clicks in order with captured point/document/URL/tab generation; release the queue on every callback/error and discard queued work across document changes or dialogs.

Two Debug Simulator deliveries succeeded; the second includes the final source refinements. Build, install and launch succeeded for 2.21.0. Source diff reviewed; no application tests, live input/playback/error-injection interaction verification, physical TV work, merge or remote push performed. The existing unreleased version is retained with matching Debug/Release MARKETING_VERSION. The user then authorized the three maintenance improvements as a separate next stage.

## 2026-10-11 — Ad Block service, candidate indexing and maintenance (unreleased 2.21.0)

The user expanded the request to all three review improvements. Extract shared lists/preferences, source updates, native policy compilation/cache state, runtime preparation and native application into BrowserAdBlockService; BrowserWebView retains document/script/UI lifecycle. Adapt hostname/entity retrieval from the local uBO cosmetic-filtering.js retrieveSpecificSelectors and scriptlet-filtering.js retrieve references; preserve broad generic/regex/ancestor candidates, path/exclusion matching and original order. The new lazy buckets reduce per-document rule-object materialization, not the shared WKUserScript source bytes; no timing/memory benchmark is claimed.

Add persistent extended-script snapshots with source/asset fingerprint and explicit generator schema, retaining the current successful snapshot and one predecessor. Network snapshots use the same bounded retention principle. Adapt native-store enumeration/removal from the retained Firefox iOS ContentBlocker.swift reference, preserving installed identifiers, policy manifests and in-flight work. Keep downloaded filters and website data outside cleanup. Add a standalone official-uAssets updater pinned to an explicit Git commit and retrieval date, preserving include/conditional order and licenses and recording input/output/license digests. Bundle its pin metadata for the Settings date. The existing uAssets content was not refreshed; exact legacy commit remains unknown.

At the user's fullscreen question, add another safe deferred-reload check on fullscreen exit; ongoing playback, edits and opaque iframes still defer. Track edits in all frames from document start, before Ad Block preparation. The Simulator build first exposed an incorrect Xcode path for the new pin resource; the log was inspected and the path corrected before the final delivery. Final Debug 2.21.0 build/install/launch succeeded. node --check accepted the maintenance script; git diff --check passed. No application tests, upstream retrieval run, live rapid-click/playback/failure-injection checks, cache retention measurement, Release build, physical TV work, merge or remote push were performed. Debug/Release MARKETING_VERSION remains the agreed unreleased 2.21.0.

The user's screenshot was a macOS Firewall incoming-connection prompt for Simulator Browser.app. The Simulator script uses CODE_SIGNING_ALLOWED=NO; changed reinstall identity is a plausible reason for repeated prompts, not an observed firewall diagnosis. TorrentHTTP binds loopback only; libtorrent also opens network listeners. Firewall settings were not changed.


## 2026-10-11 — TV recovery and extended compiler memory investigation

The user reported that Third-party Requests stayed at Preparing and that moving down through the main browser menu terminated the TV app. With explicit permission to read TV diagnostics, retrieve the fresh private jetsam report: Browser was frontmost and was killed for per-process-limit at 23:19:28 +0300, with 134,272 resident pages of 16,384 bytes (2,098 MiB). This is evidence of a memory-limit termination, not a menu exception stack trace or proof of a specific leak. No focus-handler change was made without evidence.

At the user's request, export master c4502da into an ignored isolated source directory, reuse the existing local signing settings/dependencies and local delivery scripts, and build/install/launch Debug 2.20.4 over the same app identity. All stages succeeded; the user confirmed the working version was on TV. Leave this master build on TV while investigating the feature branch. Copy only public downloaded filter lists and their generated static network snapshot for local memory profiling; keep all reports/fixtures private in .data/. No browsing databases, cookies or website content were copied, cleared or migrated.

Standalone macOS profiling of the production Swift/JSC extended compiler with bundled uAssets plus DNS, Base, Ukrainian, Social, Mobile and Annoyances lists found peak RSS of 1,770 MiB, including whole-result bridging and repeated large script copies. Network snapshot restoration in a separate process used about 233 MiB at the observed stages. Intermediate JS-only generation and normalization-pool experiments remained private and were not shipped. The user clarified that master capabilities and filter lists must remain, preferring optimization over removal.

Optimize the feature compiler by bridging 512 records at a time with autorelease pools, scoping serialization/world construction temporaries, constructing scripts in one final buffer, and discarding the compilation parser context afterward. The final production-source profile peaked at 759 MiB (about 57% lower); MAIN (7,565,176 bytes), ISOLATED (46,863,826 bytes) and serialized stats/rejections matched the original outputs byte-for-byte. No filter/default change or capability removal was made. Use extended-v2 to invalidate the native generator schema, retaining only the current and one previous generated snapshot across schemas.

Two Debug 2.21.0 Simulator build/install/launch deliveries succeeded, the second after the schema update. No application tests or menu/remote interaction checks were run. Profiling/byte comparisons are local compiler diagnostics, not full-app physical-TV validation; the reported jetsam trigger is not claimed fixed on the TV. The requested master build remains installed there. No merge or remote Git push was performed. The agreed unreleased version remains 2.21.0 in Debug and Release.


## 2026-10-12 — Further bounded extended compilation (unreleased 2.21.0)

The user requested lower memory than the prior 759 MiB while preserving all capabilities and leaving master on TV. Adapt the serialized-record approach from the local upstream static-filtering-io.js CompiledListWriter, retaining hostname/entity retrieval and authoritative applicability from the existing uBO adaptation. Add a bounded parser iterator (at most 512 records per batch) while preserving browserCompileUBlock's collecting API for existing tooling. Pull and consume every batch in one native autorelease pool. Transfer complete JSON plus routing metadata instead of a second full nested Swift rule graph; retain every record field, source order, exception, trust check and scriptlet dependency. Call upstream parser.finish(), release the parser context before final assembly, scope hostname-normalization objects, and escape bucket JSON directly into the final script buffer. Use extended-v3 for the changed generator; preserve the successful installed runtime and existing bounded cache retention.

The final standalone macOS production-source profile using the same seven sources peaked at 385 MiB, about 49% below 759 MiB and 78% below the original 1,770 MiB. An intermediate callback-based profile reached 315 MiB; this was a preliminary result, not the final implementation measurement. Final scripts contain 7,549,102 MAIN and 46,676,575 ISOLATED UTF-8 bytes. Decode and compare every bucket against the original diagnostic output: all 13,871 MAIN records in 9,100 buckets and 135,990 ISOLATED records in 49,938 buckets match, including ordinal and every record field. Non-payload runtime/index/fallback/declaration/function-map code matches exactly, and source counts/rejected reasons match byte-for-byte. JSON property order/escaping changes source bytes without dropping rules. node --check accepted both generated scripts; git diff --check passed. These are local compiler diagnostics, not application interaction tests or full-app/TV memory validation.

Debug 2.21.0 Simulator build, install and launch succeeded. No physical-device discovery, diagnostics, delivery, menu interaction check, application tests, merge or Git remote push occurred in this stage. Master 2.20.4 remains on TV. Keep the agreed unreleased 2.21.0 version in Debug and Release, consolidating the changelog item. The user accepted stopping further optimization for now and explicitly requested the next memory investigation be recorded in the roadmap; add cold network compilation/restoration, old/new engine overlap and WebKit script copies as deferred measurement candidates with no filter or capability removal.


## 2026-10-16 — Parallel filter preparation and coverage UI (2.21.1)

The user clarified that the slow first build means filter Preparing after launch, requested full CPU utilization, authorized TV delivery again, and asked for a subtle upper-right readiness badge and last-bake time in Coverage. They clarified that the badge must be absent when global/site protection is off, requested a table rather than prose, and authorized further tests after immediate test-build delivery. The workspace initially had master checked out; switch the clean workspace back to feature/ublock without changing master or pushing Git.

Start native conversion/WebKit compilation and full-runtime work independently in BrowserWebView. Within BrowserAdBlockService, start network preparation and extended-script preparation independently, join results on the main queue and preserve generation checks, installed protection and one final reload completion. Keep the native preprocessing VM locked and separate from each extended compilation VM so it cannot serialize the stages. Enable app Swift -O in Debug and separately add -O to the local AdGuardConverter target's Debug manifest; app settings alone do not propagate to packages. Retain Debug conditions and upstream converter implementation. Scope native conversion temporaries per list. No enabled list, filtering rule, trust gate, matcher precedence or website state is removed.

Add a noninteractive translucent UIKit page-corner label for enabled but unready protection, with Preparing / Reload pending / Not ready states; hide for global/site-off policies and completed document readiness. Replace the coverage alert with a native scrollable table using two label/value pairs per row, shared tvOS surfaces and native focus. Group existing metrics and rejected reasons without losing counts; retain partial-coverage limits in a short footer. Persist completion date and monotonic wall duration of the last successful rebuilt pipeline; cache-only starts leave the previous record intact. Notify an already-open table after recording completion.

Local macOS source probes with the same seven sources measured network cold compile/optimization/persistence at about 16.65 s. The earlier unoptimized extended source probe took 26.84 s; optimized extended code took 16.34 s. A final isolated-cache concurrent network/extended probe took 16.58 s wall and 32.85 s CPU (1.98 average cores), peaking at 748 MiB. This excludes native Safari conversion, WebKit compilation, app/WebKit processes and physical-TV timing; it is not a complete TV memory budget or a five-minute diagnosis. Every decoded rule and ordinal, bucket/index/fallback, scriptlet declaration/function map and source counter/rejection reason matched the original compiler outputs (13,871 MAIN and 135,990 ISOLATED records). The first standalone probes did not redirect the current cache-root expression; the final reported concurrent run explicitly uses an isolated private cache. Do not treat their intermediate paths as a device cache operation.

The first device build found a duplicate layoutSubviews introduced with the badge; merge the layout into the existing method, inspect the failed build log and rebuild. Subsequent Debug 2.21.1 TV build/install/launch succeeded, including the independent converter optimization. The user observed cache reuse rather than a cold bake, then explicitly requested a forced rebuild to measure it. Add Rebuild Filters to Coverage and a persistent generation salt used by all three generated-cache identities. Keep enabled source text, history, tabs, cookies and website data unchanged; retain installed protection until replacements succeed. A default-off Debug BROWSER_REBUILD_ADBLOCK environment variable invokes the same action. Deliver 2.21.1 with DEVICECTL_CHILD_BROWSER_REBUILD_ADBLOCK=1; build/install/launch succeeded, requesting a cold rebake on the TV without deleting app data. The user briefly paused Simulator work, then explicitly reauthorized it; no paused-interval Simulator action was initiated.

Post-delivery checks passed: check-ublock-scriptlets.cjs (pinned syntax, aliases, trust and rejection counts), check-ublock-domains.cjs (entity/PSL/regex/path/ancestor/exclusion behavior), check-ublock-network-runtime.py (actual Swift/JSC cold/ready snapshot/corrupt snapshot fallback, responsive old engine, newest candidate and failed replacement retention), complete output comparison and git diff --check. Successful installation/launch does not establish on-TV timing or visual/remote behavior. Await the user's Bake duration, badge and table observation. A Simulator Debug 2.21.1 build/install/launch also succeeded before the brief pause; a fresh forced-rebuild delivery follows the renewed authorization. No release publication, merge or remote push is implied.

For the Brave question, inspect the retained iOS adblock_engine.mm (single engine and serialize/deserialize APIs) and upstream static-filtering-io.js serialized-record mechanism. Verify current Brave primary sources: https://brave.com/privacy-updates/36-adblock-memory-reduction/ describes native Rust/FlatBuffers; https://github.com/brave/brave-browser/issues/27161 documents client-side serialized DAT cache and explicitly marks its old benchmark obsolete after FlatBuffers. Do not present those old milliseconds as current Apple TV timing or replace the uBO matcher. Explain the recurring macOS Browser.app incoming-connection dialog as the application firewall prompt, plausibly associated with torrent listeners and unsigned Simulator reinstalls; no firewall setting was modified.

The user's TV observation exposed a distinction in the first timing implementation: the bake completed while the old document retained loaded ads and displayed Reload pending for over five minutes. The manual rebuild had reused the guarded background-reload path, which intentionally defers on opaque frames. Correct explicit Rebuild Filters to carry a pending-application identity and perform one deliberate reload after all backends are ready; defer only while the current navigation is finishing. Keep ordinary background-update playback/edit/opaque-frame safeguards. Split coverage into Preparation time and Applied to page · total; set the latter only after a visible, enabled main page's matching pageshow policy marker, including elapsed time since the bake start. Increase metric/value and section fonts from 20 to 23 points, rows from 52 to 60, and the explanatory footer from 16 to 18.

At the user's request, remove the temporary BROWSER_REBUILD_ADBLOCK AppDelegate launch hook entirely. Keep only the native Rebuild Filters button as the explicit trigger. Rebuild and deliver Debug 2.21.1 successfully without the environment override. The user then reported the button title did not fit; widen it from 250 to 375 points (1.5×) and recenter the footer pair. Build/install/launch of the wider-button version succeeded on TV. The user observed ads gone while the badge was still Preparing, then reported the badge disappeared and accepted that all-backend readiness behavior. This is user-observed TV evidence, not an agent-measured numeric TV bake duration; no duration was supplied.

A permitted Simulator cold launch loaded the public example.org page; CUA screenshots first showed a black view during preparation and later the page without the readiness badge. Safe numeric logs showed native source conversion completing before a later 14-chunk WebKit readiness event; do not infer complete app timing from the earlier two-core standalone probe. Simulator Escape did not open the menu; stop that ineffective keyboard path without retrying the on-screen remote. The table's visual fit was assessed through the user's TV feedback rather than claiming a successful simulator table interaction. No Debug hook, custom diagnostic server, browsing-data deletion, filter-default change, Git remote push or merge is included in the final implementation.

The user then reported 191 seconds for the filter bake and asked how Brave avoids visible ads during that interval. Targeted inspection of the retained Brave iOS source, checked against current brave-core master, found a bundled `block-ads.json` fallback (5,824 WebKit rules in the retained copy). `AdBlockGroupsManager.loadBundledDataIfNeeded` compiles only missing bundled modes, `validBlocklistTypes` includes bundled ads only until the standard full-list rule set is ready, and `ContentBlockerHelper.set(ruleLists:)` installs available lists in the tab. Full engines first restore serialized DAT and fall back to cached TXT; content rules are looked up by identifier and version, with delayed recompilation for arriving sources. The retained reference is an incomplete research slice with no fixed upstream revision, so do not infer Brave's device startup time from it. Our native 14-chunk compiler currently calls the WebKit store serially, while network and extended preparation already run concurrently; neither the Brave fallback nor concurrent native chunk compilation is implemented here. For an equivalent early-protection path, derive a small bundled native baseline with preserved source exceptions and per-site policies, install it before full preparation, then replace it atomically without leaving an unprotected navigation. Measure native conversion and WebKit compilation separately on the TV before attributing the 191 seconds to a specific stage. No code, build, device action or interaction verification followed this research.

The user then requested 14-way native compilation and immediate TV delivery, citing spare CPU capacity. Replace the serial native chunk chain with a maximum of 14 outstanding WebKit lookup/compile requests. Store each result at its original index so application order and the manifest identity remain stable; collect failures only after every request finishes and refill slots if a ruleset has more than 14 chunks. This submits parallel work to WebKit, without claiming WebKit creates 14 CPU threads or that its internal compiler scales linearly. The first device build failed before compilation because sandboxed Xcode could not access CoreSimulator and temporary files. An authorized unsandboxed Debug 2.21.1 build, installation and launch on the Apple TV then succeeded. No forced cold rebuild, timing measurement, memory observation, interaction test or ad-visibility check was performed; the delivered launch may restore existing compiled chunks. The 191-second baseline is the user's TV reading, with no stage breakdown. Keep the existing unreleased 2.21.1 changelog entry; no Git remote push.

The user measured Preparation time at 91 seconds before 14-way submission and 90.9 seconds afterward. This is effectively no speed improvement and does not show that WebKit executes native compilation on 14 CPU threads. In an earlier Simulator numeric trace, the full network engine finished in 2.25 seconds, extended compilation in 5.2 seconds, native source conversion logged through roughly 11 seconds, and native protection was applied about 105 seconds after the first source log. These are different machines/runs but locate a substantial wait after conversion. The enabled DNS source has 178,353 valid distinct destination domains in the available local sample, previously emitted as one native regex rule per domain and about eight 25,000-rule DNS chunks. Group up to 32 escaped complete hosts per anchored regex, retaining subdomain, optional-port and third-party semantics and all domains; the sample would emit 5,574 DNS rules in one chunk. Existing complete compiled caches remain valid because the rules have equivalent intended matching; an explicit Rebuild Filters uses the new generator. Debug 2.21.1 built, installed and launched on the authorized Apple TV. No new cold-bake timing, WebKit rule-acceptance observation, website interaction test or memory measurement has yet followed. The retained Brave iOS bundled baseline remains a separate early-protection idea, not part of this speed stage.

At the user's request, add persisted per-stage wall durations to the last successful bake: native list conversion (including preparation and queue wait), native WebKit chunk lookup/compilation, full network engine preparation and extended page-rule/script preparation. Use monotonic uptime for all four durations, reset them when a new preparation begins, and publish only the current generation after network and extended work join. Show the values in a new Parallel preparation stages section of the existing two-pair Coverage table, using a dash for older records. The stages overlap and are not additive; the existing Preparation time remains the elapsed end-to-end measure. Debug 2.21.1 built, installed and launched on the authorized Apple TV. No new Rebuild Filters run, numeric stage reading, visible table observation or interaction test has yet followed. The agreed unreleased version remains 2.21.1; no remote Git push.

The user reported that the page badge remained Reload pending after the DNS grouping delivery. Source review found the grouping generated `url-filter` alternation with `|`, which WebKit's content-blocker regex subset does not support; WebKit bug 207539 specifically describes missing logical-or support. This is a strong cause for a rejected DNS chunk and incomplete bake, but no device error log was read and the user's badge observation alone does not prove the exact rejection. Revert grouped DNS rules to the prior one-host-per-rule form and require a new `individual-dns-v1` ConvertedRules.plist format marker, so the invalid grouped JSON cannot be restored on the next preparation. Preserve the current explicit rebuild identity, enabled sources, active protection and website data. Remove the reverted speed experiment from the unreleased changelog entry. Debug 2.21.1 build, installation and launch on the authorized Apple TV succeeded. No subsequent completion badge, stage timing, rule acceptance or page interaction was observed by the agent; user observation is needed to establish recovery.

The user then observed 91 s Preparation time and 79.9 s WebKit compilation on TV. For the requested memory measurement, an authorized read-only Activity Monitor attempt on the physical TV disconnected after 0.889 s; its sole pre-bake snapshot showed Browser physical footprint 719.7 MiB and the three WebKit processes together 226.3 MiB, so it is not a bake peak. The user explicitly revoked further TV pushes and directed the rest of this investigation to Simulator. Debug 2.21.1 built, installed and launched only in Simulator. To force a cold preparation without changing the app or filter lists, terminate the Simulator app, change only `AdBlockRebuildIdentity` in its private preferences, then relaunch. The Simulator run completed successfully with Preparation 68.83 s, list conversion 10.94 s, WebKit compilation 57.38 s, network 2.26 s and page rules/scripts 5.18 s; native protection applied all 14 chunks. A one-second macOS `footprint` sample from 18:48:17 to 18:49:57 measured Browser's sampled peak at 984.8 MiB and its lifetime peak at 988.0 MiB; the four-process summed peak was 1025.3 MiB. At the end, Browser was 527.6 MiB and Browser plus three WebKit processes was 777.9 MiB. The profiler began roughly 24 seconds after process launch, so its sampled peak and process lifetime peak have different observation windows. A parallel 0.5-second RSS series is private under `.data/memory-profile/`. Simulator macOS memory figures do not establish the physical TV's bake peak or jetsam margin. The TV Instruments disconnection and unavailable Activity Monitor service on tvOS Simulator ended those tool paths; no app code, TV delivery, filter setting, public documentation or Git remote changed.

## 2026-10-17 — Remove Third-party Requests and parallel filter bake

The user reported an unspecified regression in merge commit `fb46ce4d` and requested removal of the Third-party Requests control and multithreaded filter build. Removed the site override UI, stored-policy reads/writes, host-rule injection, native allow/block variants and their Objective-C policy helper. Existing saved preferences are left untouched but no longer used. The bundled and downloaded lists still apply their ordinary third-party filter rules. Restored sequential filter preparation: native WebKit chunks compile one at a time, then the full network engine prepares, then extended page rules/scripts. Removed the Debug Swift `-O` overrides that accompanied the parallel bake. Coverage keeps per-stage durations under Preparation stages. Updated the unreleased 2.21.1 changelog and user guide; no version increment. No build, tests, Simulator delivery, physical TV work or remote push was requested or performed. The reported regression remains unverified until the user checks the resulting build.

## 2026-10-17 — Iframe fullscreen scope during Ad Block preparation

The user reported that an embedded website player entered fullscreen, turned white and immediately collapsed in 2.21.0. Source inspection found a definite missing state update: the top-frame `browserTVFrameFullscreen` message branch enlarged the iframe and refreshed media controls but did not call `reportPageFullscreenState()`. The 2.21.0 deferred Ad Block reload checks `pageFullscreenActive`, so this omission allowed a pending filter upgrade to reload a page while its iframe player was fullscreen. Report scope now changes on both iframe enter and exit, using the existing authenticated bridge. This is a source-supported cause, not a reproduced device observation; site/domain, build and interaction verification are pending. The change is folded into unreleased 2.21.1; no physical TV work or remote push.
The user identified the affected page as the locally saved `site3` example, whose archived outer page includes an `embed-a.example.test` player iframe. The active live embed was not inspected; the saved outer HTML alone does not establish which player was active when the white-screen collapse occurred.
The user rejected that change and required preserving the fullscreen behavior that worked in 2.20.4. Revert commit `cad3f92` with `df5b581`. Further source review showed the ordinary background Ad Block reload already treats an opaque cross-origin iframe as busy, so the missing fullscreen report alone was insufficient evidence for the observed white-and-collapse sequence; withdraw the earlier causal claim. The installed Debug 2.21.1 Simulator app opened the public site3 page, but Safari's nested Inspector target returned `AXError.invalidUIElement`; the alternate menu navigation did not establish an Inspector session. No fullscreen interaction, crash log or navigation event was observed. Do not retry the same ineffective UI path without changed conditions. The regression remains undiagnosed; preserve the 2.20.4 iframe bridge while investigating 2.21.0 additions.


## 2026-11-04 — First public package and release-only CI

The application source remains 2.21.1 (build 3022); its feature implementation date is distinct from this package/publication date. User selected atvloadly on a home Linux host for signing, installation and automatic free-account provisioning renewal, and explicitly requested that builds start only after manual GitHub Release publication. The workflow has only release: published, validates the tag against both marketing versions, builds Simulator Debug and Apple TV Release without signing, checks the arm64 AppleTVOS IPA and attaches it with license notices and SHA-256 checksums after both builds succeed. No Apple credentials are stored in CI.

Published tag v2.21.1 points to 6737a106b94221534f606b32beaea0c6223f86bb from feature/ci-cd; master was not merged. Release title is tvOSofaBrowse 2.21.1. [Release CI 41897244825](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/41897244825) completed successfully, including both builds and asset upload. Local validation covered actionlint, Docker Compose configuration, availability of the atvloadly v0.8.2 image for amd64/arm64, 13 tag/package scenarios and 19 documentation links. The downloaded CI IPA passed ZIP, version, platform, arm64 executable, permissions, framework and notice checks; its SHA-256 and the notices archive matched the manifest. IPA size: 20,520,150 bytes. Physical-TV installation, playback and a later automatic renewal were not observed.

The Linux setup instructions are in docs/DEPLOYMENT.md. User then requested publication of all sanitized research/development notes and reusable scripts, selecting a source index rather than uploading local upstream checkouts. Notes were removed from the ignore rules; specific browsing URLs and home-device labels were anonymized, and private page copies/logs/containers remained excluded. Machine-specific delivery defaults moved to ignored scripts/Deployment.local.env; the public helpers preserve stable-worktree delivery and expose a neutral push-to-tv.sh renewal entry point. The pre-existing local scheduler entry point and renewal-state location were retained privately. Root AGENTS.md now contains the merged durable rules; the separate machine-local instruction file was retired. No new app version or release tag is introduced by these documentation and publication changes.


## 2026-11-04 — Publish the historical 2.20.4 package

The user requested a tag and release for application version 2.20.4. Existing tag 2.20.4 already pointed to c4502dac9b7734defe8e3c802a3fd25acc0c5d53, which had no GitHub workflow. Preserve that tag and create release/2.20.4 from its commit, adding only release CI, the package verifier and dependency notices/licenses. The resulting v2.20.4 tag points to 082cf197adf615a04883c40e09e3fc7a5b22bbf6; _Project is unchanged from the historical base. Do not merge this release branch into master as a feature update.

Release title: tvOSofaBrowse 2.20.4. [CI 41901991988](https://github.com/just-better-code/tvOSofaBrowse/actions/runs/41901991988) passed version validation, Simulator Debug, Apple TV Release and asset upload. The published 19,189,997-byte unsigned IPA and notices archive were downloaded; SHA-256 checks passed, as did ZIP, version, arm64 AppleTVOS executable, permissions, framework and license-presence validation. The packaging verifier intentionally checks the dependencies of 2.20.4 rather than requiring the later uBlock assets. Latest remains v2.21.1. Publication on 2026-11-04 does not change the recorded feature implementation date of 2026-10-11. No physical-TV installation, playback or automatic signing renewal was observed.

A sanitized SESSION_HANDOFF.md on master supports continuing on another computer. It records both completed releases, private configuration boundaries and a starter prompt. No conversation transcript, private device identity or signing settings are committed.


## 2026-11-07 — Brave preparation lifecycle around uBO: implementation checkpoint

The user requested a deep Brave comparison, then authorized fast parallel implementation
with subagents. The final direction explicitly retains the existing uBO engines and
all supported rules; Rust replacement, slim-list substitution and softer first-party
policy are excluded. Full cold readiness remains a separate target of at most 30 s
on tvOS 27 with source lists already downloaded. Early protection or cache restoration
must not be reported as meeting that target.

Read Brave Core at `3281ce16a8846681c7b059be5d49debd97a806e2`, verify key local
reference files against that revision, and inspect LaunchHelper, navigation policy,
engine/content-blocker managers, PageData, ScriptFactory and resource downloaders.
The confirmed adaptation candidates are pre-navigation early readiness, ready-state
restoration, independent native artifacts, coalesced conditional updates and reusable
page-script preparation. Keep the original source/trust and website-state safeguards.

Implementation started on `feature/brave-preparation` from clean master
`248b9dcec59d49a2ccbda11cf2df51e1a2b7c7c7`. Extract the network runtime into its own
Swift source so subagents can work independently. Add an optional non-truncating
AdGuard conversion path and a host splitter that preserves later native exceptions.
Early-navigation and extended-v4/WKUserScript-cache changes are on disk; native
store dispatch, lazy inputs, source caches and last-good/update integration are still
in progress. This checkpoint does not establish a compiling or runnable app.

The user explicitly requested durable development checkpoints in case work is
interrupted. Current ownership, pending integration checks and resume instructions
are in [the execution plan](plans/brave-preparation-lifecycle.md). Preliminary adapter
syntax parsing and whitespace checks succeeded for the versions read; final checks
remain pending. No app build, app tests, Simulator/device action, release, Git remote
push or measured performance result has occurred. Linux has no local Xcode/tvOS SDK.
Application version and changelog have not yet been advanced at this checkpoint.

The initial resumable checkpoint was committed as `e312bb1`. Git had no author
configuration, so use the established public noreply identity from preceding commits
per command rather than changing global configuration. The user then explicitly asked
for detailed upcoming implementation instructions sufficient for another agent at
medium reasoning effort to continue without reconstructing the conversation. Expand
the execution plan with ownership, selectors, cache schemas, rule-preservation
invariants, known race/corruption defects, exact integration order, validation limits
and explicitly deferred work. Add this checkpoint detail requirement to AGENTS.md.

Later integration work regenerates the shipping network bundle through the standard
asset builder. Static peer review identifies malformed compiled-block reader risks,
source-cache integrity/provenance gaps, A-to-B-to-A publication races, last-good binding
and first-success early restoration ordering. These findings must be resolved before
the source integration is declared complete; no app/runtime verification is implied.

### Source integration completed — 2.21.2, commit 8d7681c

Integrate three subagents' work into `8d7681c` on `feature/brave-preparation`. Add shared
launch prewarm and a generation-checked early navigation/redirect barrier before the
ordinary bounded network/strict-document decision. Early readiness may use compatible
last-successful protection or the complete bundled uBO native artifact with an
available core/extended runtime. Full readiness separately requires exact current
identities and no stale network state. Native-only completion does not reload the
document; explicit rebuild and existing script-upgrade/player safeguards remain.

Cache converted sources and native chunks independently, retain unchanged identifiers,
and compile through four separate WebKit stores with one active request per shard.
Enqueue prepared chunks while subsequent source conversion continues and join shared
in-flight work for final collection. Use canonical case-sensitive HTTP(S) DNS host
patterns with the existing subdomain and third-party conditions. Add replacement
native lists before removing superseded identifiers. Extend the local AdGuard API
with optional non-truncating output and split oversized sources while retaining every
applicable following exception; unsupported capacity fails instead of dropping rules.

Move network preparation to its own Swift source. Read source text only when the
relevant ready cache misses, reuse per-source compiled blocks with separate upstream
readers and a single final freeze, and preserve source-spanning exceptions/badfilter.
Add canonical JSON integrity, source/engine provenance, balanced-block validation,
atomic caches, coherent last-good binding, conditional ETag downloads, short update
coalescing and safe-boundary cancellation. Fix the review-discovered A-to-B-to-A
publication race, corrupt/empty compiled-block paths, available-file read failures,
first-success early restoration ordering and current/stale readiness confusion.

Extended v4 separates fresh configuration from complete immutable MAIN/ISOLATED
sources. Consume a configurable own data property before running scriptlets and reuse
WKUserScript objects under a 64 MiB UTF-8-source/eight-entry budget. Memory warnings
clear recoverable script/resource/library caches, leaving active rules installed.
Retain complete universal delivery; per-frame specialization and generic-selector
retrieval were not delivered by this integration. Preserve BFcache behavior rather
than inventing a new document-token protocol. Root also aligned service startup's
WebKit loader with the host's public/private/staged fallback paths.

Set Debug and Release MARKETING_VERSION to 2.21.2, retain technical build 3022 and
local signing, and update the single changelog, user guide and component notes. Run
the standard asset generator through the available Node runtime after the final
adapter fixes: parser four modules, 174 scriptlet/helper entries, network 20 modules.
Final static checks accepted JavaScript syntax for runtime/adapter/network/parser/
domain assets, Python probe AST, exact maintained-adapter inclusion in the shipping
network bundle, both new Swift Xcode references, matching marketing versions and
`git diff --check`. The updated macOS probe was maintained but not executed.

Source integration and commit completed within the user's final 15-minute window.
No Apple SDK compilation, app tests, Simulator interaction, physical-TV action,
release/tag, merge or remote Git push occurred. The <=30 s full-cold goal, rule-level
runtime equivalence, real playback behavior and memory/jetsam effects remain
unverified. The detailed execution plan records exact next validation steps and the
deferred mechanisms so another agent can resume without reconstructing the chat.

### Follow-up implementation — generic cosmetics and network bundle loading

The user requested commits and clarified that fast subagents should take the next
implementation steps, then supplied an additional ten-minute window. Adapt Brave's
class/ID queue and uBO's generic DOM survey/Set-based exception mechanisms around the
existing engine. In standards-mode documents, defer only simple ASCII generic
`.class`/`#id` declarations until their exact token is observed. Retain domain-specific,
escaped, compound and procedural paths, all applicable exceptions, the complete
universal payload and native CSS. Use cooperative 8 ms batches and retain pending
work; do not copy upstream survey shutdown/node limits that could omit later rules.
Quirks documents retain eager CSS to preserve case-insensitive matching.

Peer review resolved duplicate/shared survey timers, missing BFcache resurvey,
mutation-flood starvation and CSSOM loss after document-root replacement. Changed
class/ID attributes inspect their element directly; added subtrees use a retained
walker. Index applicable exception keys by kind once per document, preserving exact
and wildcard behavior. A separate fast worker removed the second engine-bundle read
inside each network prepare/restore, passing one immutable resource value into the
new JS context while retaining the exact previous engine/PSL fingerprint formula.

Read the local Brave `cosmetic_filtering.ts` and uBO `contentscript.js`/
`cosmetic-filtering.js` implementations before adapting this stage. This implements
local installation selection, not native on-demand retrieval or smaller per-frame
injected sources. Keep version 2.21.2 as the same unreleased change set and consolidate
its changelog entry. Document the remaining shared-source and policy-variant work,
including memory/generation/order safeguards, in the execution plan.

Static JavaScript syntax and whitespace checks passed; focused peer review found no
remaining blocking defect in the final changed adapters. No app tests, Apple SDK
compilation, Simulator/device action or remote push ran. Performance and browser
equivalence, including the full-cold <=30 s target, remain unverified on tvOS.
