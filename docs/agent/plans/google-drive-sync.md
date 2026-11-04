# Google Drive browser data transfer

## Goal

Automatically synchronize the app's Favorites and visit history across Apple TVs, and publish ordinary tabs for opening on another TV, through private per-device files in Google Drive. Keep website storage local. Use the Google OAuth device flow with the narrow `drive.appdata` scope and no server companion.

## Constraints and decisions

- Do not touch database location, fallback order, retention, or local backup recovery.
- Never upload credentials, cookies, website storage, or torrent payloads.
- Store the refresh token in Keychain; keep the OAuth client ID in ignored local configuration.
- Use stable visit IDs and per-record favorite revisions and tombstones so explicit local deletions propagate and concurrent edits converge.
- Use one Drive file per device so uploads never overwrite another device's changes. Merge in the local database, then publish the merged state.
- Preserve the existing local database backup behavior.
- Keep transfer operations on the TV. A phone or browser is needed only to approve Google's device sign-in code.
- Size target: at most 100 MB. Use resumable upload when the snapshot exceeds 5 MB.

## Steps

1. Add OAuth device sign-in, token refresh, and sign-out.
2. Add Drive appDataFolder list, upload, download, and failure handling.
3. Add versioned logical data export/import with validation, stable IDs, tombstones, and safe merge semantics.
4. Start sync on launch, resume, and local changes while the app is active. Add account status, manual Sync Now, and remote tabs UI.
5. Add tvOS controls and user instructions.
6. Once OAuth credentials are available, verify sign-in and transfer on simulator; device verification requires permission.

## Configuration prerequisite

The user has not created a Google OAuth client ID yet. Prepare ignored local configuration and public setup instructions without committing a personal credential.
