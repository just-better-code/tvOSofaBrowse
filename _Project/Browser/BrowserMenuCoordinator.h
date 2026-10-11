#import <UIKit/UIKit.h>
#import "BrowserWebView.h"

@class BrowserPreferencesStore;

@protocol BrowserMenuCoordinatorHost <NSObject>

@property (nonatomic, readonly) BrowserWebView *browserWebView;
@property (nonatomic, copy) NSString *browserPreviousURL;
@property (nonatomic) NSUInteger browserTextFontSize;
@property (nonatomic) BOOL browserCursorMagnifierEnabled;

- (void)browserPresentViewController:(UIViewController *)viewController;
- (void)browserLoadHomePage;
- (void)browserEditCurrentAddress;
- (void)browserShowHints;
- (void)browserShowTabOverview;
- (void)browserCreateNewTab;
- (BOOL)browserCanGoBack;
- (BOOL)browserCanGoForward;
- (void)browserGoBack;
- (void)browserGoForward;
- (void)browserUpdateTextFontSize;
- (void)browserCaptureSnapshotForCurrentTab;
- (void)browserClearSitePreviewsAndSettingsForURL:(nullable NSURL *)URL;
- (void)browserRecreateActiveWebViewPreservingCurrentURL;
- (void)browserBringCursorToFront;
- (void)browserSetAdBlockEnabled:(BOOL)enabled;
- (void)browserRefreshNewTabPageSelectingGroup:(NSString *)group index:(NSUInteger)index;
- (void)browserShowNewTabPageSelectingGroup:(NSString *)group;
- (void)browserOpenHistoryURLString:(NSString *)URLString;
- (void)browserShowTorrents;

@end

@interface BrowserMenuCoordinator : NSObject

- (instancetype)initWithHost:(id<BrowserMenuCoordinatorHost>)host
            preferencesStore:(BrowserPreferencesStore *)preferencesStore;
- (void)showAdvancedMenu;
- (void)presentStoredItemActionsForKind:(NSString *)kind index:(NSUInteger)index;
- (void)presentAllHistory;
- (void)deleteHistoryForURLString:(NSString *)URLString;

@end
