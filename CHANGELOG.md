# Changelog

This personal-use project's retrospective versions do not correspond to published releases or Git tags.

## 2.21.19 - 2026-10-11

### Added

- Apply upstream removeparam rules to GET and HEAD fetch requests in pages and supported Blob workers while preserving request options and remaining query parameters ([Request adapter](_Project/Vendor/UBlock/UBlockRequests.js)).

## 2.21.18 - 2026-10-11

### Added

- Report applied native WebKit content-rule actions in the bounded Debug buffer and Ad Block coverage counters without retaining request URLs ([Native adapter](_Project/Browser/BrowserWebView.m)).

### Fixed

- Reuse unchanged dynamic network rules between request decisions to avoid repeatedly parsing the policy ([Network adapter](_Project/Vendor/UBlock/network.js)).

## 2.21.17 - 2026-10-11

### Added

- Apply uBlock entity, regex, URL-path and ancestor-frame scriptlet scopes with Public Suffix List-aware entities and matching exclusions ([Domain adapter](_Project/Vendor/UBlock/domains.js)).

## 2.21.16 - 2026-10-11

### Added

- Extend uBlock fetch and asynchronous XHR filtering to supported module Blob workers and their nested Blob workers ([Request adapter](_Project/Vendor/UBlock/UBlockRequests.js)).

### Fixed

- Release worker bridges when their document leaves history caching or the worker closes, and count nested worker readiness once ([Request adapter](_Project/Vendor/UBlock/UBlockRequests.js)).

## 2.21.15 - 2026-10-11

### Added

- Apply uBlock fetch and asynchronous XHR decisions inside supported classic Blob workers and report worker readiness and bypasses in diagnostics ([Ad Block coverage](docs/USER_GUIDE.md#browser-menu), [Request adapter](_Project/Vendor/UBlock/UBlockRequests.js)).

## 2.21.14 - 2026-10-11

### Fixed

- Restore saved cookies with the compatible archive decoder and reject malformed cookie archives before applying them ([BrowserWebView](_Project/Browser/BrowserWebView.m)).

## 2.21.13 - 2026-10-11

### Fixed

- Discard delayed page-control results after switching tabs or revisiting the same URL through page history ([BrowserWebView](_Project/Browser/BrowserWebView.m)).
- Keep text dialogs attached to their original field and prevent stale dialogs from editing replacement fields ([Page actions](_Project/Browser/BrowserPageActionCoordinator.m)).

## 2.21.12 - 2026-10-11

### Fixed

- Prevent large advanced-filter scripts from overflowing the JavaScript stack on injection ([Filter converter](_Project/Browser/BrowserAdBlockConverter.swift)).
- Apply cached WebKit protection before the full uBlock runtime finishes preparing and reuse unchanged bundled-filter caches across app deliveries ([User Guide](docs/USER_GUIDE.md)).
- Restore the UNSENT state after canceling a filtered XHR and require a fresh open before sending again ([Request adapter](_Project/Vendor/UBlock/UBlockRequests.js)).

## 2.21.11 - 2026-10-11

### Added

- Apply uBlock network decisions to page fetch and asynchronous XHR requests through a bounded WebKit reply bridge ([User Guide](docs/USER_GUIDE.md), [Network adapter](_Project/Vendor/UBlock/README.md)).

## 2.21.10 - 2026-10-11

### Added

- Scroll pages when continued pointer movement reaches the top or bottom edge, except in fullscreen ([User Guide](docs/USER_GUIDE.md)).

## 2.21.9 - 2026-10-11

### Added

- Compile full upstream uBlock static and dynamic network engines in the background and apply bounded navigation decisions to pages and frames ([User Guide](docs/USER_GUIDE.md), [Network adapter](_Project/Vendor/UBlock/README.md)).

## 2.21.8 - 2026-10-11

### Changed

- Replace synchronous page-control and cookie waits with asynchronous operations that discard obsolete page results ([User Guide](docs/USER_GUIDE.md)).
- Register browser scripts by component so diagnostic and Ad Block updates preserve interaction and player scripts ([BrowserWebView](_Project/Browser/BrowserWebView.m)).

## 2.21.7 - 2026-10-11

### Changed

- Move the compact This Site toggle immediately left of Ad Block in the settings header ([User Guide](docs/USER_GUIDE.md)).

## 2.21.6 - 2026-10-11

### Fixed

- Open pages without waiting for filter compilation, then reload with the prepared Ad Block policy when it becomes available ([User Guide](docs/USER_GUIDE.md)).

## 2.21.5 - 2026-10-11

### Removed

- Remove manual custom-filter entry from Ad Block settings and hide the empty My Filters row to simplify remote-control use ([User Guide](docs/USER_GUIDE.md)).

## 2.21.4 - 2026-10-11

### Fixed

- Preserve the requested page during Ad Block preparation and defer filter refreshes until navigation finishes to prevent reloading the initial blank document ([Browser navigation](_Project/Browser/BrowserWebView.m)).

## 2.21.3 - 2026-10-11

### Changed

- Move VLC Audio and Subtitles selectors to the right edge of the playback panel ([User Guide](docs/USER_GUIDE.md)).

### Added

- Add Go to End beside Play/Pause in VLC to seek near the known media duration ([User Guide](docs/USER_GUIDE.md)).

### Fixed

- Keep iframe playback and episode navigation in the website player with its existing fullscreen controls ([User Guide](docs/USER_GUIDE.md)).

## 2.21.2 - 2026-10-11

### Fixed

- Compile generic uBO cosmetic rules without querying an absent domain iterator, keeping the advanced filtering runtime available ([uBO components](_Project/Vendor/UBlock/README.md)).

## 2.21.0 - 2026-10-11

### Added

- Apply pinned full-uBO scriptlets and procedural cosmetic filters alongside WebKit protection, with a bundled uBlock list, remembered site exceptions, local custom filters and source-aware coverage diagnostics ([User Guide](docs/USER_GUIDE.md), [uBO components](_Project/Vendor/UBlock/README.md)).

## 2.20.4 - 2026-10-11

### Fixed

- Keep iframe video in the website player with its existing fullscreen controls and episode lifecycle, reserving direct VLC playback for the main document ([User Guide](docs/USER_GUIDE.md)).

## 2.20.3 - 2026-10-11

### Fixed

- Pass matching browser cookies, User-Agent and policy-aware page or iframe Referer to direct web-video playback in VLC for cookie-authenticated sources ([User Guide](docs/USER_GUIDE.md)).

## 2.20.2 - 2026-10-11

### Fixed

- Reopen finished VLC media for replay, restart and seeking so controls remain usable after the first playback ends ([User Guide](docs/USER_GUIDE.md)).

## 2.20.1 - 2026-10-11

### Changed

- Enable Safari Web Inspector only while the Debug switch is on in a development build, and disconnect inspection when diagnostics are disabled ([User Guide](docs/USER_GUIDE.md)).

## 2.20.0 - 2026-10-11

### Added

- Play direct HTTP(S) web video in the shared embedded VLC player on fullscreen or Center on a standard video, preserving its position and domain volume when returning to the page ([User Guide](docs/USER_GUIDE.md)).

### Removed

- Remove torrent handoff to the external VLC app and its file action while retaining embedded VLC streaming ([User Guide](docs/USER_GUIDE.md)).

## 2.19.20 - 2026-10-11

### Removed

- Remove the separate native fullscreen web-video player and its Full Screen Player setting while retaining unified media controls and VLC torrent playback ([User Guide](docs/USER_GUIDE.md)).

## 2.19.19 - 2026-10-11

### Added

- Choose This Site, All or Cancel before clearing cache, cookies or history, and reset saved volume, zoom and tab previews alongside cache in the selected scope ([User Guide](docs/USER_GUIDE.md)).

## 2.19.18 - 2026-10-11

### Fixed

- Preserve player volume for each page domain across fullscreen iframe sessions, episode changes and native video playback ([User Guide](docs/USER_GUIDE.md)).

## 2.19.17 - 2026-10-11

### Changed

- Group mute between the volume buttons and separate audio controls from the independently centered main row by half a button width in iframe and VLC playback ([User Guide](docs/USER_GUIDE.md)).

## 2.19.16 - 2026-10-11

### Changed

- Place volume buttons in a separate group to the right of iframe and VLC controls while keeping the main row centered independently ([User Guide](docs/USER_GUIDE.md)).

## 2.19.15 - 2026-10-11

### Added

- Adjust player volume in 10% steps with quieter and louder buttons beside mute in fullscreen iframe and VLC controls, and show the current level on the panel ([User Guide](docs/USER_GUIDE.md)).

## 2.19.14 - 2026-10-11

### Changed

- Seek one second before the end with Go to End in fullscreen iframe playback controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.13 - 2026-10-11

### Fixed

- Allow web media to start without another website gesture so episode transitions can continue with sound instead of triggering a player’s muted autoplay fallback ([User Guide](docs/USER_GUIDE.md)).

## 2.19.12 - 2026-10-11

### Changed

- Keep Go to End exclusively in fullscreen iframe controls ([User Guide](docs/USER_GUIDE.md)).

### Added

- Toggle mute with a state-aware speaker button in fullscreen iframe and VLC playback controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.11 - 2026-10-11

### Changed

- Seek five seconds before the end with Go to End in iframe and VLC playback controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.10 - 2026-10-11

### Changed

- Add Go to End immediately after Play/Pause to seek two seconds before the end, and use reference icons seven, ten and eight for Beginning, Play/Pause and End in iframe and VLC controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.9 - 2026-10-11

### Changed

- Place Go to Beginning before Play/Pause and enlarge both buttons and icons by 20% while preserving centered row alignment in iframe and VLC playback controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.8 - 2026-10-11

### Changed

- Move Go to Beginning immediately after Play/Pause and show a right-facing triangle with a leading bar in both fullscreen iframe and VLC controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.7 - 2026-10-11

### Changed

- Use the combined Play/Pause triangle-and-bars icon in fullscreen iframe and VLC controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.6 - 2026-10-11

### Changed

- Unify fullscreen iframe and VLC playback icons with classic transport triangles and bars using consistent vector proportions ([User Guide](docs/USER_GUIDE.md)).

## 2.19.5 - 2026-10-11

### Changed

- Match Play/Pause to the seek transport symbols, remove redundant Close controls, and place Previous and Next at opposite ends of the fullscreen iframe and VLC control rows ([User Guide](docs/USER_GUIDE.md)).

## 2.19.4 - 2026-10-11

### Changed

- Separate Go to Beginning from Previous and use classic transport triangles for 5- and 10-second seeks in fullscreen iframe and VLC playback controls ([User Guide](docs/USER_GUIDE.md)).

## 2.19.3 - 2026-10-11

### Fixed

- Route fullscreen Previous and Next through system Now Playing media commands so WebKit can select the active media session instead of receiving synthetic keyboard events ([User Guide](docs/USER_GUIDE.md)).

## 2.19.2 - 2026-10-11

### Changed

- Keep Previous and Next active in fullscreen iframe controls and attempt media commands regardless of detected support, while hiding the cursor during native fullscreen control use ([User Guide](docs/USER_GUIDE.md)).

## 2.19.1 - 2026-10-11

### Fixed

- Keep fullscreen iframe playback controls visible while the video is paused or the browser cursor is visible, and retain cursor movement with the panel open ([User Guide](docs/USER_GUIDE.md)).

## 2.19.0 - 2026-10-11

### Added

- Add a native VLC-style playback panel to expanded fullscreen iframe players with progress, playback and seek controls routed to the website's media handlers or HTML video, without audio or subtitle selectors ([User Guide](docs/USER_GUIDE.md)).

## 2.18.30 - 2026-10-11

### Changed

- Shift the round New Tab button farther left by half its diameter for clearer separation from the tab previews ([User Guide](docs/USER_GUIDE.md)).

## 2.18.29 - 2026-10-11

### Changed

- Move the round New Tab button farther left by half the plus icon width ([User Guide](docs/USER_GUIDE.md)).

## 2.18.28 - 2026-10-11

### Changed

- Shift the round New Tab button slightly left in the tab overview ([User Guide](docs/USER_GUIDE.md)).

## 2.18.27 - 2026-10-11

### Changed

- Show New Tab as a compact round plus button in its existing overview position, with focus highlighting on the button instead of a full preview card ([User Guide](docs/USER_GUIDE.md)).

## 2.18.26 - 2026-10-11

### Changed

- Release inactive webpages five minutes after switching away while retaining their tabs, navigation lists, scroll positions and cached previews, and reload them when selected ([User Guide](docs/USER_GUIDE.md)).

## 2.18.25 - 2026-10-11

### Changed

- Open the tab overview without loading inactive websites, reuse disposable card-sized previews across launches, and show the domain and title when a preview is unavailable ([User Guide](docs/USER_GUIDE.md)).

## 2.18.24 - 2026-10-10

### Changed

- Activate website diagnostic polling and storage interception only while Debug is enabled, and apply toggles to open pages and frames without reloading ([User Guide](docs/USER_GUIDE.md)).

### Removed

- Remove storage key names from website diagnostic messages and log entries ([User Guide](docs/USER_GUIDE.md)).

## 2.18.23 - 2026-10-10

### Removed

- Remove the disabled YouTube native-stream extractor and its request-capture script to avoid injecting unused interception code into webpages ([User Guide](docs/USER_GUIDE.md)).

## 2.18.22 - 2026-10-10

### Changed

- Request media diagnostics, fallback media pause, and YouTube page configuration asynchronously, and discard delayed diagnostics or playback results after the originating page or tab changes ([User Guide](docs/USER_GUIDE.md)).

## 2.18.21 - 2026-10-10

### Changed

- Shorten the Up/Down hold acceleration and moderately increase its maximum speed while preserving the initial speed and short-press scroll step ([User Guide](docs/USER_GUIDE.md)).

### Removed

- Remove touchpad swipe scrolling and release inertia, retaining touchpad pointer control and arrow-button page scrolling ([User Guide](docs/USER_GUIDE.md)).

## 2.18.20 - 2026-10-10

### Removed

- Remove disabled fullscreen experiments, the unreachable WKWebView proof of concept, unused helpers, and the retired AVPlayer torrent loader while retaining current VLC playback ([User Guide](docs/USER_GUIDE.md)).

### Fixed

- Reload the active webpage after WebKit process termination with at most two automatic attempts per crash burst and a renewed budget after 60 seconds without termination ([User Guide](docs/USER_GUIDE.md)).

## 2.18.19 - 2026-10-10

### Fixed

- Expand option report titles across the available row width instead of reserving empty badge and detail space ([User Guide](docs/USER_GUIDE.md)).

## 2.18.18 - 2026-10-10

### Fixed

- Control all app-owned logs, website diagnostics and Background Probe with the single Debug switch, stop active probes when off, and place the same master button above report actions in Ad Block-style options ([User Guide](docs/USER_GUIDE.md)).

## 2.18.17 - 2026-10-10

### Changed

- Toggle diagnostics directly with Center on the Debug menu tile and open its existing options by holding Center, matching Ad Block controls ([User Guide](docs/USER_GUIDE.md)).

## 2.18.16 - 2026-10-10

### Fixed

- Remember page zoom separately for each domain across navigation, tabs and launches, and reset only the current domain to 100% ([User Guide](docs/USER_GUIDE.md)).

## 2.18.15 - 2026-10-10

### Changed

- Replace Purge All with Delete All to remove every listed torrent and its cached files after confirmation ([User Guide](docs/USER_GUIDE.md)).

### Added

- Add Reset All beside Delete All to reset every torrent through the existing per-torrent operation while retaining sources with all files skipped ([User Guide](docs/USER_GUIDE.md)).

## 2.18.14 - 2026-10-10

### Fixed

- Highlight the entire Ad Block master toggle in Options as a compact button beside the Settings heading so remote focus is easier to see ([User Guide](docs/USER_GUIDE.md)).

## 2.18.13 - 2026-10-10

### Fixed

- Restore compiled Ad Block rules before converting filters again on subsequent launches, falling back to preparation when filters change or compiled chunks are missing ([User Guide](docs/USER_GUIDE.md)).

## 2.18.12 - 2026-10-08

### Fixed

- Center Ad Block Options again and increase its height by one and a half filter rows as requested ([User Guide](docs/USER_GUIDE.md)).

## 2.18.11 - 2026-10-08

### Changed

- Move the Ad Block Options panel upward by one and a half filter rows ([User Guide](docs/USER_GUIDE.md)).

## 2.18.10 - 2026-10-08

### Changed

- Use the browser menu's shared ON/OFF badge for filter controls and the guide preference, align filter toggles at the row edge, and remove the extra container around the Settings toggle ([User Guide](docs/USER_GUIDE.md)).

## 2.18.9 - 2026-10-08

### Changed

- Match the Settings Ad Block toggle to the browser menu's green ON and gray OFF indicators ([User Guide](docs/USER_GUIDE.md)).

## 2.18.8 - 2026-10-08

### Changed

- Put the master Ad Block switch beside the Settings heading and leave only individual filters in the list below ([User Guide](docs/USER_GUIDE.md)).

## 2.18.7 - 2026-10-08

### Changed

- Place Update Filters Now beside Done below the Ad Block filter controls ([User Guide](docs/USER_GUIDE.md)).

## 2.18.6 - 2026-10-08

### Changed

- Narrow the Ad Block settings panel by half and place Done in a compact button below the filter controls ([User Guide](docs/USER_GUIDE.md)).

## 2.18.5 - 2026-10-08

### Changed

- Show each Ad Block filter's version or update date beside its switch instead of listing filter status above the controls ([User Guide](docs/USER_GUIDE.md)).

### Fixed

- Keep six selected AdGuard sources, preserve working rules when another source fails to compile, and block the observed Hraimo banner source across websites ([User Guide](docs/USER_GUIDE.md)).

## 2.18.4 - 2026-10-07

### Added

- Add four separately controlled AdGuard sources for wider ad, tracking, and annoyance coverage ([User Guide](docs/USER_GUIDE.md)).

## 2.18.3 - 2026-10-07

### Fixed

- Refresh Ad Block filter status inside the open settings popup as downloads finish, and show failed updates without hiding the cached copy ([User Guide](docs/USER_GUIDE.md)).

## 2.18.2 - 2026-10-07

### Changed

- Convert AdGuard Base and Ukrainian filters on Apple TV for broader network and cosmetic blocking, and open filter settings by holding Center on Ad Block ([User Guide](docs/USER_GUIDE.md)).

## 2.18.1 - 2026-10-07

### Fixed

- Download and cache a broader advertising and tracking filter, reserve bundled custom rules for gaps in that filter, and suppress script-opened external popups when Ad Block is enabled ([User Guide](docs/USER_GUIDE.md)).

## 2.18.0 - 2026-10-07

### Added

- Synchronize Favorites and visit history across Apple TVs through a private Google Drive app folder, and open tabs published by another TV ([User Guide](docs/USER_GUIDE.md#google-drive-sync)).

## 2.17.17 - 2026-10-04

### Fixed

- Hand external VLC an ASCII-only stream URL by transliterating the media filename and replacing unsupported characters ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.16 - 2026-10-04

### Fixed

- Match the external VLC cone icon to the monochrome torrent controls in normal, focused and unavailable states ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.15 - 2026-10-04

### Fixed

- Fit round glass playback controls and compact track selectors in one row, with native track menus on supported tvOS versions ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.14 - 2026-10-04

### Fixed

- Keep the VLC cone button beside its torrent row and use the media filename as the external VLC stream title ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.13 - 2026-10-04

### Added

- Open a torrent file in the installed VLC app from its file-row icon while Keep Alive serves the file through the browser's local HTTP stream, and show setup guidance when VLC or Keep Alive is unavailable ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.12 - 2026-10-04

### Added

- Choose an available audio track or subtitle track from the VLC player's bottom controls, including Off when the media supports it ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.11 - 2026-10-04

### Fixed

- Install the TVVLCKit simulator slice alongside the device slice so a clean Apple TV Simulator build can link torrent playback ([bootstrap script](scripts/bootstrap-vlc-deps.sh)).

## 2.17.10 - 2026-10-04

### Changed

- Fit the browser menu on a 1080p screen with a full-width address bar, six navigation buttons, three-column actions and a wider User Guide tile ([user guide](docs/USER_GUIDE.md#main-menu)).

## 2.17.9 - 2026-10-04

### Added

- Rewind or fast-forward continuously while holding a player seek button, with larger steps after holding the 30-second button for ten seconds ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.8 - 2026-10-04

### Added

- Resume each torrent media file from its saved playback position and clear that position when playback finishes or its torrent data is removed ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.7 - 2026-10-04

### Fixed

- Pause torrent playback when the app becomes inactive, ignore touchpad direction gestures while player controls are hidden, and hide the status header with the controls during playback ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.6 - 2026-10-04

### Fixed

- Show the selected file's completion percentage while buffering or streaming, and label files and torrents Complete only when their selected bytes are fully downloaded ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.5 - 2026-10-04

### Fixed

- Prioritize playback and requested torrent pieces so streaming can start before the selected file finishes downloading ([User Guide](docs/USER_GUIDE.md)).

## 2.17.4 - 2026-10-04

### Added

- Reset a torrent from its context actions by deleting its cached files and restoring its source with every file skipped ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.3 - 2026-10-04

### Changed

- Show a download symbol for starting all files in a torrent and move Remove into the torrent's context actions ([user guide](docs/USER_GUIDE.md#torrents)).

### Added

- Browse torrent folders and choose an individual file or whole folder from a focusable download icon without starting playback or every file ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.2 - 2026-10-04

### Changed

- Move the background runtime probe result into Debug and add a master diagnostic switch with ten recent numeric log entries ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.1 - 2026-10-04

### Added

- Offer system-managed background refresh and processing opportunities for manually started torrents, and show a torrent-free runtime probe to measure actual execution after leaving the browser ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.17.0 - 2026-10-04

### Changed

- Show the native New Tab, History, Torrents, and playback controls with a shared tvOS page style and remote focus behavior ([user guide](docs/USER_GUIDE.md)).
- Open newly imported torrents in the overall list with the new row focused, richer transfer details, and a saved priority order ([user guide](docs/USER_GUIDE.md#torrents)).

### Added

- Control a focused torrent with Start, priority, and Delete icons, and purge downloaded data without removing torrent entries ([user guide](docs/USER_GUIDE.md#torrents)).

### Removed

- Remove the manual Add Torrent and unlisted-file Clean Cache actions while keeping website link import and the cache-size hint ([user guide](docs/USER_GUIDE.md#torrents)).

### Fixed

- Continue manually started torrent downloads while browsing websites with Torrents closed, and apply saved file choices when metadata arrives ([user guide](docs/USER_GUIDE.md#background-downloads)).
- Return from a torrent's file list to the overall list with Back and preserve the proportions of VLC control symbols ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.16.0 - 2026-10-04

### Changed

- Wait for file selection before downloading payloads of newly imported torrents so unwanted files stay skipped ([user guide](docs/USER_GUIDE.md#torrents)).

### Added

- Open the built-in torrent library from website magnet and `.torrent` links, including new windows and recognized torrent download responses ([user guide](docs/USER_GUIDE.md#torrents)).
- Play selected torrent media through embedded TVVLCKit with buffering, remote controls, file navigation and direct opening of completed files ([user guide](docs/USER_GUIDE.md#torrents)).
- Continue manually started torrent downloads after leaving the browser with experimental Keep Alive enabled; a 2 GB torrent completed after five minutes with another video app playing on Apple TV ([user guide](docs/USER_GUIDE.md#background-downloads)).
- Resume verified torrent pieces across app launches to avoid repeating full checks of cached files ([User Guide](docs/USER_GUIDE.md)).
- Reclaim unlisted torrent cache files with a confirmation action and remove cached payloads when deleting a torrent ([user guide](docs/USER_GUIDE.md#torrents)).

## 2.15.26 - 2026-10-04

### Fixed

- Show the saved zoom percentage on Reset Zoom and refresh it immediately after Zoom In, Zoom Out, or Reset Zoom while the menu stays open ([user guide](docs/USER_GUIDE.md#main-menu)).

## 2.15.25 - 2026-10-02

### Fixed

- Enlarge page text and content together with WebKit view scale while keeping the page aligned from the left after zoom and relaunch ([user guide](docs/USER_GUIDE.md#main-menu)).

## 2.15.24 - 2026-10-01

### Fixed

- Prevent Zoom Out at 50% from wrapping to 200% and discard stale horizontal offsets when restoring a tab ([User Guide](docs/USER_GUIDE.md)).

## 2.15.23 - 2026-10-01

### Fixed

- Prevent native video diagnostics from writing object payloads containing request headers, signed URLs, page content, or detailed errors to logs ([diagnostic privacy](docs/USER_GUIDE.md#native-video-diagnostic-privacy)).

## 2.15.22 - 2026-10-01

### Changed

- Focus the domain button when opening the menu so address entry or search is immediately available ([`1008e01`][1008e01]).
- Update the in-app guide for video arrows, history buttons beside the domain, and Double Up closing a card only in the tab overview ([user guide](docs/USER_GUIDE.md)).

### Added

- Document remote controls, custom players, tabs, history, local recovery and diagnostics in a detailed user guide ([user guide](docs/USER_GUIDE.md)).

### Fixed

- Preserve episode selection and other state saved by websites across launches through a shared persistent WebKit data store in a writable directory ([`95e6264`][95e6264]).
- Consume every Back/Menu press phase so opening the menu or returning from an overlay does not exit to the Apple TV home screen ([`d7987c2`][d7987c2]).
- Capture tab history for URL changes without a full page load, including pushState navigation ([`d7987c2`][d7987c2]).
- Preserve Forward entries when restoring the current page or following its redirect ([`d7987c2`][d7987c2]).
- Clear the saved session after closing every ordinary tab so closed tabs do not return at launch ([`d7987c2`][d7987c2]).
- Keep history deletion and Favorite writes consistent with the backup through checked transactions and rollback on failure ([`d7987c2`][d7987c2]).
- Turn the magnifier off after 30 seconds without cursor activity and require manual reactivation ([`84b0d33`][84b0d33]).

## 2.15.0 - 2026-10-01

### Added

- Add Website Logging ON/OFF in Debug to enable website diagnostics without reloading and remember the setting across launches ([`95e6264`][95e6264]).
- Log localStorage operations and available player state inside iframes to investigate lost episode, season or playback position ([`95e6264`][95e6264]).
- Rotate the diagnostic file and record key names and lengths instead of localStorage or cookie values ([`95e6264`][95e6264]).

## 2.14.0 - 2026-10-01

### Added

- Back up the complete history, Favorites and tab navigation in a compressed local SQLite snapshot so losing the main database does not require starting over ([`d7987c2`][d7987c2]).
- Restore a missing, empty or damaged database automatically after validating the snapshot ([`d7987c2`][d7987c2]).
- Refresh the backup after writes and explicit deletion without resurrecting deleted records from an outdated snapshot ([`d7987c2`][d7987c2]).
- Respect the preferences storage budget without automatically trimming history when a new snapshot does not fit ([`d7987c2`][d7987c2]).

## 2.13.0 - 2026-10-01

### Changed

- Store the complete tab session in SQLite, including the active tab, URL/title lists and current positions, to continue navigation after relaunch ([`d7987c2`][d7987c2]).
- Synchronize each tab model with WebKit's navigation list instead of retaining only the last URL ([`d7987c2`][d7987c2]).

## 2.12.0 - 2026-09-29

### Changed

- Assign Left/Right to seeking video by 10 seconds and keep browser Back/Forward on the menu buttons beside the domain ([`8ba451f`][8ba451f]).
- Combine Back, domain and Forward in one menu control and display the compact domain until the full URL editor opens ([`8ba451f`][8ba451f]).

### Removed

- Remove the permanent top bar, its focus mode and visibility settings to give pages and video the entire screen ([`8ba451f`][8ba451f]).

### Fixed

- Seek accessible HTML video, the active iframe or the native player without immediately navigating away through browser history ([`8ba451f`][8ba451f]).
- Raise focused navigation buttons above the address field so their hover state remains visible ([`8ba451f`][8ba451f]).

## 2.11.0 - 2026-09-29

### Changed

- Open the latest 20 addresses through History in the menu and provide All History at the end ([`89882fa`][89882fa]).
- Open an All History row with Center and toggle its selection with Play/Pause ([`89882fa`][89882fa]).
- Use Center to open New Tab entries and Play/Pause for Favorite editing or history deletion ([`89882fa`][89882fa]).

### Added

- Add a visual guide with a remote illustration and six gesture cards to introduce browsing without a long instruction screen ([`ecace46`][ecace46]).
- Support cursor and arrow navigation in the guide and add Show this guide at launch ([`ecace46`][ecace46]).

### Fixed

- Restore cursor visibility and movement on a new touch after arrow navigation or inactivity ([`ab11d5e`][ab11d5e]).
- Retain the selected New Tab section after a contextual action refreshes the page ([`89882fa`][89882fa]).
- Fit the complete Start Browsing button in the in-app guide ([`ecace46`][ecace46]).

## 2.10.0 - 2026-09-29

### Added

- Support starting and controlling custom iframe players so movies and episodes can be watched with the remote on websites where Play previously did not respond ([`ecace46`][ecace46]).
- Forward Center clicks into nested iframes, including cross-origin frames inside Shadow DOM, with local coordinates and pointer/mouse events ([`ecace46`][ecace46]).
- Forward Play/Pause and fullscreen exit between the page and player to retain remote control after expanding video ([`ecace46`][ecace46]).
- Expand website players in theater mode with a dimmed background and restore the original page appearance on exit ([`ecace46`][ecace46]).

### Fixed

- Raise the player and its ancestor containers above other page layers so banners or site menus do not cover expanded video ([`ecace46`][ecace46]).

## 2.9.0 - 2026-09-29

### Added

- Add a cursor magnifier to read and accurately click small website and player controls from the sofa ([`ecace46`][ecace46]).
- Toggle the magnifier by holding Center for more than 0.65 seconds or using the menu and halve cursor sensitivity while it is enabled ([`ecace46`][ecace46]).

### Fixed

- Refresh the magnifier every 0.25 seconds so changes after a click appear without moving the cursor ([`ecace46`][ecace46]).
- Center the magnified area on the cursor near screen edges so controls at the edge remain reachable ([`ecace46`][ecace46]).
- Distinguish a Center hold from a short press so toggling the magnifier does not accidentally click the website ([`ecace46`][ecace46]).

## 2.8.0 - 2026-09-29

### Added

- Add an Ad Block toggle and WebKit content rules to block advertising and tracking requests ([`ecace46`][ecace46]).

### Fixed

- Remove rules on OFF across open tabs without recreating WebViews so toggling Ad Block preserves their navigation ([`ecace46`][ecace46]).
- Distinguish failed rule removal from successful OFF and use the available runtime fallback ([`ecace46`][ecace46]).

## 2.7.0 - 2026-09-29

### Changed

- Scale the entire page through WebKit instead of changing only the font, with a 50–200% range, 10% steps and Reset Zoom to 100% ([`ecace46`][ecace46]).
- Remember zoom across launches and keep the menu open for repeated adjustments ([`ecace46`][ecace46]).

### Fixed

- Recalculate horizontal offsets on Zoom In/Out to preserve the visible page center ([`ecace46`][ecace46]).
- Reapply the saved zoom after a page finishes loading ([`ecace46`][ecace46]).

## 2.6.0 - 2026-09-29

### Added

- Edit Favorite titles and URLs or delete Favorites directly on Apple TV ([`ecace46`][ecace46]).

### Fixed

- Isolate editor input from the New Tab page behind it so arrows do not move the hidden selection ([`ecace46`][ecace46]).
- Match editor button contrast to the glass menu so the focused action remains readable ([`ecace46`][ecace46]).

## 2.5.0 - 2026-09-29

### Added

- Store complete browsing history and Favorites in SQLite without age-based pruning instead of limited preferences lists ([`ecace46`][ecace46]).
- Add All History with selectable rows, Select All/Deselect, opening one entry and deleting selected entries ([`ecace46`][ecace46]).
- Add confirmed Clear History and place actions above the list to avoid scrolling through thousands of rows to find them ([`ecace46`][ecace46]).

### Fixed

- Open the existing database before creating a new one so history and Favorites remain accessible after changes to directory priority ([`ecace46`][ecace46]).
- Make history selection reachable through the row and preserve readable text on focus ([`ecace46`][ecace46]).
- Show the record count in the clear confirmation and provide an accessible focus target in an empty list ([`ecace46`][ecace46]).

## 2.4.0 - 2026-09-29

### Changed

- Present New Tab as a separate plus button so an empty page does not occupy a saved tab slot ([`ecace46`][ecace46]).
- Keep a separate URL history for each tab and return from the overview to the previously active page ([`ecace46`][ecace46]).

### Removed

- Remove the five-tab limit to keep more useful pages open ([`ecace46`][ecace46]).

### Fixed

- Select and close the correct tab after filtering temporary cards ([`ecace46`][ecace46]).
- Remap the active index when restoring a session without empty New Tab entries ([`ecace46`][ecace46]).
- Prevent one Back press from dismissing the tab overview repeatedly ([`ecace46`][ecace46]).

## 2.3.0 - 2026-09-29

### Added

- Add a New Tab page with search, Favorite tiles and the ten latest URLs to open familiar websites without entering their addresses ([`ecace46`][ecace46]).
- Navigate sections with arrows and scroll the selected entry into view ([`ecace46`][ecace46]).

### Fixed

- Activate the arrow-selected entry with Center instead of the entry under the previous cursor position ([`ecace46`][ecace46]).
- Return from New Tab with Back to the last active tab when one is available ([`ecace46`][ecace46]).

## 2.2.0 - 2026-09-29

### Changed

- Replace the previous menus with a tiled side panel grouped into Quick Actions, Settings and Tools with visible ON/OFF states ([`ecace46`][ecace46]).
- Place zoom controls in a dedicated first row, other tiles in pairs and diagnostic options under Debug ([`ecace46`][ecace46]).
- Switch Mobile Site without deliberately clearing cookies or website data so changing presentation preserves site state ([`ecace46`][ecace46]).

### Removed

- Remove the malfunctioning Fit to Screen option and its scaling mode ([`ecace46`][ecace46]).

### Fixed

- Raise the focused button above its neighbors and retain icon contrast on focus ([`ecace46`][ecace46]).
- Calculate zoom row widths so Zoom In does not wrap onto a separate row ([`ecace46`][ecace46]).

## 2.1.0 - 2026-09-29

### Changed

- Browse with one Siri Remote using touchpad movement, Center clicks and smooth Up/Down scrolling ([`ecace46`][ecace46]).
- Scroll continuously while holding Up/Down with gradual acceleration and stop on release ([`ecace46`][ecace46]).
- Use Play/Pause for video and Double Left for the tab overview ([`ecace46`][ecace46]).
- Hide the cursor on inactivity or arrow navigation so it does not obstruct viewing ([`ecace46`][ecace46]).

### Fixed

- Query hover asynchronously and transform WebView coordinates so cursor movement does not enter a nested event wait ([`ecace46`][ecace46]).
- Handle cancelled navigation as NSURLErrorCancelled so reaching a history boundary does not block later presses ([`ecace46`][ecace46]).
- Limit Clear Cache to resource caches while preserving other website data and browser history ([`ecace46`][ecace46]).
- Use the available cookie fallback when the asynchronous store times out ([`ecace46`][ecace46]).

## 2.0.0 - 2026-03-08

_Fork baseline with WebKit, tabs, a cursor, basic history and native/WebKit video paths ([`e245b8f`][e245b8f])._

[e245b8f]: https://github.com/just-better-code/tvOSofaBrowse/commit/e245b8f
[ecace46]: https://github.com/just-better-code/tvOSofaBrowse/commit/ecace46
[89882fa]: https://github.com/just-better-code/tvOSofaBrowse/commit/89882fa
[ab11d5e]: https://github.com/just-better-code/tvOSofaBrowse/commit/ab11d5e
[8ba451f]: https://github.com/just-better-code/tvOSofaBrowse/commit/8ba451f
[84b0d33]: https://github.com/just-better-code/tvOSofaBrowse/commit/84b0d33
[d7987c2]: https://github.com/just-better-code/tvOSofaBrowse/commit/d7987c2
[95e6264]: https://github.com/just-better-code/tvOSofaBrowse/commit/95e6264
[1008e01]: https://github.com/just-better-code/tvOSofaBrowse/commit/1008e01
