#import "BrowserAdBlockService.h"
#import "BrowserAdBlockPolicy.h"
#import "BrowserPreferencesStore.h"
#import <objc/message.h>
#import <CommonCrypto/CommonDigest.h>
#import <dlfcn.h>

@interface BrowserNativeRuleConverter : NSObject
+ (NSDictionary *)convertRuleChunks:(NSString *)source;
@end

@interface BrowserAdBlockConverter : NSObject
+ (NSDictionary *)convertRules:(NSString *)source;
+ (NSDictionary *)compileUBlockLists:(NSArray *)lists;
+ (NSDictionary *)compileUBlockLists:(NSArray *)lists cancelled:(BOOL (^)(void))cancelled;
@end

@interface BrowserNetworkFilterEngine : NSObject
+ (void)prepareSources:(NSArray *)sources identity:(NSString *)identity configuration:(NSString *)configuration completion:(void (^)(NSDictionary *))completion;
+ (void)cancelPreparation;
+ (void)restoreLastGoodForConfiguration:(NSString *)configuration completion:(void (^)(NSDictionary *))completion;
+ (void)restoreIdentity:(NSString *)identity configuration:(NSString *)configuration completion:(void (^)(NSDictionary *))completion;
+ (void)matchRequest:(NSDictionary *)request hostRules:(NSString *)hostRules urlRules:(NSString *)urlRules completion:(void (^)(NSDictionary *))completion;
@end

NSString * const BrowserAdBlockRuleListIdentifierPrefix = @"BrowserAdBlock-v12";
NSNotificationName const BrowserAdBlockRulesDidUpdateNotification = @"BrowserAdBlockRulesDidUpdate";
NSString * const BrowserAdBlockSourceStatusDidChangeNotification = @"BrowserAdBlockSourceStatusDidChange";
static NSString * const kBrowserAdBlockSourceEnabledKeyPrefix = @"AdBlockSourceEnabled.";
static NSString * const kBrowserAdBlockSourceLastCheckKeyPrefix = @"AdBlockSourceLastCheck.";
static NSMutableDictionary *sBrowserAdBlockCachedPolicies = nil;
static NSSet<NSString *> *sBrowserAdBlockRuleFailures = nil;
static NSUInteger sBrowserAdBlockRulesGeneration = 0;
static NSString * const kBrowserAdBlockTrustedSitesKey = @"AdBlockTrustedSites";
static NSString * const kBrowserAdBlockUserFiltersKey = @"AdBlockUserFilters";
static NSDictionary *sBrowserUBlockRuntime;
static NSString *sBrowserUBlockRuntimeIdentifier;
static NSMutableArray *sBrowserUBlockPendingCallbacks;
static BOOL sFilterBakePending;
static NSDictionary *sBrowserUBlockStatistics;
static NSDictionary *sBrowserNetworkSummary;
static NSUInteger sNativeLoads;
static NSTimeInterval sFilterPreparationStarted;
static NSMutableDictionary<NSString *, NSNumber *> *sFilterStageDurations;

static void BrowserBeginFilterPreparation(void) {
    if (!sNativeLoads && !sBrowserUBlockPendingCallbacks) {
        sFilterPreparationStarted = NSProcessInfo.processInfo.systemUptime;
        sFilterStageDurations = [NSMutableDictionary dictionary];
    }
}
static NSMutableDictionary<NSString *, NSNumber *> *sInstalledNativeRules;

static void BrowserPruneSnapshots(NSURL *directory, NSString *prefix, NSURL *current) {
    NSArray *files = [NSFileManager.defaultManager contentsOfDirectoryAtURL:directory includingPropertiesForKeys:@[NSURLContentModificationDateKey, NSURLIsRegularFileKey] options:0 error:nil];
    NSMutableArray *candidates = [NSMutableArray array];
    for (NSURL *file in files) {
        NSNumber *regular; [file getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil];
        if (regular.boolValue && [file.lastPathComponent hasPrefix:prefix] && [file.pathExtension isEqual:@"json"]) [candidates addObject:file];
    }
    [candidates sortUsingComparator:^NSComparisonResult(NSURL *a, NSURL *b) {
        NSDate *ad, *bd; [a getResourceValue:&ad forKey:NSURLContentModificationDateKey error:nil]; [b getResourceValue:&bd forKey:NSURLContentModificationDateKey error:nil];
        return [bd ?: NSDate.distantPast compare:ad ?: NSDate.distantPast];
    }];
    BOOL keptPrevious = NO;
    for (NSURL *file in candidates) {
        if ([file isEqual:current]) continue;
        if (!keptPrevious) { keptPrevious = YES; continue; }
        [NSFileManager.defaultManager removeItemAtURL:file error:nil];
    }
}



NSString *BrowserAdBlockHost(NSURL *URL) {
    NSString *host = URL.host.lowercaseString;
    while ([host hasSuffix:@"."]) host = [host substringToIndex:host.length - 1];
    return host ?: @"";
}
BOOL BrowserAdBlockSiteEnabled(NSURL *URL) {
    NSString *host = BrowserAdBlockHost(URL);
    for (NSString *trusted in [NSUserDefaults.standardUserDefaults arrayForKey:kBrowserAdBlockTrustedSitesKey]) {
        if ([host isEqualToString:trusted] || [host hasSuffix:[@"." stringByAppendingString:trusted]]) return NO;
    }
    return YES;
}
NSArray<NSDictionary<NSString *, NSString *> *> *BrowserAdBlockSources(void) {
    return @[
        @{@"id": @"ubo", @"title": @"uBlock Origin", @"file": @"UBlockFilters.txt"},
        @{@"id": @"custom", @"title": @"My Filters", @"file": @"UserFilters.txt"},
        @{@"id": @"dns", @"title": @"AdGuard DNS", @"file": @"AdGuardDNS.txt",
          @"url": @"https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"},
        @{@"id": @"base", @"title": @"AdGuard Base", @"file": @"AdGuardBase.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt"},
        @{@"id": @"ukrainian", @"title": @"AdGuard Ukrainian", @"file": @"AdGuardUkrainian.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_23_Ukrainian/filter.txt"},
        @{@"id": @"social", @"title": @"AdGuard Social Media", @"file": @"AdGuardSocial.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_4_Social/filter.txt"},
        @{@"id": @"mobile", @"title": @"AdGuard Mobile Ads", @"file": @"AdGuardMobile.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_11_Mobile/filter.txt"},
        @{@"id": @"annoyances", @"title": @"AdGuard Annoyances", @"file": @"AdGuardAnnoyances.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14_Annoyances/filter.txt"}
    ];
}

static BOOL BrowserAdBlockSourceEnabled(NSString *identifier) {
    id stored = [NSUserDefaults.standardUserDefaults objectForKey:
        [kBrowserAdBlockSourceEnabledKeyPrefix stringByAppendingString:identifier]];
    return stored == nil || [stored boolValue];
}

static NSURL *BrowserAdBlockSourceURL(NSDictionary<NSString *, NSString *> *source) {
    if ([source[@"id"] isEqualToString:@"ubo"]) return [NSBundle.mainBundle URLForResource:@"UBlockFilters" withExtension:@"txt"];
    NSURL *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
    return [[cache URLByAppendingPathComponent:@"BrowserContentRules" isDirectory:YES]
            URLByAppendingPathComponent:source[@"file"]];
}

static NSString *BrowserAdBlockSourceText(NSDictionary *source) {
    if ([source[@"id"] isEqualToString:@"custom"]) return [NSUserDefaults.standardUserDefaults stringForKey:kBrowserAdBlockUserFiltersKey] ?: @"";
    return [NSString stringWithContentsOfURL:BrowserAdBlockSourceURL(source) encoding:NSUTF8StringEncoding error:nil] ?: @"";
}
static NSURL *BrowserAdBlockOnlineHostsURL(void) {
    for (NSDictionary *source in BrowserAdBlockSources()) if ([source[@"id"] isEqualToString:@"dns"]) return BrowserAdBlockSourceURL(source);
    return nil;
}

static NSUInteger BrowserAddAdBlockHosts(NSMutableOrderedSet<NSString *> *domains, NSString *hosts) {
    NSCharacterSet *invalidCharacters = [[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyz0123456789.-"] invertedSet];
    [hosts enumerateLinesUsingBlock:^(NSString *line, BOOL *stop) {
        (void)stop;
        if (![line hasPrefix:@"||"] || ![line hasSuffix:@"^"]) return;
        NSString *domain = [[line substringWithRange:NSMakeRange(2, line.length - 3)] lowercaseString];
        if ([domain containsString:@"."] &&
            [domain rangeOfCharacterFromSet:invalidCharacters].location == NSNotFound) [domains addObject:domain];
    }];
    return domains.count;
}

static NSString *BrowserAdBlockFilterIdentifier(BOOL includeOnlineHosts);

static NSString *BrowserFilterDigest(NSData *data) {
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *text = [NSMutableString stringWithCapacity:64];
    for (NSUInteger i = 0; i < sizeof(digest); i++) [text appendFormat:@"%02x", digest[i]];
    return text;
}

static NSURL *BrowserFilterCacheDirectory(NSString *name) {
    NSURL *directory = [[NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:name isDirectory:YES];
    [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
    return directory;
}

static NSString *BrowserFilterConfiguration(void) {
    NSMutableArray *enabled = [NSMutableArray arrayWithObject:@"source-trust-v1"];
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (BrowserAdBlockSourceEnabled(source[@"id"])) [enabled addObject:source[@"id"]];
    }
    // A deleted/edited personal rule must never reappear through an older cache.
    [enabled addObject:[NSUserDefaults.standardUserDefaults stringForKey:kBrowserAdBlockUserFiltersKey] ?: @""];
    return BrowserFilterDigest([NSJSONSerialization dataWithJSONObject:enabled options:0 error:nil]);
}

static NSArray *BrowserFilterSourceDescriptors(void) {
    NSMutableArray *sources = [NSMutableArray array];
    NSString *epoch = [NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockRebuildIdentity"] ?: @"";
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (!BrowserAdBlockSourceEnabled(source[@"id"])) continue;
        NSMutableDictionary *descriptor = [@{@"id":source[@"id"], @"trusted":@([source[@"id"] isEqual:@"ubo"]), @"epoch":epoch} mutableCopy];
        if ([source[@"id"] isEqual:@"custom"]) descriptor[@"text"] = [NSUserDefaults.standardUserDefaults stringForKey:kBrowserAdBlockUserFiltersKey] ?: @"";
        else {
            NSURL *url = BrowserAdBlockSourceURL(source);
            if (url) { descriptor[@"url"] = url.absoluteString; descriptor[@"available"]=@([NSFileManager.defaultManager fileExistsAtPath:url.path]); }
        }
        [sources addObject:descriptor];
    }
    return sources;
}

static NSArray *BrowserReadFilterLists(NSArray *descriptors) {
    NSMutableArray *lists = [NSMutableArray array];
    for (NSDictionary *source in descriptors) {
        NSString *text = source[@"text"];
        if (!text) {
            if ([source[@"available"] isEqual:@NO]) continue;
            text = [NSString stringWithContentsOfURL:[NSURL URLWithString:source[@"url"] ?: @""] encoding:NSUTF8StringEncoding error:nil];
            if (!text.length) return nil;
        }
        if (text.length) [lists addObject:@{@"id":source[@"id"], @"text":text, @"trusted":source[@"trusted"] ?: @NO, @"epoch":source[@"epoch"] ?: @""}];
    }
    return lists;
}

static BOOL BrowserFilterGenerationCurrent(NSUInteger generation);

static BOOL BrowserNativeConversionValid(NSDictionary *value, NSString *sourceKey) {
    if (![value isKindOfClass:NSDictionary.class] || ![value[@"format"] isEqual:@"lossless-native-v2"] || ![value[@"sourceKey"] isEqual:sourceKey]) return NO;
    NSArray *chunks=value[@"chunks"];
    if (![chunks isKindOfClass:NSArray.class]) return NO;
    for (id chunk in chunks) if (![chunk isKindOfClass:NSString.class]) return NO;
    for (NSString *key in @[@"rules",@"advanced",@"discarded",@"errors"]) if (![value[key] isKindOfClass:NSNumber.class]) return NO;
    NSData *data=[NSJSONSerialization dataWithJSONObject:chunks options:NSJSONWritingSortedKeys error:nil];
    return data && [value[@"chunksDigest"] isEqual:BrowserFilterDigest(data)] && [value[@"discarded"] unsignedIntegerValue]==0;
}

static NSArray<NSDictionary *> *BrowserAdBlockRuleChunks(NSString *dynamicPolicy, BOOL early, NSUInteger generation, NSMutableSet *failedSources, void (^prepared)(NSDictionary *)) {
    NSURL *directory = BrowserFilterCacheDirectory(@"BrowserContentRules");
    NSMutableArray *chunks = [NSMutableArray array];
    NSString *epoch = [NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockRebuildIdentity"] ?: @"";
    NSArray *dynamic = [BrowserAdBlockPolicy nativeRulesForPolicy:dynamicPolicy];
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (!BrowserAdBlockSourceEnabled(source[@"id"]) || (early && ![source[@"id"] isEqual:@"ubo"])) continue;
        if (!BrowserFilterGenerationCurrent(generation)) return nil;
        @autoreleasepool {
            NSString *filter = BrowserAdBlockSourceText(source);
            if (!filter.length) {
                if (![source[@"id"] isEqual:@"custom"] && [NSFileManager.defaultManager fileExistsAtPath:BrowserAdBlockSourceURL(source).path]) [failedSources addObject:source[@"id"]];
                continue;
            }
            NSString *sourceKey = BrowserFilterDigest([[NSString stringWithFormat:@"native-source-v2|%@|%@|%@", source[@"id"], epoch, filter] dataUsingEncoding:NSUTF8StringEncoding]);
            NSURL *cacheURL = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"ConvertedSource-%@.plist", sourceKey]];
            NSDictionary *converted = [NSDictionary dictionaryWithContentsOfURL:cacheURL];
            NSArray *jsonChunks = converted[@"chunks"];
            if (!BrowserNativeConversionValid(converted,sourceKey)) {
                if ([source[@"id"] isEqual:@"dns"]) {
                    NSMutableOrderedSet *domains = [NSMutableOrderedSet orderedSet];
                    BrowserAddAdBlockHosts(domains, filter);
                    NSMutableArray *generated = [NSMutableArray array], *rules = [NSMutableArray arrayWithCapacity:10000];
                    for (NSString *domain in domains) {
                        NSString *escaped = [domain stringByReplacingOccurrencesOfString:@"." withString:@"\\."];
                        // WebKit canonicalizes HTTP(S) scheme/hostname to lowercase.
                        // [: /] terminates the same canonical host as the old numeric-port suffix.
                        NSString *pattern = [NSString stringWithFormat:@"^https?://([a-z0-9-]+\\.)*%@[:/]", escaped];
                        [rules addObject:@{@"trigger":@{@"url-filter":pattern, @"url-filter-is-case-sensitive":@YES, @"load-type":@[@"third-party"]}, @"action":@{@"type":@"block"}}];
                        if (rules.count == 10000) {
                            NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:NSJSONWritingSortedKeys error:nil];
                            if (!data) return nil;
                            [generated addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
                            [rules removeAllObjects];
                        }
                    }
                    if (rules.count) {
                        NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:NSJSONWritingSortedKeys error:nil];
                        if (!data) return nil;
                        [generated addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
                    }
                    converted = @{@"chunks":generated, @"rules":@(domains.count), @"advanced":@0, @"discarded":@0, @"errors":@0};
                } else converted = [BrowserNativeRuleConverter convertRuleChunks:filter];
                jsonChunks = converted[@"chunks"];
                if (![jsonChunks isKindOfClass:NSArray.class] || [converted[@"discarded"] unsignedIntegerValue] > 0) {
                    [failedSources addObject:source[@"id"]]; continue;
                }
                NSMutableDictionary *stored = [converted mutableCopy]; stored[@"format"] = @"lossless-native-v2"; stored[@"sourceKey"]=sourceKey; stored[@"chunksDigest"]=BrowserFilterDigest([NSJSONSerialization dataWithJSONObject:jsonChunks options:NSJSONWritingSortedKeys error:nil]);
                [stored writeToURL:cacheURL atomically:YES];
                BrowserLog(@"[AdBlock] source=%@ chunks=%lu rules=%ld advanced=%ld discarded=%ld errors=%ld", source[@"id"], (unsigned long)jsonChunks.count, (long)[converted[@"rules"] integerValue], (long)[converted[@"advanced"] integerValue], (long)[converted[@"discarded"] integerValue], (long)[converted[@"errors"] integerValue]);
            }
            NSUInteger ordinal = 0;
            for (NSString *baseJSON in jsonChunks) {
                NSString *json = baseJSON;
                if (dynamic.count) {
                    NSArray *base = [NSJSONSerialization JSONObjectWithData:[baseJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
                    if (![base isKindOfClass:NSArray.class]) { [failedSources addObject:source[@"id"]]; continue; }
                    NSMutableArray *combined = [base mutableCopy]; [combined addObjectsFromArray:dynamic];
                    NSData *data = [NSJSONSerialization dataWithJSONObject:combined options:NSJSONWritingSortedKeys error:nil];
                    if (!data) return nil;
                    json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
                }
                NSString *key = BrowserFilterDigest([[NSString stringWithFormat:@"native-chunk-v2|%@|%lu|%@|%@", source[@"id"], (unsigned long)ordinal++, epoch, json] dataUsingEncoding:NSUTF8StringEncoding]);
                unsigned shard = (unsigned)strtoul([[key substringToIndex:8] UTF8String], NULL, 16) % 4;
                NSDictionary *chunk=@{@"json":json, @"source":source[@"id"], @"sourceKey":sourceKey, @"identifier":[BrowserAdBlockRuleListIdentifierPrefix stringByAppendingFormat:@"-content-%@", key], @"shard":@(shard)};
                [chunks addObject:chunk]; if (prepared) prepared(chunk);
            }
        }
    }
    if (!chunks.count && dynamic.count) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:dynamic options:NSJSONWritingSortedKeys error:nil];
        NSString *key = BrowserFilterDigest(data);
        [chunks addObject:@{@"json":[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding], @"source":@"dynamic", @"identifier":[BrowserAdBlockRuleListIdentifierPrefix stringByAppendingFormat:@"-content-%@", key], @"shard":@0}];
    }
    return chunks;
}

static NSString *BrowserAdBlockFilterIdentifier(BOOL includeOnlineHosts) {
    NSMutableString *signature = [NSMutableString stringWithFormat:@"%d", includeOnlineHosts];
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        BOOL enabled = BrowserAdBlockSourceEnabled(source[@"id"]);
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:
            BrowserAdBlockSourceURL(source).path error:nil];
        if ([source[@"id"] isEqualToString:@"ubo"]) {
            // Bundle timestamps change on delivery even when the pinned filters do not.
            static NSString *bundledFingerprint;
            static dispatch_once_t once;
            dispatch_once(&once, ^{
                NSData *data = [NSData dataWithContentsOfURL:BrowserAdBlockSourceURL(source)];
                uint64_t hash = 14695981039346656037ULL;
                const uint8_t *bytes = data.bytes;
                for (NSUInteger index = 0; index < data.length; index++) hash = (hash ^ bytes[index]) * 1099511628211ULL;
                bundledFingerprint = [NSString stringWithFormat:@"%016llx-%lu", hash, (unsigned long)data.length];
            });
            [signature appendFormat:@"-%@-%d-%@", source[@"id"], enabled, bundledFingerprint];
        } else {
            [signature appendFormat:@"-%@-%d-%.9f-%lld", source[@"id"], enabled,
                [attributes[NSFileModificationDate] timeIntervalSince1970], [attributes[NSFileSize] longLongValue]];
        }
    }
    // An explicit rebuild advances only generated-filter cache identity. It
    // persists so subsequent launches reuse this freshly prepared generation.
    NSString *rebuild = [NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockRebuildIdentity"];
    if (rebuild.length) [signature appendFormat:@"-rebuild-%@", rebuild];
    // Use an explicit stable fingerprint for the cache shared by app launches.
    [signature appendString:[NSUserDefaults.standardUserDefaults stringForKey:kBrowserAdBlockUserFiltersKey] ?: @""];
    NSData *signatureData = [signature dataUsingEncoding:NSUTF8StringEncoding];
    const uint8_t *signatureBytes = signatureData.bytes;
    uint64_t signatureFingerprint = 14695981039346656037ULL;
    for (NSUInteger index = 0; index < signatureData.length; index++) {
        signatureFingerprint = (signatureFingerprint ^ signatureBytes[index]) * 1099511628211ULL;
    }
    return [BrowserAdBlockRuleListIdentifierPrefix stringByAppendingFormat:@"-%016llx", signatureFingerprint];
}

static NSString *BrowserAdBlockRuleListIdentifier(BOOL includeOnlineHosts, NSString *dynamicPolicy) {
    NSString *base = BrowserAdBlockFilterIdentifier(includeOnlineHosts);
    return [dynamicPolicy isEqual:@"standard"] ? base : [base stringByAppendingFormat:@"-policy-%@", dynamicPolicy];
}

NSString *BrowserDynamicHostRules(void) {
    NSString *base = [NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockDynamicHostRules"] ?: @"";
    NSString *sites = [BrowserAdBlockPolicy hostRulesForPolicies:[NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockDynamicSitePolicies"]];
    return [base stringByAppendingFormat:@"\n%@", sites];
}

typedef void (^BrowserAdBlockRuleListCompletion)(NSArray *ruleLists, NSError *error);

static NSMutableDictionary *sNativeChunkJobs;
static NSMutableDictionary *sNativeChunkMemory;
static NSMutableDictionary *sNativeChunkFailures;
static NSMutableArray *sNativeStores;
static NSMutableArray *sNativeShardQueues;
static NSMutableIndexSet *sNativeBusyShards;
static NSMutableDictionary *sLatestNativeManifests;
static NSURL *sRuntimeSnapshotURL;
static BOOL sRuntimeSnapshotPersisted;
static NSString *sRuntimeConfiguration;

static NSError *BrowserFilterError(NSInteger code, NSString *message) {
    return [NSError errorWithDomain:@"BrowserAdBlock" code:code userInfo:@{NSLocalizedDescriptionKey:message}];
}

static id BrowserNativeStore(NSUInteger shard) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        // Startup can reach the service before BrowserWebView loads WebKit.
        // Use the same runtime locations as that host, including tvOS's
        // private/staged framework paths, before memoizing preparation errors.
        for (NSString *path in @[@"/System/Library/Frameworks/WebKit.framework/WebKit",
                                 @"/System/Library/PrivateFrameworks/WebKit.framework/WebKit",
                                 @"/System/Library/StagedFrameworks/Safari/WebKit.framework/WebKit"]) {
            if (NSClassFromString(@"WKContentRuleListStore") != Nil) break;
            dlopen(path.UTF8String, RTLD_LAZY | RTLD_GLOBAL);
        }
        sNativeStores = [NSMutableArray array]; sNativeShardQueues = [NSMutableArray array];
        sNativeChunkJobs = [NSMutableDictionary dictionary]; sNativeChunkMemory = [NSMutableDictionary dictionary]; sNativeChunkFailures=[NSMutableDictionary dictionary];
        sNativeBusyShards = [NSMutableIndexSet indexSet]; sLatestNativeManifests = [NSMutableDictionary dictionary];
        for (NSUInteger i=0; i<4; i++) { [sNativeStores addObject:NSNull.null]; [sNativeShardQueues addObject:[NSMutableArray array]]; }
    });
    if (shard >= sNativeStores.count) return nil;
    if (sNativeStores[shard] == NSNull.null) {
        Class cls = NSClassFromString(@"WKContentRuleListStore"); SEL create = NSSelectorFromString(@"storeWithURL:");
        NSURL *directory = [BrowserFilterCacheDirectory(@"BrowserContentRules") URLByAppendingPathComponent:[NSString stringWithFormat:@"Compiled-%lu", (unsigned long)shard] isDirectory:YES];
        NSError *error = nil;
        [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error];
        id store = !error && [cls respondsToSelector:create] ? ((id (*)(id, SEL, id))objc_msgSend)((id)cls, create, directory) : nil;
        if (store) sNativeStores[shard] = store;
    }
    return sNativeStores[shard] == NSNull.null ? nil : sNativeStores[shard];
}

static void BrowserPumpNativeShard(NSUInteger shard) {
    if ([sNativeBusyShards containsIndex:shard]) return;
    NSMutableArray *queue = sNativeShardQueues[shard];
    if (!queue.count) return;
    NSMutableDictionary *job;
    while (queue.count) {
        job=queue.firstObject; [queue removeObjectAtIndex:0];
        BOOL wanted=NO;
        for (NSDictionary *listener in job[@"listeners"]) if ([listener[@"generation"] unsignedIntegerValue]==sBrowserAdBlockRulesGeneration) wanted=YES;
        if (wanted) break;
        [sNativeChunkJobs removeObjectForKey:job[@"identifier"]];
        for (NSDictionary *listener in job[@"listeners"]) { void (^callback)(id,NSError *)=listener[@"callback"]; callback(nil,BrowserFilterError(3,@"Filter preparation was superseded.")); }
        job=nil;
    }
    if (!job) return;
    NSString *identifier=job[@"identifier"];
    id store = BrowserNativeStore(shard);
    [sNativeBusyShards addIndex:shard];
    void (^finish)(id, NSError *) = ^(id ruleList, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (ruleList) sNativeChunkMemory[identifier] = ruleList;
            else if (error && error.code!=3) sNativeChunkFailures[identifier]=@{@"generation":@(sBrowserAdBlockRulesGeneration),@"error":error};
            [sNativeChunkJobs removeObjectForKey:identifier]; [sNativeBusyShards removeIndex:shard];
            for (NSDictionary *listener in [job[@"listeners"] copy]) { void (^callback)(id,NSError *) = listener[@"callback"]; callback(ruleList,error); }
            BrowserPumpNativeShard(shard);
        });
    };
    if (!store) { finish(nil,BrowserFilterError(1,@"WebKit content rules are unavailable.")); return; }
    SEL lookup = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
    SEL compile = NSSelectorFromString(@"compileContentRuleListForIdentifier:encodedContentRuleList:completionHandler:");
    if (![store respondsToSelector:lookup] || ![store respondsToSelector:compile]) { finish(nil,BrowserFilterError(1,@"WebKit content rule compilation is unavailable.")); return; }
    ((void (*)(id,SEL,id,id))objc_msgSend)(store,lookup,identifier,^(id list,NSError *error) {
        if (list) { finish(list,nil); return; }
        dispatch_async(dispatch_get_main_queue(), ^{
            BOOL stillWanted = NO;
            for (NSDictionary *listener in job[@"listeners"]) if ([listener[@"generation"] unsignedIntegerValue] == sBrowserAdBlockRulesGeneration) stillWanted = YES;
            if (!stillWanted) { finish(nil,BrowserFilterError(3,@"Filter preparation was superseded.")); return; }
            ((void (*)(id,SEL,id,id,id))objc_msgSend)(store,compile,identifier,job[@"json"],finish);
        });
    });
}

static void BrowserLoadNativeChunk(NSDictionary *chunk, NSUInteger generation, void (^completion)(id,NSError *)) {
    NSUInteger shard = [chunk[@"shard"] unsignedIntegerValue]; BrowserNativeStore(shard);
    NSString *identifier = chunk[@"identifier"];
    id cached = sNativeChunkMemory[identifier]; if (cached) { completion(cached,nil); return; }
    NSDictionary *failure=sNativeChunkFailures[identifier];
    if ([failure[@"generation"] unsignedIntegerValue]==generation && failure[@"error"]) { completion(nil,failure[@"error"]); return; }
    NSDictionary *listener = @{@"generation":@(generation), @"callback":[completion copy]};
    NSMutableDictionary *job = sNativeChunkJobs[identifier];
    if (job) { [job[@"listeners"] addObject:listener]; return; }
    job = [@{@"identifier":identifier, @"json":chunk[@"json"], @"listeners":[NSMutableArray arrayWithObject:listener]} mutableCopy];
    sNativeChunkJobs[identifier] = job; [sNativeShardQueues[shard] addObject:job]; BrowserPumpNativeShard(shard);
}

static NSArray *BrowserNativeReferences(NSArray *chunks) {
    NSMutableArray *references = [NSMutableArray array];
    for (NSDictionary *chunk in chunks) [references addObject:@{@"identifier":chunk[@"identifier"],@"shard":chunk[@"shard"],@"source":chunk[@"source"] ?: @"",@"sourceKey":chunk[@"sourceKey"] ?: @""}];
    return references;
}

static void BrowserLookUpAdBlockManifest(NSDictionary *manifest, void (^completion)(NSArray *,NSError *)) {
    if (![manifest isKindOfClass:NSDictionary.class]) { completion(nil,nil); return; }
    NSArray *references = manifest[@"chunks"];
    if (![manifest[@"format"] isEqual:@"native-manifest-v2"] || ![references isKindOfClass:NSArray.class] || references.count > 2048) { completion(nil,nil); return; }
    NSData *encoded=[NSJSONSerialization isValidJSONObject:references] ? [NSJSONSerialization dataWithJSONObject:references options:NSJSONWritingSortedKeys error:nil] : nil;
    if (![manifest[@"chunkCount"] isKindOfClass:NSNumber.class] || [manifest[@"chunkCount"] unsignedIntegerValue]!=references.count || !encoded || ![manifest[@"chunksDigest"] isEqual:BrowserFilterDigest(encoded)]) { completion(nil,nil); return; }
    if (!references.count) { completion(@[],nil); return; }
    NSMutableArray *lists = [NSMutableArray array]; for (NSUInteger i=0;i<references.count;i++) [lists addObject:NSNull.null];
    __block NSUInteger remaining = references.count; __block BOOL failed = NO;
    [references enumerateObjectsUsingBlock:^(NSDictionary *reference, NSUInteger index, BOOL *stop) {
        BOOL valid=[reference isKindOfClass:NSDictionary.class] && [reference[@"identifier"] isKindOfClass:NSString.class] && [reference[@"source"] isKindOfClass:NSString.class] && [reference[@"shard"] isKindOfClass:NSNumber.class];
        id value=valid ? reference[@"identifier"] : nil; NSUInteger shard=valid ? [reference[@"shard"] unsignedIntegerValue] : 4;
        id store = shard < 4 ? BrowserNativeStore(shard) : nil; SEL lookup = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
        void (^found)(id,NSError *) = ^(id list,NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (list) { lists[index]=list; sNativeChunkMemory[value]=list; } else failed=YES;
                if (--remaining==0) completion(failed ? nil : [lists copy],nil);
            });
        };
        if (![value isKindOfClass:NSString.class] || !store || ![store respondsToSelector:lookup]) found(nil,nil);
        else ((void (*)(id,SEL,id,id))objc_msgSend)(store,lookup,value,found);
    }];
}

static void BrowserPruneNativeRules(void) {
    if (sNativeLoads || sNativeChunkJobs.count) return;
    NSURL *directory = BrowserFilterCacheDirectory(@"BrowserContentRules");
    NSMutableSet *keep = [NSMutableSet setWithArray:sInstalledNativeRules.allKeys ?: @[]];
    NSMutableArray *manifests = [NSMutableArray array];
    for (NSString *policy in @[@"standard",@"allow",@"block"]) for (NSString *phase in @[@"full",@"early"]) for (NSString *suffix in @[@"",@"-previous"]) {
        NSString *name=[NSString stringWithFormat:@"NativeManifest-%@-%@%@.plist",phase,policy,suffix];
        NSDictionary *manifest=[NSDictionary dictionaryWithContentsOfURL:[directory URLByAppendingPathComponent:name]];
        if (manifest) [manifests addObject:manifest];
    }
    NSDictionary *last=[NSDictionary dictionaryWithContentsOfURL:[directory URLByAppendingPathComponent:@"LastSuccessfulFilters.plist"]];
    if ([last[@"native"] isKindOfClass:NSDictionary.class]) [manifests addObjectsFromArray:[last[@"native"] allValues]];
    for (NSDictionary *manifest in manifests) {
        if (![manifest isKindOfClass:NSDictionary.class] || ![manifest[@"chunks"] isKindOfClass:NSArray.class]) continue;
        for (NSDictionary *chunk in manifest[@"chunks"]) if ([chunk isKindOfClass:NSDictionary.class] && [chunk[@"identifier"] isKindOfClass:NSString.class]) [keep addObject:chunk[@"identifier"]];
    }
    NSMutableSet *sourceKeys=[NSMutableSet set];
    for (NSDictionary *manifest in manifests) {
        if (![manifest isKindOfClass:NSDictionary.class] || ![manifest[@"chunks"] isKindOfClass:NSArray.class]) continue;
        for (NSDictionary *chunk in manifest[@"chunks"]) if ([chunk isKindOfClass:NSDictionary.class] && [chunk[@"sourceKey"] isKindOfClass:NSString.class]) [sourceKeys addObject:chunk[@"sourceKey"]];
    }
    NSArray *files=[NSFileManager.defaultManager contentsOfDirectoryAtURL:directory includingPropertiesForKeys:@[NSURLContentModificationDateKey] options:0 error:nil];
    NSMutableArray *converted=[NSMutableArray array];
    for (NSURL *url in files) if ([url.lastPathComponent hasPrefix:@"ConvertedSource-"] && [url.pathExtension isEqual:@"plist"]) [converted addObject:url];
    [converted sortUsingComparator:^NSComparisonResult(NSURL *a,NSURL *b) {
        NSDate *ad,*bd; [a getResourceValue:&ad forKey:NSURLContentModificationDateKey error:nil]; [b getResourceValue:&bd forKey:NSURLContentModificationDateKey error:nil];
        return [bd ?: NSDate.distantPast compare:ad ?: NSDate.distantPast];
    }];
    NSUInteger spare=0;
    for (NSURL *url in converted) {
        NSString *key=[url.lastPathComponent.stringByDeletingPathExtension substringFromIndex:@"ConvertedSource-".length];
        if ([sourceKeys containsObject:key]) continue;
        if (spare++<8) continue;
        [NSFileManager.defaultManager removeItemAtURL:url error:nil];
    }
    for (NSString *identifier in [sNativeChunkMemory.allKeys copy]) if (![keep containsObject:identifier]) [sNativeChunkMemory removeObjectForKey:identifier];
    NSUInteger generation=sBrowserAdBlockRulesGeneration;
    for (NSUInteger shard=0;shard<4;shard++) {
        id store=BrowserNativeStore(shard); SEL list=NSSelectorFromString(@"getAvailableContentRuleListIdentifiers:"), remove=NSSelectorFromString(@"removeContentRuleListForIdentifier:completionHandler:");
        if (![store respondsToSelector:list] || ![store respondsToSelector:remove]) continue;
        ((void (*)(id,SEL,id))objc_msgSend)(store,list,^(NSArray *identifiers) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation!=sBrowserAdBlockRulesGeneration || sNativeLoads || sNativeChunkJobs.count) return;
                for (NSString *identifier in identifiers) if ([identifier hasPrefix:BrowserAdBlockRuleListIdentifierPrefix] && ![keep containsObject:identifier]) ((void (*)(id,SEL,id,id))objc_msgSend)(store,remove,identifier,^(__unused NSError *error){});
            });
        });
    }
}

static void BrowserLoadNativeRules(NSString *dynamicPolicy, BOOL early, BrowserAdBlockRuleListCompletion completion) {
    dynamicPolicy=[@[@"allow",@"block"] containsObject:dynamicPolicy] ? dynamicPolicy : @"standard";
    if (!sBrowserAdBlockCachedPolicies) sBrowserAdBlockCachedPolicies=[NSMutableDictionary dictionary];
    NSString *stateKey=[NSString stringWithFormat:@"%@:%@",early ? @"early" : @"full",dynamicPolicy];
    NSMutableDictionary *state=sBrowserAdBlockCachedPolicies[stateKey];
    if (!state) { state=[NSMutableDictionary dictionary]; sBrowserAdBlockCachedPolicies[stateKey]=state; }
    NSString *requestedIdentifier=BrowserAdBlockRuleListIdentifier(YES,dynamicPolicy);
    if (state[@"rules"] && [state[@"identity"] isEqual:requestedIdentifier]) { completion(state[@"rules"],nil); return; }
    if (!state[@"callbacks"]) state[@"callbacks"]=[NSMutableArray array];
    [state[@"callbacks"] addObject:[completion copy]];
    if ([state[@"compiling"] boolValue]) return;
    state[@"compiling"]=@YES; BrowserBeginFilterPreparation(); sNativeLoads++;
    NSUInteger generation=sBrowserAdBlockRulesGeneration;
    NSString *identifier=BrowserAdBlockRuleListIdentifier(YES,dynamicPolicy), *configuration=BrowserFilterConfiguration();
    NSURL *directory=BrowserFilterCacheDirectory(@"BrowserContentRules");
    NSURL *manifestURL=[directory URLByAppendingPathComponent:[NSString stringWithFormat:@"NativeManifest-%@-%@.plist",early ? @"early" : @"full",dynamicPolicy]];
    NSDictionary *manifest=[NSDictionary dictionaryWithContentsOfURL:manifestURL];
    void (^finish)(NSArray *,NSSet *,NSError *)=^(NSArray *lists,NSSet *failures,NSError *error) {
        sNativeLoads--; state[@"compiling"]=@NO;
        NSArray *callbacks=[state[@"callbacks"] copy]; [state[@"callbacks"] removeAllObjects];
        if (generation!=sBrowserAdBlockRulesGeneration || ![identifier isEqual:BrowserAdBlockRuleListIdentifier(YES,dynamicPolicy)]) {
            for (BrowserAdBlockRuleListCompletion callback in callbacks) BrowserLoadNativeRules(dynamicPolicy,early,callback);
            return;
        }
        if (!early) sBrowserAdBlockRuleFailures=failures;
        if (lists && !error && !failures.count) { state[@"rules"]=lists; state[@"identity"]=identifier; }
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        for (BrowserAdBlockRuleListCompletion callback in callbacks) callback(lists,error);
        if (lists && !error && !failures.count) BrowserPruneNativeRules();
    };
    BrowserLookUpAdBlockManifest([manifest[@"identifier"] isEqual:identifier] ? manifest : nil,^(NSArray *cached,NSError *lookupError) {
        if (cached) { if (!early) sLatestNativeManifests[dynamicPolicy]=manifest; finish(cached,[NSSet set],nil); return; }
        if (!early) sFilterBakePending=YES;
        NSTimeInterval started=NSProcessInfo.processInfo.systemUptime;
        __block NSTimeInterval webKitStarted=0;
        static dispatch_queue_t conversionQueue; static dispatch_once_t once;
        dispatch_once(&once,^{ conversionQueue=dispatch_queue_create("browser.adblock.native.conversion",dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL,QOS_CLASS_USER_INITIATED,0)); });
        dispatch_async(conversionQueue,^{
            NSMutableSet *failures=[NSMutableSet set];
            NSArray *chunks=BrowserAdBlockRuleChunks(dynamicPolicy,early,generation,failures,^(NSDictionary *chunk) {
                dispatch_async(dispatch_get_main_queue(),^{
                    if (generation!=sBrowserAdBlockRulesGeneration) return;
                    if (webKitStarted==0) webKitStarted=NSProcessInfo.processInfo.systemUptime;
                    BrowserLoadNativeChunk(chunk,generation,^(__unused id list,__unused NSError *error){});
                });
            });
            dispatch_async(dispatch_get_main_queue(),^{
                if (generation!=sBrowserAdBlockRulesGeneration || ![identifier isEqual:BrowserAdBlockRuleListIdentifier(YES,dynamicPolicy)]) { finish(nil,[NSSet set],nil); return; }
                if (!chunks || failures.count) { finish(nil,failures,BrowserFilterError(2,@"Ad Block rules could not be converted without loss.")); return; }
                if (!early) sFilterStageDurations[@"nativeConversion"]=@(NSProcessInfo.processInfo.systemUptime-started);
                if (webKitStarted==0) webKitStarted=NSProcessInfo.processInfo.systemUptime;
                NSMutableArray *lists=[NSMutableArray array]; for (NSUInteger i=0;i<chunks.count;i++) [lists addObject:NSNull.null];
                __block NSUInteger remaining=chunks.count; __block NSError *lastError;
                void (^compiled)(void)=^{
                    if (!early && generation==sBrowserAdBlockRulesGeneration) sFilterStageDurations[@"nativeWebKit"]=@(NSProcessInfo.processInfo.systemUptime-webKitStarted);
                    if (!lastError && generation==sBrowserAdBlockRulesGeneration) {
                        NSArray *references=BrowserNativeReferences(chunks);
                        NSDictionary *next=@{@"format":@"native-manifest-v2",@"identifier":identifier,@"configuration":configuration,@"chunks":references,@"chunkCount":@(references.count),@"chunksDigest":BrowserFilterDigest([NSJSONSerialization dataWithJSONObject:references options:NSJSONWritingSortedKeys error:nil])};
                        NSDictionary *previous=[NSDictionary dictionaryWithContentsOfURL:manifestURL];
                        if (previous) [previous writeToURL:[directory URLByAppendingPathComponent:[NSString stringWithFormat:@"NativeManifest-%@-%@-previous.plist",early ? @"early" : @"full",dynamicPolicy]] atomically:YES];
                        [next writeToURL:manifestURL atomically:YES];
                        if (!early) sLatestNativeManifests[dynamicPolicy]=next;
                    }
                    finish(lastError ? nil : [lists copy],failures,lastError);
                };
                if (!remaining) { compiled(); return; }
                [chunks enumerateObjectsUsingBlock:^(NSDictionary *chunk,NSUInteger index,BOOL *stop) {
                    BrowserLoadNativeChunk(chunk,generation,^(id list,NSError *error) {
                        if (list) lists[index]=list;
                        else { [failures addObject:chunk[@"source"]]; lastError=error ?: BrowserFilterError(2,@"Native filter compilation failed."); }
                        if (--remaining==0) compiled();
                    });
                }];
            });
        });
    });
}

void BrowserLoadAdBlockRuleList(NSString *dynamicPolicy, BrowserAdBlockRuleListCompletion completion) {
    BrowserLoadNativeRules(dynamicPolicy,NO,completion);
}

static BOOL BrowserFilterGenerationCurrent(NSUInteger generation) {
    if (NSThread.isMainThread) return generation==sBrowserAdBlockRulesGeneration;
    __block BOOL current;
    dispatch_sync(dispatch_get_main_queue(), ^{ current=generation==sBrowserAdBlockRulesGeneration; });
    return current;
}

static NSString *BrowserExtendedFingerprint(void) {
    static NSString *fingerprint; static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSMutableData *bytes=[NSMutableData dataWithData:[@"extended-v4" dataUsingEncoding:NSUTF8StringEncoding]];
        for (NSString *name in @[@"UBlockParser.js",@"UBlockScriptlets.json",@"UBlockRuntime.js",@"UBlockDomains.js",@"UBlockCosmetics.js",@"UBlockProcedural.js"]) {
            NSData *data=[NSData dataWithContentsOfURL:[NSBundle.mainBundle URLForResource:name withExtension:nil]];
            if (data) [bytes appendData:data];
        }
        fingerprint=BrowserFilterDigest(bytes);
    });
    return fingerprint;
}

static BOOL BrowserExtendedCacheValid(NSDictionary *value, BOOL modern) {
    return [value isKindOfClass:NSDictionary.class] && [value[@"scripts"] isKindOfClass:NSDictionary.class] &&
        [value[@"scripts"][@"MAIN"] isKindOfClass:NSString.class] && [value[@"scripts"][@"ISOLATED"] isKindOfClass:NSString.class] &&
        [value[@"stats"] isKindOfClass:NSDictionary.class] && [value[@"rejected"] isKindOfClass:NSDictionary.class] &&
        (!modern || ([value[@"format"] isKindOfClass:NSNumber.class] && [value[@"format"] integerValue]==4 && [value[@"configurationMode"] isKindOfClass:NSString.class] && [value[@"configurationMode"] isEqual:@"separate-v1"]));
}

void BrowserLoadUBlockRuntime(void (^completion)(NSDictionary *)) {
    NSString *identifier=BrowserAdBlockFilterIdentifier(YES), *configuration=BrowserFilterConfiguration();
    if (sBrowserUBlockRuntime && [identifier isEqual:sBrowserUBlockRuntimeIdentifier] && [sBrowserNetworkSummary[@"available"] boolValue] && [sBrowserNetworkSummary[@"identity"] isEqual:identifier] && ![sBrowserNetworkSummary[@"stale"] boolValue]) { completion(sBrowserUBlockRuntime); return; }
    if (sBrowserUBlockPendingCallbacks) { [sBrowserUBlockPendingCallbacks addObject:[completion copy]]; return; }
    BrowserBeginFilterPreparation();
    sBrowserUBlockPendingCallbacks=[NSMutableArray arrayWithObject:[completion copy]];
    NSUInteger generation=sBrowserAdBlockRulesGeneration;
    NSArray *descriptors=BrowserFilterSourceDescriptors();
    dispatch_group_t preparation=dispatch_group_create(); dispatch_group_enter(preparation); dispatch_group_enter(preparation);
    __block NSDictionary *preparedNetwork, *preparedRuntime;
    __block NSURL *snapshotURL;
    __block BOOL restored=NO, saved=NO;
    NSTimeInterval started=NSProcessInfo.processInfo.systemUptime;
    __block NSTimeInterval networkDuration=0,extendedDuration=0;
    dispatch_group_notify(preparation,dispatch_get_main_queue(),^{
        NSArray *callbacks=[sBrowserUBlockPendingCallbacks copy]; sBrowserUBlockPendingCallbacks=nil;
        if (generation!=sBrowserAdBlockRulesGeneration || ![identifier isEqual:BrowserAdBlockFilterIdentifier(YES)]) {
            for (void (^callback)(NSDictionary *) in callbacks) BrowserLoadUBlockRuntime(callback);
            return;
        }
        if ([preparedNetwork[@"available"] boolValue] || ![sBrowserNetworkSummary[@"available"] boolValue] || ![sRuntimeConfiguration isEqual:configuration]) sBrowserNetworkSummary=preparedNetwork;
        if (preparedRuntime) {
            sBrowserUBlockRuntime=preparedRuntime; sBrowserUBlockRuntimeIdentifier=identifier; sRuntimeConfiguration=configuration; sRuntimeSnapshotURL=snapshotURL; sRuntimeSnapshotPersisted=saved;
            sBrowserUBlockStatistics=preparedRuntime[@"stats"];
            if (saved) BrowserPruneSnapshots(snapshotURL.URLByDeletingLastPathComponent,@"extended-v",snapshotURL);
            if (!restored || ![preparedNetwork[@"cached"] boolValue]) sFilterBakePending=YES;
        }
        sFilterStageDurations[@"network"]=@(networkDuration); sFilterStageDurations[@"extended"]=@(extendedDuration);
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        for (void (^callback)(NSDictionary *) in callbacks) callback(preparedRuntime ?: sBrowserUBlockRuntime);
    });
    [BrowserNetworkFilterEngine prepareSources:descriptors identity:identifier configuration:configuration completion:^(NSDictionary *network) {
        preparedNetwork=network; networkDuration=NSProcessInfo.processInfo.systemUptime-started;
        if (generation==sBrowserAdBlockRulesGeneration && [network[@"available"] boolValue]) sBrowserNetworkSummary=network;
        BrowserLog(@"[AdBlock] network available=%d filters=%ld cached=%d snapshot=%d prepare-ms=%ld error=%ld",[network[@"available"] boolValue],(long)[network[@"count"] integerValue],[network[@"cached"] boolValue],[network[@"snapshot"] boolValue],(long)[network[@"prepareMilliseconds"] integerValue],(long)[network[@"error"] integerValue]);
        dispatch_group_leave(preparation);
    }];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
        @autoreleasepool {
            NSURL *directory=BrowserFilterCacheDirectory(@"BrowserExtendedRules");
            snapshotURL=[directory URLByAppendingPathComponent:[NSString stringWithFormat:@"extended-v4-%@-%@.json",identifier,BrowserExtendedFingerprint()]];
            NSData *data=[NSData dataWithContentsOfURL:snapshotURL];
            NSDictionary *compiled=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            restored=BrowserExtendedCacheValid(compiled,YES);
            // Existing v3 data remain a valid universal-script warm path. Never
            // relabel them as v4 or claim their scripts use separate configuration.
            if (!restored) {
                uint64_t legacy=14695981039346656037ULL;
                for (NSString *name in @[@"UBlockParser.js",@"UBlockScriptlets.json",@"UBlockRuntime.js",@"UBlockDomains.js",@"UBlockCosmetics.js",@"UBlockProcedural.js"]) {
                    NSData *bytes=[NSData dataWithContentsOfURL:[NSBundle.mainBundle URLForResource:name withExtension:nil]]; const uint8_t *p=bytes.bytes;
                    for (NSUInteger i=0;i<bytes.length;i++) legacy=(legacy^p[i])*1099511628211ULL;
                }
                NSURL *old=[directory URLByAppendingPathComponent:[NSString stringWithFormat:@"extended-v3-%@-%016llx.json",identifier,legacy]];
                NSData *legacyData=[NSData dataWithContentsOfURL:old]; NSDictionary *value=legacyData ? [NSJSONSerialization JSONObjectWithData:legacyData options:0 error:nil] : nil;
                if (BrowserExtendedCacheValid(value,NO) && !value[@"configurationMode"]) { compiled=value; restored=YES; snapshotURL=old; }
            }
            saved=restored;
            if (!restored && BrowserFilterGenerationCurrent(generation)) {
                NSArray *lists=BrowserReadFilterLists(descriptors);
                compiled=lists ? [BrowserAdBlockConverter compileUBlockLists:lists cancelled:^BOOL { return !BrowserFilterGenerationCurrent(generation); }] : nil;
                if (BrowserExtendedCacheValid(compiled,YES) && BrowserFilterGenerationCurrent(generation)) {
                    NSData *cache=[NSJSONSerialization dataWithJSONObject:compiled options:0 error:nil];
                    saved=cache && [cache writeToURL:snapshotURL options:NSDataWritingAtomic error:nil];
                } else compiled=nil;
            }
            if (compiled) {
                NSMutableDictionary *ready=[compiled mutableCopy]; ready[@"artifactIdentity"]=snapshotURL.lastPathComponent; preparedRuntime=ready;
            }
            extendedDuration=NSProcessInfo.processInfo.systemUptime-started;
            BrowserLog(@"[AdBlock] advanced cached=%d prepare-ms=%ld",restored,(long)(extendedDuration*1000));
        }
        dispatch_group_leave(preparation);
    });
}

static void BrowserRestoreLastGoodRuntime(void (^completion)(NSDictionary *)) {
    NSString *configuration=BrowserFilterConfiguration(); NSUInteger generation=sBrowserAdBlockRulesGeneration;
    if (sBrowserUBlockRuntime && [sRuntimeConfiguration isEqual:configuration] && [sBrowserNetworkSummary[@"available"] boolValue]) { completion(sBrowserUBlockRuntime); return; }
    NSURL *pointerURL=[BrowserFilterCacheDirectory(@"BrowserContentRules") URLByAppendingPathComponent:@"LastSuccessfulFilters.plist"];
    NSDictionary *pointer=[NSDictionary dictionaryWithContentsOfURL:pointerURL];
    NSString *file=pointer[@"extendedFile"];
    if (![pointer[@"identity"] isKindOfClass:NSString.class] || ![pointer[@"configuration"] isEqual:configuration] || ![pointer[@"extendedFingerprint"] isEqual:BrowserExtendedFingerprint()] ||
        ![file isKindOfClass:NSString.class] || ![file.lastPathComponent isEqual:file] || ![file hasPrefix:@"extended-v"]) { completion(nil); return; }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
        NSURL *url=[BrowserFilterCacheDirectory(@"BrowserExtendedRules") URLByAppendingPathComponent:file];
        NSData *data=[NSData dataWithContentsOfURL:url]; NSDictionary *compiled=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        if (!BrowserExtendedCacheValid(compiled,[file hasPrefix:@"extended-v4-"])) { dispatch_async(dispatch_get_main_queue(),^{completion(nil);}); return; }
        dispatch_async(dispatch_get_main_queue(),^{
            if (generation!=sBrowserAdBlockRulesGeneration || ![configuration isEqual:BrowserFilterConfiguration()]) { completion(nil); return; }
            [BrowserNetworkFilterEngine restoreIdentity:pointer[@"identity"] configuration:configuration completion:^(NSDictionary *network) {
                if (generation!=sBrowserAdBlockRulesGeneration || ![configuration isEqual:BrowserFilterConfiguration()] || ![network[@"available"] boolValue]) { completion(nil); return; }
                if (!sBrowserUBlockRuntime) {
                    NSMutableDictionary *ready=[compiled mutableCopy]; ready[@"artifactIdentity"]=file;
                    sBrowserUBlockRuntime=ready; sBrowserUBlockRuntimeIdentifier=pointer[@"identity"]; sRuntimeConfiguration=configuration; sRuntimeSnapshotURL=url; sRuntimeSnapshotPersisted=YES;
                    sBrowserUBlockStatistics=ready[@"stats"];
                }
                sBrowserNetworkSummary=network;
                completion([sRuntimeConfiguration isEqual:configuration] ? sBrowserUBlockRuntime : nil);
            }];
        });
    });
}

static NSMutableSet<NSString *> *sBrowserAdBlockCheckingSources = nil;
static NSMutableSet<NSString *> *sBrowserAdBlockFailedSources = nil;
static BOOL sBrowserAdBlockPendingDownloadChanges = NO;

static NSString *BrowserSourceFileSignature(NSURL *url) {
    NSDictionary *attributes=[NSFileManager.defaultManager attributesOfItemAtPath:url.path error:nil];
    if (!attributes) return @"";
    return [NSString stringWithFormat:@"%.9f:%lld",[attributes[NSFileModificationDate] timeIntervalSince1970],[attributes[NSFileSize] longLongValue]];
}

static void BrowserPublishSourceChanges(void) {
    static BOOL scheduled=NO;
    if (scheduled || !sBrowserAdBlockPendingDownloadChanges || sBrowserAdBlockCheckingSources.count) return;
    scheduled=YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,(int64_t)(0.25*NSEC_PER_SEC)),dispatch_get_main_queue(),^{
        scheduled=NO;
        if (sBrowserAdBlockCheckingSources.count || !sBrowserAdBlockPendingDownloadChanges) return;
        sBrowserAdBlockPendingDownloadChanges=NO;
        sBrowserAdBlockRulesGeneration++; [BrowserNetworkFilterEngine cancelPreparation]; sBrowserAdBlockCachedPolicies=nil;
        [sNativeChunkFailures removeAllObjects];
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil];
    });
}

static void BrowserCheckForAdBlockUpdate(BOOL force) {
    static NSMutableDictionary<NSString *,NSDate *> *lastAttempts;
    if (!lastAttempts) lastAttempts=[NSMutableDictionary dictionary];
    if (!sBrowserAdBlockCheckingSources) sBrowserAdBlockCheckingSources=[NSMutableSet set];
    if (!sBrowserAdBlockFailedSources) sBrowserAdBlockFailedSources=[NSMutableSet set];
    NSDate *now=NSDate.date;
    for (NSDictionary *source in BrowserAdBlockSources()) {
        NSString *identifier=source[@"id"];
        if (![source[@"url"] length] || !BrowserAdBlockSourceEnabled(identifier) || [sBrowserAdBlockCheckingSources containsObject:identifier]) continue;
        NSString *checkKey=[kBrowserAdBlockSourceLastCheckKeyPrefix stringByAppendingString:identifier];
        NSDate *lastSuccess=[NSUserDefaults.standardUserDefaults objectForKey:checkKey];
        if (!force && ((lastAttempts[identifier] && [now timeIntervalSinceDate:lastAttempts[identifier]]<3600) || (lastSuccess && [now timeIntervalSinceDate:lastSuccess]<7*24*3600))) continue;
        [sBrowserAdBlockCheckingSources addObject:identifier]; [sBrowserAdBlockFailedSources removeObject:identifier]; lastAttempts[identifier]=now;
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        NSURL *destination=BrowserAdBlockSourceURL(source);
        NSString *HTTPKey=[@"AdBlockSourceHTTP." stringByAppendingString:identifier];
        NSDictionary *HTTP=[NSUserDefaults.standardUserDefaults dictionaryForKey:HTTPKey];
        NSString *localSignature=BrowserSourceFileSignature(destination);
        NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:source[@"url"]]];
        if (localSignature.length && [HTTP[@"signature"] isEqual:localSignature] && [HTTP[@"etag"] isKindOfClass:NSString.class]) [request setValue:HTTP[@"etag"] forHTTPHeaderField:@"If-None-Match"];
        NSURLSessionDataTask *task=[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error) {
            NSHTTPURLResponse *HTTPResponse=[response isKindOfClass:NSHTTPURLResponse.class] ? (NSHTTPURLResponse *)response : nil;
            BOOL notModified=!error && HTTPResponse.statusCode==304 && localSignature.length && [localSignature isEqual:BrowserSourceFileSignature(destination)];
            BOOL validResponse=!error && HTTPResponse.statusCode==200 && data.length>10000 && data.length<20000000;
            NSString *filter=validResponse ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
            BOOL validFilter=[identifier isEqual:@"dns"] ? BrowserAddAdBlockHosts([NSMutableOrderedSet orderedSet],filter)>100000 :
                (filter.length>10000 && [filter containsString:@"||"] && ([filter containsString:@"##"] || [filter containsString:@"@@"]));
            BOOL updated=NO,saved=notModified;
            if (validFilter) {
                [NSFileManager.defaultManager createDirectoryAtURL:destination.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
                NSData *previous=[NSData dataWithContentsOfURL:destination];
                saved=[previous isEqualToData:data];
                if (!saved) { saved=[data writeToURL:destination options:NSDataWritingAtomic error:nil]; updated=saved; }
            }
            NSString *etag=[HTTPResponse valueForHTTPHeaderField:@"ETag"], *signature=saved ? BrowserSourceFileSignature(destination) : nil;
            dispatch_async(dispatch_get_main_queue(),^{
                [sBrowserAdBlockCheckingSources removeObject:identifier];
                if (saved) {
                    [NSUserDefaults.standardUserDefaults setObject:NSDate.date forKey:checkKey];
                    if (etag.length && signature.length) [NSUserDefaults.standardUserDefaults setObject:@{@"etag":etag,@"signature":signature} forKey:HTTPKey];
                    else if (!notModified) [NSUserDefaults.standardUserDefaults removeObjectForKey:HTTPKey];
                } else {
                    [sBrowserAdBlockFailedSources addObject:identifier];
                    BrowserLog(@"[AdBlock] source=%@ update failed: %@",identifier,error.localizedDescription ?: @"invalid filter response");
                }
                [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
                if (updated) sBrowserAdBlockPendingDownloadChanges=YES;
                BrowserPublishSourceChanges();
            });
        }];
        [task resume];
    }
}

void BrowserCheckForAdBlockUpdateIfNeeded(void) {
    BrowserCheckForAdBlockUpdate(NO);
}

static NSString *BrowserAdBlockSourceRevision(NSURL *url) {
    NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:url.path];
    if (file == nil) return nil;
    NSData *header = nil;
    @try {
        header = [file readDataOfLength:4096];
    } @finally {
        [file closeFile];
    }
    NSString *text = [[NSString alloc] initWithData:header encoding:NSISOLatin1StringEncoding];
    __block NSString *modified = nil;
    __block NSString *version = nil;
    [text enumerateLinesUsingBlock:^(NSString *line, BOOL *stop) {
        NSString *entry = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if ([entry hasPrefix:@"! Version:"]) {
            version = [[entry substringFromIndex:@"! Version:".length]
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
            *stop = YES;
        } else if ([entry hasPrefix:@"! Last modified:"]) {
            modified = [[entry substringFromIndex:@"! Last modified:".length]
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        }
    }];
    if (version.length > 0) return [NSString stringWithFormat:@"v%@", version];
    if (modified.length >= 10) return [NSString stringWithFormat:@"Updated %@", [modified substringToIndex:10]];
    return nil;
}


@implementation BrowserAdBlockService
+ (void)prepareForLaunch {
    NSAssert(NSThread.isMainThread,@"Ad Block launch preparation belongs to the main queue.");
    BrowserNativeStore(0);
    static NSString *scheduled;
    NSString *identity=BrowserAdBlockFilterIdentifier(YES);
    if ([scheduled isEqual:identity]) return;
    scheduled=identity;
    [self prepareEarlyProtectionForPolicy:@"standard" completion:^(__unused NSArray *rules,__unused NSDictionary *runtime,__unused NSError *error) {}];
    __block BOOL nativeReady=NO,runtimeReady=NO;
    NSTimeInterval started=NSProcessInfo.processInfo.systemUptime;
    void (^finish)(void)=^{ if (nativeReady && runtimeReady) [BrowserAdBlockService recordCompletedPreparationSince:started]; };
    BrowserLoadAdBlockRuleList(@"standard",^(NSArray *rules,NSError *error){ nativeReady=rules!=nil && !error; finish(); });
    BrowserLoadUBlockRuntime(^(NSDictionary *runtime){ runtimeReady=runtime!=nil; finish(); });
}

+ (void)prepareEarlyProtectionForPolicy:(NSString *)policy completion:(void (^)(NSArray *,NSDictionary *,NSError *))completion {
    NSAssert(NSThread.isMainThread,@"Ad Block readiness belongs to the main queue.");
    BrowserNativeStore(0);
    policy=[@[@"allow",@"block"] containsObject:policy] ? policy : @"standard";
    NSUInteger generation=sBrowserAdBlockRulesGeneration; NSString *configuration=BrowserFilterConfiguration();
    __block NSArray *readyRules; __block NSDictionary *readyRuntime;
    __block BOOL nativeDone=NO,runtimeDone=NO,finished=NO;
    __block NSUInteger nativePending=1,runtimePending=2;
    __block NSError *nativeError,*runtimeError;
    void (^finish)(void)=^{
        if (finished || !nativeDone || !runtimeDone) return;
        finished=YES;
        if (generation!=sBrowserAdBlockRulesGeneration || ![configuration isEqual:BrowserFilterConfiguration()]) {
            completion(nil,nil,BrowserFilterError(3,@"Filter preparation was superseded.")); return;
        }
        NSError *error=nativeError ?: runtimeError;
        completion(error ? nil : readyRules,error ? nil : readyRuntime,error);
    };
    NSDictionary *last=[NSDictionary dictionaryWithContentsOfURL:[BrowserFilterCacheDirectory(@"BrowserContentRules") URLByAppendingPathComponent:@"LastSuccessfulFilters.plist"]];
    if (BrowserAdBlockSourceEnabled(@"ubo") && [last[@"configuration"] isEqual:configuration] && [last[@"native"] isKindOfClass:NSDictionary.class]) {
        nativePending++;
        BrowserLookUpAdBlockManifest(last[@"native"][policy],^(NSArray *rules,__unused NSError *error) {
            nativePending--;
            if (nativeDone) return;
            if (rules) { readyRules=rules; nativeError=nil; nativeDone=YES; }
            else if (!nativePending) nativeDone=YES;
            finish();
        });
    }
    BrowserLoadNativeRules(policy,BrowserAdBlockSourceEnabled(@"ubo"),^(NSArray *rules,NSError *error) {
        nativePending--;
        if (nativeDone) return;
        if (rules && !error) { readyRules=rules; nativeError=nil; nativeDone=YES; }
        else { nativeError=error ?: BrowserFilterError(2,@"Early native protection is unavailable."); nativeDone=nativePending==0; }
        finish();
    });
    BrowserRestoreLastGoodRuntime(^(NSDictionary *runtime) {
        runtimePending--;
        if (runtimeDone) return;
        if (runtime) { readyRuntime=runtime; runtimeError=nil; runtimeDone=YES; }
        else if (!runtimePending) { runtimeError=BrowserFilterError(2,@"Early filter runtime is unavailable."); runtimeDone=YES; }
        finish();
    });
    BrowserLoadUBlockRuntime(^(NSDictionary *runtime) {
        runtimePending--;
        if (runtimeDone) return;
        if (runtime && [sBrowserNetworkSummary[@"available"] boolValue] && [sRuntimeConfiguration isEqual:configuration]) { readyRuntime=runtime; runtimeError=nil; runtimeDone=YES; }
        else { runtimeError=BrowserFilterError(2,@"Early filter runtime is unavailable."); runtimeDone=runtimePending==0; }
        finish();
    });
}

+ (NSString *)dynamicAdBlockPolicyForHost:(NSString *)host {
    return [BrowserAdBlockPolicy validatedPolicies:[NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockDynamicSitePolicies"]][host] ?: @"inherit";
}

+ (NSString *)effectiveDynamicAdBlockPolicyForHost:(NSString *)host {
    return [BrowserAdBlockPolicy effectivePolicyForHost:host policies:[NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockDynamicSitePolicies"]];
}

+ (void)setDynamicAdBlockPolicy:(NSString *)policy forHost:(NSString *)host {
    NSMutableDictionary *policies = [[BrowserAdBlockPolicy validatedPolicies:[NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockDynamicSitePolicies"]] mutableCopy];
    if ([policy isEqual:@"inherit"]) [policies removeObjectForKey:host];
    else {
        if (![BrowserAdBlockPolicy validatedPolicies:@{host:policy}].count) return;
        policies[host] = policy;
    }
    [NSUserDefaults.standardUserDefaults setObject:policies forKey:@"AdBlockDynamicSitePolicies"];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil userInfo:@{@"explicitReload":@YES}];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
}

+ (NSArray<NSDictionary<NSString *, NSString *> *> *)adBlockSources {
    return BrowserAdBlockSources();
}

+ (BOOL)adBlockSourceEnabled:(NSString *)identifier {
    return BrowserAdBlockSourceEnabled(identifier);
}

+ (void)setAdBlockSource:(NSString *)identifier enabled:(BOOL)enabled {
    BOOL known = NO;
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if ([source[@"id"] isEqualToString:identifier]) known = YES;
    }
    if (!known || BrowserAdBlockSourceEnabled(identifier) == enabled) return;
    [NSUserDefaults.standardUserDefaults setBool:enabled forKey:
        [kBrowserAdBlockSourceEnabledKeyPrefix stringByAppendingString:identifier]];
    sBrowserAdBlockRulesGeneration++;
    [BrowserNetworkFilterEngine cancelPreparation];
    sBrowserAdBlockCachedPolicies = nil;
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil userInfo:@{@"explicitReload":@YES}];
}

+ (NSString *)adBlockSourceStatus:(NSString *)identifier {
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (![source[@"id"] isEqualToString:identifier]) continue;
        if ([identifier isEqualToString:@"ubo"]) {
            NSData *data = [NSData dataWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"uassets-pin" withExtension:@"json"]];
            NSDictionary *pin = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            NSString *date = [pin[@"retrieved"] isKindOfClass:NSString.class] ? pin[@"retrieved"] : nil;
            return date.length ? [@"Pinned " stringByAppendingString:date] : @"Pinned";
        }
        if ([identifier isEqualToString:@"custom"]) return @"Local";
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:
            BrowserAdBlockSourceURL(source).path error:nil];
        NSDate *date = attributes[NSFileModificationDate];
        NSString *revision = date == nil ? nil : BrowserAdBlockSourceRevision(BrowserAdBlockSourceURL(source));
        if ([sBrowserAdBlockCheckingSources containsObject:identifier]) {
            return revision == nil ? @"Updating" : [NSString stringWithFormat:@"%@ · Updating", revision];
        }
        if ([sBrowserAdBlockFailedSources containsObject:identifier]) {
            return revision == nil ? @"Update failed" : [NSString stringWithFormat:@"%@ · Update failed", revision];
        }
        if ([sBrowserAdBlockRuleFailures containsObject:identifier]) {
            return revision == nil ? @"Rule error" : [NSString stringWithFormat:@"%@ · Rule error", revision];
        }
        if (date == nil) return @"Not downloaded";
        if (revision != nil) return revision;
        NSDateFormatter *formatter = [NSDateFormatter new];
        formatter.dateStyle = NSDateFormatterShortStyle;
        return [NSString stringWithFormat:@"Updated %@", [formatter stringFromDate:date]];
    }
    return @"Unknown source";
}

+ (NSString *)adBlockUserFilters {
    return [NSUserDefaults.standardUserDefaults stringForKey:kBrowserAdBlockUserFiltersKey] ?: @"";
}

+ (void)rebuildFilters {
    NSString *identity = NSUUID.UUID.UUIDString;
    [NSUserDefaults.standardUserDefaults setObject:identity forKey:@"AdBlockRebuildIdentity"];
    [NSUserDefaults.standardUserDefaults setObject:identity forKey:@"AdBlockRebuildPendingApply"];
    sBrowserAdBlockRulesGeneration++;
    [BrowserNetworkFilterEngine cancelPreparation];
    sBrowserAdBlockCachedPolicies = nil;
    sFilterBakePending = YES;
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
}

+ (void)refreshAdBlockSources {
    BrowserCheckForAdBlockUpdate(YES);
}

+ (void)setSiteEnabled:(BOOL)enabled forURL:(NSURL *)URL {
    NSString *host = BrowserAdBlockHost(URL);
    if (host.length == 0) return;
    NSMutableArray *sites = [[NSUserDefaults.standardUserDefaults arrayForKey:kBrowserAdBlockTrustedSitesKey] mutableCopy] ?: [NSMutableArray array];
    // Re-enabling an inherited exception removes the matching parent choice.
    NSIndexSet *matching = [sites indexesOfObjectsPassingTest:^BOOL(NSString *site, NSUInteger index, BOOL *stop) {
        return [host isEqualToString:site] || [host hasSuffix:[@"." stringByAppendingString:site]];
    }];
    [sites removeObjectsAtIndexes:matching];
    if (!enabled) [sites addObject:host];
    [NSUserDefaults.standardUserDefaults setObject:sites forKey:kBrowserAdBlockTrustedSitesKey];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil userInfo:@{@"explicitReload":@YES}];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
}


+ (NSUInteger)generation { return sBrowserAdBlockRulesGeneration; }
+ (BOOL)runtimeCurrent { NSString *identity=BrowserAdBlockFilterIdentifier(YES); return sBrowserUBlockRuntime && [sBrowserUBlockRuntimeIdentifier isEqual:identity] && [sBrowserNetworkSummary[@"available"] boolValue] && [sBrowserNetworkSummary[@"identity"] isEqual:identity] && ![sBrowserNetworkSummary[@"stale"] boolValue]; }
+ (NSDictionary *)runtime { return sBrowserUBlockRuntime; }
+ (NSString *)runtimeIdentifier { return sBrowserUBlockRuntimeIdentifier; }
+ (NSDictionary *)statistics { return sBrowserUBlockStatistics; }
+ (NSDictionary *)networkSummary { return sBrowserNetworkSummary; }
+ (NSDictionary *)lastFilterBake { return [NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockLastSuccessfulBake"]; }
+ (void)recordCompletedPreparationSince:(NSTimeInterval)started {
    if (!sFilterBakePending || [sBrowserNetworkSummary[@"stale"] boolValue] || ![sBrowserNetworkSummary[@"available"] boolValue] || ![sBrowserNetworkSummary[@"identity"] isEqual:BrowserAdBlockFilterIdentifier(YES)] || !sBrowserUBlockRuntime || self.nativePreparationFailed ||
        ![sBrowserUBlockRuntimeIdentifier isEqualToString:BrowserAdBlockFilterIdentifier(YES)]) return;
    sFilterBakePending = NO;
    NSDictionary *networkPointer=[NSDictionary dictionaryWithContentsOfURL:[BrowserFilterCacheDirectory(@"BrowserNetworkRules") URLByAppendingPathComponent:@"LastGood.plist"]];
    if (sRuntimeSnapshotPersisted && sRuntimeSnapshotURL && sLatestNativeManifests.count && [networkPointer[@"identity"] isEqual:BrowserAdBlockFilterIdentifier(YES)] && [networkPointer[@"configuration"] isEqual:BrowserFilterConfiguration()]) {
        NSMutableDictionary *native=[NSMutableDictionary dictionary];
        for (NSString *policy in sLatestNativeManifests) {
            NSDictionary *manifest=sLatestNativeManifests[policy];
            if ([manifest[@"identifier"] isEqual:BrowserAdBlockRuleListIdentifier(YES,policy)]) native[policy]=manifest;
        }
        NSDictionary *pointer=@{@"format":@1,@"configuration":BrowserFilterConfiguration(),@"identity":BrowserAdBlockFilterIdentifier(YES),@"extendedFile":sRuntimeSnapshotURL.lastPathComponent,@"extendedFingerprint":BrowserExtendedFingerprint(),@"native":native};
        [pointer writeToURL:[BrowserFilterCacheDirectory(@"BrowserContentRules") URLByAppendingPathComponent:@"LastSuccessfulFilters.plist"] atomically:YES];
    }
    if (sFilterPreparationStarted > 0) started = MIN(started, sFilterPreparationStarted);
    NSTimeInterval duration = MAX(0, NSProcessInfo.processInfo.systemUptime - started);
    NSDate *completed = NSDate.date;
    NSDictionary *bake = @{@"completedAt":completed, @"startedAt":[completed dateByAddingTimeInterval:-duration],
        @"duration":@(duration), @"identity":BrowserAdBlockFilterIdentifier(YES),
        @"stages":[sFilterStageDurations copy] ?: @{}};
    [NSUserDefaults.standardUserDefaults setObject:bake forKey:@"AdBlockLastSuccessfulBake"];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
}

+ (BOOL)explicitRebuildReadyToApply {
    NSString *pending = [NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockRebuildPendingApply"];
    return pending.length && [pending isEqualToString:[NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockRebuildIdentity"]] &&
        [self.lastFilterBake[@"identity"] isEqualToString:BrowserAdBlockFilterIdentifier(YES)] &&
        [sBrowserUBlockRuntimeIdentifier isEqualToString:BrowserAdBlockFilterIdentifier(YES)] &&
        [sBrowserNetworkSummary[@"available"] boolValue] && !self.nativePreparationFailed;
}
+ (void)recordFiltersAppliedToPage {
    NSMutableDictionary *bake = [self.lastFilterBake mutableCopy];
    NSDate *started = bake[@"startedAt"];
    if (![started isKindOfClass:NSDate.class] || bake[@"appliedDuration"] ||
        ![bake[@"identity"] isEqualToString:BrowserAdBlockFilterIdentifier(YES)]) return;
    bake[@"appliedDuration"] = @(MAX(0, -started.timeIntervalSinceNow));
    [NSUserDefaults.standardUserDefaults setObject:bake forKey:@"AdBlockLastSuccessfulBake"];
    [NSUserDefaults.standardUserDefaults removeObjectForKey:@"AdBlockRebuildPendingApply"];
    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
}

+ (BOOL)nativePreparationFailed { return sBrowserAdBlockRuleFailures.count > 0; }
+ (void)matchRequest:(NSDictionary *)details completion:(void (^)(NSDictionary *))completion {
    [BrowserNetworkFilterEngine matchRequest:details hostRules:BrowserDynamicHostRules()
        urlRules:[NSUserDefaults.standardUserDefaults stringForKey:@"AdBlockDynamicURLRules"] ?: @"" completion:completion];
}
+ (BOOL)applyNativeRules:(NSArray *)rules toController:(id)controller replacing:(NSArray *)previous {
    if ([rules isEqualToArray:previous]) return YES;
    SEL add=NSSelectorFromString(@"addContentRuleList:"),remove=NSSelectorFromString(@"removeContentRuleList:");
    if ((rules.count && ![controller respondsToSelector:add]) || (previous.count && ![controller respondsToSelector:remove])) return NO;
    if (!sInstalledNativeRules) sInstalledNativeRules=[NSMutableDictionary dictionary];
    NSMutableSet *oldIDs=[NSMutableSet set],*newIDs=[NSMutableSet set];
    for (id rule in previous) { NSString *identifier=[rule valueForKey:@"identifier"]; if (identifier) [oldIDs addObject:identifier]; }
    for (id rule in rules) { NSString *identifier=[rule valueForKey:@"identifier"]; if (identifier) [newIDs addObject:identifier]; }
    // Install replacements first, retaining every unchanged content-addressed
    // list (including the early bundled list) throughout the handoff.
    NSMutableSet *added=[NSMutableSet set];
    for (id rule in rules) {
        NSString *identifier=[rule valueForKey:@"identifier"];
        if (!identifier || [oldIDs containsObject:identifier] || [added containsObject:identifier]) continue;
        ((void (*)(id,SEL,id))objc_msgSend)(controller,add,rule); [added addObject:identifier];
        sInstalledNativeRules[identifier]=@([sInstalledNativeRules[identifier] unsignedIntegerValue]+1);
    }
    NSMutableSet *removed=[NSMutableSet set];
    for (id rule in previous) {
        NSString *identifier=[rule valueForKey:@"identifier"];
        if (!identifier || [newIDs containsObject:identifier] || [removed containsObject:identifier]) continue;
        ((void (*)(id,SEL,id))objc_msgSend)(controller,remove,rule); [removed addObject:identifier];
        NSUInteger count=[sInstalledNativeRules[identifier] unsignedIntegerValue];
        if (count>1) sInstalledNativeRules[identifier]=@(count-1); else [sInstalledNativeRules removeObjectForKey:identifier];
    }
    return YES;
}
@end
