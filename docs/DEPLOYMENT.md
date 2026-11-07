# Install and renew tvOSofaBrowse from Linux

GitHub Actions builds an **unsigned Apple TV IPA** after manual workflow dispatch or when a maintainer manually publishes a GitHub Release. Manual runs keep packages in Actions artifacts; release runs also attach them to the release. A Linux machine at home runs [atvloadly](https://github.com/bitxeno/atvloadly), signs the IPA with your Apple Account, installs it over the local network, and renews its provisioning before it expires. The Linux machine does not need Xcode or a paid Apple Developer membership.

## Requirements

- An Apple TV compatible with both the app and your atvloadly version. The setup below follows atvloadly v0.8.2, whose release targets tvOS 17.4 and later.
- A Siri Remote with a touch surface or touch-enabled clickpad.
- An always-on Linux host on the same trusted local network as the TV, with Docker Engine and the Docker Compose plugin installed.
- A dedicated Apple Account and access to its two-factor authentication codes. atvloadly requires normal Apple Account authentication; app-specific passwords are not supported by the documented upstream flow.
- Internet access to GitHub, Apple and the authentication services used by atvloadly.

Apple Account credentials, pairing records and signing material stay with atvloadly on your Linux host. The build workflow requires none of them. Keep atvloadly's data directory private, back it up, and do not commit it to Git.

## 1. Start atvloadly

On Debian or Ubuntu, install and start Avahi:

```sh
sudo apt-get update
sudo apt-get install -y avahi-daemon
sudo systemctl enable --now avahi-daemon
mkdir -p ~/atvloadly/data
cd ~/atvloadly
```

Save this as `compose.yaml` in that directory:

```yaml
services:
  atvloadly:
    image: bitxeno/atvloadly:v0.8.2
    hostname: atvloadly
    restart: unless-stopped
    security_opt:
      - seccomp:unconfined
    volumes:
      - ./data:/data
      - /var/run/dbus:/var/run/dbus
      - /var/run/avahi-daemon:/var/run/avahi-daemon
    ports:
      - "127.0.0.1:5533:80"
    ulimits:
      core: 0
```

This follows the [upstream Compose configuration](https://github.com/bitxeno/atvloadly/blob/v0.8.2/docker-compose.yml), with persistent data in a local directory, an explicit version and a localhost-only web port. The relaxed seccomp setting and host service mounts are upstream requirements; use a host you control.

```sh
docker compose pull
docker compose up -d
docker compose logs --tail=100 atvloadly
```

Open `http://127.0.0.1:5533` on the Linux host. For a headless host, forward the port from your workstation:

```sh
ssh -N -L 5533:127.0.0.1:5533 YOUR_USER@YOUR_LINUX_HOST
```

Then open the same localhost URL on the workstation. atvloadly has no built-in authentication; keep the port private rather than exposing it to the internet.

## 2. Pair and sign in

1. On Apple TV, open **Settings → Remotes and Devices → Remote App and Devices**.
2. Select the discovered TV in atvloadly and complete pairing with the PIN shown on the TV.
3. Select the paired TV and use Apple Account signing. Complete sign-in and 2FA when prompted.

Free-account certificates are shared across signing tools. Review any proposed certificate revocation carefully: revoking a certificate used by Xcode or another tool can stop its installed apps from launching.

## 3. Install from GitHub Releases

In atvloadly, add a GitHub source for:

```text
just-better-code/tvOSofaBrowse
```

Choose the release asset named `tvOSofaBrowse-VERSION-unsigned.ipa`, select your TV, and install using Apple Account signing. Enable source updates in atvloadly if you also want new app versions installed automatically. Keep stable releases selected; this repository publishes one Apple TV IPA per release.

For a manual download, open [Releases](https://github.com/just-better-code/tvOSofaBrowse/releases/latest), or use GitHub CLI:

```sh
mkdir -p tvosofabrowse-release
cd tvosofabrowse-release
gh release download --repo just-better-code/tvOSofaBrowse \
  --pattern '*.ipa' --pattern '*-notices.tar.gz' --pattern SHA256SUMS
sha256sum --check SHA256SUMS
```

Upload the verified IPA in atvloadly if you are not using a GitHub source. The unsigned package cannot be installed directly until atvloadly signs it. Source archives, notices and Simulator artifacts are not installable Apple TV packages.

## 4. Keep the app renewed

Leave the Linux host awake, atvloadly running, and the TV reachable. With Apple Account signing, atvloadly supports automatic provisioning renewal; check its status and expiry after the first installation and after a renewal. Downloading new versions and renewing the installed version are separate operations: renewal must continue even when no new GitHub Release exists.

Do not use imported P12/profile signing as a substitute for this flow: atvloadly does not automatically renew imported provisioning profiles, and signing again with the same expiring profile does not extend its validity.

Keep the same Apple Account, effective bundle identifier and app entry for updates. atvloadly may rewrite the bundle identifier; switching from an existing Xcode installation can create a separate app or prevent an in-place update. Do not uninstall the existing app to resolve this if its history, tabs or torrent data matter. This guide does not promise data migration between signing identities.

To confirm the outcome, open tvOSofaBrowse on the TV, check its version, then check that a later automatic renewal advances the expiry and the app still opens. CI success alone does not establish either observation.

## Troubleshooting and maintenance

- **TV not discovered:** check that both machines share the local network, reopen the TV pairing screen, check Avahi and multicast/firewall settings. VPNs, VLANs and guest-network isolation can block discovery. See the [upstream troubleshooting guide](https://github.com/bitxeno/atvloadly#faq).
- **Authentication or renewal fails:** inspect atvloadly's status and logs for 2FA, session or certificate errors. Complete any required account authentication; do not repeatedly revoke certificates.
- **Installation fails after a tvOS update:** check support in the current atvloadly release and re-pair if required.
- **Release appears without an IPA:** the manually published release starts the build. Wait for its [Actions run](https://github.com/just-better-code/tvOSofaBrowse/actions) to finish; failed builds do not attach an IPA. The atvloadly source picker skips releases without a compatible IPA and can show the preceding version until upload completes; click Fetch again afterward.
- **Backups:** back up the whole `data/` directory while the service is stopped. It contains sensitive account and pairing state. Avoid `docker compose down --volumes` and deleting the data directory during ordinary upgrades.
- **Update atvloadly:** review upstream release notes, change the image tag in `compose.yaml`, then run `docker compose pull` and `docker compose up -d`.

## Maintainers: build a branch without publishing a release

The build workflow supports `workflow_dispatch`. In GitHub Actions, select **Build tvOSofaBrowse**, click **Run workflow**, and choose the branch or tag to build. Both Simulator Debug and Apple TV Release are built without signing; download the packages from the run artifacts. This does not create a release or upload release assets.

From Linux with authenticated GitHub CLI:

```sh
gh auth login
gh workflow run build.yml --ref YOUR_BRANCH
gh run list --workflow build.yml --event workflow_dispatch
gh run watch RUN_ID --exit-status
gh run download RUN_ID --name tvOSofaBrowse-device-Release-COMMIT_SHA
```

The selected revision must contain this workflow and the optional-tag version helper. The existing build workflow is already registered in this repository; branch dispatch was verified without modifying master. A newly introduced workflow may first need registration on the default branch. Manual builds validate that Debug and Release share a semantic marketing version, without requiring a release tag. The IPA still requires local signing before installation. Workflow completion does not prove Simulator interaction, TV behavior or filter preparation timing.

## Maintainers: publish a release manually

Release publication uses **`release: published`**; manual branch builds use **`workflow_dispatch`**. Pushes, tags alone, pull requests and release edits do not start builds. The release workflow uses GitHub-hosted macOS with Xcode; everyday editing and release creation can happen from Linux.

1. Set the same `MARKETING_VERSION` in Debug and Release, and maintain the corresponding changelog entry.
2. Commit and push the intended source. Create a `vMAJOR.MINOR.PATCH` tag on that exact commit and push the tag.
3. In **GitHub → Releases → Draft a new release**, select that tag, enter the release notes and click **Publish release**. Publishing, rather than saving a draft, triggers the build.
4. Alternatively, publish with your authenticated GitHub CLI after preparing a notes file containing the relevant changelog groups:

   ```sh
   gh release create vMAJOR.MINOR.PATCH --verify-tag \
     --title 'tvOSofaBrowse MAJOR.MINOR.PATCH' --notes-file release-notes.md
   ```

   The Git tag (`vMAJOR.MINOR.PATCH`) identifies the source commit; the release title (`tvOSofaBrowse MAJOR.MINOR.PATCH`) is only its display name. The workflow is loaded from the tagged commit, so that commit must contain the intended workflow even if it is on a feature branch.

5. Follow the release run:

   ```sh
   gh run list --workflow build.yml --event release
   gh run watch RUN_ID --exit-status
   gh release view vMAJOR.MINOR.PATCH
   ```

The workflow validates the tag, builds Simulator Debug and Apple TV Release without signing, checks the IPA, and attaches the IPA, notices archive and `SHA256SUMS` only after both builds pass. Simulator packages remain available as Actions artifacts. App artifacts last 14 days and build diagnostics last 7 days; release assets remain until removed.

An unchanged failed run can be retried with `gh run rerun RUN_ID --failed`; no new release is needed. A source fix belongs in a new commit and a new version/tag, rather than moving an existing published tag. There is no workflow that creates releases automatically.

See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licenses and source references. The app uses private tvOS/WebKit APIs and is intended for personal sideloading outside the App Store.
