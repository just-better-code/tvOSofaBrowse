# Tab overview preview cache

## Outcome

Opening Tabs must not create web views or load saved inactive websites. Reuse card-sized previews across launches; show the domain and title if tvOS removes the disposable cache. Preserve tab/session/history data and existing controls.

## Implementation

Completed in code for 2.18.25: active-only overview snapshots, reduced snapshots, asynchronous disk cache keyed by validated tab UUID with page URL validation, stale-reply guards, per-tab request deduplication, close-time removal and orphan pruning after session restoration. Cache reads never overwrite newer in-memory snapshots. Five-minute inactive WebView expiry is implemented separately in 2.18.26; see [inactive tab lifetime](inactive-tab-ttl.md). Image-quality heuristics remain separate work.

## Validation boundary

Source review and whitespace checks passed. The subsequently requested Debug device build, installation and launch succeeded for 2.18.25 on the test Apple TV. Tests were not requested. Runtime observations remain pending: cold launch with multiple saved tabs, opening Tabs without inactive network loads, preview restoration, cleared cache fallback, first selection loading a saved page, and closing a tab while its preview operation is pending.
