# Send links to Apple TV

## User outcome

From an iPhone or iPad on the same local network, open a QR-linked page to send a URL into a new browser tab. A Share Sheet shortcut should send a shared URL without pasting it into the page. No account or separate iOS app is required. The TV browser must be active.

## Implementation

- Add a dedicated bounded HTTP receiver on a fixed LAN port, independent of the torrent loopback server.
- Keep a random receiver token in app preferences; require the token and POST for opening URLs. Accept only HTTP(S), enforce request-size/time limits, and avoid logging tokens or browsing URLs.
- Add a native Send to TV screen in the existing menu's vacant Settings slot, showing a QR code and local address without moving existing controls.
- Serve a small phone form and a signed, generic shortcut with a one-time import question for the TV endpoint.
- Open accepted links through the existing tab coordinator; preserve history and existing tabs. Return an explicit error while playback or an unrelated modal is visible.

## Validation and deployment

The current user authorized the feature after discussing the local page and Shortcut. Build/deployment follows the ongoing test deployment workflow; destructive tests are not required. Phone setup and end-to-end sharing require the user's observation. Do not claim that a successful build or HTTP response proves the phone Shortcut works.

## Status

Implementation in progress. The earlier MDN opening attempt was abandoned after LLDB preparation paused the TV browser; debugger detached and app process resumed. Open MDN through the receiver once available.
