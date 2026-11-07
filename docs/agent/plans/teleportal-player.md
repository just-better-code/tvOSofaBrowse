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
