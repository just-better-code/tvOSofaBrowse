#import <Foundation/Foundation.h>

// Shared list preparation, policy and caches live here. WebView owns only its
// installed document/scripts and lifecycle; callbacks run on the main queue.
FOUNDATION_EXPORT NSNotificationName const BrowserAdBlockRulesDidUpdateNotification;
FOUNDATION_EXPORT NSNotificationName const BrowserAdBlockSourceStatusDidChangeNotification;
FOUNDATION_EXPORT NSString * const BrowserAdBlockRuleListIdentifierPrefix;
NSString *BrowserAdBlockHost(NSURL *URL);
BOOL BrowserAdBlockSiteEnabled(NSURL *URL);
NSArray *BrowserAdBlockSources(void);
NSString *BrowserDynamicHostRules(void);
void BrowserLoadAdBlockRuleList(NSString *policy, void (^completion)(NSArray *, NSError *));
void BrowserLoadUBlockRuntime(void (^completion)(NSDictionary *));
void BrowserCheckForAdBlockUpdateIfNeeded(void);

@interface BrowserAdBlockService : NSObject
@property (class, nonatomic, readonly) NSUInteger generation;
@property (class, nonatomic, readonly) NSDictionary *runtime;
@property (class, nonatomic, readonly) NSString *runtimeIdentifier;
@property (class, nonatomic, readonly) NSDictionary *statistics;
@property (class, nonatomic, readonly) NSDictionary *networkSummary;
@property (class, nonatomic, readonly) BOOL nativePreparationFailed;
+ (NSArray *)adBlockSources;
+ (BOOL)adBlockSourceEnabled:(NSString *)identifier;
+ (void)setAdBlockSource:(NSString *)identifier enabled:(BOOL)enabled;
+ (NSString *)adBlockSourceStatus:(NSString *)identifier;
+ (NSString *)adBlockUserFilters;
+ (void)refreshAdBlockSources;
+ (NSString *)dynamicAdBlockPolicyForHost:(NSString *)host;
+ (NSString *)effectiveDynamicAdBlockPolicyForHost:(NSString *)host;
+ (void)setDynamicAdBlockPolicy:(NSString *)policy forHost:(NSString *)host;
+ (void)setSiteEnabled:(BOOL)enabled forURL:(NSURL *)URL;
+ (void)matchRequest:(NSDictionary *)details completion:(void (^)(NSDictionary *))completion;
+ (BOOL)applyNativeRules:(NSArray *)rules toController:(id)controller replacing:(NSArray *)previous;
@end
