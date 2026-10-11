# User Guide — tvOSofaBrowse

Current for **2.18.24**. Button names match the application.

## Quick start

Use a Siri Remote with a touch surface or touch-enabled clickpad. A button-only remote cannot move the browser pointer.

1. Open the browser. On New Tab, choose a Favorite or history entry, or press Back/Menu to open the main menu.
2. The domain/address button receives initial menu focus. Press Center to enter an address or search query.
3. Slide on the touchpad to move the pointer and press Center to click a page control.
4. Press Up/Down to scroll. Hold a direction for continuous, smoothly accelerating scrolling. Touchpad movement controls the pointer; swiping does not scroll the page.

Open the visual quick guide through **Menu → Tools → User Guide**. **Show this guide at launch** uses the same ON/OFF badge as the browser menu and controls whether it appears at startup.

## Siri Remote controls

| Action | Control |
| --- | --- |
| Move the pointer | Slide on the touchpad |
| Click a link or button | Center |
| Scroll a page | Up/Down; hold to accelerate; move the pointer beyond the top/bottom edge outside fullscreen |
| Navigate tab history | Back/Forward in the six-button row below the address |
| Open the tab overview | Double Left |
| Close the focused overview tab | Double Up or Play/Pause |
| Toggle the magnifier on a website | Hold Center |
| Open the menu or return from an overlay | Back/Menu, depending on context |
| Play/pause supported video | Play/Pause |

On app-owned pages, arrows move selection and Center activates the focused item. Hold Center for its context actions; Play/Pause performs the page's shortcut. Website controls retain their own behavior. The pointer hides on inactivity; a new touchpad movement brings it back.

When the pointer reaches the top or bottom of the visible page, continued outward touchpad movement scrolls vertically while the pointer stays at that edge. Move away from the edge to move the pointer again. Scrolling stops when movement stops; there is no touchpad inertia. Edge scrolling is disabled in fullscreen, native dialogs and New Tab.

Page clicks and text-field reads run asynchronously. A field dialog opens after its current value is available; results from an old page or inactive tab are ignored. Navigating away while a dialog is open prevents its Done/Submit actions from writing into another document.

### Back/Menu behavior

- On an ordinary page, open the main menu.
- In a menu, dialog, guide or tab overview, close that screen.
- In a torrent's file list, return to the overall torrent list; from the overall list, return to the browser.
- On New Tab, return to the previously active tab when available.
- With the magnifier enabled, turn it off before opening the menu.
- In a supported fullscreen player, leave fullscreen and return to the page.

Use Back/Forward below the address to navigate browser history. Left/Right on a page are reserved for video and do not open another page.

## Main menu

The domain button is focused when the menu opens, so Center immediately opens address editing.

The address spans the top of the menu. Below it, the six-button row contains **Back**, **Forward**, **Home**, **Reload Page**, **New Tab** and **Tabs**. Back/Forward use the active tab's history.

| Section | Actions |
| --- | --- |
| Quick Actions | Zoom Out, Reset Zoom, Zoom In, Add Favorite, History, Torrents |
| Settings | Ad Block, Magnifier, Keep Alive, Mobile Site |
| Tools | Clear Cache, Clear Cookies, Clear History, Debug, User Guide |

Quick Actions, Settings and the three Clear commands use three columns. In the last row, Debug takes one column and User Guide spans two. Clear commands are highlighted pink only when focused.

Zoom ranges from **50% to 200%**, in **10%** steps. It scales the text and page together, starts at the left edge after a change, and remembers the chosen percentage separately for each top-level domain across tabs and launches. Domains without a saved setting start at 100%; different subdomains have separate settings. Reset Zoom shows the current percentage, updates after each zoom action, and restores **100%** for the current domain when pressed. Mobile Site changes the User Agent; presentation depends on the website.

Press Center on **Ad Block** to switch protection on or off. Hold Center to open its settings popup. The compact **This Site** toggle sits immediately left of **Ad Block** beside the **Settings** heading when a website is open; the list below switches the [AdGuard DNS filter](https://github.com/AdguardTeam/AdGuardSDNSFilter) and [AdGuard Base, Ukrainian, Social Media, Mobile Ads, and Annoyances filters](https://adguard.com/kb/general/ad-filtering/adguard-filters/) separately. Every toggle uses the browser menu's green ON or gray OFF badge. A filter badge sits at the right edge of its row, with its version just before it, or an update date if the list has no version. Downloading and errors appear in the same row; a failed update keeps its cached copy. **Update Filters Now** sits to the left of **Done** below the filter controls. While Ad Block is on, enabled filters download directly on the Apple TV, check for updates weekly, and remain cached for later launches. Pages open with the currently available protection while filters are prepared in the background. When new protection is ready, the requested page reloads automatically; this can interrupt playback or unsaved page input, and ads may load before that reload. Ready WebKit rules apply before the full uBlock runtime finishes preparing. Unchanged bundled filters retain their compiled-cache identity across app deliveries. On later launches, unchanged filters reuse their compiled WebKit rules without converting the lists again; missing compiled rules are rebuilt from the cached filters. Browser filter rules are converted with [SafariConverterLib](https://github.com/AdguardTeam/SafariConverterLib) to support network and native cosmetic rules; extended rules additionally pass through a pinned full-uBlock Origin parser and browser-owned scriptlet/cosmetic runtime. The bundled uBlock Origin list is available offline; its pinned snapshot updates with the app. MAIN scriptlets wrap page APIs, while isolated scriptlets and procedural cosmetics use a separate WebKit content world when available. Downloaded lists select bundled implementations and cannot supply arbitrary JavaScript. Only the pinned official uBlock list can select trusted scriptlets. Generic redirects and full dynamic network policy are not yet implemented. If one filter's rules fail to compile, other successfully compiled filters remain active. Ad Block also suppresses script-opened external windows. A bundled custom-rules file blocks the observed Hraimo banner source across websites and is reserved for requested gaps in online filters; changing it requires a new app installation. If the first download is unavailable, protection from online lists starts when a download succeeds. Ads inserted directly into a video stream may remain. If Ad Block interferes with a page or player, open its settings and switch **This Site** off. This remembered exception includes subdomains and disables native rules, scriptlets, cosmetics and popup suppression for the top page and its embedded frames; other sites remain protected. Re-enabling a site covered by a parent exception removes that parent exception. The master toggle remains independent. Changing site/global/filter policy reloads the page because installed wrappers cannot be universally undone. **My Filters** appears only when custom rules were saved in an earlier version and lets you enable or disable them. Manual filter entry is unavailable in the TV interface. Previously saved custom filters remain untrusted. **Coverage and Diagnostics** shows compiled scriptlet/cosmetic counts, rejected advanced rules and runtime availability. Debug logs record capped source/line events without URLs, scriptlet arguments, cookies or page text. These observations cover scriptlet installation and DOM actions; they are not a full network log. Entity/regex/ancestor domain scopes and some AdGuard scriptlet names/arguments remain unsupported and are counted. Very large DOMs defer procedural work; unsupported filters do not disable the working WebKit rules.

Ad Block also compiles the full upstream static and dynamic network matching engines on a background worker and retains their compiled cache. The core decides page and iframe navigation and page fetch/asynchronous XHR requests, including requests from frames. Allowed requests use native WebKit networking; blocked fetch requests reject with a network error, and blocked XHR requests finish with error/loadend and no successful response. Abort, timeout and reopening XHR cancel pending decisions. A bounded asynchronous reply bridge avoids waiting on the page thread. Other resource paths retain the WebKit backend. Coverage and Diagnostics reports core availability and filter count. Synchronous XHR retains the native backend without waiting for the reply bridge. Classic and module dedicated workers created from JavaScript Blob URLs in the same realm can relay fetch and asynchronous XHR decisions through private MessageChannels, including nested Blob workers when the runtime supports them. Classic workers install the adapter before importScripts; module workers evaluate a synchronous setup dependency before the original module graph. Original strict-mode directives, module scope and ordinary messages are preserved. The site policy must permit the additional Blob script loads. Worker location and module import.meta.url use generated Blob URLs. A page entering history caching suspends pending decisions and resumes them on return; leaving without caching or closing a worker releases its bridges. HTTP entry workers, SharedWorker, service workers and Blob URLs created in another realm retain native behavior. Module imports themselves retain native resource filtering. Dynamic rule controls, broader worker delivery, redirects and response-filter adapters are still pending. Coverage also reports bridge and page-adapter availability, decisions, applied blocks, fail-open fallbacks, and ready/bypassed/unready worker counts. A matcher result does not prove that every WebKit resource used that decision. Existing native content rules can still block an allowed request; equivalent allow/noop behavior across both backends remains pending.

Remaining pointer alignment and website layout issues are tracked in the local roadmap.

The magnifier is also available through Settings → Magnifier. It turns off after **30 seconds without cursor activity**. Moving the cursor does not re-enable it; toggle it manually. Cursor movement is half as sensitive in magnifier mode for precise targeting.

## Tabs and New Tab

- Open the overview with **Tabs** or Double Left.
- Select a tab card and press Center to open it.
- The round **+** button opens New Tab; an empty New Tab does not occupy a saved tab slot.
- Play/Pause closes the focused ordinary tab in the overview.
- Hold Center on a tab card for Open and Close actions.
- Double Up also closes the focused overview tab; repeated Up presses on a page scroll it.

The native New Tab page shows **Favorites** and recent history across the available screen width. Center opens an entry. **Play/Pause or Hold Center opens the selected entry's options**: Favorite actions or recent-visit actions.

After switching to another tab, the previous tab keeps its webpage in memory for five minutes. Returning before that time keeps the live page; leaving again starts a new five-minute interval. After expiry, the browser releases the page while retaining the tab, navigation list, scroll position and preview. Selecting it reloads the saved page and attempts to restore its scroll position; unsaved page-only state may be lost. The active tab stays loaded. If tvOS suspends the app, overdue inactive pages are released when the app becomes active again.

The overview uses cached previews without loading inactive websites. A tab without a cached preview shows its domain and title; select it to load the page. Previews may be cleared by tvOS without removing saved tabs or history.

The session saves ordinary tabs, the active tab and each tab's Back/Forward list. An empty New Tab is temporary and is not restored as an ordinary page.

If the active webpage's WebKit process terminates while the app is in the foreground, the browser automatically reloads it. It allows two automatic attempts during a burst of crashes, then stops to avoid a reload loop. After 60 seconds without another termination, automatic attempts are available again. You can still use Reload manually. Background tabs are not automatically reloaded.

## Favorites

1. Open the page to save.
2. Choose **Menu → Quick Actions → Add Favorite**.
3. Review the title and address, then save.

On New Tab, select a Favorite and press Play/Pause for editing and deletion options. Favorites are stored locally.

## History

**Menu → Quick Actions → History** lists up to 20 recent addresses. Choose **All History** for the complete list.

### All History

| Action | Control |
| --- | --- |
| Open an entry | Select its row and press Center |
| Select/deselect a row | Play/Pause on the row |
| Open row actions | Hold Center on the row |
| Select every entry | Select All |
| Open one selected entry | Open; exactly one row must be selected |
| Delete selected entries | Delete |
| Clear all visits | Clear All, then confirm |
| Close the list | Done or Back/Menu |

**Clear History** in the main menu offers This Site, All and Cancel. This Site removes visits for the current host and its subdomains; All removes every visit. Favorites stay saved. History is not automatically deleted by age.

## Video

- Use Center on the player's own controls under the pointer.
- Use Play/Pause to pause or resume supported video.
- Use Left/Right to seek supported video by **10 seconds**.
- A website's fullscreen button can expand its player with a dimmed background while retaining the cursor, Play/Pause and Back.
- Use Back/Menu to leave a supported fullscreen mode.

The browser forwards clicks into supported iframe players, including cross-origin frames inside web components. Point at the player's Play, episode selector or fullscreen button and press Center.

When an accessible video in the main page document exposes a direct HTTP(S) media URL, fullscreen opens it in the same embedded VLC player used for torrents. Pointing at a standard `<video controls>` video in the main document and pressing Center also opens this player. The player starts at the website video's current position, restores the containing page's saved volume and retains mute. Back/Menu returns the final position, volume and mute to the same website video; playback on the page stays paused. After playback finishes, Play/Pause starts again from the beginning; Go to Beginning and seek controls reopen the media at the requested position, including held seeks. Audio and Subtitles use the shared VLC controls at the right edge of the panel, after the transport and volume groups. Previous and Next are unavailable for a single web URL. Iframe players keep website playback and its episode lifecycle, with the existing unified fullscreen controls; they do not transfer into VLC. Blob/MSE sources and DRM media also stay in website playback. VLC receives matching cookies from the browser's native cookie store, including HttpOnly cookies, plus the configured User-Agent and the video document's Referer according to its referrer policy. Cookie selection respects host/domain, path, expiry and Secure; anonymous cross-origin videos omit cookies. The context stays with the media during replay. Arbitrary Authorization/Bearer headers set by website JavaScript are not captured. Return to the page if playback fails.

Expanded fullscreen iframe players also show a native bottom panel styled like the built-in VLC controls, without Audio or Subtitles selectors. It shows elapsed time, duration and progress when the embedded video exposes them. Center activates a focused control; Play/Pause toggles playback, and Back/Menu leaves fullscreen. The cursor is hidden while this fullscreen panel is active. The panel stays visible while playback is paused, including when pausing a video whose panel was hidden. During playback, native button interaction reveals it for five seconds. Press Center to reveal it, and use directions or the touchpad to navigate native focus. Leaving fullscreen restores browser cursor handling.

Previous and Next occupy the left and right ends of the panel. Between them are Back 10, Back 5, Go to Beginning, Play/Pause, Go to End, Forward 5 and Forward 10. Go to Beginning sits immediately to the left of Play/Pause in both players. Go to End sits immediately to the right of Play/Pause in both players. Beginning, Play/Pause and Go to End in both players, are 20% larger than the other transport controls, with centered icons and a shared vertical centerline. Both players share classic vector transport icons with consistent triangle heights and bar thickness. Play/Pause uses a leading bar and right-facing triangle in both playback states. There is no Close button; use Back/Menu to exit. One filled triangle seeks five seconds; two filled triangles seek ten seconds, pointing in the seek direction. The Go to Beginning left-facing triangle with two leading bars returns to the earliest seekable position in the current video; it does not switch episodes. Go to End uses a right-facing triangle followed by two bars and seeks one second before the known duration (or zero for shorter videos); it is dimmed when duration is unknown. Short Center presses seek by the indicated interval. Holding a seek button repeats 10- or 20-second jumps; holding a ten-second button for ten seconds increases its repeated jump to 40 seconds. Commands use the site's Media Session handlers when registered, or the embedded HTML video for playback and seeking. Previous and Next remain active and attempt the system Now Playing Previous Track or Next Track command, allowing WebKit to route it to the active media session. If the system command API is unavailable, the browser tries registered Media Session handlers on the embedding page and in the fullscreen iframe chain. It does not send synthetic media keyboard events. A successful command submission alone does not confirm that the website switched episodes. Unsupported playback or seek actions are dimmed. A speaker button toggles mute in both players and shows a crossed-out speaker when muted. In iframe controls it changes the embedded video’s muted state and is disabled when no HTML video is available; in VLC it toggles audio mute. Muting preserves the volume level and playback position. Volume down, Mute and Volume up form a separate group in that order to the right of the main controls, separated by half a button width. The main controls are centered without the audio group. The volume buttons adjust the player’s volume by 10 percentage points, clamped to 0–100%. The panel shows the current volume. Volume changes leave mute unchanged; use Mute to restore sound when muted. In iframe playback these buttons require an accessible HTML video. They control the player’s audio level, independently of the TV or speaker’s hardware volume. The browser remembers the level for the page’s domain and restores it when entering another fullscreen iframe session or opening a new video or episode. Embedded player domains use the containing page’s preference; different page hosts keep separate levels. The preference persists across launches and does not change mute.


Web media can start without a fresh website gesture, including automatic episode transitions after near-end seeking. A website can still choose its own mute and volume behavior. Availability depends on the player, stream format and website. A pure canvas player without accessible video does not have guaranteed seeking support. DRM and unsupported formats may prevent playback.

## Torrents

Select a magnet or `.torrent` link on a website to open **Torrents** immediately. The library focuses the imported torrent in the overall list; press Center to open its files. Its row shows selected and total size, transfer rates, peer counts, and focusable Download All, Priority Up, and Priority Down icons beside the focused row. Play/Pause on a torrent row also starts all its files. Hold Center for Pause/Resume, Reset Torrent, and Remove Torrent. Priority order is saved across launches.

New torrents start with files skipped. Center opens a folder, and Back returns to its parent; Play/Pause on a folder selects every file inside it for download. The download icon to the right of a focused file or folder selects it without starting playback. Hold Center on a folder for **Download Folder** or **Skip Folder**. Center or Play/Pause on a focused playable file starts **Play Now (Priority)**. Hold Center on a file for Play Now and Download/Skip actions, or on a torrent for Open Files and Pause/Resume. The player offers MP4, M4V, MOV, MP3, M4A, MKV and AVI files. If libtorrent is checking an existing file, playback waits for that check; otherwise it starts as verified pieces arrive. The status header shows **Buffering · Complete: XX%** or **Streaming · Complete: XX%** while visible, and the header hides with the controls after inactivity during playback. The format and codec still need to be supported by the embedded player and Apple TV hardware. The bottom panel has progress and one row of round playback controls with compact Audio and Subtitles selectors. Previous and Next are at the ends of the transport group; volume controls follow, with Audio and Subtitles at the right edge of the panel. Play/Pause uses the combined filled triangle-and-bars transport icon; exit with Back/Menu instead of a Close button. Focus Audio or Subtitles and press Center to choose an available track or Off; the selectors become available after VLC discovers tracks in the file. Press Center to show the controls again; touchpad direction gestures do not seek while the controls are hidden. A short Center press on a seek button jumps five seconds for one filled triangle or ten seconds for two, in the indicated direction. Holding Center repeats 10- or 20-second jumps until release; after ten seconds of holding a ten-second button, its repeated jump becomes 40 seconds. This hold action does not open the player's context menu. A separate Go to Beginning button returns to the start of the current file and clears its saved resume position. Previous always opens the previous playable file. Play/Pause toggles playback, Back/Menu returns to the library, and playback pauses when the app becomes inactive. VLC saves a position for each torrent file and resumes there on the next opening; a finished file starts from the beginning next time.

All new torrents wait for manual file selection or Download All. Playing a file enables that file; use its right-hand download icon or Hold Center → **Download File** to transfer one file without opening the player.

From a torrent's file list, choose **Skip Download** to stop requesting that file, or use **Pause/Resume** to control the torrent. Skipping a completed file does not erase its downloaded bytes; libtorrent 1.2 has no safe individual-file removal action in this app. In the overall list, Hold Center and choose **Reset Torrent** to delete its downloaded files, retain its `.torrent` or magnet source, and restore the entry with all files skipped. **Remove Torrent** deletes its entry and cached files. Both actions also clear that torrent's playback positions. The hint beside the action shortcuts shows the total torrent cache size, which includes listed torrents. **Reset All** applies Reset Torrent to every listed torrent: it removes downloaded files and playback positions, retains sources, and re-adds entries with all files skipped. **Delete All**, beside Reset All, removes every listed torrent and its cached files and playback positions. Both actions require confirmation. This action does not touch browser history or website data. Torrent payloads and metadata are in tvOS's purgeable cache, so the system may remove them when space is needed. **Settings → Keep Alive** is experimental and does not guarantee background downloading.

### Background downloads

Torrent transfers continue while the app is active, including when Torrents is closed and you browse websites. Experimental **Settings → Keep Alive** can let a manually started torrent continue downloading after you leave the browser. tvOS may still suspend or interrupt the browser, so this does not guarantee every transfer will finish. The app can also request system-managed Background App Refresh and Background Processing time for manually started, incomplete torrents; tvOS decides whether and when to grant it. Keep the app open for a download that must continue without interruption.

**Menu → Tools → Debug** toggles diagnostics with Center; hold Center to open its options with a **Debug ON/OFF** button at the top, plus **Recent Diagnostic Logs** and **Background Probe** report buttons below. Debug is the single master switch for app console logs, website logging, numeric torrent/background diagnostics, and the temporary background probe. Turning it off stops an active probe and cancels probe-only background requests without stopping torrent downloads. Saved reports remain readable while Debug is off; collecting fresh media or WebKit diagnostics requires Debug on. **Debug → Recent Diagnostic Logs** shows the ten latest numeric diagnostic lines; **Debug → Background Probe** shows elapsed background time, timer-covered execution time, and the longest timer gap without requiring a torrent. It also records whether **Keep Alive** was on when measurement began. A long elapsed interval with little active time means the app was suspended. In Debug builds with Debug enabled, a probe-only request is submitted even if no torrent is pending; ordinary releases submit tasks only for manually started, incomplete torrents.

### Episode, season and playback position

The website saves this state, for example through cookies or localStorage. Tabs share a persistent WebKit data store so the website can read its data after another launch.

There is no separate backup of player state. If the website does not save the episode selection or its data is deleted, the browser cannot reconstruct it. Page scroll restoration also depends on content loading; a reported case of failed scroll restoration remains unresolved.

## Local storage and recovery

The browser automatically saves history, Favorites and tab sessions in a local database and refreshes its compressed backup. At startup, it attempts recovery from a valid copy if the main database is missing, empty or damaged. No backup toggle is required.

- The backup includes visits, Favorites and tab navigation.
- Cookies, localStorage and player data are not included.
- Explicit history deletion updates the backup so deleted entries should not return during recovery.
- The copy is stored in application preferences. iCloud was rejected; Firefox Account synchronization is planned but unavailable.
- Removing the application also removes the local copy.
- The main database and website data store use Caches. The system can clear these files; the database backup protects history, not website data.
- If a compressed snapshot exceeds the available preferences budget, a new backup is not written. History is not automatically trimmed to make it fit.

## Clearing data

| Command | Result |
| --- | --- |
| Clear Cache | Choose This Site, All or Cancel; clear resource caches, reset saved player volume and zoom, remove tab previews, and reload the current page |
| Clear Cookies | Choose This Site, All or Cancel; remove cookies in the selected scope and reload; this may sign you out |
| Clear History | Choose This Site, All or Cancel; delete visits in the selected scope while keeping Favorites |

This Site uses the current page host and its subdomains for history, browser preferences and previews. Cookies include matching parent-domain cookies shared with the current host. WebKit groups resource caches by its website domain, so cache removal can also include sibling subdomains. Unrelated embedded-player domains are not included. All applies to every site. This Site is disabled on New Tab or pages without an HTTP(S) host. Cancel changes nothing.

Clear Cache resets the saved page zoom to 100% and player volume to the default 100%; tab previews can be generated again as pages are used. It preserves cookies, history, Favorites, open tabs and global browser settings. Clear Cookies preserves localStorage, IndexedDB and the browser’s volume/zoom preferences. Clear History preserves website data and browser preferences. None of these actions removes torrent downloads.

## Diagnostic logging

Press Center on **Menu → Tools → Debug** to toggle diagnostics using its green ON / gray OFF badge. Hold Center on Debug to open its options, styled like Ad Block settings with the same **Debug ON/OFF** button at the top. There are no separate logging or probe switches.

- Activate the item to toggle website and numeric torrent/background diagnostics together.
- The choice survives relaunch; diagnostics are initially enabled.
- The change takes effect immediately without reloading.
- OFF stops new entries from these loggers; it does not delete old entries or silence all application logs.

Website logging helps investigate storage and player behavior. Turning Debug off stops website polling and storage interception in open pages and frames; turning it back on resumes collection without reloading. It records storage operation lengths and error names, without storage key names, storage values or cookie values. Episode and season diagnostics depend on the information exposed by the player. **Recent Diagnostic Logs** shows the latest ten numeric entries from the shared diagnostic logger; **Background Probe** shows the last recorded background interval.

In a Debug build with Debug ON, Safari on a connected Mac can inspect the browser's pages through **Develop → Apple TV → page**. Use the native Web Inspector for DOM, console, network requests, storage and web media. Turning Debug off disables inspection of open web views. Release builds do not enable this inspector. There is no custom HTTP diagnostic command server; the internal loopback server is used only for torrent playback.

For local inspection, the application container contains `Library/Caches/BrowserWebsiteDiagnostics.log`. The rotated file has the `.previous` suffix. Debug also provides media diagnostics.

## Troubleshooting

- **A website does not open:** check the address, reload, and try Mobile Site or disabling Ad Block.
- **Video does not play:** try page playback and fullscreen; format or DRM limitations may apply.
- **Episode selection resets:** enable Diagnostics, reproduce the issue and record the website, episode and restart method. Avoid clearing data before diagnosis.
- **History is missing:** recovery runs when the database opens; success depends on a valid local copy being available.

See the [README](../README.md) for an overview. Local project plans and development history live in the ignored `docs/agent/` directory.

### Playback diagnostic privacy

Torrent playback diagnostics use numeric events; website diagnostics avoid storage values and other private page data. Logging follows the Debug diagnostics toggle. Review any diagnostic output before sharing it publicly.
