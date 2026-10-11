#import "BrowserPreferencesStore.h"
#import "BrowserHistoryStore.h"
#import <sqlite3.h>
#import <limits.h>
#import <zlib.h>

static NSString *const DatabaseBackupKey = @"BrowserDatabaseBackupV1";
static NSString *const DatabaseBackupPendingKey = @"BrowserDatabaseBackupMutationPending";

static BOOL DatabaseIsHealthy(sqlite3 *database) {
    sqlite3_stmt *statement = NULL;
    BOOL healthy = NO;
    if (sqlite3_prepare_v2(database, "PRAGMA quick_check", -1, &statement, NULL) == SQLITE_OK &&
        sqlite3_step(statement) == SQLITE_ROW) {
        const char *result = (const char *)sqlite3_column_text(statement, 0);
        healthy = result && strcmp(result, "ok") == 0;
    }
    sqlite3_finalize(statement);
    return healthy;
}

// Validate a complete snapshot before touching the live database.
static BOOL RestoreDatabase(NSString *path) {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    if ([defaults boolForKey:DatabaseBackupPendingKey]) return NO;
    id raw = [defaults objectForKey:DatabaseBackupKey];
    if (![raw isKindOfClass:NSDictionary.class]) return NO;
    NSDictionary *backup = raw;
    id compressed = backup[@"data"];
    for (NSString *field in @[@"version", @"size", @"crc"])
        if (![backup[field] isKindOfClass:NSNumber.class]) return NO;
    NSUInteger size = [backup[@"size"] unsignedIntegerValue];
    if ([backup[@"version"] integerValue] != 1 || ![compressed isKindOfClass:NSData.class] ||
        size == 0 || size > 64 * 1024 * 1024) return NO;
    NSMutableData *data = [NSMutableData dataWithLength:size];
    uLongf length = size;
    if (uncompress(data.mutableBytes, &length, [compressed bytes], [compressed length]) != Z_OK ||
        length != size || crc32(0, data.bytes, (uInt)data.length) != [backup[@"crc"] unsignedLongValue]) return NO;
    NSString *staging = [path stringByAppendingFormat:@".restore.%@", NSUUID.UUID.UUIDString];
    if (![data writeToFile:staging options:NSDataWritingAtomic error:nil]) return NO;
    sqlite3 *check = NULL;
    BOOL valid = sqlite3_open_v2(staging.UTF8String, &check, SQLITE_OPEN_READONLY, NULL) == SQLITE_OK && DatabaseIsHealthy(check);
    sqlite3_stmt *tables = NULL;
    if (valid) {
        valid = sqlite3_prepare_v2(check, "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('visits','favorites','browser_session','session_tabs','tab_navigation')", -1, &tables, NULL) == SQLITE_OK &&
            sqlite3_step(tables) == SQLITE_ROW && sqlite3_column_int(tables, 0) == 5;
    }
    sqlite3_finalize(tables);
    sqlite3_close(check);
    NSFileManager *manager = NSFileManager.defaultManager;
    if (!valid) { [manager removeItemAtPath:staging error:nil]; return NO; }
    NSString *preserved = [path stringByAppendingFormat:@".damaged.%@", NSUUID.UUID.UUIDString];
    NSMutableArray *moved = [NSMutableArray array];
    // Preserve a damaged original, including its journal, for manual recovery.
    BOOL restored = YES;
    for (NSString *suffix in @[@"", @"-wal", @"-shm", @"-journal"]) {
        NSString *source = [path stringByAppendingString:suffix];
        if (![manager fileExistsAtPath:source]) continue;
        if (![manager moveItemAtPath:source toPath:[preserved stringByAppendingString:suffix] error:nil]) {
            restored = NO; break;
        }
        [moved addObject:suffix];
    }
    if (restored) restored = [manager moveItemAtPath:staging toPath:path error:nil];
    if (!restored) {
        for (NSString *suffix in moved) [manager moveItemAtPath:[preserved stringByAppendingString:suffix]
            toPath:[path stringByAppendingString:suffix] error:nil];
        [manager removeItemAtPath:staging error:nil];
    } else BrowserLog(@"[History] Restored complete local backup at %@", path);
    return restored;
}


@interface BrowserHistoryStore ()
@property (nonatomic) sqlite3 *database;
@end

@implementation BrowserHistoryStore

+ (instancetype)sharedStore {
    static BrowserHistoryStore *store;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{ store = [BrowserHistoryStore new]; });
    return store;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        NSArray<NSNumber *> *directoryKinds = @[@(NSApplicationSupportDirectory),
                                                @(NSDocumentDirectory), @(NSCachesDirectory)];
        const char *schema = "CREATE TABLE IF NOT EXISTS visits (id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL, visited_at REAL NOT NULL);"
                             "CREATE INDEX IF NOT EXISTS visits_url ON visits(url);"
                             "CREATE INDEX IF NOT EXISTS visits_recent ON visits(visited_at DESC, id DESC);"
                             "CREATE TABLE IF NOT EXISTS favorites (position INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL);"
                             "CREATE TABLE IF NOT EXISTS browser_session (id INTEGER PRIMARY KEY CHECK(id=1), active_tab_index INTEGER NOT NULL, version INTEGER NOT NULL);"
                             "CREATE TABLE IF NOT EXISTS session_tabs (position INTEGER PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, state BLOB NOT NULL);"
                             "CREATE TABLE IF NOT EXISTS tab_navigation (tab_identifier TEXT NOT NULL, position INTEGER NOT NULL, url TEXT NOT NULL, PRIMARY KEY(tab_identifier,position));";
        NSFileManager *fileManager = [NSFileManager defaultManager];
        NSString *openedPath = nil;
        BOOL existingDatabaseFailed = NO;
        // Open an existing database before creating a new one in a preferred directory.
        for (NSUInteger pass = 0; pass < 2 && _database == NULL; pass++) {
            if (pass == 1 && existingDatabaseFailed) break;
            for (NSNumber *kind in directoryKinds) {
                NSURL *directory = [[fileManager URLsForDirectory:kind.unsignedIntegerValue
                                                        inDomains:NSUserDomainMask] firstObject];
                NSString *path = [[directory URLByAppendingPathComponent:@"BrowserHistory.sqlite"] path];
                if (path.length == 0 || [fileManager fileExistsAtPath:path] != (pass == 0)) continue;
                NSError *directoryError = nil;
                if (![fileManager createDirectoryAtURL:directory withIntermediateDirectories:YES
                                           attributes:nil error:&directoryError]) {
                    BrowserLog(@"[History] Directory %@ unavailable: %@", directory.path, directoryError);
                    continue;
                }
                BOOL exists = [fileManager fileExistsAtPath:path];
                BOOL hasBackup = [NSUserDefaults.standardUserDefaults objectForKey:DatabaseBackupKey] != nil;
                BOOL emptyFile = exists && [[fileManager attributesOfItemAtPath:path error:nil][NSFileSize] unsignedLongLongValue] == 0;
                if ((!exists || emptyFile) && hasBackup && !RestoreDatabase(path)) {
                    BrowserLog(@"[History] Backup unavailable; preserving it instead of creating an empty database");
                    continue;
                }
                BOOL opened = sqlite3_open(path.UTF8String, &_database) == SQLITE_OK;
                if (opened && !DatabaseIsHealthy(_database)) {
                    sqlite3_close(_database);
                    _database = NULL;
                    opened = RestoreDatabase(path) && sqlite3_open(path.UTF8String, &_database) == SQLITE_OK;
                }
                if (opened && sqlite3_exec(_database, schema, NULL, NULL, NULL) == SQLITE_OK) {
                    openedPath = path;
                    break;
                }
                if (exists) existingDatabaseFailed = YES;
                BrowserLog(@"[History] Cannot open or initialize %@: %s", path,
                      _database ? sqlite3_errmsg(_database) : "open failed");
                sqlite3_close(_database);
                _database = NULL;
            }
        }
        if (_database == NULL) return self;
        BrowserLog(@"[History] Opened database at %@", openedPath);
        [self migrateLegacyFavorites];
        [self syncHistoryBackup];
    }
    return self;
}

- (void)migrateLegacyFavorites {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    NSArray *legacy = [defaults arrayForKey:@"FAVORITES"];
    if ([self favorites].count == 0 && legacy.count > 0) {
        [self saveFavorites:legacy];
    } else {
        [defaults setObject:[self favorites] forKey:@"FAVORITES"];
    }
}

- (void)dealloc {
    if (_database != NULL) sqlite3_close(_database);
}

- (NSDictionary *)savedBrowserSession {
    if (self.database == NULL) return nil;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT active_tab_index,version FROM browser_session WHERE id=1",
                         -1, &statement, NULL) != SQLITE_OK) return nil;
    if (sqlite3_step(statement) != SQLITE_ROW) {
        sqlite3_finalize(statement);
        return nil;
    }
    NSNumber *activeIndex = @(sqlite3_column_int64(statement, 0));
    NSNumber *version = @(sqlite3_column_int64(statement, 1));
    sqlite3_finalize(statement);

    if (sqlite3_prepare_v2(self.database, "SELECT identifier,state FROM session_tabs ORDER BY position",
                         -1, &statement, NULL) != SQLITE_OK) return nil;
    NSMutableArray *tabs = [NSMutableArray array];
    BOOL success = YES;
    int result;
    while ((result = sqlite3_step(statement)) == SQLITE_ROW) {
        const char *identifier = (const char *)sqlite3_column_text(statement, 0);
        NSData *data = [NSData dataWithBytes:sqlite3_column_blob(statement, 1)
                                     length:sqlite3_column_bytes(statement, 1)];
        id decoded = [NSPropertyListSerialization propertyListWithData:data options:NSPropertyListMutableContainers
                                                               format:NULL error:nil];
        if (identifier == NULL || ![decoded isKindOfClass:NSDictionary.class]) {
            success = NO;
            break;
        }
        NSMutableDictionary *tab = [decoded mutableCopy];
        tab[@"identifier"] = [NSString stringWithUTF8String:identifier];
        sqlite3_stmt *navigation = NULL;
        if (sqlite3_prepare_v2(self.database,
                "SELECT url FROM tab_navigation WHERE tab_identifier=? ORDER BY position",
                -1, &navigation, NULL) != SQLITE_OK) {
            success = NO;
            break;
        }
        sqlite3_bind_text(navigation, 1, identifier, -1, SQLITE_TRANSIENT);
        NSMutableArray *URLs = [NSMutableArray array];
        int navigationResult;
        while ((navigationResult = sqlite3_step(navigation)) == SQLITE_ROW) {
            const char *URL = (const char *)sqlite3_column_text(navigation, 0);
            if (URL == NULL) { success = NO; break; }
            [URLs addObject:[NSString stringWithUTF8String:URL]];
        }
        success = success && navigationResult == SQLITE_DONE;
        sqlite3_finalize(navigation);
        if (!success) break;
        tab[@"navigationURLs"] = URLs;
        [tabs addObject:tab];
    }
    success = success && result == SQLITE_DONE;
    sqlite3_finalize(statement);
    if (!success) {
        BrowserLog(@"[Session] Cannot read SQLite session: %s", sqlite3_errmsg(self.database));
        return nil;
    }
    return @{@"version": version, @"activeTabIndex": activeIndex, @"tabs": tabs};
}

- (BOOL)saveBrowserSession:(NSDictionary *)session {
    if (self.database == NULL ||
        sqlite3_exec(self.database, "BEGIN IMMEDIATE TRANSACTION", NULL, NULL, NULL) != SQLITE_OK) return NO;
    [self beginBackupMutation];
    BOOL success = sqlite3_exec(self.database,
        "DELETE FROM tab_navigation; DELETE FROM session_tabs; DELETE FROM browser_session;",
        NULL, NULL, NULL) == SQLITE_OK;
    sqlite3_stmt *metadata = NULL, *tabStatement = NULL, *navigation = NULL;
    if (success) success = sqlite3_prepare_v2(self.database,
        "INSERT INTO browser_session (id,active_tab_index,version) VALUES (1,?,?)", -1, &metadata, NULL) == SQLITE_OK;
    if (success) {
        sqlite3_bind_int64(metadata, 1, [session[@"activeTabIndex"] longLongValue]);
        sqlite3_bind_int64(metadata, 2, [session[@"version"] longLongValue]);
        success = sqlite3_step(metadata) == SQLITE_DONE;
    }
    if (success) success = sqlite3_prepare_v2(self.database,
        "INSERT INTO session_tabs (position,identifier,state) VALUES (?,?,?)", -1, &tabStatement, NULL) == SQLITE_OK;
    if (success) success = sqlite3_prepare_v2(self.database,
        "INSERT INTO tab_navigation (tab_identifier,position,url) VALUES (?,?,?)", -1, &navigation, NULL) == SQLITE_OK;
    NSUInteger position = 0;
    for (NSDictionary *rawTab in session[@"tabs"]) {
        if (!success) break;
        NSMutableDictionary *tab = [rawTab mutableCopy];
        NSString *identifier = tab[@"identifier"] ?: NSUUID.UUID.UUIDString;
        NSArray *URLs = tab[@"navigationURLs"] ?: @[];
        [tab removeObjectForKey:@"navigationURLs"];
        tab[@"identifier"] = identifier;
        NSData *state = [NSPropertyListSerialization dataWithPropertyList:tab format:NSPropertyListBinaryFormat_v1_0
                                                                options:0 error:nil];
        if (state == nil || state.length > INT_MAX) { success = NO; break; }
        sqlite3_bind_int64(tabStatement, 1, position++);
        sqlite3_bind_text(tabStatement, 2, identifier.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_bind_blob(tabStatement, 3, state.bytes, (int)state.length, SQLITE_TRANSIENT);
        success = sqlite3_step(tabStatement) == SQLITE_DONE;
        sqlite3_reset(tabStatement);
        sqlite3_clear_bindings(tabStatement);
        NSUInteger navigationPosition = 0;
        for (NSString *URL in URLs) {
            if (!success) break;
            sqlite3_bind_text(navigation, 1, identifier.UTF8String, -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(navigation, 2, navigationPosition++);
            sqlite3_bind_text(navigation, 3, URL.UTF8String, -1, SQLITE_TRANSIENT);
            success = sqlite3_step(navigation) == SQLITE_DONE;
            sqlite3_reset(navigation);
            sqlite3_clear_bindings(navigation);
        }
    }
    sqlite3_finalize(metadata);
    sqlite3_finalize(tabStatement);
    sqlite3_finalize(navigation);
    if (success) success = sqlite3_exec(self.database, "COMMIT", NULL, NULL, NULL) == SQLITE_OK;
    if (!success) {
        BrowserLog(@"[Session] Cannot save SQLite session: %s", sqlite3_errmsg(self.database));
        sqlite3_exec(self.database, "ROLLBACK", NULL, NULL, NULL);
    }
    if (success) [self syncHistoryBackup];
    return success;
}

// Invalidate an older snapshot before a mutation that can remove user data.
// If the new snapshot cannot fit, deleted entries must never be resurrected.
- (void)beginBackupMutation {
    [NSUserDefaults.standardUserDefaults setBool:YES forKey:DatabaseBackupPendingKey];
    [NSUserDefaults.standardUserDefaults synchronize];
}

- (void)syncHistoryBackup {
    if (self.database == NULL) return;
    sqlite3 *snapshot = NULL;
    if (sqlite3_open(":memory:", &snapshot) != SQLITE_OK) { sqlite3_close(snapshot); return; }
    sqlite3_backup *copy = sqlite3_backup_init(snapshot, "main", self.database, "main");
    BOOL success = copy != NULL && sqlite3_backup_step(copy, -1) == SQLITE_DONE;
    if (copy != NULL) success = sqlite3_backup_finish(copy) == SQLITE_OK && success;
    sqlite3_int64 size = 0;
    unsigned char *bytes = success ? sqlite3_serialize(snapshot, "main", &size, 0) : NULL;
    if (bytes == NULL || size <= 0 || size > 64 * 1024 * 1024) {
        sqlite3_free(bytes); sqlite3_close(snapshot); return;
    }
    uLongf length = compressBound((uLong)size);
    NSMutableData *compressed = [NSMutableData dataWithLength:length];
    success = compress2(compressed.mutableBytes, &length, bytes, (uLong)size, Z_BEST_COMPRESSION) == Z_OK;
    NSNumber *checksum = @(crc32(0, bytes, (uInt)size));
    sqlite3_free(bytes);
    sqlite3_close(snapshot);
    if (!success) return;
    compressed.length = length;
    NSDictionary *backup = @{@"version": @1, @"size": @(size), @"crc": checksum, @"data": compressed};
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSString *domainName = NSBundle.mainBundle.bundleIdentifier;
    if (domainName.length == 0) return;
    NSMutableDictionary *domain = [[defaults persistentDomainForName:domainName] mutableCopy] ?: [NSMutableDictionary dictionary];
    domain[DatabaseBackupKey] = backup;
    [domain removeObjectForKey:DatabaseBackupPendingKey];
    [domain removeObjectForKey:@"HISTORY_BACKUP_V2"];
    [domain removeObjectForKey:@"HISTORY"];
    NSData *encoded = [NSPropertyListSerialization dataWithPropertyList:domain
        format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
    if (encoded == nil || encoded.length > 450 * 1024) {
        BrowserLog(@"[History] Local backup exceeds preferences budget; existing snapshot retained");
        return;
    }
    [defaults setObject:backup forKey:DatabaseBackupKey];
    [defaults removeObjectForKey:DatabaseBackupPendingKey];
    [defaults removeObjectForKey:@"HISTORY_BACKUP_V2"];
    [defaults removeObjectForKey:@"HISTORY"];
    if (![defaults synchronize]) BrowserLog(@"[History] Cannot synchronize local backup");
}

- (void)recordURLString:(NSString *)URLString title:(NSString *)title {
    if (self.database == NULL || URLString.length == 0) {
        if (self.database == NULL) BrowserLog(@"[History] Cannot save visit: database unavailable");
        return;
    }
    NSURL *url = [NSURL URLWithString:URLString];
    if (url.host.length == 0 || ![@[@"http", @"https"] containsObject:url.scheme.lowercaseString]) return;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "INSERT INTO visits (url,title,visited_at) VALUES (?,?,?)", -1, &statement, NULL) != SQLITE_OK) {
        BrowserLog(@"[History] Cannot prepare visit insert: %s", sqlite3_errmsg(self.database));
        return;
    }
    sqlite3_bind_text(statement, 1, URLString.UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(statement, 2, (title ?: @"").UTF8String, -1, SQLITE_TRANSIENT);
    sqlite3_bind_double(statement, 3, [NSDate date].timeIntervalSince1970);
    BOOL success = sqlite3_step(statement) == SQLITE_DONE;
    if (!success) BrowserLog(@"[History] Cannot save visit: %s", sqlite3_errmsg(self.database));
    sqlite3_finalize(statement);
    if (success) [self syncHistoryBackup];
}

- (NSArray<NSDictionary *> *)recordsForSQL:(const char *)SQL limit:(NSUInteger)limit {
    if (self.database == NULL) return @[];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, SQL, -1, &statement, NULL) != SQLITE_OK) {
        BrowserLog(@"[History] Cannot read visits: %s", sqlite3_errmsg(self.database));
        return @[];
    }
    if (limit > 0) sqlite3_bind_int64(statement, 1, (sqlite3_int64)limit);
    NSMutableArray *records = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        const char *url = (const char *)sqlite3_column_text(statement, 1);
        const char *title = (const char *)sqlite3_column_text(statement, 2);
        NSMutableDictionary *record = [@{@"id": @(sqlite3_column_int64(statement, 0)),
                                         @"url": url ? [NSString stringWithUTF8String:url] : @"",
                                         @"title": title ? [NSString stringWithUTF8String:title] : @"",
                                         @"count": @(sqlite3_column_int64(statement, 3))} mutableCopy];
        if (sqlite3_column_count(statement) > 4) record[@"visitedAt"] = @(sqlite3_column_double(statement, 4));
        [records addObject:record];
    }
    sqlite3_finalize(statement);
    return records;
}

- (NSArray<NSDictionary *> *)recentVisitsWithLimit:(NSUInteger)limit {
    return [self recordsForSQL:"SELECT v.id,v.url,v.title,counts.visits,counts.latest FROM visits v "
                               "JOIN (SELECT url,COUNT(*) visits,MAX(id) last_id,MAX(visited_at) latest FROM visits "
                               "GROUP BY url) counts "
                               "ON v.id=counts.last_id ORDER BY counts.latest DESC, v.id DESC LIMIT ?"
                        limit:limit];
}

- (NSArray<NSDictionary *> *)allVisits {
    return [self recordsForSQL:"SELECT id,url,title,1,visited_at FROM visits ORDER BY visited_at DESC,id DESC" limit:0];
}

- (void)deleteVisitsWithIdentifiers:(NSArray<NSNumber *> *)identifiers {
    if (self.database == NULL || identifiers.count == 0) return;
    if (sqlite3_exec(self.database, "BEGIN IMMEDIATE TRANSACTION", NULL, NULL, NULL) != SQLITE_OK) return;
    [self beginBackupMutation];
    sqlite3_stmt *statement = NULL;
    BOOL success = sqlite3_prepare_v2(self.database, "DELETE FROM visits WHERE id=?", -1, &statement, NULL) == SQLITE_OK;
    for (NSNumber *identifier in identifiers) {
        if (!success) break;
        sqlite3_bind_int64(statement, 1, identifier.longLongValue);
        success = sqlite3_step(statement) == SQLITE_DONE;
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
    }
    sqlite3_finalize(statement);
    if (success) success = sqlite3_exec(self.database, "COMMIT", NULL, NULL, NULL) == SQLITE_OK;
    if (!success) {
        sqlite3_exec(self.database, "ROLLBACK", NULL, NULL, NULL);
        BrowserLog(@"[History] Cannot delete visits: %s", sqlite3_errmsg(self.database));
    }
    [self syncHistoryBackup];
}

- (void)deleteVisitsForURLString:(NSString *)URLString {
    if (self.database == NULL || URLString.length == 0) return;
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "DELETE FROM visits WHERE url=?", -1, &statement, NULL) != SQLITE_OK) return;
    [self beginBackupMutation];
    sqlite3_bind_text(statement, 1, URLString.UTF8String, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(statement) != SQLITE_DONE)
        BrowserLog(@"[History] Cannot delete URL visits: %s", sqlite3_errmsg(self.database));
    sqlite3_finalize(statement);
    [self syncHistoryBackup];
}

- (void)deleteVisitsForSiteURL:(NSURL *)URL {
    if (![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString]) return;
    NSString *host = URL.host.lowercaseString;
    while ([host hasSuffix:@"."]) host = [host substringToIndex:host.length - 1];
    if (!host.length) return;
    NSMutableArray<NSNumber *> *identifiers = [NSMutableArray array];
    for (NSDictionary *visit in [self allVisits]) {
        NSString *visitHost = [NSURL URLWithString:visit[@"url"]].host.lowercaseString;
        while ([visitHost hasSuffix:@"."]) visitHost = [visitHost substringToIndex:visitHost.length - 1];
        if ([visitHost isEqualToString:host] || [visitHost hasSuffix:[@"." stringByAppendingString:host]]) {
            [identifiers addObject:visit[@"id"]];
        }
    }
    [self deleteVisitsWithIdentifiers:identifiers];
}

- (void)deleteAllVisits {
    if (self.database == NULL) return;
    [self beginBackupMutation];
    if (sqlite3_exec(self.database, "DELETE FROM visits", NULL, NULL, NULL) != SQLITE_OK)
        BrowserLog(@"[History] Cannot clear visits: %s", sqlite3_errmsg(self.database));
    [self syncHistoryBackup];
}

- (NSArray<NSArray<NSString *> *> *)favorites {
    if (self.database == NULL) return @[];
    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self.database, "SELECT url,title FROM favorites ORDER BY position", -1, &statement, NULL) != SQLITE_OK) return @[];
    NSMutableArray *items = [NSMutableArray array];
    while (sqlite3_step(statement) == SQLITE_ROW) {
        const char *url = (const char *)sqlite3_column_text(statement, 0);
        const char *title = (const char *)sqlite3_column_text(statement, 1);
        [items addObject:@[url ? [NSString stringWithUTF8String:url] : @"",
                           title ? [NSString stringWithUTF8String:title] : @""]];
    }
    sqlite3_finalize(statement);
    return items;
}

- (void)saveFavorites:(NSArray<NSArray<NSString *> *> *)favorites {
    if (self.database == NULL) return;
    if (sqlite3_exec(self.database, "BEGIN TRANSACTION", NULL, NULL, NULL) != SQLITE_OK) return;
    [self beginBackupMutation];
    BOOL success = sqlite3_exec(self.database, "DELETE FROM favorites", NULL, NULL, NULL) == SQLITE_OK;
    sqlite3_stmt *statement = NULL;
    if (success) success = sqlite3_prepare_v2(self.database,
        "INSERT INTO favorites (position,url,title) VALUES (?,?,?)", -1, &statement, NULL) == SQLITE_OK;
    NSUInteger position = 0;
    for (id raw in favorites) {
        if (!success) break;
        if (![raw isKindOfClass:NSArray.class]) continue;
        NSArray *entry = raw;
        NSString *url = entry.count > 0 && [entry[0] isKindOfClass:NSString.class] ? entry[0] : @"";
        NSString *title = entry.count > 1 && [entry[1] isKindOfClass:NSString.class] ? entry[1] : @"";
        if (url.length == 0) continue;
        sqlite3_bind_int64(statement, 1, (sqlite3_int64)position++);
        sqlite3_bind_text(statement, 2, url.UTF8String, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(statement, 3, title.UTF8String, -1, SQLITE_TRANSIENT);
        success = sqlite3_step(statement) == SQLITE_DONE;
        sqlite3_reset(statement);
        sqlite3_clear_bindings(statement);
    }
    sqlite3_finalize(statement);
    if (success) success = sqlite3_exec(self.database, "COMMIT", NULL, NULL, NULL) == SQLITE_OK;
    if (!success) sqlite3_exec(self.database, "ROLLBACK", NULL, NULL, NULL);
    else [[NSUserDefaults standardUserDefaults] setObject:[self favorites] forKey:@"FAVORITES"];
    [self syncHistoryBackup];
}

@end
