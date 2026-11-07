# Build and delivery scripts

For **automatic signing from Linux**, follow [the atvloadly deployment guide](../docs/DEPLOYMENT.md). GitHub builds an unsigned IPA after manual workflow dispatch or release publication; atvloadly runs at home and handles signing, installation and renewal. No Apple credentials are needed in GitHub Actions.

## Local macOS delivery

`push-to-simulator.sh` builds, installs and launches through the tvOS Simulator. See the [Simulator runbook](../docs/agent/SIMULATOR_RUNBOOK.md).

`build-to-tv.sh` builds or delivers a signed app to an explicitly configured Apple TV. Device builds use the local `stable` branch through an isolated worktree; they do not build whichever branch happens to be checked out. Before using it:

1. Install both media dependencies with the bootstrap scripts.
2. Configure automatic signing in the ignored `Signing.local.xcconfig` as described in the [README](../README.md).
3. Ensure a local `stable` branch exists at the source revision you intend to deliver. The script does not fetch, merge or push it.
4. Copy and edit the local deployment settings:

   ```sh
   cp scripts/Deployment.local.env.example scripts/Deployment.local.env
   chmod 600 scripts/Deployment.local.env
   ```

Set `TV_DEVICE_ID` to your paired TV's UUID and `TV_EXPECTED_BUNDLE_IDENTIFIER` to the identifier in your local signing configuration. An existing local configuration should be edited rather than overwritten. The example uses environment defaults, so explicitly exported values can override it.

```sh
./scripts/build-to-tv.sh build
./scripts/build-to-tv.sh deploy
./scripts/build-to-tv.sh install --no-launch
./scripts/build-to-tv.sh launch
```

`--configuration Release` selects Release instead of Debug. `--device YOUR_APPLE_TV_UUID` selects an explicitly requested TV. `--dry-run` prints planned operations without accessing the TV. Build-only mode does not need a device UUID. Actual device work requires the user's authorization; configuration alone does not grant it.

## Local Xcode provisioning renewal

`push-to-tv.sh` preserves the macOS/Xcode renewal workflow as an alternative to atvloadly. Explicit `build`, `deploy`, `install` and `launch` modes delegate to `build-to-tv.sh`.

With no subcommand, it checks renewal state and, when due, requests a fresh profile through Xcode, builds `stable`, checks that profile validity increased and has at least six days left, and installs without launching. The default threshold is three days remaining. `--force` requests renewal immediately. Run this only as an intentional renewal action or from a scheduler you have configured yourself.

The default state file is `.data/tv-renewal.next-update`; `TV_RENEWAL_STATE_FILE` can select an existing private state file. Logs and profile-cache backups stay in ignored `.data/`. Profile-cache rollback is attempted on build or installation failure. Renewal needs a Mac with working Xcode account authentication and a reachable paired TV; it is not the Linux flow.

`build-stable-root.sh` is a sourced worktree helper, not a standalone command. The dependency bootstrap scripts are public and checksum-pinned. Runtime logs, local settings and renewal state are never committed.
