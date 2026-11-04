# Inactive tab lifetime

## Outcome

Release an inactive tab's WebView five minutes after switching to another tab, without waiting for memory warnings. Keep the tab, saved navigation, scroll offset and cached preview. Returning before the deadline cancels expiry; leaving again starts a fresh five-minute interval. Restored tabs without WebViews stay unloaded until selected.

## Approach

Track inactivity using process uptime, independent of document loading and thumbnail updates. Use one timer for the nearest deadline. Stop the timer while inactive and sweep overdue entries on activation. Preserve navigation and scroll state before detaching the expired WebView and cancelling its loading. Reuse existing lazy page creation and session restoration. Guard late snapshot and scroll replies so they cannot retain an unloaded WebView or change a newly recreated tab.

## Status

Implemented in code as 2.18.26. Snapshot requests now use weak WebView references and distinct tokens; delayed scroll restoration is guarded, and persistence does not overwrite an offset awaiting restoration. The requested Debug build, installation and launch of 2.18.26 on the test Apple TV succeeded through push-to-tv.sh deploy. Runtime TTL behavior has not been observed.

## Validation boundary

Source review and whitespace checking only unless the user separately requests app testing or a build. Runtime checks pending: return before five minutes, expiry after five minutes, returning after suspension, multiple independent deadlines, new/closed tabs, Back/Forward and scroll restoration after reload. A subsequent explicit deployment request was completed; expiry and restoration interaction still require observation.
