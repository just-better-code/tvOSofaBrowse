# uBlock Origin reference review

Source provenance: [research sources](RESEARCH_SOURCES.md). The inspected uBlock snapshot has no established commit; upstream links below are navigation aids to a moving branch, not immutable citations of that snapshot.

Reviewed on 2026-10-11 for the Ad Block roadmap. Scope: targeted static source inspection of the user-supplied `.references/uBlock-master` snapshot and the current tvOSofaBrowse adapter. No build, tests, simulator interaction, or physical-device verification was performed. Feasibility below is an architectural assessment, not evidence of working behavior on tvOS. Snapshot version metadata is `1.75.1.10`; its exact commit is unknown.

## User-selected target and mobile baseline

The user requested maximum practical full-uBO functionality on 2026-10-11 and rejected a Lite feature ceiling. Narrow subsets below describe starting points and delivery stages only. Full uBO is the primary implementation reference; Lite code illustrates alternative adapters, not the desired final coverage. Mobile WKWebView/WebKit is the capability baseline for planning the tvOS adapter, with concrete runtime differences documented when found rather than presumed.

Apple documents all-frame injection through [WKUserScript](https://developer.apple.com/documentation/webkit/wkuserscript/isformainframeonly) and shared DOM with separate JavaScript worlds through [WKContentWorld](https://developer.apple.com/documentation/webkit/wkcontentworld). These support the injection/isolation design. [Apple's Safari extensions session](https://developer.apple.com/videos/play/wwdc2023/10119/) distinguishes content-blocker CSS from extension Declarative Net Request actions and their per-site permissions. Shared mobile WebKit does not itself establish that extension-only permissions and callbacks are available in WKWebView. Investigate WebKit redirect/header actions and resource reporting in the actual adapter before ruling them out.

## Existing integration points

[BrowserWebView.m](../../_Project/Browser/BrowserWebView.m) already installs `WKUserScript` through `initWithSource:injectionTime:forMainFrameOnly:` with document-start injection in all frames. It also installs script-message handlers, replaces a selected diagnostics bootstrap while preserving other scripts, and adds/removes compiled content-rule lists. These are concrete starting points for our JavaScript filtering runtime. The current popup delegate rejects script-created windows to a different host when Ad Block is enabled.

[BrowserAdBlockConverter.swift](../../_Project/Browser/BrowserAdBlockConverter.swift) requests advanced conversion, but returns only Safari JSON and counts. The vendored converter's `advancedRulesText` contains original rule text, not executable JavaScript. Our wrapper drops that text and returns `nil` when there are no Safari rules, so an advanced-only list also needs explicit handling. Exporting that text would be an input to a future parser, not a complete runtime.

## Per-site protection: implement locally using the matching principle

[trusted-sites.js](https://github.com/gorhill/uBlock/blob/master/src/js/trusted-sites.js) has a small hostname matcher: a parent hostname matches itself and subdomains only at a dot boundary. Its larger manager also supports URL patterns, regexes, comments, and textual export. Borrow the hostname boundary rule, but keep our preferences and UI native; a JavaScript copy of the full manager is unnecessary for an initial domain switch. Normalize hostnames consistently and define whether a saved choice covers subdomains; do not infer a registrable domain by simply taking the last two labels.

Separate the user's global preference from effective protection for the current top-level page. A site exception should cover its embedded frames and popup policy as well as content rules. All navigation paths matter, including redirects, Back/Forward, restored tabs, and site links. Current `setAdBlockEnabled:` can asynchronously compile rules and reload the page; it cannot simply become a per-navigation setter without guarding stale callbacks and reload loops. Updating only after `didCommitNavigation` is too late for early loads. Establish the ordering before navigation or a supported top-page rule condition before claiming complete exemption coverage.

## Scriptlets: adapt the broad library and replace extension wiring

The reference offers specific candidates:

- [scriptlets.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/scriptlets.js): `noWindowOpenIf` / `prevent-window-open`, and later `m3uPrune`.
- [prevent-setTimeout.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/prevent-setTimeout.js): conditional timeout/interval prevention based on callback text and delay.
- [prevent-fetch.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/prevent-fetch.js): matching request properties and returning a synthetic `Response`.
- [set-constant.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/set-constant.js): selected property overrides for a confirmed site-specific failure.
- [json-prune.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/json-prune.js): selected JSON response modification, a later candidate rather than an initial requirement.

These functions use ordinary JavaScript and web APIs but are not standalone pasteable files. They import or declare dependencies such as [safe-self.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/safe-self.js), [proxy-apply.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/proxy-apply.js), utility functions, and `scriptletGlobals`. [base.js](https://github.com/gorhill/uBlock/blob/master/src/js/resources/base.js) registers dependency metadata. [make-scriptlets.js](https://github.com/gorhill/uBlock/blob/master/src/js/make-scriptlets.js) collects transitive dependencies, aliases, trust requirements, and MAIN/ISOLATED worlds. Use that model to generate dependency-complete bundles for the supported library, starting with an initial batch and expanding toward broad coverage. Replace browser-extension host wiring instead of importing it unchanged; filter parameters must select bundled implementations rather than run arbitrary remote JavaScript.

Replace extension registration/messaging and the BroadcastChannel logger with our injection and bounded Debug message bridge. Verify the required JavaScript APIs in our actual runtime. API wrappers must run in the page's world before the targeted code executes; DOM-only helpers can use isolation if supported. Bootstrap once per document/frame, select rules by validated host and frame context, and honor rule exceptions and trusted-source requirements. Do not assume AdGuard scriptlet names/arguments and uBO `+js(...)` are interchangeable.

An exception for the top-level page must suppress injection into third-party frames too; a frame-local hostname check alone does not implement this. Determine reliable native/page-context propagation, including opaque or sandboxed frames. Preserve the existing media/interaction scripts when rebuilding the user-script collection.

For popup prevention, start with the matching path which returns `null`. Optional decoy modes in `noWindowOpenIf` can create an iframe/object pointed at the supplied URL or call the original `open`; they are not inert replacements and should not be enabled blindly. Existing native popup suppression remains useful as a fallback.

Upstream wrappers modify page functions and properties without a universal uninstall mechanism. Plan a reload when scriptlet policy changes; removing a `WKUserScript` only changes future documents. Preserve website storage and do not claim already-running page scripts were undone.

## Procedural cosmetics: full uBO pipeline with a Lite adapter comparison

[contentscript-extra.js](https://github.com/gorhill/uBlock/blob/master/src/js/contentscript-extra.js) contains the full uBO procedural engine but depends on `vAPI.domFilterer`, `domWatcher`, tokens, and its CSS pipeline. A comparatively self-contained adapter example is Lite's [css-procedural-api.js](https://github.com/gorhill/uBlock/blob/master/platform/mv3/extension/js/scripting/css-procedural-api.js): selector tasks, MutationObserver batching, animation-frame scheduling, tracking/unhiding previously matched nodes, and a reset path are more self-contained.

It still requires `chrome.runtime.sendMessage` for CSS removal and `self.cssAPI` for insertion, and accepts compiled selector objects rather than raw filter-list lines. Replace those adapters, validate a small compiled schema, and use `has-text`, `upward`, and structural tasks as an initial batch before expanding to the applicable full operator surface. Prefer native CSS selectors where supported. Keep hide/unhide reversible; stage destructive `remove` actions with explicit lifecycle semantics, and retain the full applicable operator/parser surface as the final target.

Borrow its per-selector execution-budget idea, but do not copy its desktop thresholds as proven TV defaults: the code starts at 200 ms, replenishes up to 50 ms per two seconds, and permanently disables a selector after a large overrun. Budget accounting cannot interrupt one long synchronous scan, so also constrain selectors, scan size, observer work, and applicability. Disconnect observers and restore owned styles when disabled; separate frame documents must run their own DOM logic.

## Diagnostics: reusable lifecycle and network-observation investigation

[logger.js](https://github.com/gorhill/uBlock/blob/master/src/js/logger.js) enables buffering only when read and disables it after 30 seconds without a reader. Borrow demand-driven logging and duplicate suppression, but impose an explicit event/size cap in our Debug buffer. Retain source-list IDs and supported-rule IDs during conversion, then log scriptlet decisions, procedural matches/costs, popup decisions, compilation failures, and unsupported-rule reasons through the existing handler. Validate document/frame generation and redact sensitive values before messages leave the page.

Actual network decisions in uBO originate from [traffic.js](https://github.com/gorhill/uBlock/blob/master/src/js/traffic.js) and `browser.webRequest` adapters, not from the buffer itself. Our current code has no equivalent callback for every WebKit content-rule match. Investigate mobile WebKit/native reporting paths to expand coverage. Until those paths are established, do not claim exact network block counts, a full request log, or the precise rule responsible for every failed player request. A separate uBO evaluator could predict matches, but prediction would not establish that WebKit applied the same rule.

## Replacement resources: split page-level substitutes from network redirects

[redirect-resources.js](https://github.com/gorhill/uBlock/blob/master/src/js/redirect-resources.js) and [web_accessible_resources](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources) contain inert resources, VAST/VMAP documents, and compatibility surrogates such as Google IMA. Their content is reusable material, but uBO's delivery path in `traffic.js` returns `redirectUrl` through extension request interception; our adapter does not implement that path.

A selected `fetch`/XHR scriptlet can substitute a response that passes through those page APIs. That does not intercept every script tag, browser media request, worker, or native player load. A bundled API surrogate could be injected for a confirmed player, with matching network blocking and execution-order checks, rather than promising generic `$redirect` support. Empty VAST/VMAP responses remain conditional research, not guaranteed ad-free playback.

`m3uPrune` wraps page `fetch` and XHR and edits matched playlist text. It cannot universally remove stream ads or alter playlists fetched directly by native media/VLC. Keep it outside initial scope until a confirmed site uses an interceptable path and identifiable ad segments.

## Full-uBO architecture candidates

[static-filtering-parser.js](https://github.com/gorhill/uBlock/blob/master/src/js/static-filtering-parser.js) exports `AstFilterParser` and scriptlet argument extraction; use it as the primary syntax reference. [scriptlet-filtering-core.js](https://github.com/gorhill/uBlock/blob/master/src/js/scriptlet-filtering-core.js) separates rule selection from browser injection, while `scriptlet-filtering.js` supplies extension registration, caching, messaging, and context wiring to replace. Adapt the full `cosmetic-filtering.js` / `contentscript.js` / `contentscript-extra.js` pipeline, including hostname-specific compiled selectors and its operator classes; do not define Lite DOM code as the feature ceiling.

[static-net-filtering.js](https://github.com/gorhill/uBlock/blob/master/src/js/static-net-filtering.js) has an optional `vAPI` key-value storage fallback and explicit parser/trie/context dependencies. [platform/npm/README.md](https://github.com/gorhill/uBlock/blob/master/platform/npm/README.md) and `demo.js` demonstrate standalone matching, log data, list loading, and serialization. This is evidence that core matching can be separated from the full extension, not evidence of request interception on Apple TV. The generated package entry point is not present in this archive. A host-side JavaScript or bundled engine design needs its own memory, startup, and API assessment.

[dynamic-net-filtering.js](https://github.com/gorhill/uBlock/blob/master/src/js/dynamic-net-filtering.js) implements source/destination hostname and resource-category block/allow/noop policies. Include dynamic rules in the capability matrix and translate enforceable policies into native WebKit rules or applicable page/navigation paths; preserve priority/exception semantics across backends. The complete matching core, broad scriptlet library, procedural parser/operators, redirects, and diagnostics remain candidates. A missing current adapter is an integration requirement, not sufficient reason to reject them.

## Scope and order

1. Mobile WebKit capability/action matrix, full-uBO parser/runtime architecture, and source/dependency coverage inventory.
2. Native per-site policy, navigation ordering, bounded diagnostics, and first scriptlet batch.
3. Broad scriptlet library and full applicable procedural filtering, uBO lists/custom rules, and trust/exception semantics.
4. Static/dynamic network matching and enforcement mapping, resource redirects/surrogates, and response modification through the available mobile WebKit paths.

These stages do not cap the final feature set. Retain WebKit content rules as an efficient backend while evaluating full uBO matching and conversion, rather than automatically replacing working protection. Replace extension host wiring and adapt UI to native TV controls. General redirects and rich network diagnostics remain planned investigations: enumerate modern mobile WebKit/native adapter actions and permission requirements before declaring an unsupported case. The snapshot's `platform/safari/README.md` is a historical removal notice, not a ready WKWebView implementation. Additional lists require explicit syntax coverage; the external uAssets corpus is absent. Preserve upstream GPL notices and attribution. This review delivers documentation only, not a new app version.
