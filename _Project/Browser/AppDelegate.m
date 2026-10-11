//
//  AppDelegate.m
//  Browser
//
//  Created by Steven Troughton-Smith on 20/09/2015.
//  Improved by Jip van Akker on 14/10/2015 through 10/01/2019
//

#import "AppDelegate.h"
#import "BrowserPreferencesStore.h"
#import "BrowserTorrentKeepAlive.h"
#import "BrowserTorrentManager.h"
#import "BrowserWebView.h"
#import <BackgroundTasks/BackgroundTasks.h>

static NSString * const kTorrentProcessingTaskIdentifier = @"org.justbettercode.browser.torrent-processing";
static NSString * const kTorrentRefreshTaskIdentifier = @"org.justbettercode.browser.torrent-refresh";
static NSString * const kBackgroundProbeSummaryKey = @"BrowserBackgroundProbeSummary";
static NSTimeInterval const kBackgroundProbeInterval = 5;

@interface AppDelegate ()
@property (nonatomic) NSUInteger cookieSaveGeneration;
@property (nonatomic) BOOL torrentProcessingRegistered;
@property (nonatomic) BOOL torrentRefreshRegistered;
@property (nonatomic) BGProcessingTask *torrentProcessingTask;
@property (nonatomic) BGAppRefreshTask *torrentRefreshTask;
@property (nonatomic) NSTimer *torrentProcessingTimer;
@property (nonatomic) NSTimer *torrentRefreshTimer;
@property (nonatomic) NSTimeInterval torrentProcessingStarted;
@property (nonatomic) int64_t torrentProcessingStartBytes;
@property (nonatomic) BOOL torrentProcessingProbeOnly;
@property (nonatomic) NSTimeInterval torrentRefreshStarted;
@property (nonatomic) int64_t torrentRefreshStartBytes;
@property (nonatomic) NSTimer *backgroundProbeTimer;
@property (nonatomic) NSTimeInterval backgroundProbeStarted;
@property (nonatomic) NSTimeInterval backgroundProbeLastTick;
@property (nonatomic) NSTimeInterval backgroundProbeActiveSeconds;
@property (nonatomic) NSTimeInterval backgroundProbeMaxGap;
@property (nonatomic) NSUInteger backgroundProbeTicks;
@property (nonatomic) BOOL backgroundProbeKeepAliveEnabled;
@end

@implementation AppDelegate

- (void)restoreCookiesFromDefaults {
    NSData *cookieData = [[NSUserDefaults standardUserDefaults] objectForKey:@"ApplicationCookie"];
    if (cookieData.length == 0) {
        return;
    }

    [BrowserWebView restoreCookiesFromData:cookieData completion:nil];
}

- (void)saveCookiesToDefaults {
    NSUInteger generation = ++self.cookieSaveGeneration;
    __block UIBackgroundTaskIdentifier task = UIBackgroundTaskInvalid;
    void (^endTask)(void) = ^{
        if (task != UIBackgroundTaskInvalid) {
            [UIApplication.sharedApplication endBackgroundTask:task];
            task = UIBackgroundTaskInvalid;
        }
    };
    task = [UIApplication.sharedApplication beginBackgroundTaskWithName:@"Save browser cookies" expirationHandler:endTask];
    [BrowserWebView cookieDataRepresentationWithCompletion:^(NSData *cookieData) {
        if (cookieData && generation == self.cookieSaveGeneration) [[NSUserDefaults standardUserDefaults] setObject:cookieData forKey:@"ApplicationCookie"];
        endTask();
    }];
}


- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
	// Override point for customization after application launch.
    if ([[NSUserDefaults standardUserDefaults] boolForKey:@"MobileMode"]) {
        [[NSUserDefaults standardUserDefaults] setObject:BrowserPreferencesStore.mobileUserAgent forKey:@"UserAgent"];
        [[NSUserDefaults standardUserDefaults] setBool:YES forKey:@"MobileMode"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    }
    else {
        [[NSUserDefaults standardUserDefaults] setObject:BrowserPreferencesStore.desktopUserAgent forKey:@"UserAgent"];
        [[NSUserDefaults standardUserDefaults] setBool:NO forKey:@"MobileMode"];
        [[NSUserDefaults standardUserDefaults] synchronize];
    }
    [self restoreCookiesFromDefaults];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(debugEnabledDidChange:)
        name:BrowserDebugEnabledDidChangeNotification object:nil];
    [self recoverInterruptedBackgroundProbe];
    __weak typeof(self) weakSelf = self;
    self.torrentProcessingRegistered = [BGTaskScheduler.sharedScheduler
        registerForTaskWithIdentifier:kTorrentProcessingTaskIdentifier
        usingQueue:dispatch_get_main_queue() launchHandler:^(BGTask *task) {
            [weakSelf handleTorrentProcessingTask:(BGProcessingTask *)task];
        }];
    self.torrentRefreshRegistered = [BGTaskScheduler.sharedScheduler
        registerForTaskWithIdentifier:kTorrentRefreshTaskIdentifier
        usingQueue:dispatch_get_main_queue() launchHandler:^(BGTask *task) {
            [weakSelf handleTorrentRefreshTask:(BGAppRefreshTask *)task];
        }];
    BrowserDebugLog(@"[BackgroundTask] processingRegistered=%d refreshRegistered=%d refreshStatus=%ld",
        self.torrentProcessingRegistered, self.torrentRefreshRegistered,
        (long)application.backgroundRefreshStatus);
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(backgroundRefreshStatusChanged:)
        name:UIApplicationBackgroundRefreshStatusDidChangeNotification object:nil];
    dispatch_async(dispatch_get_main_queue(), ^{
        (void)[BrowserTorrentManager sharedManager];
    });
    if (BrowserTorrentKeepAlive.sharedKeepAlive.enabled) {
        [BrowserTorrentKeepAlive.sharedKeepAlive setEnabled:YES];
    }
    if (application.applicationState == UIApplicationStateBackground) [self beginBackgroundProbe];
	return YES;
}

- (void)debugEnabledDidChange:(NSNotification *)notification {
    (void)notification;
    if (BrowserPreferencesStore.debugEnabled) {
        if (UIApplication.sharedApplication.applicationState == UIApplicationStateBackground) [self beginBackgroundProbe];
        return;
    }
    [self endBackgroundProbe];
    BOOL pending = NO;
    [BrowserTorrentManager.sharedManager backgroundTransferPending:&pending downloadedBytes:nil];
    if (!pending) {
        [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentProcessingTaskIdentifier];
        [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentRefreshTaskIdentifier];
        if (self.torrentProcessingProbeOnly) [self finishTorrentProcessingTask:YES];
        [self finishTorrentRefreshTask:YES];
    }
}

- (void)recoverInterruptedBackgroundProbe {
    NSMutableDictionary *summary = [[[NSUserDefaults standardUserDefaults] dictionaryForKey:kBackgroundProbeSummaryKey] mutableCopy];
    if (![summary[@"running"] boolValue]) return;
    NSTimeInterval started = [summary[@"started"] doubleValue];
    NSTimeInterval lastTick = [summary[@"lastTick"] doubleValue];
    summary[@"elapsed"] = @(MAX(0, lastTick - started));
    summary[@"running"] = @NO;
    summary[@"interrupted"] = @YES;
    [[NSUserDefaults standardUserDefaults] setObject:summary forKey:kBackgroundProbeSummaryKey];
}

- (void)writeBackgroundProbeRunning:(BOOL)running interrupted:(BOOL)interrupted {
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    NSDictionary *summary = @{
        @"started": @(self.backgroundProbeStarted),
        @"lastTick": @(self.backgroundProbeLastTick),
        @"elapsed": @(MAX(0, now - self.backgroundProbeStarted)),
        @"active": @(self.backgroundProbeActiveSeconds),
        @"maxGap": @(self.backgroundProbeMaxGap),
        @"ticks": @(self.backgroundProbeTicks),
        @"keepAlive": @(self.backgroundProbeKeepAliveEnabled),
        @"running": @(running),
        @"interrupted": @(interrupted),
    };
    [[NSUserDefaults standardUserDefaults] setObject:summary forKey:kBackgroundProbeSummaryKey];
}

- (void)beginBackgroundProbe {
    if (!BrowserPreferencesStore.debugEnabled) return;
    if (self.backgroundProbeTimer) return;
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    self.backgroundProbeStarted = now;
    self.backgroundProbeLastTick = now;
    self.backgroundProbeActiveSeconds = 0;
    self.backgroundProbeMaxGap = 0;
    self.backgroundProbeTicks = 0;
    self.backgroundProbeKeepAliveEnabled = BrowserTorrentKeepAlive.sharedKeepAlive.enabled;
    self.backgroundProbeTimer = [NSTimer timerWithTimeInterval:kBackgroundProbeInterval target:self
        selector:@selector(backgroundProbeTick) userInfo:nil repeats:YES];
    [[NSRunLoop mainRunLoop] addTimer:self.backgroundProbeTimer forMode:NSRunLoopCommonModes];
    [self writeBackgroundProbeRunning:YES interrupted:NO];
    BrowserDebugLog(@"[BackgroundProbe] began keepAlive=%d", self.backgroundProbeKeepAliveEnabled);
}

- (void)backgroundProbeTick {
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    NSTimeInterval gap = MAX(0, now - self.backgroundProbeLastTick);
    if (gap <= kBackgroundProbeInterval * 2) self.backgroundProbeActiveSeconds += gap;
    self.backgroundProbeMaxGap = MAX(self.backgroundProbeMaxGap, gap);
    self.backgroundProbeLastTick = now;
    self.backgroundProbeTicks++;
    [self writeBackgroundProbeRunning:YES interrupted:NO];
    BrowserDebugLog(@"[BackgroundProbe] tick=%lu active=%.0f elapsed=%.0f gap=%.1f",
        (unsigned long)self.backgroundProbeTicks, self.backgroundProbeActiveSeconds,
        now - self.backgroundProbeStarted, gap);
}

- (void)endBackgroundProbe {
    if (!self.backgroundProbeTimer) return;
    [self.backgroundProbeTimer invalidate];
    self.backgroundProbeTimer = nil;
    NSTimeInterval gap = MAX(0, NSDate.date.timeIntervalSince1970 - self.backgroundProbeLastTick);
    self.backgroundProbeMaxGap = MAX(self.backgroundProbeMaxGap, gap);
    [self writeBackgroundProbeRunning:NO interrupted:NO];
    BrowserDebugLog(@"[BackgroundProbe] ended ticks=%lu active=%.0f elapsed=%.0f maxGap=%.1f",
        (unsigned long)self.backgroundProbeTicks, self.backgroundProbeActiveSeconds,
        NSDate.date.timeIntervalSince1970 - self.backgroundProbeStarted, self.backgroundProbeMaxGap);
}

- (void)backgroundRefreshStatusChanged:(NSNotification *)notification {
    (void)notification;
    UIBackgroundRefreshStatus status = UIApplication.sharedApplication.backgroundRefreshStatus;
    BrowserDebugLog(@"[BackgroundTask] refreshStatus=%ld", (long)status);
    if (status == UIBackgroundRefreshStatusAvailable) return;
    [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentProcessingTaskIdentifier];
    [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentRefreshTaskIdentifier];
    [self finishTorrentProcessingTask:NO];
    [self finishTorrentRefreshTask:NO];
}

- (void)scheduleTorrentRefreshIfNeeded {
    BOOL pending = NO;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:&downloaded];
#if DEBUG
    BOOL probeOnly = BrowserPreferencesStore.debugEnabled && !pending;
#else
    BOOL probeOnly = NO;
#endif
    if (!pending && !probeOnly) return;
    UIBackgroundRefreshStatus status = UIApplication.sharedApplication.backgroundRefreshStatus;
    if (!self.torrentRefreshRegistered || status != UIBackgroundRefreshStatusAvailable) {
        BrowserDebugLog(@"[BackgroundTask] refresh not submitted registered=%d status=%ld pending=%d probe=%d",
            self.torrentRefreshRegistered, (long)status, pending, probeOnly);
        return;
    }
    BGAppRefreshTaskRequest *request = [[BGAppRefreshTaskRequest alloc] initWithIdentifier:kTorrentRefreshTaskIdentifier];
    request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:30];
    [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentRefreshTaskIdentifier];
    NSError *error = nil;
    BOOL submitted = [BGTaskScheduler.sharedScheduler submitTaskRequest:request error:&error];
    BrowserDebugLog(@"[BackgroundTask] refresh submitted=%d code=%ld pending=%d probe=%d downloaded=%lld",
        submitted, (long)error.code, pending, probeOnly, (long long)downloaded);
}

- (void)handleTorrentRefreshTask:(BGAppRefreshTask *)task {
    if (self.torrentRefreshTask ||
        UIApplication.sharedApplication.backgroundRefreshStatus != UIBackgroundRefreshStatusAvailable) {
        [task setTaskCompletedWithSuccess:NO];
        return;
    }
    [self beginBackgroundProbe];
    BOOL pending = NO;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:&downloaded];
    if (!pending && !BrowserPreferencesStore.debugEnabled) {
        [task setTaskCompletedWithSuccess:YES];
        return;
    }
    self.torrentRefreshTask = task;
    self.torrentRefreshStarted = NSDate.date.timeIntervalSince1970;
    self.torrentRefreshStartBytes = downloaded;
    __weak typeof(self) weakSelf = self;
    task.expirationHandler = ^{
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf finishTorrentRefreshTask:NO]; });
    };
    BrowserDebugLog(@"[BackgroundTask] refresh launched pending=%d downloaded=%lld", pending, (long long)downloaded);
    if (pending) [self scheduleTorrentRefreshIfNeeded];
    self.torrentRefreshTimer = [NSTimer timerWithTimeInterval:15 target:self
        selector:@selector(torrentRefreshTick) userInfo:nil repeats:NO];
    [[NSRunLoop mainRunLoop] addTimer:self.torrentRefreshTimer forMode:NSRunLoopCommonModes];
}

- (void)torrentRefreshTick {
    BOOL pending = NO;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:nil];
    if (pending) [[BrowserTorrentManager sharedManager] requestFastResumeCheckpoint];
    [self finishTorrentRefreshTask:YES];
}

- (void)finishTorrentRefreshTask:(BOOL)success {
    BGAppRefreshTask *task = self.torrentRefreshTask;
    if (!task) return;
    [self.torrentRefreshTimer invalidate];
    self.torrentRefreshTimer = nil;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:nil downloadedBytes:&downloaded];
    BrowserDebugLog(@"[BackgroundTask] refresh completed success=%d elapsed=%.0f delta=%lld",
        success, NSDate.date.timeIntervalSince1970 - self.torrentRefreshStarted,
        (long long)MAX(0, downloaded - self.torrentRefreshStartBytes));
    self.torrentRefreshTask = nil;
    [task setTaskCompletedWithSuccess:success];
}

- (void)scheduleTorrentProcessingIfNeeded {
    BOOL pending = NO;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:&downloaded];
#if DEBUG
    BOOL probeOnly = BrowserPreferencesStore.debugEnabled && !pending;
#else
    BOOL probeOnly = NO;
#endif
    if (!pending && !probeOnly) return;
    UIBackgroundRefreshStatus status = UIApplication.sharedApplication.backgroundRefreshStatus;
    if (!self.torrentProcessingRegistered || status != UIBackgroundRefreshStatusAvailable) {
        BrowserDebugLog(@"[BackgroundTask] not submitted registered=%d status=%ld pending=%d probe=%d",
            self.torrentProcessingRegistered, (long)status, pending, probeOnly);
        return;
    }
    BGProcessingTaskRequest *request = [[BGProcessingTaskRequest alloc] initWithIdentifier:kTorrentProcessingTaskIdentifier];
    request.requiresNetworkConnectivity = pending;
    request.earliestBeginDate = [NSDate dateWithTimeIntervalSinceNow:30];
    [BGTaskScheduler.sharedScheduler cancelTaskRequestWithIdentifier:kTorrentProcessingTaskIdentifier];
    NSError *error = nil;
    BOOL submitted = [BGTaskScheduler.sharedScheduler submitTaskRequest:request error:&error];
    BrowserDebugLog(@"[BackgroundTask] submitted=%d code=%ld pending=%d probe=%d downloaded=%lld",
        submitted, (long)error.code, pending, probeOnly, (long long)downloaded);
}

- (void)handleTorrentProcessingTask:(BGProcessingTask *)task {
    if (self.torrentProcessingTask) {
        [task setTaskCompletedWithSuccess:NO];
        return;
    }
    if (UIApplication.sharedApplication.backgroundRefreshStatus != UIBackgroundRefreshStatusAvailable) {
        BrowserDebugLog(@"[BackgroundTask] launched without refresh permission");
        [task setTaskCompletedWithSuccess:NO];
        return;
    }
    [self beginBackgroundProbe];
    BOOL pending = NO;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:&downloaded];
    if (!pending && !BrowserPreferencesStore.debugEnabled) {
        [task setTaskCompletedWithSuccess:YES];
        return;
    }
    self.torrentProcessingTask = task;
    self.torrentProcessingStarted = NSDate.date.timeIntervalSince1970;
    self.torrentProcessingStartBytes = downloaded;
    self.torrentProcessingProbeOnly = !pending;
    __weak typeof(self) weakSelf = self;
    task.expirationHandler = ^{
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf finishTorrentProcessingTask:NO]; });
    };
    BrowserDebugLog(@"[BackgroundTask] launched pending=%d probe=%d downloaded=%lld",
        pending, self.torrentProcessingProbeOnly, (long long)downloaded);
    if (pending) [self scheduleTorrentProcessingIfNeeded];
    self.torrentProcessingTimer = [NSTimer timerWithTimeInterval:10 target:self
        selector:@selector(torrentProcessingTick) userInfo:nil repeats:YES];
    [[NSRunLoop mainRunLoop] addTimer:self.torrentProcessingTimer forMode:NSRunLoopCommonModes];
}

- (void)torrentProcessingTick {
    if (!self.torrentProcessingTask) return;
    if (UIApplication.sharedApplication.backgroundRefreshStatus != UIBackgroundRefreshStatusAvailable) {
        [self finishTorrentProcessingTask:NO];
        return;
    }
    BOOL pending = NO;
    int64_t downloaded = 0;
    [[BrowserTorrentManager sharedManager] backgroundTransferPending:&pending downloadedBytes:&downloaded];
    NSTimeInterval elapsed = NSDate.date.timeIntervalSince1970 - self.torrentProcessingStarted;
    BrowserDebugLog(@"[BackgroundTask] tick elapsed=%.0f pending=%d delta=%lld",
        elapsed, pending, (long long)MAX(0, downloaded - self.torrentProcessingStartBytes));
    if ((!pending && !self.torrentProcessingProbeOnly) ||
        (self.torrentProcessingProbeOnly && elapsed >= 60)) {
        [self finishTorrentProcessingTask:YES];
    }
}

- (void)finishTorrentProcessingTask:(BOOL)success {
    BGProcessingTask *task = self.torrentProcessingTask;
    if (!task) return;
    [self.torrentProcessingTimer invalidate];
    self.torrentProcessingTimer = nil;
    BOOL pending = NO;
    int64_t downloaded = 0;
    BrowserTorrentManager *manager = [BrowserTorrentManager sharedManager];
    [manager backgroundTransferPending:&pending downloadedBytes:&downloaded];
    if (pending) [manager requestFastResumeCheckpoint];
    BrowserDebugLog(@"[BackgroundTask] completed success=%d elapsed=%.0f pending=%d delta=%lld",
        success, NSDate.date.timeIntervalSince1970 - self.torrentProcessingStarted,
        pending, (long long)MAX(0, downloaded - self.torrentProcessingStartBytes));
    self.torrentProcessingTask = nil;
    [task setTaskCompletedWithSuccess:success];
}

- (void)applicationWillResignActive:(UIApplication *)application {
	// Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
	// Use this method to pause ongoing tasks, disable timers, and throttle down OpenGL ES frame rates. Games should use this method to pause the game.
    [self saveCookiesToDefaults];
}

- (void)applicationDidEnterBackground:(UIApplication *)application {
	// Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
	// If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    [self saveCookiesToDefaults];
    [self beginBackgroundProbe];
    [self scheduleTorrentProcessingIfNeeded];
    [self scheduleTorrentRefreshIfNeeded];
}

- (void)applicationWillEnterForeground:(UIApplication *)application {
	// Called as part of the transition from the background to the inactive state; here you can undo many of the changes made on entering the background.
    [self finishTorrentProcessingTask:YES];
    [self finishTorrentRefreshTask:YES];
    [self endBackgroundProbe];
}

- (void)applicationDidBecomeActive:(UIApplication *)application {
	// Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
}

- (void)applicationWillTerminate:(UIApplication *)application {
	// Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    [self saveCookiesToDefaults];
}

@end
