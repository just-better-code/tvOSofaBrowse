# Asynchronous WebKit operations

## Scope

The user approved the staged roadmap improvement and asked to follow Firefox iOS. First deliver completion-based media diagnostics, media pause fallback and YouTube page configuration, with stale-result protection. Keep DOM queries and cookie persistence as explicit subsequent stages because they have synchronous callers with different ordering requirements. Preserve accepted scrolling, website storage and remote controls.

## Reference

Local Firefox revision: 371a1b51c54645dbcbd7ad41d1479c7a9e5850f8. BrowserKit/Sources/Shared/Extensions/WKWebViewExtensions.swift uses completion result/error; Scripts/Metadata/MetadataFetcherHelper.swift handles errors and parses metadata inside the callback. Borrow the asynchronous control flow, without assuming iOS content-world APIs are available in the tvOS runtime adapter.

## Implementation

- Add a completion API carrying result and error, with bounded asynchronous completion and document generation tracking.
- Convert diagnostics, pause fallback and YouTube page config; preserve request/config processing order.
- Check originating web view, document generation and URL before presenting delayed UI or playback.
- Record remaining synchronous DOM and cookie callers in the roadmap.

## Verification

Source review only unless the user asks for builds or tests. Do not claim TV interaction verification.

## Progress

First stage implemented in 2.18.22. Review and the authorized Debug device build completed; 2.18.22 installed and launched on the test Apple TV. Interaction checks remain unperformed. DOM and cookies remain pending, with explicit ordering and storage-preservation requirements.

YouTube extraction was removed entirely in 2.18.23 at the user’s request; its migrated config read is no longer part of the resulting feature. Retain asynchronous diagnostics and media pause, and the pending DOM/cookie work.


## 2026-10-11 continuation

Delivered in 2.22.0: migrate all remaining synchronous DOM and cookie callers, remove the nested-run-loop helper and compatibility APIs, consolidate input metadata, preserve click ordering with callbacks, cancel obsolete results and protect saves. Initial requests wait asynchronously for bounded cookie restoration; foreground restores no longer overwrite live website cookies. No blocking video-activation loop was found in the current source; existing media commands use the guarded completion API. Debug Simulator build/install/launch succeeded; interaction observations remain pending.

Managed scripts now have an ordered component registry and a shared runtime constructor carrying timing, frame scope and named-world selection. The interaction/media/fullscreen bridge remains coupled in page world because its shared state and exposed APIs are required by the existing iframe behavior. Diagnostics intentionally intercept page storage APIs. Isolated uBlock scripts retain runtime capability checks. Further separation of bridge source and isolated evaluation for new independent helpers remains future work, not a requirement to move page API patches into isolation.


## Remaining stabilization scope (2026-10-11)

Current logical versions use the 2.21 patch line; the asynchronous DOM/cookie and registry stage is 2.21.8 (initially packaged as 2.22.0). Core migration is implemented, not fully interaction-verified. Next prioritize lifecycle regressions for navigation/tab changes, history restoration, canceled or late JS callbacks, field editing and cookie ordering. Separating the coupled interaction/media/fullscreen source is a maintainability stage and must preserve page-world shared state and website APIs. New independent helpers should choose a named world where available; do not isolate page API patches. Structured canceled/timeout/error diagnostics can distinguish adapter failures from website errors without suppressing the latter. Worker interception remains a separate postponed host-adapter stage.


2.21.13 lifecycle stage: guard tab and same-document URL ABA results, bind field dialogs to their original node/token. Native Simulator regression methods and Node field fixtures pass; actual UI/website navigation remains to observe. Cookie archive decoder compatibility confirmed broken and handled in the next separate stage.


2.21.14 cookie stage: fix secure-decoder incompatibility with existing NSHTTPCookie NSCoding archives; validate all decoded cookies before writing. Full production-method harness passes using tvOS Simulator Foundation and controlled stores, including asynchronous initial-load ordering and latest queued request. Build/install/launch succeeded. Live UIKit/WKWebView interaction and website cookie persistence remain pending: CUA window operations timed out and user observation was requested. Keep worker work postponed until this requested reliability scope is observed.


Follow-up: user smoke-tested Back/Forward, tab return and input and reported normal behavior. CUA recovered and confirmed the original page rendering; its console contained known external syntax errors, intentional blocker rejections and blocked-ad preroll errors, without a new lifecycle/stack failure in this session. Broader stress and actual signed-in cookie persistence across relaunch remain unverified. The requested lifecycle fixes and stage deliveries are complete; do not equate this smoke check with exhaustive reliability.


## Cookie restart investigation deferred — 2026-10-11

The user chose to defer the remaining cookie investigation and resume uBlock worker work. A live httpbingo fixture confirmed Secure/HttpOnly session cookies, persistent cookies and JavaScript-set persistent cookies before restart. After a forced process restart, the session fixture was absent while both persistent fixtures survived. This does not establish behavior after normal backgrounding, nor real account authentication persistence; no signed-in account was verified. No history-loss or app-crash evidence was observed in this investigation.

An uncommitted cookie-store observer candidate passed controlled harness cases but did not fix the live session-cookie restart fixture. It is not a delivered fix. Its tracked patch and harness are preserved privately in `.data/cookie-lifecycle-deferred/`; the candidate was removed from the source and the app version restored to 2.21.14. Do not publish cookie values or private diagnostics. Revisit native store snapshot/archive timing before proposing another fix. The earlier diagnostic claim that the observer was inactive was incorrect: a pointer-to-BOOL cast caused that reading; subsequent inspection confirmed it was registered.
