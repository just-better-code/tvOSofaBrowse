# tvOS interface style guide

Use the existing translucent browser menu and `BrowserTVAppearance.h` as the visual reference for app-owned screens. Use the anonymized images in `assets/readme/` for the approved style; personal reference photos are not published. Keep website content inside the web view.

## Toggle controls

- Show app-owned boolean settings with the browser menu's ON/OFF badge: 42 × 22 points, 14-point semibold white text, 11-point corner radius, green ON (`0.20, 0.72, 0.42`, alpha `0.95`) and gray OFF (white `0.42`, alpha `0.65`). Use `BrowserTVConfigureToggleBadge` from `BrowserTVAppearance.h` so the style stays shared. The playback panel's icon-only Keep fullscreen button is the exception: omit the badge, and show a dark symbol on a light pressed surface when selected, independent of focus.
- Make the containing row or button focusable and activate it with Center. Keep the badge visible when focused; use the approved resting and focused surfaces for its container. Expose the state through `accessibilityValue`.
- Place filter versions before the ON/OFF badge and align each filter badge to the right edge of its row. In the Ad Block heading, keep the label and badge together in a compact button at the existing header position; highlight the whole button with the same focused surface as the filter rows. Do not replace the badge with plain ON/OFF text or draw a separate sliding switch.

## Layout and controls

- Preserve the existing browser menu layout and its translucent panel. Use `BrowserTVPanelEffect` and the shared surface and text colors for app-owned dialogs.
- Keep filter-preparation feedback non-obscuring; use the existing status badge rather than a full-screen overlay over website content.
- Use a neutral dark canvas behind WebKit before the first website paints. Do not cover the site, inject a page theme, or delay its first render; once content appears, let the website and WebKit own the background.
- Let modern system glass buttons draw their own surfaces; do not add a separate rectangular background beneath their capsule or replace the accepted native focus appearance.
- For `UIButtonTypeSystem`, use `BrowserTVConfigureSystemButtonSurface` at creation and `BrowserTVSystemButtonSurfaceColor` in custom focus updates. Keep custom backing/clipping only on the older-tvOS fallback. Do not apply this rule to custom `UIControl` toggles, badges, cards, fields or panel containers, which still own their surfaces.
- Respect tvOS focus and remote behavior. Center activates the focused control; Play/Pause uses the screen's documented shortcut. Prefer UIKit controls over HTML for app UI.
- Keep labels readable and avoid full-width buttons when the action is short and a compact button fits the panel.


Menu item options should reuse `BrowserOptionsViewController` with a caller-configured header toggle and rows. Future menu items will also have options; do not hardcode a Debug/Ad Block mode switch. Configure optional row badges, detail text, footer actions and the Play/Pause shortcut through the shared screen.
