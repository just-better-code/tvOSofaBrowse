# Branch stabilization and maintenance

Authorized scope: fix preparation reloads, retain native protection on failure, preserve ordered Center clicks; then extract Ad Block service, reduce per-frame rule data, and provide pinned uAssets refresh/cache maintenance. Build/install/launch on Simulator after each completed stage and commit separately. No physical TV work, remote push, merge or application tests requested.

1. Stabilize asynchronous preparation and ordered input. Build/deliver before documentation; retain unreleased 2.21.0.
2. Extract shared Ad Block state/preparation, index extended rules without narrowing domain/entity/regex/ancestor applicability, add reproducible offline uAssets snapshot tool and bounded internal-cache cleanup. Build/deliver, document actual evidence and commit.

Completion evidence must distinguish source review/build/launch from interaction verification. Deferred automatic reloads apply on next navigation/manual reload; do not interrupt playback/input or rotate the live document's request capability prematurely.

Both implementation stages are delivered on Debug Simulator. Stage 1 commit: eb56aa2. Stage 2 source/build/launch complete; documentation is updated after delivery. Application interactions and performance/retention observations remain unverified; no test or physical-TV scope was added.
