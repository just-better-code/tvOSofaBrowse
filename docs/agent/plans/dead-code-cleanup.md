# Dead-code cleanup proposal

## Purpose and acceptance

Reduce maintenance and binary surface without changing browsing, playback, or diagnostics behavior. Completion requires evidence that each removed path has no supported entry point, that the Xcode target no longer references removed files, and that the user-facing controls still work in the simulator. This document proposes investigation; it does not authorize removal or claim that any candidate is dead.

## Current candidates

| Candidate | Evidence to examine | Decision gate |
| --- | --- | --- |
| `BrowserWKWebViewProofOfConceptViewController.m` and its Debug action in `BrowserMenuCoordinator.m` | The class is created by `NSClassFromString`, so a plain text reference search can miss its runtime use. | Ask whether the WebKit proof of concept still supports active debugging. Remove the class, menu action, and project references only if no current workflow needs it. |
| `BrowserTorrentAssetLoader.m/.h` and the `browsertorrent://` branch in `BrowserNativeVideoPlayerViewController.m` | Current torrent playback uses `BrowserTorrentVLCPlayerViewController` and `BrowserTorrentHTTPServer`; the older loader is still referenced by the native AVPlayer controller. | Trace every creation path for `browsertorrent://` and preserve direct-URL AVPlayer playback. Remove only the old torrent branch if no supported path reaches it. |
| `WebAVPlayerViewController+FullscreenSubviewHack.m`, `AVPlayerViewController+BrowserFullscreenBlock.m`, and `WebCoreNSURLSessionTaskTransactionMetrics+AddPrivacyStance.m` | Objective-C categories may be loaded for side effects and private WebKit behavior even without imports. | Inspect runtime selectors and linked category behavior; keep any category required for playback or privacy. Do not classify by filename or reference count alone. |
| Legacy diagnostic and logging branches | Debug diagnostics are intentionally retained by project policy. | Consolidate duplicated code only after preserving the numeric `[TorrentHTTP]`, `[TorrentVLC]`, and `[TorrentState]` events and the current Debug controls. |
| `../README.mdown` file reference in `_Project/Browser.xcodeproj/project.pbxproj` | The repository now uses the root `README.md`; the old path appears in the project navigator but no matching file exists in the checkout. | Confirm it is only a navigator reference, then remove the stale reference without changing build phases. |

## Milestones

1. Map each candidate's call sites, runtime selectors, Xcode source membership, and user-visible entry points. Use `graphify query` first, then direct code inspection because dynamic Objective-C references may be absent from the graph.
2. Record a keep/remove decision and its evidence for each candidate. Keep speculative candidates until an observable replacement or irrelevance is established.
3. In a separate implementation task, remove one isolated path at a time, update project references, then perform only user-requested build or interaction checks under `AGENTS.md`.
4. Update `USER_GUIDE.md`, `TORRENTS.md`, changelog, and version only if the resulting application behavior changes.

## Progress and safeguards

- Proposal created from source/reference inspection on 2026-10-04. No application code was removed, built, or exercised.
- Preserve automatic signing, local browser data, current VLC streaming, and Debug diagnostic scaffolding.
- If investigation finds an active call path, mark that candidate **keep**. Revert any isolated removal if it breaks a supported route.

## Outcome and remaining work

The candidate list is ready for a focused review. Reachability and simulator behavior remain unverified.
