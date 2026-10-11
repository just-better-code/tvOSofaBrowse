#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT NSString * const BrowserAdBlockSourceStatusDidChangeNotification;

@protocol BrowserWebViewDelegate <NSObject>

@optional
- (BOOL)webView:(id _Nonnull)webView shouldStartLoadWithRequest:(NSURLRequest * _Nullable)request navigationType:(NSInteger)navigationType;
- (BOOL)webView:(id _Nonnull)webView shouldCreateNewTabWithRequest:(NSURLRequest * _Nullable)request navigationType:(NSInteger)navigationType;
- (BOOL)webView:(id _Nonnull)webView shouldImportTorrentResponse:(NSURLResponse * _Nonnull)response request:(NSURLRequest * _Nullable)request;
- (void)webView:(id)webView didUpdateFullscreenMediaState:(NSDictionary *)state;
- (void)webView:(id)webView didRequestVLCPlayback:(NSDictionary *)info;
- (void)webView:(id)webView didBlockNavigationToURL:(NSURL *)URL rule:(nullable NSString *)rule;
- (void)webViewDidStartLoad:(id _Nonnull)webView;
- (void)webViewDidFinishLoad:(id _Nonnull)webView;
- (void)webViewDidChangeNavigationHistory:(id _Nonnull)webView;
- (void)webViewWebContentProcessDidTerminate:(id _Nonnull)webView;
- (void)webView:(id _Nonnull)webView didFailLoadWithError:(NSError * _Nonnull)error;

@end

@interface BrowserWebView : UIView

@property (nullable, nonatomic, weak) id<BrowserWebViewDelegate> delegate;
@property (nullable, nonatomic, readonly, strong) NSURLRequest *request;
@property (nullable, nonatomic, readonly, strong) UIScrollView *scrollView;
@property (nullable, nonatomic, readonly, copy) NSString *title;
@property (nonatomic, readonly, getter=canGoBack) BOOL canGoBack;
@property (nonatomic, readonly, getter=canGoForward) BOOL canGoForward;
@property (nullable, nonatomic, readonly, copy) NSString *backURLString;
@property (nullable, nonatomic, readonly, copy) NSString *forwardURLString;
@property (nonatomic, readonly, getter=isLoading) BOOL loading;
@property (nonatomic) CGFloat pageZoomFactor;
@property (nonatomic) CGFloat textZoomFactor;
@property (nonatomic, readonly) BOOL adBlockEnabled;
@property (nonatomic, readonly, copy) NSString *adBlockStatus;

- (instancetype)initWithUserAgent:(NSString * _Nullable)userAgent
      allowsInlineMediaPlayback:(BOOL)allowsInlineMediaPlayback NS_DESIGNATED_INITIALIZER;

- (void)loadRequest:(NSURLRequest * _Nullable)request;
- (void)loadHTMLString:(NSString *)HTMLString;
- (void)reload;
- (void)stopLoading;
- (void)goBack;
- (void)goForward;
- (nullable NSDictionary *)navigationHistorySnapshot;
- (void)evaluateJavaScript:(NSString * _Nonnull)script
               completion:(void (^ _Nullable)(NSString * _Nullable result))completion;
// Completion runs on the main queue; navigation invalidates pending results.
@property (nonatomic, readonly) NSUInteger documentGeneration;
@property (nonatomic, readonly) NSUInteger javaScriptGeneration;
- (void)invalidatePendingJavaScript;
@property (nonatomic, readonly) BOOL pageFullscreenActive;
- (void)evaluateJavaScript:(NSString *)script
        completionHandler:(void (^ _Nullable)(NSString * _Nullable result, NSError * _Nullable error))completion;
- (NSString * _Nonnull)runtimeMediaPreferenceReport;
- (void)setUserAgent:(NSString * _Nullable)userAgent;
- (void)pauseAllMediaPlayback;
- (void)setFullscreenMediaControlsSuspended:(BOOL)suspended;
- (void)resetSitePlaybackPreferences;
// YES means the system route was attempted, not that the player switched tracks.
- (BOOL)sendSystemMediaTrackCommand:(BOOL)nextTrack;
- (void)captureSnapshotWithCompletion:(void (^)(UIImage * _Nullable snapshot))completion;
- (void)captureSnapshotInRect:(CGRect)rect
                       width:(CGFloat)width
                  completion:(void (^)(UIImage * _Nullable snapshot))completion;
- (void)setAdBlockEnabled:(BOOL)enabled;
@property (nonatomic, readonly) BOOL adBlockSiteEnabled;
@property (nonatomic, readonly) BOOL adBlockEffectiveEnabled;
@property (nonatomic, readonly) BOOL adBlockPolicyPreparing;
- (void)setAdBlockSiteEnabled:(BOOL)enabled;
- (NSString *)adBlockDiagnosticSummary;
+ (NSString *)dynamicAdBlockPolicyForHost:(NSString *)host;
+ (NSString *)effectiveDynamicAdBlockPolicyForHost:(NSString *)host;
+ (void)setDynamicAdBlockPolicy:(NSString *)policy forHost:(NSString *)host;
+ (NSString *)adBlockUserFilters;

+ (void)cookieDataRepresentationWithCompletion:(void (^)(NSData * _Nullable data))completion;
+ (void)fetchCookiesWithResult:(void (^)(NSArray<NSHTTPCookie *> * _Nullable cookies, NSError * _Nullable error))completion;
+ (void)restoreCookiesFromData:(NSData * _Nullable)cookieData completion:(void (^ _Nullable)(void))completion;
+ (void)clearCachedDataWithCompletion:(void (^ _Nullable)(void))completion;
+ (void)clearCachedDataForURL:(nullable NSURL *)URL completion:(void (^ _Nullable)(void))completion;
+ (void)clearCookiesWithCompletion:(void (^ _Nullable)(void))completion;
+ (void)clearCookiesForURL:(nullable NSURL *)URL completion:(void (^ _Nullable)(void))completion;
+ (void)resetWebsiteDataWithCompletion:(void (^ _Nullable)(void))completion;
+ (NSArray<NSDictionary<NSString *, NSString *> *> *)adBlockSources;
+ (BOOL)adBlockSourceEnabled:(NSString *)identifier;
+ (void)setAdBlockSource:(NSString *)identifier enabled:(BOOL)enabled;
+ (NSString *)adBlockSourceStatus:(NSString *)identifier;
+ (void)refreshAdBlockSources;

@end

NS_ASSUME_NONNULL_END
