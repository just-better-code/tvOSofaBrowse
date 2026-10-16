#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
// Remote-friendly policy surface. General engine rules stay a separate input.
@interface BrowserAdBlockPolicy : NSObject
+ (NSDictionary<NSString *, NSString *> *)validatedPolicies:(NSDictionary *)policies;
+ (NSString *)hostRulesForPolicies:(NSDictionary *)policies;
+ (NSString *)effectivePolicyForHost:(NSString *)host policies:(NSDictionary *)policies;
+ (NSArray<NSDictionary *> *)nativeRulesForPolicy:(NSString *)policy;
@end
NS_ASSUME_NONNULL_END
