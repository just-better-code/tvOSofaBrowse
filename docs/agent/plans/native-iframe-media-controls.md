# Native fullscreen iframe media controls

Request: 2026-10-11. Implementation: 2.19.0. Runtime observation pending.

## Direction decision — 2026-10-11

The user selected the implemented unified media commands and shared controls instead of developing a separate native fullscreen AVPlayer for web video. This native panel keeps playback in the website and remains the chosen approach; it is not the rejected separate-player direction. Do not resume separate-player development without a new request. Torrent VLC playback remains in scope. The subsequent user request explicitly removed the separate AVPlayer, its asset loader, coordinator, input interception and menu setting in 2.20.1. The unified website media panel and torrent VLC remain. Build/install/launch do not establish additional interaction verification.

## Outcome

Show VLC-style native playback controls over expanded fullscreen iframe players while keeping playback in the website. Exclude audio and subtitle selectors. Use media commands rather than coordinate clicks for the native panel.

## Implementation

- Inject the media helper into the existing all-frame fullscreen bridge; route requests through the expanded iframe chain and return bounded playback state to a weak-owner native handler.
- Prefer registered Media Session actions; fall back to the current HTML video for play/pause and seeking. Disable unsupported previous/next actions.
- Use a native child controller for glass round buttons, progress/time, native focus, five-second hiding and the VLC held-seek intervals.
- Preserve website mouse interaction with the panel hidden. Scope commands to the current tab/document/fullscreen session. Suspend progress requests in parked tabs and while the app is inactive; stop held seeking on cancellation, exit or navigation.

## Remaining observation

Debug 2.19.0 was built, installed and launched on the test Apple TV successfully on 2026-10-11. Observe an actual supported cross-origin player: panel appearance/focus; play/pause; ±10/30 seeks; held seeks and release; previous/next availability; hidden-panel mouse access; nested fullscreen exit; tab switching and app inactivity. Compilation alone does not establish these outcomes. Do not resume the older website-control experiment without a separate request.
