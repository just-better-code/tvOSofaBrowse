# Full uBO adaptation

**Current status — 2026-10-11:** user finalized the delivered scope at 2.21.0. Historical intermediate version headings below are development evidence, not separate releases. Deferred work is recorded in ROADMAP.md and is no longer active under the earlier autonomous authorization.


User authorized implementation and simulator delivery on 2026-10-11.

Target: maximum practical full-uBO coverage, preserving the existing WebKit backend.

Delivered: pinned parser and dependency-complete scriptlets, procedural engine, per-site policy, cached full static/dynamic network core, bounded navigation decisions, and page fetch/asynchronous XHR adapters. Current work moves to remaining host adapters and cross-backend semantics.

Remaining delivery paths: TV-friendly dynamic policy editing and equivalent allow/noop semantics across native content-rule chunks, worker/native resource interception, resource redirects/surrogates, response-header/body filtering outside page API wrappers, resource action reporting. Do not describe a predicted match as an observed network block. Investigate concrete mobile WebKit paths before declaring unsupported capabilities.

Validation requested: build, install and launch on Simulator. Interaction tests were not requested; do not infer functional verification from compilation.

## Capability/action matrix

| Action | Finalized 2.21.0 path | Deferred / unverified boundary |
| --- | --- | --- |
| Network decisions | WKContentRuleList plus full core for navigation, page fetch/async XHR and supported Blob workers; strict-document winning-rule explanation | General destination/type/URL UI and native reconciliation; broader modifiers |
| Scriptlets/cosmetics | 174 entries, trusted dependency closure, full procedural library and extended scopes | Full AdGuard arguments; broad site/lifecycle audit; nonpreemptible DOM queries and scans deferred above 15,000 elements |
| Per-site policy | Site exception and remembered third-party Block/Allow/Use Filters/Inherit with cached native variants | Complete live policy interactions and redirects/history-cache/remote-frame audit |
| Workers | Same-realm classic/module/nested Blob bridges | Accepted native fallback for HTTP(S)/Shared/service and foreign Blob realms; unshipped cookie/cancellation prototype defects |
| Diagnostics | Bounded source/line scriptlet/DOM events, rejection reasons, native action counters and navigation rule | Exact original network list/line, complete traffic observations and native-dialog focus validation |
| Substitutions | Pinned page fetch/XHR scriptlets; GET/HEAD fetch removeparam | General redirects/surrogates, broader modifier and network header/body delivery |
| Startup | Fingerprinted ready snapshots, compiled/source recovery, newest-only background engine publication | Simulator/macOS checks are not physical-TV performance or full website timing |

Debug 2.21.0 build/install/launch succeeded on Simulator. 2.21.1 adds the user-requested iframe/VLC routing correction and was also built, installed and launched successfully. No application tests, site interaction verification, Release build or physical-TV work were performed.

2.21.2 fixes generic-filter domain iteration discovered through a targeted pinned-list compilation diagnostic. Final Debug Simulator build/install/launch succeeded; Example site C rendered visibly and the private native log recorded a cosmetic-match event. This is limited runtime evidence, not full filter/episode verification.


## Network core stage, 2.23.0

Delivered: full pinned SNFE, hostname firewall and URL engine on a dedicated serial JSCore worker; PSL snapshot and compiled-list disk cache; enabled DNS/HOSTS and regular lists; native main/subframe navigation decisions with document cancellation and bounded fallback. Simulator final startup reported 230765 filters and available=1. Generated bundle export handling was corrected after startup exposed an empty named-export property. Build/install/launch succeeded; no interaction correctness tests.

Next: TV-friendly dynamic policy controls; worker/native resource adapters; equivalent allow/noop handling across native content-rule chunks; strict generic document policy; redirect/modifier/header/body adapters and resource diagnostics. Do not call this stage full resource interception. The full engine sources can match broader types, but navigation and page fetch/asynchronous XHR are connected as of 2.24.0. The hostname-only JSCore URL shim does not support URL-transform modifier execution.


### 2.24.0 — stage 1: fetch reply bridge (2026-10-11)

Added a capability-checked page-world reply handler and fetch preflight adapter in every frame. Native frame origin and current policy drive upstream matching; stale replies cancel, bounded missing replies allow native networking. Only URL/method/type reach the host, without bodies, headers or cookies. Simulator build, installation and launch succeeded. Normal startup reported bridge=1 and fetch=1, XHR=0. No application tests or request-blocking interaction checks were run. XHR follows in a separate stage commit within this feature version.


### 2.24.0 — stage 2: asynchronous XHR (2026-10-11)

Added prototype-based XHR gating with mutable-body snapshots, pending send/header guards, abort/open cancellation, deadline accounting from send, native allowed responses and synthetic error completion for blocked requests. Native constructor/instanceof remain intact. Sync XHR bypasses; workers and general native resources remain outside the page adapter. Native content rules remain authoritative on their paths, so a core allow/noop does not override a converted native block. Final Debug Simulator build/install/launch succeeded; normal startup reported bridge=1, fetch=1, XHR=1. No application tests, request-blocking interactions, Release build or physical TV work were performed.


## Worker adapter stages (2026-10-11)

Stage 1: make the request installer reusable with an explicit transport and document-independent base URL/lifecycle. Simulator 2.24.0 build/install/launch succeeded; this is preparation without a new user-facing version. Stage 2: connect tracked same-origin Blob dedicated workers through private MessageChannels, reuse fetch/async XHR, cancel stale replies and track readiness/bypasses. HTTP entry workers cannot be transparently replaced by Blob without changing response CSP/base URL/identity. Shared-worker identity and service-worker registrations need independent native delivery paths. Retain these gaps explicitly rather than replacing site workers wholesale.

Debug investigation before stage 2: the open Safari Inspector displayed two unhandled TypeError Load failed rejections at the fetch adapter’s intentional block branch, plus native content blocker messages and site manifest/preload warnings. This establishes where the rejections came from, not whether the matched request should have been blocked; no blocked URL was available in that stack. Do not suppress unhandled rejections globally.


## Stabilization before worker delivery (2026-10-11)

Worker transport remains preparation only. User requested stabilization first. Version line corrected to 2.21.*; current delivered artifact is 2.21.12. Stack-entry overflow was reproduced with 132844 records on a 256 KiB JavaScriptCore thread and eliminated by JSON-packed data. Ready native chunks now apply before full-runtime preparation, and bundled filters use content-based cache identity across deliveries. Initial cache transition still requires cold compilation. Warm startup applies restored native rules immediately and restores the network core separately. XHR cancellation now ends in UNSENT and requires open before resend. Standalone stack regression and ten gate scenarios pass; two selected WPT XHR pages visibly passed on Simulator. See development history for exact evidence and remaining limitations. No fixed-build TV verification or full WPT coverage; do not resume worker delivery before resolving the requested reliability scope.


## Resume after lifecycle scope — 2026-10-11

The user permits resuming uBlock work while deferring forced-restart session-cookie persistence. Persistent test cookies survived; the session fixture did not. The unsuccessful observer candidate is saved privately and removed from the delivered source. Current completed version remains 2.21.14. Resume worker stage 2 described above; keep dedicated-worker coverage and unsupported entry/shared/service-worker paths explicit. Cookie investigation details are in the asynchronous WebKit plan and development history.


## 2.21.15 — classic Blob dedicated worker requests (2026-10-11)

Connect supported same-realm JavaScript Blob dedicated workers through private transferred MessageChannels. Inject the reusable installer before executing the original script with importScripts, preserving its directive prologue; retain a separate entry Blob URL so immediate site revocation does not race execution. Worker fetch and asynchronous XHR reuse full-core decisions, bounded fallback, cancellation and parent pagehide/pageshow control. Explicit terminate closes the channel and releases owned URLs. Diagnostics count readiness, bypasses and unready bridges without recording request URLs or payloads.

Coverage is limited to text/javascript and application/javascript Blob entries; HTTP/module/shared/service/nested/cross-realm Blob workers retain native paths. The worker observes a generated Blob location, and bootstrap importScripts is subject to site CSP; these are concrete compatibility limits, not transparent full worker coverage. No compatibility claim was verified on a real site worker.

Verification: ten controlled isolated-realm worker bridge scenarios and ten existing page fetch/XHR gate regressions passed. They cover initial requests, allowed/blocked fetch, blocked XHR, strict directives and site messages, lifecycle cancellation/resume, bounded fallback, termination cleanup, unchanged option getters on bypasses and MIME bypass. They do not model WebKit CSP, true thread scheduling or full Worker WebIDL behavior. Final Debug 2.21.15 build, install and launch succeeded on Simulator with the original Example site D URL requested at launch. Launch does not establish page rendering or live worker filtering. No physical-TV work, Release build or Git remote push. Cookie forced-restart investigation remains deferred.


### Live Simulator worker probe — 2026-10-11

User opened Safari Inspector and refreshed Example site D. Inspected console for the current Banshee page on the 1080p Apple TV Simulator. Observed known external fullscreen.js/player_down.js top-level-return SyntaxErrors, Report Only CSP messages, blocked advertising/reporting resources, and an unhandled fetch TypeError from the intentional block branch at request-adapter line 71. UAS and Tortuga player readiness logs appeared; no new RangeError or adapter SyntaxError was visible in this console snapshot. This does not prove playback or that naturally occurring site workers were instrumented.

Executed a disposable classic JavaScript Blob worker from the Inspector console and revoked its original URL immediately. Screenshot visibly confirmed: worker adapter=true, original strict directive=true, ordinary echo preserved, allowed httpbingo fetch returned ok=true, DoubleClick fixture fetch rejected TypeError, and four probe messages before explicit termination. The stack-name probe for the blocked request returned false, so the rejection alone does not distinguish full-core adapter blocking from native WebKit blocking. Report Only CSP warnings for Blob worker/importScripts/connect appeared without preventing this probe. This is real WKWebView worker execution evidence for this page policy, not coverage of enforcing CSP, HTTP/module/shared/service/nested workers, lifecycle stress or every network decision. No source change, build, version bump or physical-TV action was needed.


## 2.21.16 — nested and module Blob workers (2026-10-11)

Enable the Blob worker adapter inside an instrumented worker whenever the runtime exposes Worker and the required Blob/channel APIs. Child transports relay only URL/method/API and event metadata through parent channels to the original native frame context. The full-core host keeps deriving origin/top context from WebKit. Readiness terminates at each parent record and reports one event, avoiding duplicate descendant counts at every hop.

Module Blob workers retain WorkerOptions.type=module, credentials and name. Their generated root imports a synchronous setup Blob dependency followed by a retained original Blob module entry, rather than concatenating site source into a classic wrapper or awaiting a dynamic loader. This preserves module strictness/scope and installs API interception before original static dependencies execute. HTTP entries are still not refetched or replaced; shared/service workers and foreign-realm Blob URLs remain outside this path. Module import fetches use native resource filtering, not the fetch/XHR adapter. Additional Blob loads remain subject to CSP; worker location and module import.meta.url expose generated aliases. No transparent identity/CSP equivalence claim. The module graph design follows the HTML worker module model: https://html.spec.whatwg.org/multipage/workers.html .

Add worker self-close notification/disposal, dispose channels on nonpersisted document pagehide, retain suspend/resume for back-forward cache, and roll back partially installed constructor/URL/terminate wrappers when descriptors are incompatible.

Verification: 16 isolated-realm worker scenarios passed with Node's experimental SourceTextModule harness (node --experimental-vm-modules scripts/check-ublock-workers.cjs); ten existing page fetch/XHR regressions also passed. New cases cover actual module linking/evaluation order, module-local declarations/strictness/import.meta, nested classic and nested module transport, inherited lifecycle cancellation, once-per-worker readiness, self-close cleanup and noncached document disposal. The fixture isolates constructor/URL/XHR prototypes across realms and models onmessage as well as listeners. These checks do not model real WebKit CSP, Worker WebIDL conversion, thread scheduling or native nested-worker support.

Final Debug 2.21.16 Simulator build/install/launch succeeded with the Banshee Example site D URL passed to launch. Live post-delivery interaction was not verified: two Safari CUA getApp calls timed out (-10005). The earlier 2.21.15 real classic-worker probe remains evidence only for that version/path. No TV work, Release build or Git remote push.


### Live verification of 2.21.16 — 2026-10-11

After user-assisted console input, Safari Inspector on the 1080p Apple TV Simulator showed all eight expected expanded-worker probe messages: dependency adapter=true; root module adapter=true, scoped=true, strict=true, nestedAvailable=true; ordinary fixture echo; blocked advertising fixture TypeError; classic child adapter=true; module child adapter=true; and successful httpbingo fetch ok=true from both children. The earlier inline run also displayed WORKER_EXPANDED_DONE with messages=8; the manually pasted file displayed the same eight results in the observed snapshot. No new worker error, adapter SyntaxError or RangeError appeared. Existing console errors were the previously investigated external fullscreen.js/player_down.js top-level returns and a page fetch rejection at the intentional adapter block branch.

This confirms live WKWebView module setup ordering before a static dependency, native nested-worker availability on this Simulator, successful classic/module child bootstrap and message/fetch operation on the current page. The advertising rejection does not independently distinguish full-core matching from native WebKit blocking. Enforcing CSP, broader lifecycle stress, HTTP/shared/service workers and physical TV remain unverified. No source change, new version, build or commit was needed for this observation.

Diagnostic correction: earlier CUA reads/screenshot did not show the test input/result, so it was reported as not executed. The later console contains that inline input and its successful results; delivery or observation was delayed. Do not treat absent initial AX/screenshot output alone as proof that input never executed, and never retype a potentially pending command merely because no result is visible. User instruction still requires stopping failed actions and reporting them rather than retry loops. The disposable manual probe is saved privately in .data/worker-check/live-probe.js.


## HTTP(S) worker investigation paused — 2026-10-11

The user requested a handoff and will resume later. HTTP(S) worker interception research has started, with no implementation or delivery yet. Current completed baseline is 2.21.16/c98ad11. Continue from [the HTTP-worker handoff](ublock-http-workers-handoff.md); it records examined native APIs, semantic risks, missing runtime verification and the next concrete investigation steps.

## 2.21.17 — extended domain applicability

Remove the domain-pattern rejection for entity, regex/path and ancestor rules. The runtime uses the same pinned PSL as the full core, with its trie generated at asset build time; handle multi-label/public-private/exception suffixes and subdomain entities. Match regex/path targets according to upstream StaticExtFilteringHostnameDB and scriptlet ancestors from location.ancestorOrigins. Exclusions precede positives. Cosmetic ancestor matching is not introduced beyond upstream semantics.

Production parser/runtime checks passed for entity, private/exception PSL, hostname regex, path regex/literal path, scriptlet ancestor matches and exclusions, and misleading hostname suffixes; all ten page and sixteen worker regressions passed. Debug Simulator 2.21.17 build/install/launch succeeded. The first sandbox invocation could not access CoreSimulatorService; an authorized invocation outside sandbox succeeded. No live site correctness claim, physical TV work or Git remote push. HTTP-worker host adapters remain investigation, not delivered.

## 2.21.18 — native action observations and dynamic policy reuse

Connect WebKit _webView:contentRuleListWithIdentifier:performedAction:forURL: to Debug-only numeric/capped action records, capability-check each BOOL getter, omit URLs and chunk identifiers, and report native action counters in Coverage. This callback observes applied actions, not all allowed requests, request type, worker origin or exact filter source/line. Upstream references: WKNavigationDelegatePrivate.h, _WKContentRuleListAction.h and NavigationState.mm under https://github.com/WebKit/WebKit/tree/main/Source/WebKit/UIProcess . Retain no runtime URL/cookies in records.

Cache dynamic host/URL rule strings in the full core and reparse only when changed. The production network bundle passes static exception, dynamic URL/hostname precedence, noop, removal, repeated policy and compiled-cache restore checks. Debug Simulator 2.21.18 build/install/launch succeeded. Live Simulator unified-log observation showed eighteen Browser native-resource-action callbacks with blockedLoad=1; this confirms runtime callback delivery on Example site D, not HTTP-worker-specific coverage. Safari AX access succeeded but Develop Simulator selection closed its menu without opening Inspector; stop this path rather than retry. The alternate redacted unified-log read succeeded. No physical TV or remote push.

## 2.21.19 — fetch query pruning

Deliver upstream filterQuery/removeparam modifiers on nonblocked GET/HEAD fetch in pages and supported Blob worker descendants. Native reply and page reconstruction independently constrain changes to the query of the same origin/path/fragment. Preserve headers/credentials/cache/redirect options using native Request construction, keep POST bodies/native path unchanged, retain action/cancellation/fallback semantics and modifier exceptions. XHR, navigation and other native resources do not apply the modifier result through this adapter; general redirects and response changes remain pending.

Production full-core checks passed encoded and duplicate query parameters, fragments, removeparam exception, POST skip and blocked-request skip. Eleven page gate checks include Request option preservation and cross-origin/path rejection; sixteen worker regression scenarios passed. Debug Simulator 2.21.19 build/install/launch succeeded. No live modifier fixture verification or TV/remote push. No new diagnostic server.

## 2.21.20 — legacy scriptlet surrogates

Include the pinned upstream redirect resource registry and its 21 text-injectable JavaScript resources in generated scriptlet library (174 entries including helpers). Preserve original GPL notices, resource aliases and requiresTrust metadata; compile aliases before suffix normalization as well as through .js token names. No downloaded list code executes, no global eval injection, and this stage does not implement general network redirection.

All library code parses; controlled checks pass noeval/nofab/popads/popads-dummy/google-ima names, google-ima3 alias, google-ima3-dai trust restriction and exceptions, and functional anti-adblock/noeval/popads stubs. Bundled compilation now accepts 9468 scriptlet and 7354 cosmetic rules; unknown scriptlet-name rejections fall from 69 to zero. Remaining 137 extended rejections comprise 130 HTML response-filter capability rejections, one other syntax rejection and six response-header filters; current reporting still groups the first 131 as syntax and needs refinement. Extended-domain regression checks pass. Debug Simulator 2.21.20 build/install/launch succeeded; broad site/advertisement API integration remains unverified. No TV or remote push.

## 2.21.21 — site third-party policy and requested Hraimo removal

Add persisted host policies Block/Allow/Noop/Use Parent, with longest-parent inheritance and the same host rules sent to the upstream dynamic core. Append third-party block or ignore-previous-rules to every native chunk; Noop uses standard chunks. Cache separate native variants without rebuilding the full core for policy-only changes. Preserve a standalone dynamic chunk when no source lists are enabled. WebKit rejects combining if-top-url and unless-top-url, so select policy variants per top-page view rather than invalid intersected triggers. General URL/destination/type policy reconciliation remains pending beyond this UI surface.

Remove the requested embedded Hraimo list, resource references, loader, blocked-host contribution and source identity; retain My Filters and downloaded lists. Bump native cache generation to v12 to avoid reusing removed rules.

Actual Foundation policy source passes validation, hierarchy/noop, host boundaries, native action shapes and JSON persistence checks. The generated full network core passes existing precedence/exception/cache/query-modifier regressions. Final Debug Simulator 2.21.21 build/install/launch succeeded. App menu interaction and live policy effects are awaiting user-assisted observation; compilation does not establish them. The on-screen Simulator remote and unchanged ineffective Escape path were stopped. Its unreliability is recorded in AGENTS.md and .data/simulator-remote.md. No physical TV or Git remote push.

Follow-up live observation: user found the four technical action names unclear. Action rows were also discarding rowDetailProvider output, hiding the saved policy; support opted-in action detail, show effective/inherited mode and Preparing, use plain action names and mark the selected action. During user-assisted Allow testing, the Simulator preference contained allow while only the standard/block compiled manifests existed. Previous console blocks were still from the old document. Native compilation completed later and applied fourteen chunks; iframe navigation decisions used dynamic-host and allowed them. Final console evaluation failed with noWindowsAvailable and was not retried, so CryptoJS load completion and page correctness remain unverified. No stack-overflow message appeared in the initial observed snapshot. Existing site fullscreen.js/player_down.js top-level-return errors remain visible.

Persist converted static chunks under their exact filter-source identity, validate cached shapes and regenerate on a changed identity. New policy variants reuse conversion output instead of parsing every source again; actual WebKit variant compilation still takes time. Final clarified-menu/cache build, install and launch succeeded on Simulator. Do not claim measured speedup or full live backend equivalence.

## 2.21.22 — distinguish parsing from response delivery limitations

Enable response-body parsing in the pinned parser, reject successfully parsed HTML and response-header rules under dedicated pending-delivery reasons, and expose bounded named counts in Coverage. Do not execute either response-filter class or treat this as implemented response rewriting. Fixtures distinguish valid HTML/header filters, unknown scriptlet and malformed HTML syntax. The full pinned list retains 137 unsupported rules: 130 response-body, six response-header and one syntax; no scriptlet-name rejection. Extended-domain regressions pass. Debug Simulator build/install/launch succeeded. No physical TV or remote push. Live popup layout has not been observed after delivery.

## 2.21.23 — strict-document decisions and requested simple default menu

Retain pinned upstream traffic.js strict-block and validateStrictBlock helpers with original GPL notice; call them for main_frame after dynamic URL/firewall evaluation. Preserve explicit/generic important/exception precedence, hostname boundary/end matching and rejection of tokenless or path-only generic strict blocks. Show a UIKit Page Blocked by Ad Block explanation via an optional delegate callback for the active tab; do not claim a temporary bypass. Cancel obsolete policy-generation navigation decisions and evaluate main-page site exceptions using the destination instead of the previous page.

Production bundle checks pass sixteen explicit/generic/important/exception combinations, generic path versus explicit document behavior, tokenless filters, FQDN and hostname boundaries and dynamic allow. Existing network-policy/modifier regressions passed before the native changes. Simulator build/install/launch succeeded; blocked-dialog live interaction is not yet observed.

User found the third-party policy explanation unclear and requested its removal and explicit default. Remove the long description, show hostname only, rename the first inherited choice Default, keep the selected checkmark, effective setting row and Preparing. Default with a parent override reports the inherited action; without one it uses filter lists. Final 2.21.23 build/install/launch including this menu change succeeded. No physical TV or Git remote push. Previous Allow runtime preference is preserved rather than changing the user's selection silently.

## 2.21.24 — mark the actual default filtering mode

At user request, replace the separate Default label with Use Filters (Default), mark Block as Strict and Allow as Soft, and rename Follow Parent to Inherit. Inherit is not labelled Soft because it can inherit Block. Show the effective filter mode when inheritance has no parent override; preserve existing preference values and policy behavior. The dialog retains only the hostname message and selected mode indicator. Debug Simulator build/install/launch succeeded. No new interaction test or screenshot was performed for this text change; no physical TV or Git remote push.
