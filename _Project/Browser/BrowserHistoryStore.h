#import <Foundation/Foundation.h>

@interface BrowserHistoryStore : NSObject

+ (instancetype)sharedStore;
- (void)recordURLString:(NSString *)URLString title:(NSString *)title;
- (NSArray<NSDictionary *> *)recentVisitsWithLimit:(NSUInteger)limit;
- (NSArray<NSDictionary *> *)allVisits;
- (void)deleteVisitsWithIdentifiers:(NSArray<NSNumber *> *)identifiers;
- (void)deleteAllVisits;
- (void)deleteVisitsForSiteURL:(NSURL *)URL;
- (void)deleteVisitsForURLString:(NSString *)URLString;
- (NSArray<NSArray<NSString *> *> *)favorites;
- (void)saveFavorites:(NSArray<NSArray<NSString *> *> *)favorites;
- (nullable NSDictionary *)savedBrowserSession;
- (BOOL)saveBrowserSession:(NSDictionary *)session;

@end
