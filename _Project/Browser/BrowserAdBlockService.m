#import "BrowserAdBlockService.h"
#import "BrowserAdBlockPolicy.h"
#import "BrowserPreferencesStore.h"
#import <objc/message.h>

@interface BrowserAdBlockConverter : NSObject
+ (NSDictionary *)convertRules:(NSString *)source;
+ (NSDictionary *)compileUBlockLists:(NSArray *)lists;
@end

@interface BrowserNetworkFilterEngine : NSObject
+ (void)prepareLists:(NSArray *)lists identity:(NSString *)identity completion:(void (^)(NSDictionary *))completion;
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

static void BrowserPruneNativeRules(id store, NSURL *directory) {
    SEL list = NSSelectorFromString(@"getAvailableContentRuleListIdentifiers:"), remove = NSSelectorFromString(@"removeContentRuleListForIdentifier:completionHandler:");
    if (sNativeLoads || ![store respondsToSelector:list] || ![store respondsToSelector:remove]) return;
    NSUInteger generation = sBrowserAdBlockRulesGeneration;
    ((void (*)(id, SEL, id))objc_msgSend)(store, list, ^(NSArray *identifiers) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (sNativeLoads || generation != sBrowserAdBlockRulesGeneration) return;
            NSMutableSet *keep = [NSMutableSet setWithArray:sInstalledNativeRules.allKeys ?: @[]];
            for (NSString *name in @[@"CompiledRulesManifest.plist", @"CompiledRulesManifest-allow.plist", @"CompiledRulesManifest-block.plist"]) {
                NSDictionary *manifest = [NSDictionary dictionaryWithContentsOfURL:[directory URLByAppendingPathComponent:name]];
                NSString *identity = manifest[@"identifier"]; NSUInteger count = [manifest[@"chunkCount"] unsignedIntegerValue];
                if (![identity isKindOfClass:NSString.class] || count > 1000) continue;
                for (NSUInteger i = 0; i < count; i++) [keep addObject:[identity stringByAppendingFormat:@"-%lu", (unsigned long)i]];
            }
            for (NSString *identifier in identifiers) {
                if (![identifier hasPrefix:@"BrowserAdBlock-v"] || [keep containsObject:identifier]) continue;
                ((void (*)(id, SEL, id, id))objc_msgSend)(store, remove, identifier, ^(__unused NSError *error) {});
            }
        });
    });
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

static NSArray<NSString *> *BrowserAdBlockRuleChunks(BOOL includeOnlineHosts, NSString *dynamicPolicy,
    NSMutableArray<NSString *> *sourceIDs, NSMutableSet<NSString *> *failedSources) {
    NSString *baseIdentity = BrowserAdBlockFilterIdentifier(includeOnlineHosts);
    NSURL *baseCacheURL = [[[[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject
        URLByAppendingPathComponent:@"BrowserContentRules" isDirectory:YES] URLByAppendingPathComponent:@"ConvertedRules.plist"];
    NSDictionary *cached = [NSDictionary dictionaryWithContentsOfURL:baseCacheURL];
    NSArray *cachedChunks = cached[@"chunks"], *cachedSources = cached[@"sources"];
    BOOL validCache = [cached[@"identifier"] isEqual:baseIdentity] &&
        [cached[@"format"] isEqual:@"individual-dns-v1"] && [cachedChunks isKindOfClass:NSArray.class] &&
        [cachedSources isKindOfClass:NSArray.class] && cachedChunks.count == cachedSources.count;
    if (validCache) {
        for (id value in cachedChunks) if (![value isKindOfClass:NSString.class]) { validCache = NO; break; }
        for (id value in cachedSources) if (![value isKindOfClass:NSString.class]) { validCache = NO; break; }
    }
    NSMutableArray<NSString *> *chunks;
    if (validCache) {
        chunks = [cachedChunks mutableCopy]; [sourceIDs addObjectsFromArray:cachedSources];
    } else {
    NSMutableOrderedSet<NSString *> *domains = [NSMutableOrderedSet orderedSet];
    if (includeOnlineHosts && BrowserAdBlockSourceEnabled(@"dns")) {
        BrowserAddAdBlockHosts(domains, [NSString stringWithContentsOfURL:BrowserAdBlockOnlineHostsURL()
                                                                 encoding:NSUTF8StringEncoding error:nil]);
    }
    chunks = [NSMutableArray array];
    NSMutableArray<NSDictionary *> *rules = [NSMutableArray arrayWithCapacity:25000];
    NSCharacterSet *invalidCharacters = [[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyz0123456789.-"] invertedSet];
    for (NSString *domain in domains) {
        if ([domain rangeOfCharacterFromSet:invalidCharacters].location != NSNotFound) continue;
        NSString *escapedDomain = [domain stringByReplacingOccurrencesOfString:@"." withString:@"\\."];
        NSString *URLFilter = [NSString stringWithFormat:@"^https?://([a-z0-9-]+\\.)*%@(:[0-9]+)?/", escapedDomain];
        [rules addObject:@{
            @"trigger": @{
                @"url-filter": URLFilter,
                @"load-type": @[@"third-party"]
            },
            @"action": @{@"type": @"block"}
        }];
        if (rules.count == 25000) {
            NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:0 error:nil];
            if (data == nil) return nil;
            [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
            [sourceIDs addObject:@"dns"];
            [rules removeAllObjects];
        }
    }
    if (rules.count > 0) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:0 error:nil];
        if (data == nil) return nil;
        [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
        [sourceIDs addObject:@"dns"];
    }
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        if ([source[@"id"] isEqualToString:@"dns"] || !BrowserAdBlockSourceEnabled(source[@"id"])) continue;
        @autoreleasepool {
            NSString *filter = BrowserAdBlockSourceText(source);
            if (filter.length == 0) continue;
            NSDictionary *converted = [BrowserAdBlockConverter convertRules:filter];
            if ([converted[@"rules"] integerValue] == 0 && [converted[@"advanced"] integerValue] > 0) continue;
            NSString *json = converted[@"json"];
            if (![json isKindOfClass:NSString.class] || json.length == 0) {
                [failedSources addObject:source[@"id"]];
                BrowserLog(@"[AdBlock] source=%@ conversion failed", source[@"id"]);
                continue;
            }
            [chunks addObject:json];
            [sourceIDs addObject:source[@"id"]];
            BrowserLog(@"[AdBlock] source=%@ rules=%ld advanced=%ld discarded=%ld errors=%ld", source[@"id"],
                  (long)[converted[@"rules"] integerValue], (long)[converted[@"advanced"] integerValue],
                  (long)[converted[@"discarded"] integerValue], (long)[converted[@"errors"] integerValue]);
        }
    }
    if (failedSources.count == 0) {
        [@{@"identifier":baseIdentity, @"format":@"individual-dns-v1", @"chunks":chunks, @"sources":sourceIDs}
            writeToURL:baseCacheURL atomically:YES];
    }
    }
    NSArray *dynamic = [BrowserAdBlockPolicy nativeRulesForPolicy:dynamicPolicy];
    if (dynamic.count && chunks.count == 0) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:dynamic options:0 error:nil];
        if (!data) return nil;
        [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
        [sourceIDs addObject:@"dynamic"];
    } else if (dynamic.count) {
        for (NSUInteger index = 0; index < chunks.count; index++) {
            NSData *data = [chunks[index] dataUsingEncoding:NSUTF8StringEncoding];
            NSArray *parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            if (![parsed isKindOfClass:NSArray.class]) return nil;
            NSMutableArray *combined = [parsed mutableCopy]; [combined addObjectsFromArray:dynamic];
            NSData *output = [NSJSONSerialization dataWithJSONObject:combined options:0 error:nil];
            if (!output) return nil;
            chunks[index] = [[NSString alloc] initWithData:output encoding:NSUTF8StringEncoding];
        }
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

static void BrowserCompileAdBlockChunks(id store, NSString *identifier, NSArray<NSString *> *chunks,
    NSArray<NSString *> *sourceIDs, NSMutableSet<NSString *> *failedSources,
    void (^completion)(NSArray *ruleLists, NSSet<NSString *> *failedSources, NSError *error)) {
    SEL lookupSelector = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
    SEL compileSelector = NSSelectorFromString(@"compileContentRuleListForIdentifier:encodedContentRuleList:completionHandler:");
    NSMutableArray *ruleLists = [NSMutableArray arrayWithCapacity:chunks.count];
    for (NSUInteger index = 0; index < chunks.count; index++) [ruleLists addObject:NSNull.null];
    __block NSError *lastError = nil;
    __block NSUInteger nextIndex = 0, active = 0, remaining = chunks.count;
    __block void (^startNext)(void);
    startNext = ^{
        // WebKit owns the worker threads. Keep at most 14 independent chunk
        // requests in flight, then refill a slot whenever one completes.
        while (active < 14 && nextIndex < chunks.count) {
            NSUInteger index = nextIndex++;
            active++;
            NSString *chunkIdentifier = [identifier stringByAppendingFormat:@"-%lu", (unsigned long)index];
            void (^finishChunk)(id, NSError *) = ^(id ruleList, NSError *error) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (ruleList == nil) {
                        NSString *sourceID = sourceIDs[index];
                        [failedSources addObject:sourceID];
                        lastError = error;
                        BrowserLog(@"[AdBlock] source=%@ chunk=%lu compile failed: %@",
                              sourceID, (unsigned long)index, error.localizedDescription ?: @"unknown error");
                    } else {
                        ruleLists[index] = ruleList;
                    }
                    active--;
                    remaining--;
                    if (remaining == 0) {
                        NSMutableArray *successful = [NSMutableArray arrayWithCapacity:ruleLists.count];
                        for (id value in ruleLists) if (value != NSNull.null) [successful addObject:value];
                        completion(successful.count > 0 || failedSources.count == 0 ? [successful copy] : nil,
                                   [failedSources copy], lastError);
                        startNext = nil;
                    } else {
                        startNext();
                    }
                });
            };
            void (^compileChunk)(void) = ^{
                ((void (*)(id, SEL, NSString *, NSString *, void (^)(id, NSError *)))objc_msgSend)(
                    store, compileSelector, chunkIdentifier, chunks[index], finishChunk);
            };
            if ([store respondsToSelector:lookupSelector]) {
                ((void (*)(id, SEL, NSString *, void (^)(id, NSError *)))objc_msgSend)(
                    store, lookupSelector, chunkIdentifier, ^(id ruleList, NSError *error) {
                        (void)error;
                        if (ruleList != nil) finishChunk(ruleList, nil);
                        else dispatch_async(dispatch_get_main_queue(), compileChunk);
                    });
            } else {
                compileChunk();
            }
        }
    };
    if (remaining == 0) { completion(@[], [failedSources copy], nil); return; }
    startNext();
}

// A manifest lets us look up compiled chunks before parsing or converting filters.
// Only complete, successful compilations are eligible for this fast path.
static void BrowserLookUpAdBlockManifest(id store, NSURL *manifestURL, NSString *identifier,
                                       BrowserAdBlockRuleListCompletion completion) {
    NSDictionary *manifest = [NSDictionary dictionaryWithContentsOfURL:manifestURL];
    SEL lookupSelector = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
    id storedIdentifier = manifest[@"identifier"];
    id storedCount = manifest[@"chunkCount"];
    if (![storedIdentifier isKindOfClass:NSString.class] ||
        ![storedIdentifier isEqualToString:identifier] ||
        ![storedCount isKindOfClass:NSNumber.class] ||
        ![store respondsToSelector:lookupSelector]) {
        completion(nil, nil);
        return;
    }
    NSInteger count = [storedCount integerValue];
    if (count <= 0 || count > 1024) {
        completion(nil, nil);
        return;
    }
    NSMutableArray *ruleLists = [NSMutableArray arrayWithCapacity:(NSUInteger)count];
    for (NSInteger index = 0; index < count; index++) [ruleLists addObject:NSNull.null];
    __block NSInteger remaining = count;
    __block BOOL missingChunk = NO;
    for (NSInteger index = 0; index < count; index++) {
        NSString *chunkIdentifier = [identifier stringByAppendingFormat:@"-%lu", (unsigned long)index];
        ((void (*)(id, SEL, NSString *, void (^)(id, NSError *)))objc_msgSend)(
            store, lookupSelector, chunkIdentifier, ^(id ruleList, NSError *error) {
                (void)error;
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (ruleList != nil) ruleLists[(NSUInteger)index] = ruleList;
                    else missingChunk = YES;
                    remaining--;
                    if (remaining == 0) completion(missingChunk ? nil : [ruleLists copy], nil);
                });
            });
    }
}

void BrowserLoadAdBlockRuleList(NSString *dynamicPolicy, BrowserAdBlockRuleListCompletion completion) {
    // A view chooses a fixed variant from its top-page policy. Each variant
    // appends its action to every chunk, avoiding cross-chunk allow leaks and
    // unsupported intersections of WebKit top-URL conditions. Noop uses base
    // static chunks, so it never clears static protection.
    dynamicPolicy = [@[@"allow", @"block"] containsObject:dynamicPolicy] ? dynamicPolicy : @"standard";
    if (!sBrowserAdBlockCachedPolicies) sBrowserAdBlockCachedPolicies = [NSMutableDictionary dictionary];
    NSMutableDictionary *state = sBrowserAdBlockCachedPolicies[dynamicPolicy];
    if (!state) { state = [NSMutableDictionary dictionary]; sBrowserAdBlockCachedPolicies[dynamicPolicy] = state; }
    if (state[@"rules"]) { sBrowserAdBlockRuleFailures = [NSSet set]; completion(state[@"rules"], nil); return; }
    NSMutableArray *pendingCompletions = state[@"callbacks"];
    if (!pendingCompletions) { pendingCompletions = [NSMutableArray array]; state[@"callbacks"] = pendingCompletions; }
    Class storeClass = NSClassFromString(@"WKContentRuleListStore");
    SEL customStoreSelector = NSSelectorFromString(@"storeWithURL:");
    SEL compileSelector = NSSelectorFromString(@"compileContentRuleListForIdentifier:encodedContentRuleList:completionHandler:");
    NSURL *cacheURL = [[[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject
        URLByAppendingPathComponent:@"BrowserContentRules" isDirectory:YES];
    NSError *directoryError = nil;
    if (cacheURL != nil) {
        [[NSFileManager defaultManager] createDirectoryAtURL:cacheURL
                                  withIntermediateDirectories:YES attributes:nil error:&directoryError];
    }
    id store = cacheURL != nil && directoryError == nil && storeClass != Nil && [storeClass respondsToSelector:customStoreSelector]
        ? ((id (*)(id, SEL, NSURL *))objc_msgSend)((id)storeClass, customStoreSelector, cacheURL) : nil;
    if (store == nil || ![store respondsToSelector:compileSelector]) {
        NSError *error = [NSError errorWithDomain:@"BrowserAdBlock" code:1
                                        userInfo:@{NSLocalizedDescriptionKey: directoryError.localizedDescription ?: @"WebKit content rule lists are unavailable on this device."}];
        completion(nil, error);
        return;
    }
    if (pendingCompletions == nil) {
        pendingCompletions = [NSMutableArray array];
    }
    [pendingCompletions addObject:[completion copy]];
    if ([state[@"compiling"] boolValue]) {
        return;
    }
    state[@"compiling"] = @YES;
    BrowserBeginFilterPreparation();
    sNativeLoads++;
    NSUInteger generation = sBrowserAdBlockRulesGeneration;
    BOOL includeOnlineHosts = NO;
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        if (BrowserAdBlockSourceEnabled(source[@"id"]) &&
            [NSFileManager.defaultManager fileExistsAtPath:BrowserAdBlockSourceURL(source).path]) {
            includeOnlineHosts = YES;
            break;
        }
    }
    NSString *identifier = BrowserAdBlockRuleListIdentifier(includeOnlineHosts, dynamicPolicy);
    NSURL *manifestURL = [cacheURL URLByAppendingPathComponent:[dynamicPolicy isEqual:@"standard"] ? @"CompiledRulesManifest.plist" : [NSString stringWithFormat:@"CompiledRulesManifest-%@.plist", dynamicPolicy]];
    void (^finishLoading)(NSArray *, NSSet<NSString *> *, NSError *) =
        ^(NSArray *ruleLists, NSSet<NSString *> *ruleFailures, NSError *error) {
        sNativeLoads--;
        if (generation != sBrowserAdBlockRulesGeneration ||
            ![identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts, dynamicPolicy)]) {
            state[@"compiling"] = @NO;
            NSArray *callbacks = [pendingCompletions copy];
            [pendingCompletions removeAllObjects];
            for (id callbackObject in callbacks) BrowserLoadAdBlockRuleList(dynamicPolicy, callbackObject);
            return;
        }
        sBrowserAdBlockRuleFailures = ruleFailures;
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        if (ruleLists && !error && ruleFailures.count == 0) state[@"rules"] = ruleLists;
        state[@"compiling"] = @NO;
        NSArray *callbacks = [pendingCompletions copy];
        [pendingCompletions removeAllObjects];
        for (id callbackObject in callbacks) {
            BrowserAdBlockRuleListCompletion callback = callbackObject;
            callback(ruleLists, error);
        }
        if (ruleLists && !error && !ruleFailures.count) BrowserPruneNativeRules(store, cacheURL);
    };
    BrowserLookUpAdBlockManifest(store, manifestURL, identifier, ^(NSArray *cachedRuleLists, NSError *error) {
        (void)error;
        if (cachedRuleLists != nil) {
            BrowserLog(@"[AdBlock] restored %lu compiled chunks without filter conversion", (unsigned long)cachedRuleLists.count);
            finishLoading(cachedRuleLists, [NSSet set], nil);
            return;
        }
        sFilterBakePending = YES;
        NSTimeInterval conversionStarted = NSProcessInfo.processInfo.systemUptime;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSMutableArray<NSString *> *sourceIDs = [NSMutableArray array];
            NSMutableSet<NSString *> *failedSources = [NSMutableSet set];
            NSArray<NSString *> *chunks = BrowserAdBlockRuleChunks(includeOnlineHosts, dynamicPolicy, sourceIDs, failedSources);
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation != sBrowserAdBlockRulesGeneration ||
                    ![identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts, dynamicPolicy)]) {
                    finishLoading(nil, [NSSet set], nil);
                    return;
                }
                if (chunks == nil) {
                    NSError *preparationError = [NSError errorWithDomain:@"BrowserAdBlock" code:2
                        userInfo:@{NSLocalizedDescriptionKey: @"Ad Block rules could not be prepared."}];
                    finishLoading(nil, [failedSources copy], preparationError);
                    return;
                }
                sFilterStageDurations[@"nativeConversion"] = @(NSProcessInfo.processInfo.systemUptime - conversionStarted);
                NSTimeInterval webKitStarted = NSProcessInfo.processInfo.systemUptime;
                BrowserCompileAdBlockChunks(store, identifier, chunks, sourceIDs, failedSources,
                    ^(NSArray *ruleLists, NSSet<NSString *> *ruleFailures, NSError *compileError) {
                    if (generation == sBrowserAdBlockRulesGeneration)
                        sFilterStageDurations[@"nativeWebKit"] = @(NSProcessInfo.processInfo.systemUptime - webKitStarted);
                    if (generation == sBrowserAdBlockRulesGeneration &&
                        [identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts, dynamicPolicy)] &&
                        ruleFailures.count == 0 && ruleLists.count > 0 && ruleLists.count == chunks.count) {
                        [@{@"identifier": identifier, @"chunkCount": @(chunks.count)}
                            writeToURL:manifestURL atomically:YES];
                    }
                    finishLoading(ruleLists, ruleFailures, compileError);
                });
            });
        });
    });
}

void BrowserLoadUBlockRuntime(void (^completion)(NSDictionary *)) {
    NSString *identifier = BrowserAdBlockFilterIdentifier(YES);
    if (sBrowserUBlockRuntime && [identifier isEqualToString:sBrowserUBlockRuntimeIdentifier]) { completion(sBrowserUBlockRuntime); return; }
    if (sBrowserUBlockPendingCallbacks) { [sBrowserUBlockPendingCallbacks addObject:[completion copy]]; return; }
    BrowserBeginFilterPreparation();
    sBrowserUBlockPendingCallbacks = [NSMutableArray arrayWithObject:[completion copy]];
    NSUInteger generation = sBrowserAdBlockRulesGeneration;
    NSMutableArray *lists = [NSMutableArray array];
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (!BrowserAdBlockSourceEnabled(source[@"id"])) continue;
        NSString *text = BrowserAdBlockSourceText(source);
        if (text.length) [lists addObject:@{@"id":source[@"id"], @"text":text, @"trusted":@([source[@"id"] isEqualToString:@"ubo"])}];
    }
    dispatch_group_t preparation = dispatch_group_create();
    dispatch_group_enter(preparation);
    dispatch_group_enter(preparation);
    __block NSDictionary *preparedNetwork;
    __block NSDictionary *preparedRuntime;
    __block NSURL *preparedDirectory;
    __block NSURL *preparedSnapshot;
    __block BOOL saved = NO;
    __block BOOL restored = NO;
    NSTimeInterval runtimeStarted = NSProcessInfo.processInfo.systemUptime;
    __block NSTimeInterval networkDuration = 0, extendedDuration = 0;
    // Each stage owns its VM/queue. Publish once both finish, retaining the
    // previous runtime until the current generation is ready.
    dispatch_group_notify(preparation, dispatch_get_main_queue(), ^{
        NSArray *callbacks = [sBrowserUBlockPendingCallbacks copy]; sBrowserUBlockPendingCallbacks = nil;
        if (generation != sBrowserAdBlockRulesGeneration || ![identifier isEqualToString:BrowserAdBlockFilterIdentifier(YES)]) {
            for (id callback in callbacks) BrowserLoadUBlockRuntime(callback);
            return;
        }
        sBrowserNetworkSummary = preparedNetwork;
        if (preparedRuntime) {
            sBrowserUBlockRuntime = preparedRuntime; sBrowserUBlockRuntimeIdentifier = identifier;
            sBrowserUBlockStatistics = preparedRuntime[@"stats"];
            if (saved) BrowserPruneSnapshots(preparedDirectory, @"extended-v", preparedSnapshot);
            if (!restored || ![preparedNetwork[@"cached"] boolValue]) sFilterBakePending = YES;
        }
        sFilterStageDurations[@"network"] = @(networkDuration);
        sFilterStageDurations[@"extended"] = @(extendedDuration);
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        if (!preparedRuntime) BrowserLog(@"[AdBlock] uBO parser/runtime unavailable");
        for (void (^callback)(NSDictionary *) in callbacks) callback(preparedRuntime ?: sBrowserUBlockRuntime);
    });
    [BrowserNetworkFilterEngine prepareLists:lists identity:identifier completion:^(NSDictionary *network) {
        preparedNetwork = network;
        networkDuration = NSProcessInfo.processInfo.systemUptime - runtimeStarted;
        BrowserLog(@"[AdBlock] network available=%d filters=%ld cached=%d snapshot=%d prepare-ms=%ld error=%ld", [network[@"available"] boolValue], (long)[network[@"count"] integerValue], [network[@"cached"] boolValue], [network[@"snapshot"] boolValue], (long)[network[@"prepareMilliseconds"] integerValue], (long)[network[@"error"] integerValue]);
        dispatch_group_leave(preparation);
    }];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        @autoreleasepool {
            CFAbsoluteTime started = CFAbsoluteTimeGetCurrent();
            NSURL *directory = [[[NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject URLByAppendingPathComponent:@"BrowserExtendedRules" isDirectory:YES] copy];
            [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:nil];
            uint64_t fingerprint = 14695981039346656037ULL;
            for (NSString *name in @[@"UBlockParser.js", @"UBlockScriptlets.json", @"UBlockRuntime.js", @"UBlockDomains.js", @"UBlockCosmetics.js", @"UBlockProcedural.js"]) {
                NSData *bytes = [NSData dataWithContentsOfURL:[NSBundle.mainBundle URLForResource:name withExtension:nil]];
                const uint8_t *p = bytes.bytes; for (NSUInteger i = 0; i < bytes.length; i++) fingerprint = (fingerprint ^ p[i]) * 1099511628211ULL;
            }
            NSURL *snapshotURL = [directory URLByAppendingPathComponent:[NSString stringWithFormat:@"extended-v3-%@-%016llx.json", identifier, fingerprint]];
            NSData *data = [NSData dataWithContentsOfURL:snapshotURL];
            NSDictionary *compiled = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            restored = [compiled isKindOfClass:NSDictionary.class] && [compiled[@"scripts"] isKindOfClass:NSDictionary.class] &&
                [compiled[@"scripts"][@"MAIN"] isKindOfClass:NSString.class] && [compiled[@"scripts"][@"ISOLATED"] isKindOfClass:NSString.class] &&
                [compiled[@"stats"] isKindOfClass:NSDictionary.class] && [compiled[@"rejected"] isKindOfClass:NSDictionary.class];
            saved = restored;
            if (!restored) {
                compiled = [BrowserAdBlockConverter compileUBlockLists:lists];
                NSData *cache = compiled ? [NSJSONSerialization dataWithJSONObject:compiled options:0 error:nil] : nil;
                saved = cache && [cache writeToURL:snapshotURL options:NSDataWritingAtomic error:nil];
            }
            preparedRuntime = compiled; preparedDirectory = directory; preparedSnapshot = snapshotURL;
            extendedDuration = NSProcessInfo.processInfo.systemUptime - runtimeStarted;
            BrowserLog(@"[AdBlock] advanced cached=%d prepare-ms=%ld", restored, (long)((CFAbsoluteTimeGetCurrent() - started) * 1000));
        }
        dispatch_group_leave(preparation);
    });
}

static NSMutableSet<NSString *> *sBrowserAdBlockCheckingSources = nil;
static NSMutableSet<NSString *> *sBrowserAdBlockFailedSources = nil;
static BOOL sBrowserAdBlockPendingDownloadChanges = NO;

static void BrowserCheckForAdBlockUpdate(BOOL force) {
    static NSMutableDictionary<NSString *, NSDate *> *lastAttempts = nil;
    if (lastAttempts == nil) lastAttempts = [NSMutableDictionary dictionary];
    if (sBrowserAdBlockCheckingSources == nil) sBrowserAdBlockCheckingSources = [NSMutableSet set];
    if (sBrowserAdBlockFailedSources == nil) sBrowserAdBlockFailedSources = [NSMutableSet set];
    NSDate *now = NSDate.date;
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        NSString *identifier = source[@"id"];
        if ([source[@"url"] length] == 0 || !BrowserAdBlockSourceEnabled(identifier) ||
            [sBrowserAdBlockCheckingSources containsObject:identifier]) continue;
        NSString *checkKey = [kBrowserAdBlockSourceLastCheckKeyPrefix stringByAppendingString:identifier];
        NSDate *lastSuccess = [NSUserDefaults.standardUserDefaults objectForKey:checkKey];
        if (!force && ((lastAttempts[identifier] != nil &&
                        [now timeIntervalSinceDate:lastAttempts[identifier]] < 3600) ||
                       (lastSuccess != nil && [now timeIntervalSinceDate:lastSuccess] < 7 * 24 * 3600))) continue;
        [sBrowserAdBlockCheckingSources addObject:identifier];
        [sBrowserAdBlockFailedSources removeObject:identifier];
        lastAttempts[identifier] = now;
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        NSURL *sourceURL = [NSURL URLWithString:source[@"url"]];
        NSURLSessionDataTask *task = [NSURLSession.sharedSession dataTaskWithURL:sourceURL
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            BOOL validResponse = error == nil && [response isKindOfClass:NSHTTPURLResponse.class] &&
                ((NSHTTPURLResponse *)response).statusCode == 200 && data.length > 10000 && data.length < 20000000;
            NSString *filter = validResponse ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
            BOOL validFilter = NO;
            if ([identifier isEqualToString:@"dns"]) {
                validFilter = BrowserAddAdBlockHosts([NSMutableOrderedSet orderedSet], filter) > 100000;
            } else {
                validFilter = filter.length > 10000 && [filter containsString:@"||"] &&
                    ([filter containsString:@"##"] || [filter containsString:@"@@"]);
            }
            BOOL updated = NO;
            BOOL saved = validFilter;
            if (validFilter) {
                NSURL *destination = BrowserAdBlockSourceURL(source);
                [NSFileManager.defaultManager createDirectoryAtURL:destination.URLByDeletingLastPathComponent
                    withIntermediateDirectories:YES attributes:nil error:nil];
                NSData *previous = [NSData dataWithContentsOfURL:destination];
                if (![previous isEqualToData:data]) {
                    saved = [data writeToURL:destination options:NSDataWritingAtomic error:nil];
                    updated = saved;
                }
            }
            dispatch_async(dispatch_get_main_queue(), ^{
                [sBrowserAdBlockCheckingSources removeObject:identifier];
                if (saved) {
                    [NSUserDefaults.standardUserDefaults setObject:NSDate.date forKey:checkKey];
                } else {
                    [sBrowserAdBlockFailedSources addObject:identifier];
                    BrowserLog(@"[AdBlock] source=%@ update failed: %@", identifier,
                          error.localizedDescription ?: @"invalid filter response");
                }
                [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
                if (updated) sBrowserAdBlockPendingDownloadChanges = YES;
                if (sBrowserAdBlockCheckingSources.count == 0 && sBrowserAdBlockPendingDownloadChanges) {
                    sBrowserAdBlockPendingDownloadChanges = NO;
                    sBrowserAdBlockRulesGeneration++;
                    sBrowserAdBlockCachedPolicies = nil;
                    [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockRulesDidUpdateNotification object:nil];
                }
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
+ (NSDictionary *)runtime { return sBrowserUBlockRuntime; }
+ (NSString *)runtimeIdentifier { return sBrowserUBlockRuntimeIdentifier; }
+ (NSDictionary *)statistics { return sBrowserUBlockStatistics; }
+ (NSDictionary *)networkSummary { return sBrowserNetworkSummary; }
+ (NSDictionary *)lastFilterBake { return [NSUserDefaults.standardUserDefaults dictionaryForKey:@"AdBlockLastSuccessfulBake"]; }
+ (void)recordCompletedPreparationSince:(NSTimeInterval)started {
    if (!sFilterBakePending || ![sBrowserNetworkSummary[@"available"] boolValue] || !sBrowserUBlockRuntime || self.nativePreparationFailed ||
        ![sBrowserUBlockRuntimeIdentifier isEqualToString:BrowserAdBlockFilterIdentifier(YES)]) return;
    sFilterBakePending = NO;
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
    SEL add = NSSelectorFromString(@"addContentRuleList:"), remove = NSSelectorFromString(@"removeContentRuleList:");
    if ((rules.count && ![controller respondsToSelector:add]) || (previous.count && ![controller respondsToSelector:remove])) return NO;
    if (!sInstalledNativeRules) sInstalledNativeRules = [NSMutableDictionary dictionary];
    for (id rule in previous) {
        ((void (*)(id, SEL, id))objc_msgSend)(controller, remove, rule);
        NSString *identifier = [rule valueForKey:@"identifier"];
        NSUInteger count = [sInstalledNativeRules[identifier] unsignedIntegerValue];
        if (count > 1) sInstalledNativeRules[identifier] = @(count - 1); else [sInstalledNativeRules removeObjectForKey:identifier];
    }
    for (id rule in rules) {
        ((void (*)(id, SEL, id))objc_msgSend)(controller, add, rule);
        NSString *identifier = [rule valueForKey:@"identifier"];
        sInstalledNativeRules[identifier] = @([sInstalledNativeRules[identifier] unsignedIntegerValue] + 1);
    }
    return YES;
}
@end
