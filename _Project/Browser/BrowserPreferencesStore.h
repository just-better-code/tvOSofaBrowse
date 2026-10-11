#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface BrowserPreferencesStore : NSObject

+ (NSString *)desktopUserAgent;
+ (NSString *)mobileUserAgent;
+ (BOOL)websiteLoggingEnabled;
+ (BOOL)debugEnabled;

@property (nonatomic, copy) NSString *userAgent;
@property (nonatomic) BOOL mobileModeEnabled;
@property (nonatomic) NSUInteger textFontSize;
// Page zoom belongs to the top-level HTTP(S) host, shared across its tabs.
- (NSUInteger)pageZoomPercentForURL:(nullable NSURL *)URL;
- (void)setPageZoomPercent:(NSUInteger)percent forURL:(nullable NSURL *)URL;
// Player volume belongs to the page host, including its embedded players.
- (nullable NSNumber *)playerVolumeForURL:(nullable NSURL *)URL;
- (void)setPlayerVolume:(double)volume forURL:(nullable NSURL *)URL;
// nil clears the per-site preferences for every host.
- (void)clearSitePreferencesForURL:(nullable NSURL *)URL;
@property (nonatomic) BOOL adBlockEnabled;
@property (nonatomic) BOOL cursorMagnifierEnabled;
@property (nonatomic) BOOL dontShowHintsOnLaunch;
@property (nonatomic) BOOL websiteLoggingEnabled;
@property (nonatomic) BOOL debugEnabled;
@property (nonatomic, copy) NSString *homePageURLString;

- (void)ensureUserAgentConsistency;

@end

// App-owned console logging follows the Debug master switch.
#define BrowserLog(...) do { if (BrowserPreferencesStore.debugEnabled) NSLog(__VA_ARGS__); } while (0)
FOUNDATION_EXPORT NSNotificationName const BrowserDebugEnabledDidChangeNotification;

/// Numeric torrent/background diagnostics; never pass URLs, headers, or page content.
FOUNDATION_EXPORT void BrowserDebugLog(NSString *format, ...) NS_FORMAT_FUNCTION(1, 2);
FOUNDATION_EXPORT NSString * _Nullable BrowserDebugLastLog(void);
FOUNDATION_EXPORT NSArray<NSString *> *BrowserDebugRecentLogs(void);

NS_ASSUME_NONNULL_END
