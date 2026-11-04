# Autonomous uBlock completion

Status: current scope finalized in 2.21.0 by the user on 2026-10-11; remaining stages are deferred to ROADMAP.md and require a new request. The earlier authorization to complete the entire roadmap autonomously no longer makes them active work. No physical-TV work or Git remote pushes. Avoid optional clarification and repeated failed actions; record concrete remaining host limitations rather than claiming completion.

Historical baseline: feature/ublock, c98ad11, development artifact 2.21.16. Current unreleased version is consolidated at 2.21.0. The matching core, document fetch/async XHR, same-realm classic/module/nested Blob worker adapters, scriptlet library and procedural actions exist. Session-cookie restart work and rejected iframe-VLC/custom-filter editor directions remain outside scope.

## Stages

- Delivered 2.21.17–20: extended applicability, native action observations, unchanged dynamic policy reuse, fetch query pruning and pinned legacy scriptlet aliases.
- Delivered 2.21.21: whole-third-party site policy with cached native variants and Hraimo list removal. Live user-assisted policy interaction/effects remain unverified; destination/type/URL policies remain pending.
- User accepted native WebKit fallback for HTTP(S) workers after Brave review; custom-protocol production integration is deferred. Synthetic classic/module/nested, CSP and redirect evidence remains in the worker handoff. Cookie transfer and transport cancellation gaps are not shipped. Shared/service coverage remains a documented boundary, not claimed full-uBO equivalence.
- Implemented in unreleased 2.21.0: ready upstream-engine snapshots with source/PSL fingerprint validation, compiled/source recovery, isolated background replacement and newest-generation-only publication. Actual Swift/JSC lifecycle and snapshot harnesses pass; Simulator build/install/launch succeeded.
- Delivered 2.21.23: strict-document matching and native block explanation, plus explicit Default and shortened policy menu at user request. Continue broader modifier propagation, source-rule decision provenance and live dialog verification.
- Delivered in unreleased 2.21.0: winning strict-document/dynamic rule explanations using upstream decision logData; precedence/noop/snapshot harnesses passed and Simulator delivered. Native dialog interaction remains unobserved. Exact original source/line provenance remains pending.
- Deferred: compatible redirects/surrogates and page response delivery, preserving request/response semantics and trust boundaries.
- Delivered 2.21.22: parser capability versus syntax rejection reasons. Continue AdGuard argument, procedural runtime and lifecycle audits; user-assisted policy interaction remains partially observed.
- Finalized: capability matrix distinguishing delivered, native fallback, unsupported with concrete reason, and unverified interactions. Compilation is not behavioral evidence.

Verification uses focused production-source harnesses, requested Simulator build/install/launch, and live observations when available. A UI timeout stops that path; an absent initial console result is not proof that input did not execute. No diagnostic HTTP backdoor.
