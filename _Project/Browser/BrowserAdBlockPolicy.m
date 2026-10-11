#import "BrowserAdBlockPolicy.h"

@implementation BrowserAdBlockPolicy
+ (NSDictionary<NSString *, NSString *> *)validatedPolicies:(NSDictionary *)policies {
    NSMutableDictionary *valid = [NSMutableDictionary dictionary];
    NSCharacterSet *invalid = [[NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyz0123456789.-"] invertedSet];
    if (![policies isKindOfClass:NSDictionary.class]) return valid;
    for (id host in policies) {
        id action = policies[host];
        if (![host isKindOfClass:NSString.class] || [host length] == 0 || [host length] > 253 ||
            [host rangeOfCharacterFromSet:invalid].location != NSNotFound || [host hasPrefix:@"."] ||
            [host hasSuffix:@"."] || [host containsString:@".."] || ![@[@"block", @"allow", @"noop"] containsObject:action]) continue;
        valid[host] = action;
    }
    return valid;
}
+ (NSString *)hostRulesForPolicies:(NSDictionary *)policies {
    NSDictionary *valid = [self validatedPolicies:policies];
    NSMutableArray *lines = [NSMutableArray array];
    for (NSString *host in [valid.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
        [lines addObject:[NSString stringWithFormat:@"%@ * 3p %@", host, valid[host]]];
    }
    return [lines componentsJoinedByString:@"\n"];
}
+ (NSString *)effectivePolicyForHost:(NSString *)host policies:(NSDictionary *)policies {
    NSDictionary *valid = [self validatedPolicies:policies];
    NSString *source = host.lowercaseString;
    while (source.length) {
        if (valid[source]) return valid[source];
        NSRange dot = [source rangeOfString:@"."];
        if (dot.location == NSNotFound) break;
        source = [source substringFromIndex:dot.location + 1];
    }
    return @"standard";
}
+ (NSArray<NSDictionary *> *)nativeRulesForPolicy:(NSString *)policy {
    if (![@[@"allow", @"block"] containsObject:policy]) return @[];
    return @[@{@"trigger":@{@"url-filter":@"^https?://", @"load-type":@[@"third-party"]},
        @"action":@{@"type":[policy isEqual:@"allow"] ? @"ignore-previous-rules" : @"block"}}];
}
@end
