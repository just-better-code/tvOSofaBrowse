#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class BrowserNavigationService;
@class BrowserPreferencesStore;
@class BrowserSessionStore;
@class BrowserTabViewModel;
@class BrowserViewModel;
@class BrowserWebView;

NS_ASSUME_NONNULL_BEGIN

@protocol BrowserTabCoordinatorHost <NSObject>

- (void)browserTabCoordinatorPresentViewController:(UIViewController *)viewController;
- (BOOL)browserTabCoordinatorIsCursorModeEnabled;
- (BOOL)browserTabCoordinatorIsTabOverviewVisible;
- (void)browserTabCoordinatorSnapshotDidUpdateForTab:(BrowserTabViewModel *)tab;
- (void)browserTabCoordinatorShowNativeStartPageSelectingGroup:(nullable NSString *)group index:(NSUInteger)index;
- (void)browserTabCoordinatorHideNativeStartPage;
- (void)browserTabCoordinatorDidChangeActiveWebView;

@end

@interface BrowserTabCoordinator : NSObject

@property (nonatomic, readonly) NSUInteger newTabPageGeneration;

@property (nonatomic, readonly, nullable) BrowserWebView *activeWebView;
@property (nonatomic, readonly, nullable) BrowserTabViewModel *activeTab;
@property (nonatomic, copy) NSString *requestURL;
@property (nonatomic, copy) NSString *previousURL;

- (instancetype)initWithHost:(id<BrowserTabCoordinatorHost>)host
                   viewModel:(BrowserViewModel *)viewModel
            preferencesStore:(BrowserPreferencesStore *)preferencesStore
           navigationService:(BrowserNavigationService *)navigationService
                sessionStore:(BrowserSessionStore *)sessionStore
           browserContainerView:(UIView *)browserContainerView
                    rootView:(UIView *)rootView
                  cursorView:(UIImageView *)cursorView
             webViewDelegate:(id)webViewDelegate
         scrollViewAllowBounces:(BOOL)scrollViewAllowBounces NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

- (void)restoreInitialStateOrCreateFirstTab;
- (void)webViewDidAppear;
- (void)loadHomePage;
- (void)createNewTabLoadingHomePage:(BOOL)loadHomePage;
- (BOOL)createNewTabWithRequest:(NSURLRequest *)request;
- (void)switchToTabAtIndex:(NSInteger)tabIndex;
- (BOOL)returnToPreviousTabFromNewTab;
- (void)closeTabAtIndex:(NSInteger)tabIndex;
- (void)recreateActiveWebViewPreservingCurrentURL;
- (void)setAdBlockEnabledForAllWebViews:(BOOL)enabled;
- (void)captureSnapshotForCurrentTab;
- (void)clearSitePreviewsAndSettingsForURL:(nullable NSURL *)URL;
- (void)prepareTabOverviewThumbnails;
- (void)persistSession;
- (BOOL)canGoBack;
- (BOOL)canGoForward;
- (void)goBack;
- (void)goForward;
- (void)refreshNewTabPageIfVisibleSelectingGroup:(NSString *)group index:(NSUInteger)index;
- (void)showNewTabPageSelectingGroup:(NSString *)group;
- (void)handleWebViewPanGesture:(UIPanGestureRecognizer *)gestureRecognizer;
- (void)webViewDidStartLoad:(id)webView;
- (void)webViewDidFinishLoad:(id)webView;
- (void)webViewDidChangeNavigationHistory:(id)webView;
- (void)webViewDidFailLoad:(id)webView;
- (void)webViewWebContentProcessDidTerminate:(BrowserWebView *)webView;
- (void)prepareTabForRequest:(NSURLRequest *)request webView:(id)webView navigationType:(NSInteger)navigationType;
- (BrowserTabViewModel *)tabForWebView:(id)webView;
- (BOOL)isPrimaryDocumentRequest:(NSURLRequest *)request;
- (void)reloadStartPageIfActive;

@end

NS_ASSUME_NONNULL_END
