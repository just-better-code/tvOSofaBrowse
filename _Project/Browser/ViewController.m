//
//  ViewController.m
//  Browser
//
//  Created by Steven Troughton-Smith on 20/09/2015.
//  Improved by Jip van Akker on 14/10/2015 through 10/01/2019
//

#import "BrowserMenuCoordinator.h"
#import "BrowserFullscreenMediaControlsController.h"
#import "BrowserDOMInteractionService.h"
#import "BrowserHistoryStore.h"
#import "BrowserNavigationService.h"
#import "BrowserNativeStartPageView.h"
#import "BrowserPageActionCoordinator.h"
#import "BrowserPreferencesStore.h"
#import "BrowserRemoteInputController.h"
#import "BrowserSessionStore.h"
#import "BrowserTabViewModel.h"
#import "BrowserTabCoordinator.h"
#import "BrowserTabOverviewController.h"
#import "BrowserTorrentLibraryViewController.h"
#import "BrowserTorrentManager.h"
#import "BrowserUsageGuideViewController.h"
#import "BrowserViewModel.h"
#import "ViewController.h"

static NSString * const kBrowserGlobalSelectPressEndedNotification = @"BrowserGlobalSelectPressEndedNotification";
static NSString * const kBrowserGlobalDirectionalPressBeganNotification = @"BrowserGlobalDirectionalPressBeganNotification";

static UIColor *kTextColor(void) {
    if (@available(tvOS 13, *)) {
        return UIColor.labelColor;
    } else {
        return UIColor.blackColor;
    }
}

@interface ViewController () <BrowserMenuCoordinatorHost, BrowserPageActionCoordinatorHost, BrowserRemoteInputControllerHost, BrowserTabCoordinatorHost, BrowserTabOverviewControllerHost>

@property (nonatomic) BrowserFullscreenMediaControlsController *fullscreenMediaControls;
@property (nonatomic, weak) BrowserWebView *fullscreenMediaWebView;
@property (nonatomic, copy) NSString *fullscreenMediaSession;
@property (nonatomic) NSUInteger fullscreenMediaGeneration;
@property (nonatomic) BOOL mediaRevealPress;
@property (nonatomic) NSTimeInterval mediaSelectIgnoreUntil;
@property (nonatomic) BrowserDOMInteractionService *domInteractionService;
@property (nonatomic) BrowserMenuCoordinator *menuCoordinator;
@property (nonatomic) BrowserNavigationService *navigationService;
@property (nonatomic) BrowserPageActionCoordinator *pageActionCoordinator;
@property (nonatomic) BrowserPreferencesStore *preferencesStore;
@property (nonatomic) BrowserRemoteInputController *remoteInputController;
@property (nonatomic) BrowserSessionStore *sessionStore;
@property (nonatomic) BrowserTabCoordinator *tabCoordinator;
@property (nonatomic) BrowserTabOverviewController *tabOverviewController;
@property (nonatomic) BrowserViewModel *viewModel;
@property (nonatomic) BOOL displayedHintsOnLaunch;
@property (nonatomic) BOOL scrollViewAllowBounces;
@property (nonatomic) BrowserNativeStartPageView *nativeStartPageView;

@end

@implementation ViewController

#pragma mark - Lifecycle

- (void)viewDidLoad {
    [super viewDidLoad];
    self.definesPresentationContext = YES;
    self.scrollViewAllowBounces = YES;

    self.preferencesStore = [BrowserPreferencesStore new];
    [self.preferencesStore ensureUserAgentConsistency];

    self.viewModel = [BrowserViewModel new];
    self.viewModel.textFontSize = 100;

    self.domInteractionService = [BrowserDOMInteractionService new];
    self.navigationService = [[BrowserNavigationService alloc] initWithPreferencesStore:self.preferencesStore];
    self.sessionStore = [BrowserSessionStore new];
    self.menuCoordinator = [[BrowserMenuCoordinator alloc] initWithHost:self preferencesStore:self.preferencesStore];
    self.remoteInputController = [[BrowserRemoteInputController alloc] initWithHost:self rootView:self.view];
    __weak typeof(self) cursorOwner = self;
    self.remoteInputController.cursorVisibilityDidChange = ^(BOOL visible) {
        typeof(self) owner = cursorOwner;
        owner.fullscreenMediaControls.cursorVisible = visible;
        if (visible && owner.fullscreenMediaControls) [owner.view bringSubviewToFront:owner.remoteInputController.cursorView];
    };
    [self.view addSubview:self.remoteInputController.cursorView];
    self.tabCoordinator = [[BrowserTabCoordinator alloc] initWithHost:self
                                                             viewModel:self.viewModel
                                                      preferencesStore:self.preferencesStore
                                                     navigationService:self.navigationService
                                                          sessionStore:self.sessionStore
                                                    browserContainerView:self.browserContainerView
                                                              rootView:self.view
                                                            cursorView:self.remoteInputController.cursorView
                                                           webViewDelegate:self
                                                       scrollViewAllowBounces:self.scrollViewAllowBounces];
    self.tabOverviewController = [[BrowserTabOverviewController alloc] initWithHost:self
                                                                            viewModel:self.viewModel
                                                                             rootView:self.view
                                                                           cursorView:self.remoteInputController.cursorView];
    self.pageActionCoordinator = [[BrowserPageActionCoordinator alloc] initWithHost:self
                                                               domInteractionService:self.domInteractionService
                                                                   navigationService:self.navigationService];

    self.remoteInputController.cursorView.hidden = NO;
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(handleApplicationDidBecomeActive:)
                                               name:UIApplicationDidBecomeActiveNotification object:nil];

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationWillResignActive:)
                                                 name:UIApplicationWillResignActiveNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationDidEnterBackground:)
                                                 name:UIApplicationDidEnterBackgroundNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleApplicationWillTerminate:)
                                                 name:UIApplicationWillTerminateNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleGlobalSelectPressEndedNotification:)
                                                 name:kBrowserGlobalSelectPressEndedNotification
                                               object:nil];
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(handleGlobalDirectionalPressBeganNotification:)
                                                 name:kBrowserGlobalDirectionalPressBeganNotification
                                               object:nil];

    [self.tabCoordinator restoreInitialStateOrCreateFirstTab];
#if DEBUG
    // A launch-only URL lets local device tools open a requested page without altering saved settings.
    NSString *launchURLString = NSProcessInfo.processInfo.environment[@"BROWSER_OPEN_URL"];
    NSURL *launchURL = launchURLString.length ? [NSURL URLWithString:launchURLString] : nil;
    if (launchURL.host.length && [@[@"http", @"https"] containsObject:launchURL.scheme.lowercaseString]) {
        BOOL opened = [self.tabCoordinator createNewTabWithRequest:[NSURLRequest requestWithURL:launchURL]];
        self.displayedHintsOnLaunch = opened;
        BrowserLog(@"[DebugLaunch] openURLAccepted=%d", opened);
    }
#endif
    self.remoteInputController.magnifierEnabled = self.preferencesStore.cursorMagnifierEnabled;
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self.tabCoordinator webViewDidAppear];
    if (!self.preferencesStore.dontShowHintsOnLaunch && !self.displayedHintsOnLaunch) {
        [self showHintsAlert];
    }
    self.displayedHintsOnLaunch = YES;
}

- (void)viewDidDisappear:(BOOL)animated {
    [super viewDidDisappear:animated];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

#pragma mark - Notifications

- (void)handleApplicationWillResignActive:(NSNotification *)notification {
    [self.webview setFullscreenMediaControlsSuspended:YES];
    [self removeFullscreenMediaControls];
    (void)notification;
    [self.tabCoordinator persistSession];
}

- (void)handleApplicationDidBecomeActive:(NSNotification *)notification {
    [self.webview setFullscreenMediaControlsSuspended:NO];
}

- (void)handleApplicationDidEnterBackground:(NSNotification *)notification {
    (void)notification;
    [self.tabCoordinator persistSession];
}

- (void)handleApplicationWillTerminate:(NSNotification *)notification {
    (void)notification;
    [self.tabCoordinator persistSession];
}

- (void)handleGlobalSelectPressEndedNotification:(NSNotification *)notification {
    (void)notification;
    if (NSDate.timeIntervalSinceReferenceDate < self.mediaSelectIgnoreUntil) return;
    if ([self fullscreenMediaInputActive]) {
        if (self.fullscreenMediaControls.controlsVisible) return;
        if (self.remoteInputController.cursorView.hidden) {
            [self.fullscreenMediaControls showControls]; [self setNeedsFocusUpdate]; [self updateFocusIfNeeded]; return;
        }
    }
    [self.remoteInputController handleGlobalSelectPressEndedNotification];
}

- (void)handleGlobalDirectionalPressBeganNotification:(NSNotification *)notification {
    (void)notification;
    if ([self fullscreenMediaInputActive]) return;
    [self.remoteInputController hideCursorForDirectionalNavigation];
}

#pragma mark - Helpers

- (BrowserWebView *)webview {
    return self.tabCoordinator.activeWebView;
}

- (CGPoint)browserDOMPointForCursor {
    return [self.domInteractionService DOMPointForCursorOrigin:self.remoteInputController.cursorView.frame.origin
                                                        inView:self.view
                                                       webView:self.webview];
}

- (void)loadHomePage {
    [self.tabCoordinator loadHomePage];
}

- (void)showAdvancedMenu {
    [self.menuCoordinator showAdvancedMenu];
}

- (void)updateTextFontSize {
    self.webview.textZoomFactor = self.viewModel.textFontSize / 100.0;
}

- (void)showInputURLorSearchGoogleWithInitialText:(NSString *)initialText {
    UIAlertController *alertController = [UIAlertController alertControllerWithTitle:@"Enter URL or Search Terms"
                                                                             message:@""
                                                                      preferredStyle:UIAlertControllerStyleAlert];

    [alertController addTextFieldWithConfigurationHandler:^(UITextField *textField) {
        textField.keyboardType = UIKeyboardTypeURL;
        textField.placeholder = @"Enter URL or Search Terms";
        textField.text = initialText;
        textField.textColor = kTextColor();
        [textField setReturnKeyType:UIReturnKeyDone];
    }];

    __weak typeof(self) weakSelf = self;
    [alertController addAction:[UIAlertAction actionWithTitle:@"Search Google"
                                                        style:UIAlertActionStyleDefault
                                                      handler:^(__unused UIAlertAction *action) {
        UITextField *textField = alertController.textFields.firstObject;
        NSURLRequest *searchRequest = [weakSelf.navigationService googleSearchRequestForQuery:textField.text];
        if (searchRequest != nil) {
            [weakSelf.webview loadRequest:searchRequest];
        } else {
            [weakSelf requestURLorSearchInput];
        }
    }]];
    [alertController addAction:[UIAlertAction actionWithTitle:@"Go To Website"
                                                        style:UIAlertActionStyleDefault
                                                      handler:^(__unused UIAlertAction *action) {
        UITextField *textField = alertController.textFields.firstObject;
        if (textField.text.length == 0) {
            [weakSelf requestURLorSearchInput];
            return;
        }
        NSURLRequest *navigationRequest = [weakSelf.navigationService requestForEnteredAddressString:textField.text];
        if (navigationRequest != nil) {
            [weakSelf.webview loadRequest:navigationRequest];
        } else {
            [weakSelf requestURLorSearchInput];
        }
    }]];
    [alertController addAction:[UIAlertAction actionWithTitle:nil style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alertController animated:YES completion:nil];

    UITextField *textField = alertController.textFields.firstObject;
    if (self.webview.request == nil || self.webview.request.URL.absoluteString.length > 0) {
        [textField becomeFirstResponder];
    }
}

- (void)showInputURLorSearchGoogle {
    [self showInputURLorSearchGoogleWithInitialText:nil];
}

- (void)requestURLorSearchInput {
    UIAlertController *alertController = [UIAlertController alertControllerWithTitle:@"Quick Menu"
                                                                             message:@""
                                                                      preferredStyle:UIAlertControllerStyleAlert];

    if ([self.tabCoordinator canGoForward]) {
        [alertController addAction:[UIAlertAction actionWithTitle:@"Go Forward"
                                                            style:UIAlertActionStyleDefault
                                                          handler:^(__unused UIAlertAction *action) {
            [self.tabCoordinator goForward];
        }]];
    }

    [alertController addAction:[UIAlertAction actionWithTitle:@"Input URL or Search with Google"
                                                        style:UIAlertActionStyleDefault
                                                      handler:^(__unused UIAlertAction *action) {
        [self showInputURLorSearchGoogle];
    }]];

    if (self.webview.request != nil && self.webview.request.URL.absoluteString.length > 0) {
        [alertController addAction:[UIAlertAction actionWithTitle:@"Reload Page"
                                                            style:UIAlertActionStyleDefault
                                                          handler:^(__unused UIAlertAction *action) {
            self.tabCoordinator.previousURL = @"";
            [self.webview reload];
        }]];
    }

    [alertController addAction:[UIAlertAction actionWithTitle:nil style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alertController animated:YES completion:nil];
}

- (void)showHintsAlert {
    BrowserUsageGuideViewController *guide = [[BrowserUsageGuideViewController alloc]
                                              initWithPreferencesStore:self.preferencesStore];
    [self presentViewController:guide animated:YES completion:nil];
}

- (void)browserHandlePrimaryAction {
    if (self.nativeStartPageView != nil && self.remoteInputController.cursorModeEnabled) {
        CGPoint point = [self.remoteInputController.cursorView.superview
            convertPoint:self.remoteInputController.cursorView.center toView:self.nativeStartPageView];
        [self.nativeStartPageView activateAtPoint:point];
        return;
    }
    if (!self.remoteInputController.cursorModeEnabled || self.webview == nil) {
        return;
    }

    CGPoint domPoint = [self browserDOMPointForCursor];
    [self.pageActionCoordinator handlePageSelectionAtDOMPoint:domPoint webView:self.webview];
}

#pragma mark - BrowserMenuCoordinatorHost

- (BrowserWebView *)browserWebView {
    return self.webview;
}

- (NSString *)browserPreviousURL {
    return self.tabCoordinator.previousURL;
}

- (void)setBrowserPreviousURL:(NSString *)browserPreviousURL {
    self.tabCoordinator.previousURL = browserPreviousURL ?: @"";
}

- (NSUInteger)browserTextFontSize {
    return self.viewModel.textFontSize;
}

- (void)setBrowserTextFontSize:(NSUInteger)browserTextFontSize {
    self.viewModel.textFontSize = browserTextFontSize;
    self.preferencesStore.textFontSize = self.viewModel.textFontSize;
}

- (BOOL)browserCursorMagnifierEnabled {
    return self.preferencesStore.cursorMagnifierEnabled;
}

- (void)setBrowserCursorMagnifierEnabled:(BOOL)browserCursorMagnifierEnabled {
    self.preferencesStore.cursorMagnifierEnabled = browserCursorMagnifierEnabled;
    self.remoteInputController.magnifierEnabled = browserCursorMagnifierEnabled;
}

- (void)browserRemoteInputControllerToggleMagnifier {
    self.browserCursorMagnifierEnabled = !self.browserCursorMagnifierEnabled;
}

- (void)browserPresentViewController:(UIViewController *)viewController {
    [self presentViewController:viewController animated:YES completion:nil];
}

- (void)browserLoadHomePage {
    [self loadHomePage];
}

- (void)browserEditCurrentAddress {
    NSString *address = self.webview.request.URL.absoluteString;
    [self showInputURLorSearchGoogleWithInitialText:[address isEqualToString:@"about:blank"] ? nil : address];
}

- (void)browserShowHints {
    [self showHintsAlert];
}

- (void)browserShowTabOverview {
    [self removeFullscreenMediaControls];
    [self.tabCoordinator prepareTabOverviewThumbnails];
    [self.tabOverviewController show];
}

- (void)browserShowTorrents {
    [self presentTorrentLibrary];
}

- (BrowserTorrentLibraryViewController *)presentTorrentLibrary {
    if ([self.presentedViewController isKindOfClass:BrowserTorrentLibraryViewController.class]) {
        return (BrowserTorrentLibraryViewController *)self.presentedViewController;
    }
    BrowserTorrentLibraryViewController *library = [BrowserTorrentLibraryViewController new];
    [self browserPresentViewController:library];
    return library;
}

- (BOOL)handleTorrentRequest:(NSURLRequest *)request {
    NSURL *URL = request.URL;
    NSString *scheme = URL.scheme.lowercaseString;
    BOOL magnet = [scheme isEqualToString:@"magnet"];
    BOOL torrentFile = ([@[@"http", @"https"] containsObject:scheme ?: @""] &&
                        [URL.pathExtension.lowercaseString isEqualToString:@"torrent"]);
    if (!magnet && !torrentFile) return NO;

    BrowserTorrentLibraryViewController *library = [self presentTorrentLibrary];
    if (magnet) {
        NSError *error = nil;
        NSString *identifier = [[BrowserTorrentManager sharedManager] identifierForMagnetString:URL.absoluteString error:&error];
        if (identifier) [library focusTorrent:identifier];
        else [library showImportError:error.localizedDescription];
    } else {
        [library importTorrentRequest:request];
    }
    return YES;
}

- (void)browserCreateNewTab {
    [self.tabCoordinator createNewTabLoadingHomePage:NO];
}

- (BOOL)browserCanGoBack {
    return [self.tabCoordinator canGoBack];
}

- (BOOL)browserCanGoForward {
    return [self.tabCoordinator canGoForward];
}

- (void)browserGoBack {
    [self.tabCoordinator goBack];
}

- (void)browserGoForward {
    [self.tabCoordinator goForward];
}

- (void)browserOpenHistoryURLString:(NSString *)URLString {
    NSURLRequest *request = [self.navigationService requestForURLString:URLString];
    if (request != nil) {
        [self.webview loadRequest:request];
    }
}

- (void)browserUpdateTextFontSize {
    [self updateTextFontSize];
}

- (void)browserCaptureSnapshotForCurrentTab {
    [self.tabCoordinator captureSnapshotForCurrentTab];
}

- (void)browserClearSitePreviewsAndSettingsForURL:(NSURL *)URL {
    [self.tabCoordinator clearSitePreviewsAndSettingsForURL:URL];
}

- (void)browserRecreateActiveWebViewPreservingCurrentURL {
    [self.tabCoordinator recreateActiveWebViewPreservingCurrentURL];
}

- (void)browserBringCursorToFront {
    [self.view bringSubviewToFront:self.remoteInputController.cursorView];
}

- (void)browserSetAdBlockEnabled:(BOOL)enabled {
    [self.tabCoordinator setAdBlockEnabledForAllWebViews:enabled];
}

#pragma mark - BrowserTabCoordinatorHost

- (void)browserTabCoordinatorDidChangeActiveWebView {
    if (self.fullscreenMediaWebView != self.webview) [self removeFullscreenMediaControls];
}

- (void)browserTabCoordinatorPresentViewController:(UIViewController *)viewController {
    [self browserPresentViewController:viewController];
}

- (BOOL)browserTabCoordinatorIsCursorModeEnabled {
    return self.remoteInputController.cursorModeEnabled;
}

- (BOOL)browserTabCoordinatorIsTabOverviewVisible {
    return self.tabOverviewController.visible;
}

- (void)browserTabCoordinatorShowNativeStartPageSelectingGroup:(NSString *)group index:(NSUInteger)index {
    if (!self.nativeStartPageView) {
        BrowserNativeStartPageView *startPage = [[BrowserNativeStartPageView alloc] initWithFrame:CGRectZero];
        startPage.translatesAutoresizingMaskIntoConstraints = NO;
        __weak typeof(self) weakSelf = self;
        startPage.openURLString = ^(NSString *URLString) {
            NSURL *URL = [NSURL URLWithString:URLString];
            if (!URL || ![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString] || URL.host.length == 0) return;
            [weakSelf browserTabCoordinatorHideNativeStartPage];
            [weakSelf.webview loadRequest:[NSURLRequest requestWithURL:URL]];
        };
        startPage.openSearch = ^{ [weakSelf showInputURLorSearchGoogle]; };
        startPage.showAllHistory = ^{ [weakSelf.menuCoordinator presentAllHistory]; };
        startPage.manageFavorite = ^(NSUInteger storageIndex) {
            [weakSelf.menuCoordinator presentStoredItemActionsForKind:@"favorite" index:storageIndex];
        };
        startPage.deleteRecentVisit = ^(NSString *URLString) {
            NSURL *URL = [NSURL URLWithString:URLString];
            UIAlertController *actions = [UIAlertController alertControllerWithTitle:URL.host ?: @"Recent Visit"
                                                                             message:URLString preferredStyle:UIAlertControllerStyleAlert];
            if (URL.host.length > 0 && [@[@"http", @"https"] containsObject:URL.scheme.lowercaseString]) {
                [actions addAction:[UIAlertAction actionWithTitle:@"Open" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
                    [weakSelf browserTabCoordinatorHideNativeStartPage];
                    [weakSelf.webview loadRequest:[NSURLRequest requestWithURL:URL]];
                }]];
            }
            [actions addAction:[UIAlertAction actionWithTitle:@"Delete from History" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
                [weakSelf.menuCoordinator deleteHistoryForURLString:URLString];
            }]];
            [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
            [weakSelf presentViewController:actions animated:YES completion:nil];
        };
        [self.browserContainerView addSubview:startPage];
        [NSLayoutConstraint activateConstraints:@[
            [startPage.leadingAnchor constraintEqualToAnchor:self.browserContainerView.leadingAnchor],
            [startPage.trailingAnchor constraintEqualToAnchor:self.browserContainerView.trailingAnchor],
            [startPage.topAnchor constraintEqualToAnchor:self.browserContainerView.topAnchor],
            [startPage.bottomAnchor constraintEqualToAnchor:self.browserContainerView.bottomAnchor],
        ]];
        self.nativeStartPageView = startPage;
    }
    [self.nativeStartPageView reloadFavorites:[[BrowserHistoryStore sharedStore] favorites]
                                    recents:[[BrowserHistoryStore sharedStore] recentVisitsWithLimit:10]
                             selectingGroup:group index:index];
    [self.browserContainerView bringSubviewToFront:self.nativeStartPageView];
    [self.view bringSubviewToFront:self.remoteInputController.cursorView];
}

- (void)browserTabCoordinatorHideNativeStartPage {
    [self.nativeStartPageView removeFromSuperview];
    self.nativeStartPageView = nil;
}

#pragma mark - BrowserTabOverviewControllerHost

- (BOOL)browserTabOverviewControllerCursorModeEnabled {
    return self.remoteInputController.cursorModeEnabled;
}

- (void)browserTabOverviewControllerSetCursorModeEnabled:(BOOL)enabled {
    [self.remoteInputController setCursorModeEnabled:enabled];
}

- (void)browserTabOverviewControllerPresentViewController:(UIViewController *)viewController {
    [self presentViewController:viewController animated:YES completion:nil];
}

- (void)browserTabOverviewControllerCreateNewTabLoadingHomePage:(BOOL)loadHomePage {
    [self.tabCoordinator createNewTabLoadingHomePage:loadHomePage];
}

- (void)browserTabOverviewControllerSwitchToTabAtIndex:(NSInteger)tabIndex {
    [self.tabCoordinator switchToTabAtIndex:tabIndex];
}

- (void)browserTabOverviewControllerCloseTabAtIndex:(NSInteger)tabIndex {
    [self.tabCoordinator closeTabAtIndex:tabIndex];
}

- (void)browserTabOverviewControllerReturnToStartPage {
    [self.tabCoordinator reloadStartPageIfActive];
}

#pragma mark - BrowserPageActionCoordinatorHost

- (void)browserPageActionCoordinatorPresentViewController:(UIViewController *)viewController {
    [self browserPresentViewController:viewController];
}

- (BOOL)browserPageActionCoordinatorCreateNewTabWithRequest:(NSURLRequest *)request {
    if ([self handleTorrentRequest:request]) return YES;
    return [self.tabCoordinator createNewTabWithRequest:request];
}

#pragma mark - BrowserRemoteInputControllerHost

- (UIScrollView *)browserRemoteInputControllerActiveScrollView {
    return self.webview.scrollView;
}

- (UIViewController *)browserRemoteInputControllerPresentedViewController {
    return self.presentedViewController;
}

- (BOOL)browserRemoteInputControllerTabOverviewVisible {
    return self.tabOverviewController.visible;
}

- (BOOL)browserRemoteInputControllerTabOverviewContainsPoint:(CGPoint)point {
    return [self.tabOverviewController containsPoint:point];
}

- (BOOL)browserRemoteInputControllerHandleTabOverviewSelectionAtPoint:(CGPoint)point {
    return [self.tabOverviewController handleSelectionAtPoint:point];
}

- (void)browserRemoteInputControllerDismissTabOverview {
    [self.tabOverviewController dismiss];
}

- (void)browserRemoteInputControllerHandleTabOverviewAlternateAction {
    [self.tabOverviewController handleAlternateAction];
}

- (void)browserRemoteInputControllerHandlePrimaryAction {
    [self browserHandlePrimaryAction];
}

- (BOOL)browserRemoteInputControllerNewTabVisible {
    return [self.tabCoordinator.activeTab.URLString isEqualToString:@"about:blank"];
}

- (NSUInteger)browserRemoteInputControllerNewTabPageGeneration {
    return self.tabCoordinator.newTabPageGeneration;
}

- (void)browserRemoteInputControllerNavigateNewTabInDirection:(NSString *)direction {
    [self.nativeStartPageView navigateInDirection:direction];
}

- (void)browserRemoteInputControllerActivateNewTabSelection {
    [self.nativeStartPageView activateSelection];
}

- (void)browserRemoteInputControllerHandleTabOverviewPress {
    [self browserShowTabOverview];
}

- (void)browserRemoteInputControllerHandleMenuPress {
    if ([self fullscreenMediaInputActive]) { [self.fullscreenMediaControls closePlayer]; return; }
    if (self.webview == nil) {
        [self handleMenuPressOutsideFullscreen];
        return;
    }
    __weak typeof(self) weakSelf = self;
    [self.webview evaluateJavaScript:@"window.__browserTVExitFullscreen ? window.__browserTVExitFullscreen() : false"
                           completion:^(NSString *result) {
        if ([result isEqualToString:@"true"]) {
            return;
        }
        [weakSelf handleMenuPressOutsideFullscreen];
    }];
}

- (void)handleMenuPressOutsideFullscreen {
    if (self.presentedViewController != nil) {
        [self.presentedViewController dismissViewControllerAnimated:YES completion:nil];
    } else if ([self.tabCoordinator returnToPreviousTabFromNewTab]) {
        return;
    } else if (self.browserCursorMagnifierEnabled) {
        self.browserCursorMagnifierEnabled = NO;
    } else {
        [self showAdvancedMenu];
    }
}

- (void)browserRemoteInputControllerHandlePlayPausePress {
    if ([self fullscreenMediaInputActive]) { [self.fullscreenMediaControls togglePlayback]; return; }
    __weak typeof(self) weakSelf = self;
    [self.webview evaluateJavaScript:@"window.__browserTVToggleVideo ? window.__browserTVToggleVideo() : false"
                           completion:^(NSString *result) {
        if ([result isEqualToString:@"true"]) {
            return;
        }
        if ([weakSelf.presentedViewController isKindOfClass:[UIAlertController class]]) {
            [weakSelf.presentedViewController dismissViewControllerAnimated:YES completion:nil];
        }
    }];
}

- (void)browserRemoteInputControllerHandleNewTabOptionUsingKeyboardSelection:(BOOL)keyboardSelection {
    if (![self browserRemoteInputControllerNewTabVisible]) return;
    if (keyboardSelection) {
        [self.nativeStartPageView showOptionForSelection];
    } else {
        CGPoint point = [self.remoteInputController.cursorView.superview
            convertPoint:self.remoteInputController.cursorView.center toView:self.nativeStartPageView];
        [self.nativeStartPageView showOptionAtPoint:point];
    }
}

- (void)browserRemoteInputControllerHoverStateAtCursorPoint:(CGPoint)point
                                                completion:(void (^)(BOOL))completion {
    BrowserWebView *webView = self.webview;
    if (webView.request == nil) {
        completion(NO);
        return;
    }
    [self.domInteractionService evaluateHoverStateAtCursorPoint:point
                                                          inView:self.view
                                                         webView:webView
                                                      completion:completion];
}

- (void)browserRemoteInputControllerCaptureMagnifierAtPoint:(CGPoint)point
                                                  completion:(void (^)(UIImage *))completion {
    BrowserWebView *webView = self.webview;
    if (webView == nil || webView.request == nil || CGRectIsEmpty(webView.bounds)) {
        completion(nil);
        return;
    }
    CGPoint webPoint = [self.view convertPoint:point toView:webView];
    if (!CGRectContainsPoint(webView.bounds, webPoint)) {
        completion(nil);
        return;
    }
    CGFloat cropSize = MIN(192.0, MIN(CGRectGetWidth(webView.bounds), CGRectGetHeight(webView.bounds)));
    CGRect centeredCrop = CGRectMake(webPoint.x - cropSize / 2.0,
                                     webPoint.y - cropSize / 2.0,
                                     cropSize, cropSize);
    CGRect visibleCrop = CGRectIntersection(centeredCrop, webView.bounds);
    if (CGRectIsEmpty(visibleCrop)) {
        completion(nil);
        return;
    }
    CGFloat magnification = 384.0 / cropSize;
    [webView captureSnapshotInRect:visibleCrop
                            width:CGRectGetWidth(visibleCrop) * magnification
                       completion:^(UIImage *snapshot) {
        if (snapshot == nil) {
            completion(nil);
            return;
        }
        UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc]
            initWithSize:CGSizeMake(384.0, 384.0)];
        UIImage *centeredImage = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
            [[UIColor colorWithWhite:0.1 alpha:1.0] setFill];
            UIRectFill(CGRectMake(0.0, 0.0, 384.0, 384.0));
            CGRect imageRect = CGRectMake((CGRectGetMinX(visibleCrop) - CGRectGetMinX(centeredCrop)) * magnification,
                                          (CGRectGetMinY(visibleCrop) - CGRectGetMinY(centeredCrop)) * magnification,
                                          CGRectGetWidth(visibleCrop) * magnification,
                                          CGRectGetHeight(visibleCrop) * magnification);
            [snapshot drawInRect:imageRect];
        }];
        completion(centeredImage);
    }];
}

- (void)browserRemoteInputControllerSetWebInteractionEnabled:(BOOL)enabled {
    self.webview.userInteractionEnabled = enabled;
}

- (void)browserRemoteInputControllerPersistSession {
    [self.tabCoordinator persistSession];
}

- (void)browserRemoteInputControllerHandleMediaHorizontalPress:(UIPressType)pressType {
    if (self.webview == nil) {
        return;
    }
    NSString *direction = pressType == UIPressTypeRightArrow ? @"right" : @"left";
    NSString *script = [NSString stringWithFormat:
        @"window.__browserTVHandleMediaHorizontalPress ? window.__browserTVHandleMediaHorizontalPress('%@') : false",
        direction];
    [self.webview evaluateJavaScript:script completion:^(__unused NSString *result) {}];
}

#pragma mark - Fullscreen iframe media controls

- (void)removeFullscreenMediaControls {
    if (!self.fullscreenMediaControls) return;
    [self.fullscreenMediaControls stopSeeking];
    [self.fullscreenMediaControls willMoveToParentViewController:nil];
    [self.fullscreenMediaControls.view removeFromSuperview];
    [self.fullscreenMediaControls removeFromParentViewController];
    self.fullscreenMediaControls = nil;
    self.fullscreenMediaWebView = nil; self.fullscreenMediaSession = nil;
    self.mediaRevealPress = NO;
    self.remoteInputController.cursorSuppressed = NO;
    [self.remoteInputController refreshInteractionState];
    [self setNeedsFocusUpdate];
}

- (BOOL)fullscreenMediaInputActive {
    if (self.fullscreenMediaControls && (self.fullscreenMediaWebView != self.webview ||
        self.fullscreenMediaGeneration != self.webview.documentGeneration)) [self removeFullscreenMediaControls];
    return self.fullscreenMediaControls && !self.presentedViewController && !self.tabOverviewController.visible;
}

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    if ([self fullscreenMediaInputActive] && self.fullscreenMediaControls.controlsVisible) return @[self.fullscreenMediaControls];
    return [super preferredFocusEnvironments];
}

- (void)webView:(id)webView didUpdateFullscreenMediaState:(NSDictionary *)state {
    if (webView != self.webview) {
        [webView setFullscreenMediaControlsSuspended:YES];
        if (webView == self.fullscreenMediaWebView) [self removeFullscreenMediaControls];
        return;
    }
    if (![state[@"active"] boolValue] || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
        [self removeFullscreenMediaControls]; return;
    }
    if (self.presentedViewController || self.tabOverviewController.visible) {
        [self removeFullscreenMediaControls]; return;
    }
    NSString *session = state[@"session"];
    if (self.fullscreenMediaControls && (![session isEqual:self.fullscreenMediaSession] ||
        self.fullscreenMediaWebView != webView || self.fullscreenMediaGeneration != self.webview.documentGeneration)) [self removeFullscreenMediaControls];
    if (!self.fullscreenMediaControls) {
        BrowserFullscreenMediaControlsController *controls = [BrowserFullscreenMediaControlsController new];
        self.fullscreenMediaControls = controls; self.fullscreenMediaWebView = webView;
        self.fullscreenMediaSession = session; self.fullscreenMediaGeneration = self.webview.documentGeneration;
        __weak typeof(self) weakSelf = self;
        controls.sendCommand = ^(NSString *command, double value) {
            typeof(self) owner = weakSelf;
            if (![owner fullscreenMediaInputActive]) return;
            owner.mediaSelectIgnoreUntil = NSDate.timeIntervalSinceReferenceDate + 0.4;
            if ([command isEqualToString:@"previous"] || [command isEqualToString:@"next"]) {
                if ([owner.fullscreenMediaWebView sendSystemMediaTrackCommand:[command isEqualToString:@"next"]]) return;
            }
            NSArray *arguments = @[command, @(value), owner.fullscreenMediaSession ?: @""];
            NSData *data = [NSJSONSerialization dataWithJSONObject:arguments options:0 error:nil];
            NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            if (!json) return;
            NSString *script = [NSString stringWithFormat:@"window.__browserTVSendFullscreenMediaCommand ? window.__browserTVSendFullscreenMediaCommand.apply(null,%@) : false", json];
            [owner.fullscreenMediaWebView evaluateJavaScript:script completionHandler:^(__unused NSString *result, __unused NSError *error) {}];
        };
        [self addChildViewController:controls];
        controls.view.frame = self.view.bounds;
        controls.view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        [self.view addSubview:controls.view]; [controls didMoveToParentViewController:self];
        self.remoteInputController.cursorSuppressed = YES;
        controls.cursorVisible = NO;
        [controls updateMediaState:state]; [controls showControls];
        [self setNeedsFocusUpdate]; [self updateFocusIfNeeded];
    } else [self.fullscreenMediaControls updateMediaState:state];
}

#pragma mark - BrowserWebViewDelegate

- (BOOL)webView:(id)webView shouldCreateNewTabWithRequest:(NSURLRequest *)request navigationType:(NSInteger)navigationType {
    (void)webView;
    if ([self handleTorrentRequest:request]) return YES;
    return [self.tabCoordinator createNewTabWithRequest:request];
}

- (BOOL)webView:(id)webView shouldImportTorrentResponse:(NSURLResponse *)response request:(NSURLRequest *)request {
    (void)webView;
    BOOL torrentMIME = [response.MIMEType.lowercaseString isEqualToString:@"application/x-bittorrent"];
    NSString *disposition = [response isKindOfClass:NSHTTPURLResponse.class]
        ? [(NSHTTPURLResponse *)response valueForHTTPHeaderField:@"Content-Disposition"] : nil;
    BOOL torrentFilename = [disposition.lowercaseString containsString:@"attachment"] &&
        [response.suggestedFilename.pathExtension.lowercaseString isEqualToString:@"torrent"];
    if (!torrentMIME && !torrentFilename) return NO;
    NSURL *URL = response.URL;
    if (![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString ?: @""]) return NO;

    BrowserTorrentLibraryViewController *library = [self presentTorrentLibrary];
    BOOL sameURL = [request.URL isEqual:URL];
    NSString *method = request.HTTPMethod.uppercaseString ?: @"GET";
    if (![method isEqualToString:@"GET"] && !sameURL) {
        [library showImportError:@"This torrent download was redirected after a form submission. Open its direct .torrent URL instead."];
        return YES;
    }
    NSURLRequest *importRequest = sameURL ? request : [NSURLRequest requestWithURL:URL];
    [library importTorrentRequest:importRequest];
    return YES;
}

- (BOOL)webView:(id)webView shouldStartLoadWithRequest:(NSURLRequest *)request navigationType:(NSInteger)navigationType {
    (void)navigationType;
    if ([self handleTorrentRequest:request]) return NO;
    if ([request.URL.scheme.lowercaseString isEqualToString:@"tvosbrowser"] &&
        [request.URL.host.lowercaseString isEqualToString:@"manage"] &&
        [self browserRemoteInputControllerNewTabVisible]) {
        NSString *kind = nil;
        NSUInteger index = NSNotFound;
        for (NSURLQueryItem *item in [NSURLComponents componentsWithURL:request.URL resolvingAgainstBaseURL:NO].queryItems) {
            if ([item.name isEqualToString:@"kind"]) {
                kind = item.value;
            } else if ([item.name isEqualToString:@"index"] && item.value.length > 0) {
                NSScanner *scanner = [NSScanner scannerWithString:item.value];
                unsigned long long parsedIndex = 0;
                if ([scanner scanUnsignedLongLong:&parsedIndex] && scanner.isAtEnd && parsedIndex <= NSUIntegerMax) {
                    index = (NSUInteger)parsedIndex;
                }
            }
        }
        if (index != NSNotFound && [kind isEqualToString:@"favorite"]) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self.menuCoordinator presentStoredItemActionsForKind:kind index:index];
            });
        }
        return NO;
    }
    if ([request.URL.scheme.lowercaseString isEqualToString:@"tvosbrowser"] &&
        [self browserRemoteInputControllerNewTabVisible]) {
        NSString *host = request.URL.host.lowercaseString;
        if ([host isEqualToString:@"history"]) {
            dispatch_async(dispatch_get_main_queue(), ^{ [self.menuCoordinator presentAllHistory]; });
            return NO;
        }
        if ([host isEqualToString:@"delete-history"]) {
            NSString *URLString = nil;
            for (NSURLQueryItem *item in [NSURLComponents componentsWithURL:request.URL resolvingAgainstBaseURL:NO].queryItems) {
                if ([item.name isEqualToString:@"url"]) URLString = item.value;
            }
            if (URLString.length > 0) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    [self.menuCoordinator deleteHistoryForURLString:URLString];
                });
            }
            return NO;
        }
    }
    if ([request.URL.scheme.lowercaseString isEqualToString:@"tvosbrowser"] &&
        [request.URL.host.lowercaseString isEqualToString:@"search"] &&
        [self browserRemoteInputControllerNewTabVisible]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self showInputURLorSearchGoogle];
        });
        return NO;
    }
    [self.tabCoordinator prepareTabForRequest:request webView:webView navigationType:navigationType];
    return YES;
}

- (void)browserRefreshNewTabPageSelectingGroup:(NSString *)group index:(NSUInteger)index {
    [self.tabCoordinator refreshNewTabPageIfVisibleSelectingGroup:group index:index];
}

- (void)browserShowNewTabPageSelectingGroup:(NSString *)group {
    [self.tabCoordinator showNewTabPageSelectingGroup:group];
}

- (void)webViewDidStartLoad:(id)webView {
    if (webView == self.fullscreenMediaWebView) [self removeFullscreenMediaControls];
    [self.tabCoordinator webViewDidStartLoad:webView];
}

- (void)webViewWebContentProcessDidTerminate:(id)webView {
    if (webView == self.fullscreenMediaWebView) [self removeFullscreenMediaControls];
    [self.tabCoordinator webViewWebContentProcessDidTerminate:webView];
}

- (void)webViewDidChangeNavigationHistory:(id)webView {
    [self.tabCoordinator webViewDidChangeNavigationHistory:webView];
}

- (void)webViewDidFinishLoad:(id)webView {
    [self.tabCoordinator webViewDidFinishLoad:webView];
    if (self.tabOverviewController.visible) {
        BrowserTabViewModel *tab = [self.tabCoordinator tabForWebView:webView];
        NSInteger tabIndex = tab != nil ? [self.viewModel.tabs indexOfObject:tab] : NSNotFound;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!self.tabOverviewController.visible) {
                return;
            }
            if (tabIndex != NSNotFound) {
                [self.tabOverviewController updateCardAtIndex:tabIndex];
            } else {
                [self.tabOverviewController reload];
            }
        });
    }
}

- (void)browserTabCoordinatorSnapshotDidUpdateForTab:(BrowserTabViewModel *)tab {
    if (!self.tabOverviewController.visible) {
        return;
    }
    NSInteger tabIndex = [self.viewModel.tabs indexOfObject:tab];
    if (tabIndex != NSNotFound) {
        [self.tabOverviewController updateCardAtIndex:tabIndex];
    }
}

- (void)webView:(id)webView didFailLoadWithError:(NSError *)error {
    BrowserTabViewModel *tab = [self.tabCoordinator tabForWebView:webView];
    if (tab == nil) {
        return;
    }

    NSURL *failingURL = error.userInfo[NSURLErrorFailingURLErrorKey];
    NSURLRequest *currentRequest = [webView request];
    NSString *currentRequestURLString = currentRequest.URL.absoluteString ?: @"";
    if (failingURL != nil &&
        currentRequestURLString.length > 0 &&
        ![failingURL.absoluteString isEqualToString:currentRequestURLString]) {
        return;
    }

    if (![self.navigationService shouldIgnoreLoadError:error]) {
        [self.tabCoordinator webViewDidFailLoad:webView];
    }

    if (tab != self.tabCoordinator.activeTab) {
        return;
    }
    if ([self.navigationService shouldIgnoreLoadError:error]) {
        return;
    }

    UIAlertController *alertController = [UIAlertController alertControllerWithTitle:@"Could Not Load Webpage"
                                                                             message:error.localizedDescription
                                                                      preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    if (tab.requestURL.length > 1) {
        [alertController addAction:[UIAlertAction actionWithTitle:@"Google This Page"
                                                            style:UIAlertActionStyleDefault
                                                          handler:^(__unused UIAlertAction *action) {
            NSURLRequest *searchRequest = [weakSelf.navigationService googleSearchRequestForFailedRequestURLString:tab.requestURL];
            if (searchRequest != nil) {
                [weakSelf.webview loadRequest:searchRequest];
            }
        }]];
    }
    if (self.webview.request != nil && self.webview.request.URL.absoluteString.length > 0) {
        [alertController addAction:[UIAlertAction actionWithTitle:@"Reload Page"
                                                            style:UIAlertActionStyleDefault
                                                          handler:^(__unused UIAlertAction *action) {
            weakSelf.tabCoordinator.previousURL = @"";
            [weakSelf.webview reload];
        }]];
    } else {
        [alertController addAction:[UIAlertAction actionWithTitle:@"Enter a URL or Search"
                                                            style:UIAlertActionStyleDefault
                                                          handler:^(__unused UIAlertAction *action) {
            [weakSelf requestURLorSearchInput];
        }]];
    }
    [alertController addAction:[UIAlertAction actionWithTitle:nil style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alertController animated:YES completion:nil];
}

#pragma mark - Presses / Touches

- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    if ([self fullscreenMediaInputActive]) {
        UIPress *press = presses.anyObject;
        if (press.type == UIPressTypeMenu || press.type == UIPressTypePlayPause) return;
        if (!self.fullscreenMediaControls.controlsVisible && self.remoteInputController.cursorView.hidden &&
            (press.type == UIPressTypeSelect || press.type == UIPressTypeUpArrow || press.type == UIPressTypeDownArrow ||
             press.type == UIPressTypeLeftArrow || press.type == UIPressTypeRightArrow)) {
            self.mediaRevealPress = YES; [self.fullscreenMediaControls showControls];
            [self setNeedsFocusUpdate]; [self updateFocusIfNeeded]; return;
        }
        if (self.fullscreenMediaControls.controlsVisible) { [super pressesBegan:presses withEvent:event]; return; }
    }
    [self.remoteInputController handlePressesBegan:presses withEvent:event];
    [super pressesBegan:presses withEvent:event];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    if ([self fullscreenMediaInputActive]) {
        UIPress *press = presses.anyObject;
        if (press.type == UIPressTypeMenu) { [self.fullscreenMediaControls closePlayer]; return; }
        if (press.type == UIPressTypePlayPause) { [self.fullscreenMediaControls togglePlayback]; return; }
        if (self.mediaRevealPress) { self.mediaRevealPress = NO; return; }
        if (self.fullscreenMediaControls.controlsVisible) { [super pressesEnded:presses withEvent:event]; return; }
    }
    if ([self.remoteInputController handlePressesEnded:presses withEvent:event]) {
        return;
    }
    [super pressesEnded:presses withEvent:event];
}

- (void)pressesCancelled:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    self.mediaRevealPress = NO;
    [self.fullscreenMediaControls stopSeeking];
    [self.remoteInputController handlePressesCancelled:presses];
    [super pressesCancelled:presses withEvent:event];
}

- (void)touchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    if ([self fullscreenMediaInputActive]) { [super touchesBegan:touches withEvent:event]; return; }
    if ([self.remoteInputController handleTouchesBegan:touches withEvent:event]) {
        return;
    }
    [super touchesBegan:touches withEvent:event];
}

- (void)touchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    if ([self fullscreenMediaInputActive]) { [super touchesMoved:touches withEvent:event]; return; }
    if ([self.remoteInputController handleTouchesMoved:touches withEvent:event]) {
        return;
    }
    [super touchesMoved:touches withEvent:event];
}

- (void)touchesEnded:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    (void)touches;
    (void)event;
    [self.remoteInputController handleTouchesEnded];
    [super touchesEnded:touches withEvent:event];
}

- (void)touchesCancelled:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    (void)touches;
    (void)event;
    [self.remoteInputController handleTouchesEnded];
    [super touchesCancelled:touches withEvent:event];
}

@end
