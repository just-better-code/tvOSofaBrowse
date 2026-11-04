# Brave source research slice

Received and reduced on 2026-10-11. Upstream branch reported as master; exact archive commit has not been established. This is an incomplete source reference, not a buildable Brave checkout.

Retain iOS Web/Brave script handlers, privacy settings, shared helpers, preferences, user agent, related tests, app/profile initialization, native network/renderer references, relevant iOS/network/cookie/worker patches and rewrites, dependency descriptions and original LICENSE/LICENSE.html. Remove unrelated wallet/VPN/news/store/UI assets, desktop packaging/test payloads and vendored Rust build-tool dependencies. tools/crates/Cargo.toml identified those dependencies as cargo-audit/wasm build tools, not the blocking engine.

The supplied copy already lacked components/, ios/browser/, ios/web/, ios/web_view/, Sources/BraveShields, Sources/BraveShared, Sources/Data and Sources/Brave/WebFilters before pruning. Do not attribute these gaps to cleanup. Pending incoming source should be merged selectively from a separate directory. Kept original files were checked against pre-pruning SHA-256 hashes; inventory and deletion evidence are in ignored .data/brave-reference-pruning.json.

Active investigation: faithful native HTTP-worker interception without losing WK cookies, request context or transport cancellation. Current Browser retains native WebKit networking; the isolated legacy-protocol prototype is not enabled in the application. Detailed stopping point: docs/agent/plans/ublock-http-workers-handoff.md and DEVELOPMENT_HISTORY.md.

## Restored modules

On 2026-10-11 the supplied full source archive was verified against ZIP entries, and seven missing trees were restored with byte-integrity checks: ios/browser, ios/web, ios/web_view, Sources/BraveShields, Sources/BraveShared, Sources/Data and Sources/Brave/WebFilters. The previous missing-directory list describes the initially supplied slice. components/ and other unselected upstream trees remain outside this local research slice; the untouched full archive is available separately. Exact archive revision remains unestablished.
