# Apple TV safeguards

Use the [public delivery-script guide](../../scripts/README.md) for Mac builds and [atvloadly deployment guide](../DEPLOYMENT.md) for Linux signing and renewal. This runbook records safety requirements; it is not evidence that a device has been inspected or backed up.

## Authorization and identity

- Physical-TV discovery, inspection, backups, installation and launch require current user authorization. Historical records are not authorization.
- Keep the paired device UUID and expected app identity in ignored `scripts/Deployment.local.env`; signing overrides belong in ignored `Signing.local.xcconfig`.
- Preserve the development team and bundle identifier when updating an existing installation. Do not uninstall an app to work around an installation or identity error when its data matters.

## Before storage paths, migrations or retention change

1. Obtain authorization for device work and identify the intended app and device through the authorized delivery workflow.
2. Export a complete copy of the existing app's data container using the installed Xcode tooling or another explicitly authorized container-backup method. Store it under ignored `.data/` or another private location.
3. Confirm that the export completed and includes the relevant history/session databases, their SQLite WAL/SHM companions where present, and preferences. A copy of one database without its live sidecars is not proof of a complete backup.
4. Retain an untouched original backup. Inspect only a private working copy and record sanitized evidence that it is readable and covers the state being changed. Do not publish the database, browsing records or account state.
5. Perform the change only after these prerequisites are met. Without device permission or a usable backup workflow, leave dependent migration work pending; do not infer the live container's state from source code or a Simulator.

Ordinary launches must preserve browsing history and tabs. History is cleared only by an explicit user action, not by automatic age-based retention.

## Xcode service visibility

If a paired TV is visible to Xcode but a sandboxed authorized build cannot see it, treat that as a tool/service-access problem before changing signing, team, bundle identifier or device settings. An authorized build may need the normal shell escalation to use Xcode services outside the sandbox. Inspect the failure once; if access remains unavailable, stop and report the constraint rather than repeatedly resetting services or re-pairing.

## Verification and private evidence

Report build, install and launch separately. They do not establish that a player, remote control or automatic profile renewal works. Keep device IDs, full logs, copied containers, signed stream URLs and personal screenshots private. Publish only sanitized observations and safe numeric torrent events.
