# uBlock HTTP(S) workers handoff

Date: 2026-10-11. User paused work explicitly: “давай тут хендоф. пізніше продовжим”. Resumed on the user's later autonomous-completion instruction; the original pause applies only to that historical checkpoint.

## Completed baseline

- Branch: feature/ublock. Last completed version: 2.21.16.
- Commits: e80ec90 (classic Blob worker bridge), c98ad11 (nested and module Blob workers).
- Debug 2.21.16 built, installed and launched on Apple TV Simulator. No physical-TV work or Git remote push authorized.
- 16 controlled worker scenarios plus ten page fetch/XHR cases passed. Worker harness requires `node --experimental-vm-modules scripts/check-ublock-workers.cjs`.
- Live Safari Inspector on the 1080p Simulator confirmed eight expected messages: adapter installed before module dependency execution, module scope/strict mode, normal echo, advertising request rejected TypeError, classic/module nested worker adapter installation and successful allowed fetch from both children. This does not distinguish core blocking from native WebKit blocking or prove enforcing-CSP compatibility.
- Disposable manual probe: .data/worker-check/live-probe.js. Detailed evidence: ublock-runtime.md and DEVELOPMENT_HISTORY.md.
- Forced-restart session-cookie persistence remains deferred. Persistent cookie fixtures survived; session fixture did not. Unsuccessful observer WIP is preserved privately in .data/cookie-lifecycle-deferred/ and removed from delivered source.

## Current request and work performed

User requested HTTP(S) worker request interception, stage commits and Simulator delivery, explicitly no TV. Only research has begun; no HTTP-worker implementation, version increment, build or new commit was made for this request. Do not describe this stage as delivered.

The existing UBlockRequests.js adapter deliberately bypasses HTTP worker entries. It installs into supported same-realm Blob dedicated workers and relays nested transports to the native frame. HTTP/shared/service-worker coverage remains incomplete.

Investigated upstream primary sources:

- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/_WKResourceLoadDelegate.h — observed request/redirect/response/completion callbacks, with no blocking decision or response replacement callback in this header. A didSendRequest prediction is not interception.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewPrivate.h — resource delegate setter and frame JS APIs; searched this header for an interception entry point without finding one. This is current upstream, not proof of every SPI available in the installed runtime.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/loader/WorkerThreadableLoader.cpp — dedicated worker requests bridge to DocumentThreadableLoader while copying the worker's origin, CSP, referrer and embedder policy. Investigate native content-rule enforcement on this path before assuming worker networking is unprotected.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKURLSchemeHandler.h — scheme handler investigation started, not resolved for reserved HTTP(S) schemes on installed WebKit.
- https://html.spec.whatwg.org/multipage/workers.html — worker entry/module loading model.

## Resume steps

1. Verify installed mobile/tvOS WebKit capabilities and native content-rule coverage for real HTTP worker entry/fetch/XHR. Prefer targeted source/runtime evidence; upstream main is not installed-runtime verification.
2. Establish an actual before-request cancellation or entry-response injection path that retains native HTTP worker semantics. Evaluate concrete host APIs; do not count resource observation as enforcement or navigation policy as all-resource interception.
3. Replacing an HTTP worker with a Blob bootstrap changes WorkerLocation, relative URL handling, response CSP and potentially credentials/referrer/redirect behavior. Importing HTTP entry source from a Blob is not transparent injection; do not silently weaken response CSP or claim equivalent identity. No such replacement was implemented or approved.
4. If a faithful path is unavailable, report the concrete boundary and discuss scope rather than delivering a misleading HTTP-worker claim. A native-WebKit coverage verification can be useful but does not fulfill full-core worker interception by itself.
5. Once code is ready, run requested meaningful regressions, use scripts/push-to-simulator.sh deploy, then update version/changelog/guide/history and commit the completed stage. No physical TV, signing changes, storage migrations or remote Git push.

## Debug workflow and user preferences

Do not repeat actions which keep failing, particularly Safari Inspector controls. Report a failure immediately and stop that path. A fresh explicit user instruction or concrete changed precondition may authorize a new attempt. Do not bypass an automatic-review rejection.

Native console input was unreliable even when reads worked. Initial AX/screenshot observations omitted command results; later logs showed an earlier inline command had actually executed. Missing initial output is not proof of nonexecution: never retype a potentially pending command. If input is unreliable, provide the disposable script for manual paste and then read the output. User authorizes needed debug actions, with the stop-on-failure condition. No custom HTTP diagnostic server.


## Resumed native-host investigation — 2026-10-11

Current shipping development version is 2.21.0: the user confirms 2.21 is unreleased and requests consolidated versioning. Prior patch labels remain historical development evidence only.

An isolated arm64 tvOS 18.2 Simulator executable found WKWebView/WKWebViewConfiguration, WebExtension classes, setWebExtensionController:, _setResourceLoadDelegate: and WKBrowsingContextController registerSchemeForCustomProtocol:. HTTP/HTTPS are natively handled, so ordinary WKURLSchemeHandler registration cannot claim those schemes. The older initWithManifestDictionary: selector was absent. A separate _initWithManifestDictionary: construction attempt terminated the disposable process with SIGSEGV; it was stopped and not retried. These observations do not prove WebExtensions are usable in the Browser app or a blanket tvOS impossibility. Upstream WKWebExtension.mm contains both real and unsupported implementations, so class existence alone is insufficient. Apple currently documents Safari webRequestBlocking as unsupported; WK host behavior needs its own evidence.

A different isolated UIKit Simulator fixture successfully registered legacy HTTPS custom protocol handling and loaded synthetic https://workerprobe.invalid/index.html. Native dedicated HTTP worker entry and importScripts requests reached NSURLProtocol. WorkerLocation retained the original HTTPS worker URL, relative imports executed, fetch and asynchronous XHR returned allowed data, and a blocked fetch rejected TypeError. The final prototype loads the actual shipped UBlockNetwork.js in JavaScriptCore on a serial worker queue; a generic fixture filter, rather than a hardcoded URL branch, makes the blocking decision. The request type is deliberately other in this research fixture: no production resource-type equivalence is claimed. This is neither a Blob bootstrap nor a custom HTTP server.

Cookie observations reveal unresolved integration: document.cookie contains the synthetic worker_probe fixture, but the intercepted request's case-insensitively read Cookie header lacks it; synthetic Set-Cookie is not reflected in document.cookie. This is evidence about the prototype path, not proof about eventual default HTTP transport behavior. The legacy manager routes registered schemes through NSURLConnection in the app process, including requests a custom NSURLProtocol declines; deploying global HTTP registration can therefore affect all page traffic. Preserve WK cookie storage, credentials/SameSite/partitioning, CORS, redirect/header/cancellation and TLS semantics before enabling this in Browser. Native mainDocumentURL exists in the fixture but does not establish full tab/frame/request-type attribution. The real Browser remains on its existing native/Blob adapters.

Reproducible isolated fixture: scripts/check-ublock-http-worker-host.m and .py. The runner installs only its dedicated test app on one booted tvOS Simulator, runs for twenty seconds, checks the summary, retains logs in ignored .data/worker-host-probe/ and removes the test app. Browser data is untouched. Module/nested HTTP workers, enforceable CSP denial, real-server credentials, redirects, concurrent tabs/frames, abort and stale response handling remain unverified.

Primary references:
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebViewConfiguration.mm — rejects handled HTTP/HTTPS schemes.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebExtension.mm — initializer/factory and unsupported feature implementations.
- https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility — Safari blocking permission boundary, distinct from installed host verification.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKBrowsingContextController.mm and UIProcess/WebProcessPool.cpp — legacy scheme registration.
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/Cocoa/LegacyCustomProtocolManagerClient.mm — NSURLConnection bridge and redirects.

Next: establish faithful cookie/credential and per-request context handling in the isolated fixture before a Browser adapter. Keep production full-core HTTP-worker interception pending; successful synthetic transport does not fulfill it.

## Native-host fidelity matrix — 2026-10-11

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

### Cookie API source audit

Current upstream WKHTTPCookieStorePrivate.h exposes URL-filtered lookup, accept-policy adjustment and flushing; this header does not expose binding NSURLSession/NSURLConnection to the WK network-process storage session. Its URL-only lookup accepts no top-frame/site context. WKWebsiteDataStorePrivate.h contains storage/statistics controls but the inspected header does not provide a transport-session binding either. This is a bounded source audit, not exhaustive installed-runtime impossibility. ResourceRequestCocoa.mm preserves HTTPShouldHandleCookies and CF site-for-cookies/top-navigation metadata; the prototype confirms omit intent survives, but preserving intent alone does not connect the two cookie stores. Do not infer that a URL cookie lookup enforces every SameSite/ITP/partitioning rule.

Sources:
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKHTTPCookieStorePrivate.h
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/UIProcess/API/Cocoa/WKWebsiteDataStorePrivate.h
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/network/cocoa/ResourceRequestCocoa.mm

## Firefox / Brave reference check — 2026-10-11

User offered a Brave source download. Target current brave/brave-core, branch master; archived brave/brave-ios README explicitly says iOS moved there. Recommended archive: https://github.com/brave/brave-core/archive/refs/heads/master.zip; local ignored destination .references/brave-core.zip. Inspect ios/brave-ios plus ios/browser, ios/web and ios/web_view first, then relevant Shields dependencies. No Chromium dependency checkout or build needed merely to study source; record resolved archive revision if obtainable, otherwise label snapshot unpinned.

Firefox local reference and current upstream ContentBlocker.swift apply WKContentRuleList objects to WKUserContentController. No ready solution to the legacy-protocol cookie/cancellation gap was found in the targeted files. This is not an exhaustive Firefox claim.

Current Brave RequestBlockingScript.js checks page fetch/asynchronous XHR through a native message, then calls original WebKit APIs for allowed traffic. It is window-scoped and does not itself install into native HTTP workers. Keeping native networking avoids the custom-protocol cookie transfer gap on this path; it does not solve full-core native worker interception. Inspect remaining Brave iOS host/engine implementation before a broad conclusion.

Sources:
- https://raw.githubusercontent.com/mozilla-mobile/firefox-ios/main/firefox-ios/Client/ContentBlocker/ContentBlocker.swift
- https://raw.githubusercontent.com/brave/brave-core/master/ios/brave-ios/Sources/Brave/Frontend/UserContent/UserScripts/Scripts_Dynamic/Scripts/Paged/RequestBlockingScript.js
- https://raw.githubusercontent.com/brave/brave-ios/development/README.md

## User scope decision — 2026-10-11

After Brave inspection, user said “якщо вони не паряться і ми не будем” and then requested applying their optimization mechanism. HTTP(S) worker full-core custom-protocol integration is now deferred by user preference; keep native WebKit content rules for that traffic, existing dedicated Blob adapters and page/navigation full matching. Do not resume the transport experiment without a new request. Preserve its fixture/results as research; do not claim native fallback is full-uBO interception. Next implementation priority is optimized engine snapshots and safe background replacement, following Brave's architecture rather than importing its Rust engine/permission policy.
