#import <Foundation/Foundation.h>
#import "../_Project/Browser/BrowserAdBlockPolicy.m"

static void check(BOOL value, NSString *message) { if (!value) { NSLog(@"FAIL %@", message); exit(1); } }
int main(void) { @autoreleasepool {
    NSDictionary *policies = @{@"example.com":@"block", @"child.example.com":@"noop", @"allow.example.com":@"allow", @"bad/host":@"allow", @"unknown.com":@"invalid"};
    check([BrowserAdBlockPolicy validatedPolicies:policies].count == 3, @"validate persisted input");
    check([[BrowserAdBlockPolicy effectivePolicyForHost:@"www.example.com" policies:policies] isEqual:@"block"], @"inherit ancestor block");
    check([[BrowserAdBlockPolicy effectivePolicyForHost:@"www.child.example.com" policies:policies] isEqual:@"noop"], @"specific noop masks ancestor");
    check([[BrowserAdBlockPolicy effectivePolicyForHost:@"allow.example.com" policies:policies] isEqual:@"allow"], @"specific allow");
    check([[BrowserAdBlockPolicy effectivePolicyForHost:@"example.com.evil.net" policies:policies] isEqual:@"standard"], @"hostname boundary");
    check([BrowserAdBlockPolicy nativeRulesForPolicy:@"noop"].count == 0, @"noop retains static chunks");
    NSDictionary *allow = [BrowserAdBlockPolicy nativeRulesForPolicy:@"allow"].firstObject;
    check([allow[@"action"][@"type"] isEqual:@"ignore-previous-rules"], @"allow clears each chunk");
    check([allow[@"trigger"][@"load-type"] isEqual:@[@"third-party"]], @"retain first-party filtering");
    check([[BrowserAdBlockPolicy nativeRulesForPolicy:@"block"].firstObject[@"action"][@"type"] isEqual:@"block"], @"block appended after static exceptions");
    NSString *rules = [BrowserAdBlockPolicy hostRulesForPolicies:policies];
    check([rules containsString:@"child.example.com * 3p noop"], @"core gets same specific noop");
    check(![rules containsString:@"bad/host"], @"reject malformed core input");
    NSData *data = [NSJSONSerialization dataWithJSONObject:[BrowserAdBlockPolicy validatedPolicies:policies] options:NSJSONWritingSortedKeys error:nil];
    NSDictionary *restored = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    check([restored isEqual:[BrowserAdBlockPolicy validatedPolicies:policies]], @"persistence roundtrip");
    puts("Third-party policy validation, inheritance/noop, native actions, boundaries and persistence checks passed.");
} return 0; }
