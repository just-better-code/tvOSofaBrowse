# Player compatibility and unified transport

## Acceptance

- Website double Center produces click detail 1, click detail 2 and dblclick across nested frames; native panel Center/Back behavior stays unchanged.
- Endpoint transport buttons combine Previous/restart (threshold <=5 s) and end-minus-two/Next, without duplicate central buttons.
- Player capability fallback is independent of the embedding domain; preserve iframe playback and site-owned episode lifecycle.
- Web headers use the top document title; torrent headers retain filenames.

## Stages

1. Unify click dispatch and retain original press timestamps through the asynchronous queue.
2. Combine transport actions and add a recognized-player control fallback.
3. Add page title headers, consolidate version 2.21.5 and documentation.

## Evidence and limits

Public Teleportal videoPage.b4b27c35.js embeds a Starlight iframe and sets the document SEO title. The iframe embeds /vplayer/. Public vp.starlight.digital/player.core.hls.js has a dblclick fullscreen handler, a Next control that fetches the next source and a lower-level next() method that does not perform equivalent fetching. The active Next control class in that snapshot is adt-kCdJnjy. The inner page supplies ui.fetch_next through starlight.fetchNext. No live tvOS playback has been observed for this change. Source evidence does not establish successful automatic episode transitions or exclude double advancement when near-end seeking and Next interact.

No build or automated tests are requested. Physical TV work, Git push and release publication require separate requests. Runtime acceptance remains pending: double click, Next, natural EOF, near-end plus Next, missing neighbors, buffering, title changes and fullscreen persistence. Do not re-route iframe video to VLC or synthesize ended.

## Implementation checkpoint

All three source stages are implemented. Playback interaction acceptance is pending. No runtime evidence establishes that automatic episode switching was broken by the browser or fixed by this stage. Next work, when requested: build on a macOS runner, inspect the real nested player using Safari on an authorized Simulator/TV, observe one natural completion and one combined End/Next, and verify no skipped episode. Do not add a second track command after ambiguous delivery.

## TV feedback and next checkpoint

User installed 2.21.5 and confirmed Next, title and double click. Previous and held seeking failed. Follow-up 2.21.6 adds the Previous control fallback and replaces seek gestures with Select press lifecycle handling. Pending: requested build and real remote checks for short press, hold beyond 0.6 s, acceleration, release/cancel, context-menu priority, and restart then Previous within five seconds. Natural EOF and double advancement remain unverified.

## 2.21.7 checkpoint

User confirms 2.21.6 Center seek press/hold works, Previous still fails, and physical arrows fail with possible duplicate press/release actions. Source follow-up adds recognized Starlight fetchPrevious source resolution and routes only native playback-owned presses before UIKit. Shared press driver now serves buttons and arrows. Preserve successful Next/Media Session and other-player routes. Pending build and real TV verification; no release is requested for this stage. Check Previous on an initially single-item playlist, subsequent Next, no predecessor, stale fetch on source/fullscreen change, one short action, held arrows and visible-panel focus.

The configured previous-source callback path is now vendor-independent under the shared source/group-playlist contract; Starlight's extension is only an optional resolver. Verify other players through their published capability adapters rather than guessed method names.

## 2.21.8 — Research-backed Starlight adapter

The user reports Previous still fails after 2.21.7; Next works well, but the header stays on the old containing page title. Public API observations on 2026-11-07 establish: current 92 -> HTTP 200 / episode 92; get/next -> HTTP 200 / episode 93; get/prev -> HTTP 404 / Not Found; get/ser -> HTTP 200 with seasons=null. The presence of fetchPrevious in the JavaScript was insufficient evidence of a usable server endpoint. Teleportal's page API contains seasonGallery.items 1–91, with each actual source hash, and the current episode 92 separately. Resolve the catalog's episode-91 hash via player-api: HTTP 200, episode 91, matching hash. Only metadata/statuses were printed; media responses remain untracked under /tmp.

The adapter is explicitly Starlight, with a separate Teleportal host-catalog provider. Keep Next untouched. Supply the host catalog through the existing authenticated status/volume relay to the actual video frame. Find the preceding numbered entry in the same project/season, use Starlight fetchVideo and its existing source setter, and reject stale player/group/source/fullscreen responses. Preserve observed newer sources when merging repeated host metadata. Do not call the observed-broken get/prev or claim generic support based on similarly named functions. Header uses text parsed from current source.title, preserving the page-title fallback for other players.

Pending: no TV interaction or build evidence yet. Verify 92 -> 91, Next -> Previous, header updates, first episode, request failures, cancellation and another player's unchanged behavior. Restart restoration is a separate unresolved integration: internal iframe Next leaves the host URL unchanged, so restoring that URL reopens the initial episode. Do not introduce app-specific episode preference storage or silently alter navigation.

## Ordered season catalogs, without title parsing

Public API comparison on 2026-11-07 disproved the episode-page gallery assumption: its recommendations omit the current item and vary in order (92's page lists 1..91; 91's lists 92,1..90). Use the actual season endpoint instead, exactly as seasonPage.7add9aa8.js does. The season catalogs are newest-first: K.O.D. 2026 has 92 entries, Kotlyarevskyi 6, Slipa 108, Shvydkari 12. Reopening the second catalog entry for the latter three matched its hash at index 1. Dates and display labels were inspected for research only; runtime selection uses neither.

Production provider now requests the parent season path, preserves slots and source hashes in server order, finds current by hash and selects index+1. At the oldest item stop. For current sources absent from the host catalog, use only an already loaded predecessor in Starlight's chronological playlist, not guessed numbering or an invented insertion into the host index. Unknown/invalid neighbors do not advance. Keep Next unchanged. Remove number/name parsing and project-title/season-title matching from selection; titles are presentation only.

Verification requested by user: extracted production provider and predecessor functions passed 225 assertions on the four real catalog responses, arbitrary nonnumeric source names, all item positions, oldest boundaries, absent current, loaded-playlist fallback and an invalid neighbor slot. JavaScript syntax check passed. Initial shell Node was missing; the available Node REPL passed the assertions, then user authorized installing official Node v26.13.0 LTS under ignored .data/tools after SHA-256 verification, and the local runtime passed the same checks. Repro: `.data/tools/node/bin/node .data/check-starlight-order.cjs`; fixtures and harness are ignored local research artifacts. This does not establish iframe/player execution, CORS/filter compatibility or TV behavior. No app build/delivery/release/push performed.
