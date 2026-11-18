# Unified playback controls, episode routing and metadata

## Goal and invariants

Unify app-owned controls and website episode routing while keeping WebKit and VLC as separate playback engines. Website controls and playlist ownership remain unchanged. Do not force website auto-advance or fullscreen retention. Preserve the 0.1 s capture threshold, immediate visible VLC, paused mid-Back return, separate genuine EOF path, native focus/held seeking and per-site preferences.

The implementation plan was approved in conversation and saved initially at the user's OpenCode plan location. This tracked checkpoint is the implementation source of truth.

## Stages

1. **Shared episode adapters and metadata, existing panels retained.** Route WebKit and VLC through one adapter registry with explicit unsupported/boundary/submitted outcomes. Keep Teleportal Previous enabled only in the existing WebKit path. Synchronize verified episode identity/title and known canonical URL independently of control-panel visibility. Update a visible VLC title without waiting for a new player instance.
2. **Shared playback session interface.** Expose common commands, transport state and capabilities while retaining backend-specific playback and source/dismissal guards. VLC owns its playback clock; website adapters own episode selection; torrent file navigation stays separate.
3. **One native playback panel.** Consolidate layout, controls, focus, held seeking and auto-hide using the existing approved UI and shared symbols. Adopt the panel one renderer at a time without replacing website UI or introducing a new theme.

## Acceptance

- Actual UASerials Next/Previous/completion, Teleportal Next in WebKit and VLC, and UAKino site-owned completion: no duplicate dispatch, stale-source operation or synthetic ended event.
- For a known Teleportal catalog entry, confirm title and URL changes without page reload, extra history entries or app-owned video replacement. Unknown entries must not invent a URL. Preserve history state, query and fragment.
- Keep capture eligibility and backend clocks unchanged. Metadata must not apply paused HTML time to VLC or recreate fullscreen UI while VLC is presented.
- Validate Linux WebKit with production scripts/adblock and actual libVLC before experimental app delivery. UIKit focus, actual MediaRemote routing and native saved-session restoration require tvOS evidence.
- Maintain separate implementation commits/checkpoints. Keep consolidated unreleased version 2.22.0 unless release status changes.

## Starting evidence and boundaries

Baseline source: `90003cb`. Working actual-site routing checks and limitations are in DEVELOPMENT_HISTORY.md. UAKino currently loses website fullscreen when its leaf iframe navigates; do not change website navigation or globally suppress pagehide cleanup to mask that. Teleportal natural completion stopped at episode 92 even in plain WebKit without the app media bridge; retain that website choice.

## Resumable checkpoint

- Stage 1 implemented: `mediaEpisodeAdapters` serves both renderers. Accepted source metadata travels with the pause ACK and updates the native title independently of WebKit UI state. Catalogue completion reapplies the latest still-owned metadata, including while the panel is suspended. WebKit's generic URL-generation invalidation remains strict; media calls use a separate playback-document generation that survives replaceState but expires on navigation, explicit load/reload/back/forward, process loss and tab invalidation.
- Actual public Teleportal 92 → 93 → 94 passes in both WebKit and Linux libVLC, including title/canonical path, unchanged top-document token, unchanged history length and unchanged video node. Controlled delayed-catalog/unknown-entry coverage passes preservation of history state, query and fragment. Native generation guards, UIKit title rendering and saved-session restoration remain pending tvOS evidence.
- Stages 2 and 3 pending. No native build or device work is implied by source implementation.
