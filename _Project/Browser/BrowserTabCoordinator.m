#import "BrowserTabCoordinator.h"

#import "BrowserNavigationService.h"
#import "BrowserPreferencesStore.h"
#import "BrowserSessionStore.h"
#import "BrowserTabViewModel.h"
#import "BrowserViewModel.h"
#import "BrowserWebView.h"

static CGFloat const kThumbnailStagingOffset = 4096.0;
static NSString * const kBrowserNewTabURL = @"about:blank";
static NSUInteger const kMaximumWebContentProcessReloads = 2;
static NSTimeInterval const kWebContentProcessCrashQuietInterval = 60.0;

@interface BrowserTabCoordinator ()

@property (nonatomic, weak) id<BrowserTabCoordinatorHost> host;
@property (nonatomic) BrowserViewModel *viewModel;
@property (nonatomic) BrowserPreferencesStore *preferencesStore;
@property (nonatomic) BrowserNavigationService *navigationService;
@property (nonatomic) BrowserSessionStore *sessionStore;
@property (nonatomic, weak) UIView *browserContainerView;
@property (nonatomic, weak) UIView *rootView;
@property (nonatomic, weak) UIImageView *cursorView;
@property (nonatomic, weak) id webViewDelegate;
@property (nonatomic) BOOL scrollViewAllowBounces;
@property (nonatomic) NSMutableDictionary<NSString *, BrowserWebView *> *webViewsByTabIdentifier;
@property (nonatomic) UIView *thumbnailStagingView;
@property (nonatomic, strong) dispatch_queue_t thumbnailCacheQueue;
@property (nonatomic) NSMutableSet<NSString *> *pendingThumbnailReads;
@property (nonatomic) NSMutableSet<NSString *> *pendingSnapshots;
@property (nonatomic, readwrite, nullable) BrowserWebView *activeWebView;
@property (nonatomic, copy) NSString *pendingNewTabSelectionGroup;
@property (nonatomic) NSUInteger pendingNewTabSelectionIndex;
@property (nonatomic, copy) NSString *lastActiveTabIdentifier;
@property (nonatomic, readwrite) NSUInteger newTabPageGeneration;

- (void)showNewTabPageInWebView:(BrowserWebView *)webView tab:(BrowserTabViewModel *)tab;

@end

@implementation BrowserTabCoordinator

- (instancetype)initWithHost:(id<BrowserTabCoordinatorHost>)host
                   viewModel:(BrowserViewModel *)viewModel
            preferencesStore:(BrowserPreferencesStore *)preferencesStore
           navigationService:(BrowserNavigationService *)navigationService
                sessionStore:(BrowserSessionStore *)sessionStore
          browserContainerView:(UIView *)browserContainerView
                    rootView:(UIView *)rootView
                  cursorView:(UIImageView *)cursorView
             webViewDelegate:(id)webViewDelegate
         scrollViewAllowBounces:(BOOL)scrollViewAllowBounces {
    self = [super init];
    if (self) {
        _host = host;
        _viewModel = viewModel;
        _preferencesStore = preferencesStore;
        _navigationService = navigationService;
        _sessionStore = sessionStore;
        _browserContainerView = browserContainerView;
        _rootView = rootView;
        _cursorView = cursorView;
        _webViewDelegate = webViewDelegate;
        _scrollViewAllowBounces = scrollViewAllowBounces;
        _webViewsByTabIdentifier = [NSMutableDictionary dictionary];
        _thumbnailCacheQueue = dispatch_queue_create("browser.tab-thumbnails", DISPATCH_QUEUE_SERIAL);
        _pendingThumbnailReads = [NSMutableSet set];
        _pendingSnapshots = [NSMutableSet set];
        [_preferencesStore ensureUserAgentConsistency];
        [self ensureThumbnailStagingView];
    }
    return self;
}

- (BrowserTabViewModel *)activeTab {
    return [self.viewModel activeTab];
}

- (NSString *)requestURL {
    return self.activeTab.requestURL;
}

- (void)setRequestURL:(NSString *)requestURL {
    self.activeTab.requestURL = requestURL ?: @"";
}

- (NSString *)previousURL {
    return self.activeTab.previousURL;
}

- (void)setPreviousURL:(NSString *)previousURL {
    self.activeTab.previousURL = previousURL ?: @"";
}

- (CGSize)thumbnailViewportSize {
    CGFloat width = CGRectGetWidth(self.rootView.bounds);
    CGFloat height = CGRectGetHeight(self.rootView.bounds);
    return CGSizeMake(MAX(width, 1.0), MAX(height, 1.0));
}

- (void)ensureThumbnailStagingView {
    if (self.thumbnailStagingView != nil || self.rootView == nil) {
        return;
    }

    CGSize viewportSize = [self thumbnailViewportSize];
    UIView *stagingView = [[UIView alloc] initWithFrame:CGRectMake(kThumbnailStagingOffset,
                                                                   0.0,
                                                                   viewportSize.width,
                                                                   viewportSize.height)];
    stagingView.backgroundColor = UIColor.clearColor;
    stagingView.userInteractionEnabled = NO;
    stagingView.clipsToBounds = YES;
    [self.rootView addSubview:stagingView];
    self.thumbnailStagingView = stagingView;
}

- (void)updateThumbnailStagingViewFrame {
    [self ensureThumbnailStagingView];
    if (self.thumbnailStagingView == nil) {
        return;
    }

    CGSize viewportSize = [self thumbnailViewportSize];
    self.thumbnailStagingView.frame = CGRectMake(kThumbnailStagingOffset,
                                                 0.0,
                                                 viewportSize.width,
                                                 viewportSize.height);
}

- (void)parkWebViewForThumbnailing:(BrowserWebView *)webView {
    if (webView == nil) {
        return;
    }

    [self updateThumbnailStagingViewFrame];
    webView.userInteractionEnabled = NO;
    UIScrollView *scrollView = webView.scrollView;
    scrollView.scrollEnabled = NO;
    scrollView.bounces = self.scrollViewAllowBounces;
    if (webView.superview != self.thumbnailStagingView) {
        [webView removeFromSuperview];
        [self.thumbnailStagingView addSubview:webView];
    }
    webView.frame = self.thumbnailStagingView.bounds;
}

- (BOOL)isWebViewStaged:(BrowserWebView *)webView {
    return webView != nil && webView.superview == self.thumbnailStagingView;
}

- (BrowserWebView *)createConfiguredWebView {
    BrowserWebView *webView = [[BrowserWebView alloc] initWithUserAgent:self.preferencesStore.userAgent
                                            allowsInlineMediaPlayback:YES];
    webView.translatesAutoresizingMaskIntoConstraints = NO;
    webView.clipsToBounds = NO;
    webView.delegate = self.webViewDelegate;
    webView.layoutMargins = UIEdgeInsetsZero;
    webView.opaque = NO;
    webView.backgroundColor = UIColor.blackColor;

    UIScrollView *scrollView = webView.scrollView;
    scrollView.layoutMargins = UIEdgeInsetsZero;
    scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    scrollView.contentOffset = CGPointZero;
    scrollView.contentInset = UIEdgeInsetsZero;
    scrollView.clipsToBounds = NO;
    scrollView.backgroundColor = UIColor.blackColor;
    scrollView.bounces = self.scrollViewAllowBounces;
    [scrollView.panGestureRecognizer addTarget:self action:@selector(handleWebViewPanGesture:)];
    scrollView.scrollEnabled = NO;

    webView.pageZoomFactor = 1.0;
    webView.contentMode = UIViewContentModeScaleToFill;
    webView.userInteractionEnabled = NO;
    return webView;
}

- (void)refreshActiveTabUI {
    BrowserTabViewModel *tab = self.activeTab;
    if (tab == nil) {
        return;
    }

    NSURL *pageURL = self.activeWebView.request.URL ?: [NSURL URLWithString:tab.URLString];
    self.activeWebView.pageZoomFactor = [self.preferencesStore pageZoomPercentForURL:pageURL] / 100.0;
    if (![tab.URLString isEqualToString:kBrowserNewTabURL]) {
        [self.host browserTabCoordinatorHideNativeStartPage];
    }
}

- (BOOL)restoreBrowserSession {
    return [self.sessionStore restoreSessionIntoViewModel:self.viewModel];
}

- (void)restoreInitialStateOrCreateFirstTab {
    BOOL restored = [self restoreBrowserSession];
    [self pruneThumbnailCache];
    if (!restored) {
        [self createNewTabLoadingHomePage:NO];
        return;
    }
    [self initWebView];
    [self refreshActiveTabUI];
}

- (void)webViewDidAppear {
    NSURLRequest *savedReopenRequest = [self.sessionStore consumeSavedURLToReopenRequestWithNavigationService:self.navigationService];
    if (savedReopenRequest != nil) {
        [self.activeWebView loadRequest:savedReopenRequest];
    } else if (self.activeWebView.request == nil) {
        [self loadStoredContentForTab:self.activeTab webView:self.activeWebView fallbackToHomePage:YES];
    }
}

- (void)loadHomePage {
    NSURLRequest *homePageRequest = [self.navigationService homePageRequest];
    if (homePageRequest != nil) {
        [self.activeWebView loadRequest:homePageRequest];
    }
}


- (void)showNewTabPageInWebView:(BrowserWebView *)webView tab:(BrowserTabViewModel *)tab {
    if (webView == nil || tab == nil) return;
    self.newTabPageGeneration += 1;
    tab.title = @"New Tab";
    tab.URLString = kBrowserNewTabURL;
    tab.requestURL = kBrowserNewTabURL;
    [webView loadHTMLString:@""];
    if (tab == self.activeTab) {
        NSString *group = self.pendingNewTabSelectionGroup;
        NSUInteger index = self.pendingNewTabSelectionIndex;
        self.pendingNewTabSelectionGroup = nil;
        self.pendingNewTabSelectionIndex = 0;
        [self.host browserTabCoordinatorShowNativeStartPageSelectingGroup:group index:index];
        [self refreshActiveTabUI];
    }
}

- (void)refreshNewTabPageIfVisibleSelectingGroup:(NSString *)group index:(NSUInteger)index {
    if (self.activeWebView == nil || ![self.activeTab.URLString isEqualToString:kBrowserNewTabURL]) {
        return;
    }
    self.pendingNewTabSelectionGroup = [group copy];
    self.pendingNewTabSelectionIndex = index;
    [self showNewTabPageInWebView:self.activeWebView tab:self.activeTab];
}

- (void)showNewTabPageSelectingGroup:(NSString *)group {
    if ([self.activeTab.URLString isEqualToString:kBrowserNewTabURL]) {
        [self.host browserTabCoordinatorShowNativeStartPageSelectingGroup:group index:0];
        return;
    }
    self.pendingNewTabSelectionGroup = [group copy];
    self.pendingNewTabSelectionIndex = 0;
    [self createNewTabLoadingHomePage:NO];
}

- (void)initWebView {
    BrowserTabViewModel *tab = [self.viewModel ensureActiveTab];
    if (tab == nil) {
        return;
    }

    BrowserWebView *webView = self.webViewsByTabIdentifier[tab.identifier];
    if (webView == nil) {
        webView = [self createConfiguredWebView];
        self.webViewsByTabIdentifier[tab.identifier] = webView;
    }
    self.activeWebView = webView;
    [self attachActiveWebView];
}

- (void)attachActiveWebView {
    BrowserTabViewModel *tab = self.activeTab;
    if (tab == nil) {
        return;
    }

    BrowserWebView *activeWebView = self.webViewsByTabIdentifier[tab.identifier];
    if (activeWebView == nil) {
        return;
    }

    [self updateThumbnailStagingViewFrame];
    for (BrowserTabViewModel *candidate in self.viewModel.tabs) {
        BrowserWebView *candidateWebView = self.webViewsByTabIdentifier[candidate.identifier];
        if (candidateWebView == nil || candidateWebView == activeWebView) {
            continue;
        }
        [self parkWebViewForThumbnailing:candidateWebView];
    }

    self.activeWebView = activeWebView;
    [self.activeWebView removeFromSuperview];
    [self.browserContainerView addSubview:self.activeWebView];
    self.activeWebView.frame = self.rootView.bounds;

    UIScrollView *scrollView = self.activeWebView.scrollView;
    [scrollView setNeedsLayout];
    [scrollView layoutIfNeeded];
    [self.rootView setNeedsLayout];
    [self.rootView layoutIfNeeded];
    scrollView.bounces = self.scrollViewAllowBounces;

    BOOL shouldAllowWebInteraction = ![self.host browserTabCoordinatorIsCursorModeEnabled] &&
        ![self.host browserTabCoordinatorIsTabOverviewVisible];
    // Keep native touchpad panning disabled when switching tabs as well.
    scrollView.scrollEnabled = NO;
    self.activeWebView.userInteractionEnabled = shouldAllowWebInteraction;

    [self refreshActiveTabUI];
}

- (void)updateStoredScrollOffsetForTab:(BrowserTabViewModel *)tab {
    if (tab == nil) {
        return;
    }

    BrowserWebView *webView = self.webViewsByTabIdentifier[tab.identifier];
    if (webView == nil) {
        return;
    }

    UIScrollView *scrollView = webView.scrollView;
    tab.savedScrollOffset = scrollView.contentOffset;
    tab.hasSavedScrollOffset = YES;
}

- (void)persistSession {
    for (BrowserTabViewModel *tab in self.viewModel.tabs) {
        BrowserWebView *webView = self.webViewsByTabIdentifier[tab.identifier];
        if (webView != nil && !webView.loading && tab.pendingNavigationIndex == NSNotFound) {
            [self updateNavigationHistoryForTab:tab webView:webView];
        }
        [self updateStoredScrollOffsetForTab:tab];
    }
    [self.sessionStore saveSessionForViewModel:self.viewModel];
}

- (void)updateNavigationHistoryForTab:(BrowserTabViewModel *)tab webView:(BrowserWebView *)webView {
    NSString *URLString = webView.request.URL.absoluteString;
    if (URLString.length == 0) return;
    NSURL *URL = [NSURL URLWithString:URLString];
    if (URL.host.length == 0 || ![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString]) return;
    NSDictionary *snapshot = tab.navigationHistoryRestored ? nil : [webView navigationHistorySnapshot];
    // A request may be saved before WebKit has committed its first page.
    if (!tab.navigationHistoryRestored && snapshot == nil) return;
    if (snapshot != nil) {
        // WebKit's list includes same-document navigation and repeated URLs.
        tab.navigationURLs = snapshot[@"navigationURLs"];
        tab.navigationIndex = [snapshot[@"navigationIndex"] integerValue];
        tab.pendingNavigationIndex = NSNotFound;
    } else {
        [tab recordNavigationURLString:URLString];
    }
    tab.URLString = URLString;
    tab.requestURL = URLString;
    tab.title = webView.title.length > 0 ? webView.title : tab.title;
}

- (void)webViewDidChangeNavigationHistory:(id)webView {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    if (tab == nil || [webView isLoading]) return;
    [self updateNavigationHistoryForTab:tab webView:webView];
    [self persistSession];
}

- (BOOL)canGoBack {
    BrowserTabViewModel *tab = self.activeTab;
    return (tab.navigationIndex != NSNotFound && tab.navigationIndex > 0) ||
        (!tab.navigationHistoryRestored && self.activeWebView.canGoBack);
}

- (BOOL)canGoForward {
    BrowserTabViewModel *tab = self.activeTab;
    return (tab.navigationIndex != NSNotFound && tab.navigationIndex + 1 < tab.navigationURLs.count) ||
        (!tab.navigationHistoryRestored && self.activeWebView.canGoForward);
}

- (void)navigateToHistoryIndex:(NSInteger)index {
    BrowserTabViewModel *tab = self.activeTab;
    if (index < 0 || index >= tab.navigationURLs.count) return;
    NSURLRequest *request = [self.navigationService requestForURLString:tab.navigationURLs[index]];
    if (request == nil) return;
    tab.pendingNavigationIndex = index;
    if (!tab.navigationHistoryRestored && index == tab.navigationIndex - 1 &&
        [self.activeWebView.backURLString isEqualToString:request.URL.absoluteString]) {
        [self.activeWebView goBack];
    } else if (!tab.navigationHistoryRestored && index == tab.navigationIndex + 1 &&
               [self.activeWebView.forwardURLString isEqualToString:request.URL.absoluteString]) {
        [self.activeWebView goForward];
    } else {
        tab.navigationHistoryRestored = YES;
        [self.activeWebView loadRequest:request];
    }
}

- (void)goBack {
    if (self.activeTab.navigationIndex != NSNotFound && self.activeTab.navigationIndex > 0) {
        [self navigateToHistoryIndex:self.activeTab.navigationIndex - 1];
    } else if (!self.activeTab.navigationHistoryRestored && self.activeWebView.canGoBack) {
        [self.activeWebView goBack];
    }
}

- (void)goForward {
    if (self.activeTab.navigationIndex != NSNotFound &&
        self.activeTab.navigationIndex + 1 < self.activeTab.navigationURLs.count) {
        [self navigateToHistoryIndex:self.activeTab.navigationIndex + 1];
    } else if (!self.activeTab.navigationHistoryRestored && self.activeWebView.canGoForward) {
        [self.activeWebView goForward];
    }
}

- (void)loadStoredContentForTab:(BrowserTabViewModel *)tab
                        webView:(BrowserWebView *)webView
             fallbackToHomePage:(BOOL)fallbackToHomePage {
    if (webView == nil) {
        return;
    }

    NSString *URLString = tab.URLString.length > 0 ? tab.URLString : tab.requestURL;
    if (URLString.length == 0 || [URLString isEqualToString:kBrowserNewTabURL]) {
        if (fallbackToHomePage) {
            [self showNewTabPageInWebView:webView tab:tab];
        }
        return;
    }

    NSURLRequest *request = [self.navigationService requestForURLString:URLString];
    if (request != nil) {
        if (tab.navigationIndex != NSNotFound && tab.navigationIndex >= 0 &&
            tab.navigationIndex < tab.navigationURLs.count) {
            // Reload the saved entry in place, including any server redirect.
            tab.navigationHistoryRestored = YES;
            tab.pendingNavigationIndex = tab.navigationIndex;
        }
        [webView loadRequest:request];
    } else if (fallbackToHomePage) {
        NSURLRequest *homePageRequest = [self.navigationService homePageRequest];
        if (homePageRequest != nil) {
            [webView loadRequest:homePageRequest];
        }
    }
}

- (void)restoreSavedScrollOffsetForTab:(BrowserTabViewModel *)tab webView:(BrowserWebView *)webView {
    if (tab == nil || !tab.needsScrollRestore || !tab.hasSavedScrollOffset) {
        return;
    }

    UIScrollView *scrollView = webView.scrollView;
    CGPoint savedScrollOffset = tab.savedScrollOffset;
    dispatch_async(dispatch_get_main_queue(), ^{
        [scrollView layoutIfNeeded];
        CGFloat maxOffsetY = MAX(0.0, scrollView.contentSize.height - CGRectGetHeight(scrollView.bounds));
        CGPoint clampedScrollOffset = CGPointMake(0.0,
                                                  MIN(MAX(savedScrollOffset.y, 0.0), maxOffsetY));
        [scrollView setContentOffset:clampedScrollOffset animated:NO];
        tab.savedScrollOffset = clampedScrollOffset;
        tab.hasSavedScrollOffset = YES;
        [self captureSnapshotForTab:tab];
        [self persistSession];
    });
    tab.needsScrollRestore = NO;
}

// Disposable previews live outside the session and history stores.
- (NSURL *)thumbnailCacheDirectory {
    NSURL *caches = [[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory
                                                         inDomains:NSUserDomainMask].firstObject;
    return [caches URLByAppendingPathComponent:@"TabThumbnails" isDirectory:YES];
}

- (NSURL *)thumbnailCacheURLForTab:(BrowserTabViewModel *)tab {
    // Session identifiers are normally UUIDs; never use an arbitrary saved path component.
    NSString *identifier = [[NSUUID alloc] initWithUUIDString:tab.identifier].UUIDString;
    return identifier != nil ? [[self thumbnailCacheDirectory]
        URLByAppendingPathComponent:[identifier stringByAppendingPathExtension:@"plist"]] : nil;
}

- (void)loadCachedThumbnailForTab:(BrowserTabViewModel *)tab {
    if (tab.snapshotImage != nil || [self.pendingThumbnailReads containsObject:tab.identifier]) return;
    NSURL *cacheURL = [self thumbnailCacheURLForTab:tab];
    if (cacheURL == nil) return;
    NSString *URLString = [tab.URLString copy] ?: @"";
    [self.pendingThumbnailReads addObject:tab.identifier];
    __weak typeof(self) weakSelf = self;
    dispatch_async(self.thumbnailCacheQueue, ^{
        NSDictionary *entry = [NSDictionary dictionaryWithContentsOfURL:cacheURL];
        NSData *data = [entry[@"image"] isKindOfClass:NSData.class] ? entry[@"image"] : nil;
        UIImage *image = [entry[@"URL"] isEqual:URLString] && data != nil
            ? [UIImage imageWithData:data] : nil;
        dispatch_async(dispatch_get_main_queue(), ^{
            BrowserTabCoordinator *strongSelf = weakSelf;
            if (strongSelf == nil) return;
            [strongSelf.pendingThumbnailReads removeObject:tab.identifier];
            if (image == nil || tab.snapshotImage != nil || ![tab.URLString isEqual:URLString] ||
                [strongSelf.viewModel.tabs indexOfObjectIdenticalTo:tab] == NSNotFound) return;
            tab.snapshotImage = image;
            [strongSelf.host browserTabCoordinatorSnapshotDidUpdateForTab:tab];
        });
    });
}

- (void)removeCachedThumbnailForTab:(BrowserTabViewModel *)tab {
    NSURL *cacheURL = [self thumbnailCacheURLForTab:tab];
    if (cacheURL == nil) return;
    dispatch_async(self.thumbnailCacheQueue, ^{
        [[NSFileManager defaultManager] removeItemAtURL:cacheURL error:nil];
    });
}

- (void)pruneThumbnailCache {
    NSURL *directory = [self thumbnailCacheDirectory];
    if (directory == nil) return;
    NSMutableSet<NSString *> *retainedNames = [NSMutableSet set];
    for (BrowserTabViewModel *tab in self.viewModel.tabs) {
        NSString *name = [self thumbnailCacheURLForTab:tab].lastPathComponent;
        if (name != nil) [retainedNames addObject:name];
    }
    dispatch_async(self.thumbnailCacheQueue, ^{
        NSFileManager *manager = [NSFileManager defaultManager];
        for (NSURL *URL in [manager contentsOfDirectoryAtURL:directory
                                includingPropertiesForKeys:nil options:0 error:nil]) {
            if (![retainedNames containsObject:URL.lastPathComponent])
                [manager removeItemAtURL:URL error:nil];
        }
    });
}

- (void)captureSnapshotForTab:(BrowserTabViewModel *)tab {
    if (tab == nil || [self.pendingSnapshots containsObject:tab.identifier]) return;
    if (!tab.needsScrollRestore) [self updateStoredScrollOffsetForTab:tab];
    BrowserWebView *webView = self.webViewsByTabIdentifier[tab.identifier];
    if (webView == nil || webView.loading || CGRectIsEmpty(webView.bounds) ||
        [tab.URLString isEqualToString:kBrowserNewTabURL]) return;

    NSUInteger generation = webView.documentGeneration;
    NSString *URLString = [tab.URLString copy] ?: @"";
    [self.pendingSnapshots addObject:tab.identifier];
    __weak typeof(self) weakSelf = self;
    [webView captureSnapshotInRect:webView.bounds width:584.0 completion:^(UIImage *snapshotImage) {
        dispatch_async(dispatch_get_main_queue(), ^{
            BrowserTabCoordinator *strongSelf = weakSelf;
            if (strongSelf == nil) return;
            [strongSelf.pendingSnapshots removeObject:tab.identifier];
            if (snapshotImage == nil || snapshotImage.size.width <= 0 || snapshotImage.size.height <= 0 ||
                strongSelf.webViewsByTabIdentifier[tab.identifier] != webView ||
                webView.documentGeneration != generation || ![tab.URLString isEqual:URLString] ||
                [strongSelf.viewModel.tabs indexOfObjectIdenticalTo:tab] == NSNotFound) return;

            // Keep memory and disk previews at the card's pixel size, regardless of display scale.
            CGSize size = CGSizeMake(584.0, 347.0);
            UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
            format.scale = 1.0;
            format.opaque = YES;
            UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:size format:format];
            UIImage *thumbnail = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
                [UIColor.blackColor setFill];
                [context fillRect:(CGRect){CGPointZero, size}];
                CGFloat scale = MAX(size.width / snapshotImage.size.width, size.height / snapshotImage.size.height);
                CGSize scaled = CGSizeMake(snapshotImage.size.width * scale, snapshotImage.size.height * scale);
                [snapshotImage drawInRect:CGRectMake((size.width - scaled.width) / 2.0,
                    (size.height - scaled.height) / 2.0, scaled.width, scaled.height)];
            }];
            tab.snapshotImage = thumbnail;
            [strongSelf.host browserTabCoordinatorSnapshotDidUpdateForTab:tab];
            NSURL *cacheURL = [strongSelf thumbnailCacheURLForTab:tab];
            if (cacheURL == nil) return;
            dispatch_async(strongSelf.thumbnailCacheQueue, ^{
                NSData *data = UIImageJPEGRepresentation(thumbnail, 0.8);
                if (data == nil) return;
                [[NSFileManager defaultManager] createDirectoryAtURL:cacheURL.URLByDeletingLastPathComponent
                    withIntermediateDirectories:YES attributes:nil error:nil];
                [@{@"URL": URLString, @"image": data} writeToURL:cacheURL atomically:YES];
            });
        });
    }];
}

- (void)captureSnapshotForCurrentTab {
    [self captureSnapshotForTab:self.activeTab];
}

- (void)prepareTabOverviewThumbnails {
    // Opening the overview must never create a web view or load a saved page.
    for (BrowserTabViewModel *tab in self.viewModel.tabs) {
        [self loadCachedThumbnailForTab:tab];
    }
    [self captureSnapshotForCurrentTab];
}

- (void)createNewTabLoadingHomePage:(BOOL)loadHomePage {
    if ([self.activeTab.URLString isEqualToString:kBrowserNewTabURL]) {
        [self showNewTabPageInWebView:self.activeWebView tab:self.activeTab];
        return;
    }
    self.lastActiveTabIdentifier = self.activeTab.identifier;
    BrowserTabViewModel *tab = [self.viewModel addStartPageTab];

    (void)loadHomePage;
    [self initWebView];
    [self refreshActiveTabUI];
    [self.rootView bringSubviewToFront:self.cursorView];

    [self showNewTabPageInWebView:self.activeWebView tab:tab];
    [self persistSession];
}

- (BOOL)createNewTabWithRequest:(NSURLRequest *)request {
    if (request == nil || request.URL == nil) {
        return NO;
    }

    if ([self.activeTab.URLString isEqualToString:kBrowserNewTabURL]) {
        [self.activeWebView loadRequest:request];
        [self persistSession];
        return YES;
    }

    [self captureSnapshotForTab:self.activeTab];
    [self.viewModel addTab];

    [self initWebView];
    [self refreshActiveTabUI];
    [self.rootView bringSubviewToFront:self.cursorView];
    [self.activeWebView loadRequest:request];
    [self persistSession];
    return YES;
}

- (void)reloadStartPageIfActive {
    if ([self.activeTab.URLString isEqualToString:kBrowserNewTabURL])
        [self showNewTabPageInWebView:self.activeWebView tab:self.activeTab];
}

- (void)switchToTabAtIndex:(NSInteger)tabIndex {
    if (tabIndex < 0 || tabIndex >= self.viewModel.tabs.count) {
        return;
    }
    if (tabIndex == self.viewModel.activeTabIndex) {
        return;
    }

    BrowserTabViewModel *currentTab = self.activeTab;
    BOOL discardCurrentTab = [currentTab.URLString isEqualToString:kBrowserNewTabURL];
    if (!discardCurrentTab) self.lastActiveTabIdentifier = currentTab.identifier;
    if (!discardCurrentTab) [self captureSnapshotForTab:currentTab];

    [self.viewModel switchToTabAtIndex:tabIndex];
    if (discardCurrentTab) {
        [self removeCachedThumbnailForTab:currentTab];
        NSInteger emptyTabIndex = [self.viewModel.tabs indexOfObjectIdenticalTo:currentTab];
        [self.webViewsByTabIdentifier[currentTab.identifier] removeFromSuperview];
        [self.webViewsByTabIdentifier removeObjectForKey:currentTab.identifier];
        if (emptyTabIndex != NSNotFound) [self.viewModel removeTabAtIndex:emptyTabIndex];
    }
    [self initWebView];
    [self.rootView bringSubviewToFront:self.cursorView];
    if ([self.activeTab.URLString isEqualToString:kBrowserNewTabURL]) {
        [self showNewTabPageInWebView:self.activeWebView tab:self.activeTab];
    } else if (self.activeWebView.request == nil) {
        [self loadStoredContentForTab:self.activeTab webView:self.activeWebView fallbackToHomePage:YES];
    }
    [self persistSession];
}

- (BOOL)returnToPreviousTabFromNewTab {
    BrowserTabViewModel *currentTab = self.activeTab;
    if (![currentTab.URLString isEqualToString:kBrowserNewTabURL]) return NO;
    NSInteger targetIndex = NSNotFound;
    for (NSInteger index = 0; index < self.viewModel.tabs.count; index++) {
        BrowserTabViewModel *tab = self.viewModel.tabs[index];
        if (tab != currentTab && [tab.identifier isEqualToString:self.lastActiveTabIdentifier]) {
            targetIndex = index;
            break;
        }
    }
    if (targetIndex == NSNotFound) {
        for (NSInteger index = self.viewModel.tabs.count - 1; index >= 0; index--) {
            BrowserTabViewModel *tab = self.viewModel.tabs[index];
            if (tab != currentTab && ![tab.URLString isEqualToString:kBrowserNewTabURL]) {
                targetIndex = index;
                break;
            }
        }
    }
    if (targetIndex == NSNotFound) return NO;
    [self switchToTabAtIndex:targetIndex];
    return YES;
}

- (void)closeTabAtIndex:(NSInteger)tabIndex {
    if (tabIndex < 0 || tabIndex >= self.viewModel.tabs.count) {
        return;
    }

    BOOL closingActiveTab = tabIndex == self.viewModel.activeTabIndex;
    BrowserTabViewModel *tab = self.viewModel.tabs[tabIndex];
    [self removeCachedThumbnailForTab:tab];
    [self.webViewsByTabIdentifier[tab.identifier] removeFromSuperview];
    [self.webViewsByTabIdentifier removeObjectForKey:tab.identifier];
    [self.viewModel removeTabAtIndex:tabIndex];

    if (self.viewModel.tabs.count == 0) {
        [self createNewTabLoadingHomePage:YES];
        return;
    }

    if (closingActiveTab) {
        [self initWebView];
        if (self.activeWebView.request == nil) {
            [self loadStoredContentForTab:self.activeTab webView:self.activeWebView fallbackToHomePage:YES];
        }
    }

    [self refreshActiveTabUI];
    [self persistSession];
}

- (void)recreateActiveWebViewPreservingCurrentURL {
    BrowserTabViewModel *tab = self.activeTab;
    if (tab == nil) {
        return;
    }

    NSString *currentURL = self.activeWebView.request.URL.absoluteString;
    [self.webViewsByTabIdentifier[tab.identifier] removeFromSuperview];
    [self.webViewsByTabIdentifier removeObjectForKey:tab.identifier];
    tab.requestURL = currentURL ?: @"";
    tab.previousURL = @"";
    tab.URLString = currentURL ?: @"";
    tab.navigationHistoryRestored = YES;
    [self initWebView];

    if (currentURL.length > 0) {
        NSURLRequest *request = [self.navigationService requestForURLString:currentURL];
        if (request != nil) {
            [self.activeWebView loadRequest:request];
        }
    } else {
        [self loadHomePage];
    }
    [self persistSession];
}

- (void)setAdBlockEnabledForAllWebViews:(BOOL)enabled {
    for (BrowserWebView *webView in self.webViewsByTabIdentifier.allValues) {
        [webView setAdBlockEnabled:enabled];
    }
}

- (void)handleWebViewPanGesture:(UIPanGestureRecognizer *)gestureRecognizer {
    if (gestureRecognizer.state != UIGestureRecognizerStateEnded &&
        gestureRecognizer.state != UIGestureRecognizerStateCancelled &&
        gestureRecognizer.state != UIGestureRecognizerStateFailed) {
        return;
    }

    UIView *gestureView = gestureRecognizer.view;
    if (![gestureView isKindOfClass:[UIScrollView class]]) {
        return;
    }

    UIScrollView *scrollView = (UIScrollView *)gestureView;
    if (scrollView != self.activeWebView.scrollView) {
        return;
    }

    [self persistSession];
}

- (BOOL)isPrimaryDocumentRequest:(NSURLRequest *)request {
    NSURL *requestURL = request.URL;
    NSURL *mainDocumentURL = request.mainDocumentURL;
    if (requestURL == nil) {
        return NO;
    }
    if (mainDocumentURL == nil) {
        return YES;
    }
    return [requestURL isEqual:mainDocumentURL];
}

- (BrowserTabViewModel *)tabForWebView:(id)webView {
    for (BrowserTabViewModel *tab in self.viewModel.tabs) {
        if (self.webViewsByTabIdentifier[tab.identifier] == webView) {
            return tab;
        }
    }
    return nil;
}

- (void)prepareTabForRequest:(NSURLRequest *)request webView:(id)webView navigationType:(NSInteger)navigationType {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    if (tab == nil || ![self isPrimaryDocumentRequest:request]) {
        return;
    }
    NSString *requestURL = request.URL.absoluteString ?: @"";
    // WKNavigationTypeBackForward is 2. Distinguish it from a link to the same URL.
    if (navigationType == 2 && tab.pendingNavigationIndex == NSNotFound &&
        tab.navigationIndex != NSNotFound) {
        NSInteger index = tab.navigationIndex;
        if (index > 0 && [tab.navigationURLs[index - 1] isEqualToString:requestURL]) {
            tab.pendingNavigationIndex = index - 1;
        } else if (index + 1 < tab.navigationURLs.count &&
                   [tab.navigationURLs[index + 1] isEqualToString:requestURL]) {
            tab.pendingNavigationIndex = index + 1;
        }
    }
    if ([tab.URLString isEqualToString:kBrowserNewTabURL] &&
        [@[@"http", @"https"] containsObject:request.URL.scheme.lowercaseString]) {
        tab.URLString = requestURL;
        if (tab == self.activeTab) [self.host browserTabCoordinatorHideNativeStartPage];
    }
    if (tab.URLString.length > 0 && ![tab.URLString isEqualToString:requestURL]) {
        tab.savedScrollOffset = CGPointZero;
        tab.hasSavedScrollOffset = NO;
        tab.needsScrollRestore = NO;
    }
    tab.requestURL = requestURL;
}

- (void)webViewDidStartLoad:(id)webView {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    if (tab == nil) {
        return;
    }

    tab.previousURL = tab.requestURL;
}

- (void)webViewDidFailLoad:(id)webView {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    tab.pendingNavigationIndex = NSNotFound;
}

- (void)webViewWebContentProcessDidTerminate:(BrowserWebView *)webView {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    if (tab == nil || tab != self.activeTab || webView != self.activeWebView ||
        [tab.URLString isEqualToString:kBrowserNewTabURL] ||
        UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
        return;
    }

    NSTimeInterval uptime = NSProcessInfo.processInfo.systemUptime;
    if (uptime - tab.lastWebContentProcessCrashUptime >= kWebContentProcessCrashQuietInterval) {
        tab.webContentProcessCrashCount = 0;
    }
    tab.lastWebContentProcessCrashUptime = uptime;
    tab.webContentProcessCrashCount = MIN(tab.webContentProcessCrashCount + 1,
                                        kMaximumWebContentProcessReloads + 1);
    // Keep the budget across successful loads: a page can crash again just after
    // didFinishNavigation. Only a quiet interval allows another recovery burst.
    if (tab.webContentProcessCrashCount > kMaximumWebContentProcessReloads) {
        BrowserLog(@"[WebKit] automatic recovery stopped after repeated process termination");
        return;
    }

    tab.pendingNavigationIndex = NSNotFound;
    tab.needsScrollRestore = tab.hasSavedScrollOffset;
    BrowserLog(@"[WebKit] recovering active tab attempt=%lu",
               (unsigned long)tab.webContentProcessCrashCount);
    [webView reload];
}

- (void)webViewDidFinishLoad:(id)webView {
    BrowserTabViewModel *tab = [self tabForWebView:webView];
    if (tab == nil) {
        return;
    }

    NSString *theTitle = [webView title];
    NSURLRequest *request = [webView request];
    NSString *currentURL = request.URL.absoluteString ?: @"";
    if ([currentURL isEqualToString:kBrowserNewTabURL] ||
        (currentURL.length == 0 && [tab.URLString isEqualToString:kBrowserNewTabURL])) {
        tab.title = @"New Tab";
        tab.URLString = kBrowserNewTabURL;
        tab.requestURL = kBrowserNewTabURL;
        if (tab == self.activeTab && self.pendingNewTabSelectionGroup.length > 0) {
            NSString *group = self.pendingNewTabSelectionGroup;
            NSUInteger index = self.pendingNewTabSelectionIndex;
            self.pendingNewTabSelectionGroup = nil;
            [self.host browserTabCoordinatorShowNativeStartPageSelectingGroup:group index:index];
        }
    } else {
        [self.navigationService updateTab:tab withPageTitle:theTitle currentURLString:currentURL];
        [self updateNavigationHistoryForTab:tab webView:webView];
    }

    if (tab == self.activeTab) {
        [self refreshActiveTabUI];
    } else if ([self isWebViewStaged:webView]) {
        [webView pauseAllMediaPlayback];
    }
    [self restoreSavedScrollOffsetForTab:tab webView:webView];
    if (!tab.needsScrollRestore) {
        [self captureSnapshotForTab:tab];
        [self persistSession];
    }
}

@end
