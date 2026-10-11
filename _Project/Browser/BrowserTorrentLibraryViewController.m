#import "BrowserTorrentLibraryViewController.h"

#import "BrowserTorrentManager.h"
#import "BrowserPreferencesStore.h"
#import "BrowserVLCPlayerViewController.h"
#import "BrowserWebView.h"
#import "BrowserTVAppearance.h"

static NSArray<NSHTTPCookie *> *BrowserTorrentCookiesForURL(NSArray<NSHTTPCookie *> *cookies, NSURL *URL) {
    NSMutableArray<NSHTTPCookie *> *matching = [NSMutableArray array];
    NSString *host = URL.host.lowercaseString ?: @"";
    NSString *path = URL.path.length > 0 ? URL.path : @"/";
    for (NSHTTPCookie *cookie in cookies) {
        NSString *domain = cookie.domain.lowercaseString ?: @"";
        BOOL subdomains = [domain hasPrefix:@"."];
        if (subdomains) domain = [domain substringFromIndex:1];
        BOOL hostMatches = [host isEqualToString:domain] || (subdomains && [host hasSuffix:[@"." stringByAppendingString:domain]]);
        if (!hostMatches || ![path hasPrefix:cookie.path ?: @"/"] ||
            (cookie.isSecure && ![URL.scheme.lowercaseString isEqualToString:@"https"])) continue;
        [matching addObject:cookie];
    }
    return matching;
}

static NSInteger const kTorrentRowActionIconTag = 9902;


@interface BrowserTorrentDownloadDelegate : NSObject <NSURLSessionTaskDelegate>
@property (nonatomic, copy) NSArray<NSHTTPCookie *> *cookies;
@end

@implementation BrowserTorrentDownloadDelegate
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request
completionHandler:(void (^)(NSURLRequest *))completionHandler {
    (void)session; (void)task; (void)response;
    if (![@[@"http", @"https"] containsObject:request.URL.scheme.lowercaseString ?: @""]) {
        completionHandler(nil);
        return;
    }
    NSMutableURLRequest *next = [request mutableCopy];
    [next setValue:nil forHTTPHeaderField:@"Cookie"];
    NSArray *cookies = BrowserTorrentCookiesForURL(self.cookies, request.URL);
    if (cookies.count > 0) {
        [next setValue:[NSHTTPCookie requestHeaderFieldsWithCookies:cookies][@"Cookie"] forHTTPHeaderField:@"Cookie"];
    }
    completionHandler(next);
}
@end

@interface BrowserTorrentLibraryViewController () <UITableViewDataSource, UITableViewDelegate>
@property (nonatomic) UILabel *heading;
@property (nonatomic) UILabel *subtitle;
@property (nonatomic) UITableView *tableView;
@property (nonatomic) UIButton *resetAllButton;
@property (nonatomic) UIButton *deleteAllButton;
@property (nonatomic) UIButton *backButton;
@property (nonatomic) UIButton *pauseButton;
@property (nonatomic) UIView *actionsPanel;
@property (nonatomic) UIView *fileActionsPanel;
@property (nonatomic) UIButton *fileDownloadButton;
@property (nonatomic) NSArray<UIButton *> *torrentActionButtons;
@property (nonatomic) NSLayoutConstraint *tableTrailingConstraint;
@property (nonatomic, copy) NSString *cacheSizeText;
@property (nonatomic) NSArray<BrowserTorrentSnapshot *> *torrents;
@property (nonatomic) NSArray<BrowserTorrentFile *> *files;
@property (nonatomic) NSArray *visibleEntries;
@property (nonatomic, copy) NSString *folderPath;
@property (nonatomic, copy) NSString *selectedIdentifier;
@property (nonatomic, copy) NSString *focusedTorrentIdentifier;
@property (nonatomic, copy) NSString *loadingMessage;
@property (nonatomic, copy) NSString *displayedIdentifier;
@property (nonatomic) NSInteger displayedRowCount;
@property (nonatomic) NSTimer *refreshTimer;
@property (nonatomic) BrowserTorrentFile *pendingPlaybackFile;
@property (nonatomic, copy) NSString *pendingPlaybackIdentifier;
@property (nonatomic) NSInteger focusedFileRow;
@property (nonatomic) NSTimeInterval lastBackPressTime;
@property (nonatomic) NSTimeInterval lastCacheSizeUpdate;
@end

@implementation BrowserTorrentLibraryViewController

- (instancetype)init {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        self.modalPresentationStyle = UIModalPresentationFullScreen;
        _focusedFileRow = NSNotFound;
    }
    return self;
}

- (UIButton *)button:(NSString *)title action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.backgroundColor = BrowserTVRestingSurfaceColor();
    button.layer.cornerRadius = 18;
    button.titleLabel.font = [UIFont systemFontOfSize:25 weight:UIFontWeightSemibold];
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    [button setTitleColor:BrowserTVFocusedTextColor() forState:UIControlStateFocused];
    [button addTarget:self action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    BrowserTVInstallBackground(self.view);
    self.heading = [UILabel new];
    self.heading.translatesAutoresizingMaskIntoConstraints = NO;
    self.heading.font = [UIFont systemFontOfSize:56 weight:UIFontWeightBold];
    self.heading.textColor = UIColor.whiteColor;
    [self.view addSubview:self.heading];
    self.subtitle = [UILabel new];
    self.subtitle.translatesAutoresizingMaskIntoConstraints = NO;
    self.subtitle.font = [UIFont systemFontOfSize:22];
    self.subtitle.numberOfLines = 3;
    self.subtitle.textColor = [UIColor colorWithWhite:1 alpha:0.7];
    [self.view addSubview:self.subtitle];

    Class glassClass = NSClassFromString(@"UIGlassEffect");
    UIVisualEffect *effect = BrowserTVPanelEffect();
    UIVisualEffectView *glassPanel = [[UIVisualEffectView alloc] initWithEffect:effect];
    glassPanel.translatesAutoresizingMaskIntoConstraints = NO;
    glassPanel.layer.cornerRadius = 30;
    glassPanel.layer.masksToBounds = YES;
    glassPanel.layer.borderWidth = glassClass != Nil ? 0 : 1;
    glassPanel.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.25].CGColor;
    [self.view addSubview:glassPanel];

    self.deleteAllButton = [self button:@"Delete All" action:@selector(deleteAllPressed)];
    self.resetAllButton = [self button:@"Reset All" action:@selector(resetAllPressed)];
    self.backButton = [self button:@"Back" action:@selector(backPressed)];
    self.pauseButton = [self button:@"Pause" action:@selector(pausePressed)];
    UIButton *done = [self button:@"Done" action:@selector(donePressed)];
    for (UIButton *button in @[self.deleteAllButton, self.resetAllButton, self.backButton, self.pauseButton, done]) {
        [self.view addSubview:button];
    }

    UITableView *table = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStylePlain];
    table.translatesAutoresizingMaskIntoConstraints = NO;
    table.dataSource = self;
    table.delegate = self;
    table.remembersLastFocusedIndexPath = NO;
    table.rowHeight = 126;
    table.backgroundColor = UIColor.clearColor;
    [self.view addSubview:table];
    self.tableView = table;
    [self installTorrentActionsPanel];
    [self installFileActionsPanel];
    self.displayedRowCount = -1;
    UILongPressGestureRecognizer *contextPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                               action:@selector(handleContextPress:)];
    contextPress.minimumPressDuration = 0.6;
    contextPress.allowedPressTypes = @[@(UIPressTypeSelect)];
    contextPress.cancelsTouchesInView = YES;
    [table addGestureRecognizer:contextPress];
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(applicationWillEnterForeground:)
                                                 name:UIApplicationWillEnterForegroundNotification object:nil];
    UITapGestureRecognizer *backGesture = [[UITapGestureRecognizer alloc] initWithTarget:self
                                                                                 action:@selector(handleBackGesture:)];
    backGesture.allowedPressTypes = @[@(UIPressTypeMenu)];
    backGesture.cancelsTouchesInView = YES;
    [self.view addGestureRecognizer:backGesture];

    [NSLayoutConstraint activateConstraints:@[
        [glassPanel.leadingAnchor constraintEqualToAnchor:table.leadingAnchor constant:-14],
        [glassPanel.trailingAnchor constraintEqualToAnchor:done.trailingAnchor constant:14],
        [glassPanel.topAnchor constraintEqualToAnchor:table.topAnchor constant:-14],
        [glassPanel.bottomAnchor constraintEqualToAnchor:table.bottomAnchor constant:14],
    ]];

    [NSLayoutConstraint activateConstraints:@[
        [self.heading.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:110],
        [self.heading.topAnchor constraintEqualToAnchor:self.view.topAnchor constant:70],
        [self.subtitle.leadingAnchor constraintEqualToAnchor:self.heading.leadingAnchor],
        [self.subtitle.topAnchor constraintEqualToAnchor:self.heading.bottomAnchor constant:8],
        [self.subtitle.trailingAnchor constraintLessThanOrEqualToAnchor:self.view.trailingAnchor constant:-110],
        [self.deleteAllButton.leadingAnchor constraintEqualToAnchor:self.heading.leadingAnchor],
        [self.resetAllButton.leadingAnchor constraintEqualToAnchor:self.deleteAllButton.trailingAnchor constant:18],
        [self.deleteAllButton.centerYAnchor constraintEqualToAnchor:self.resetAllButton.centerYAnchor],
        [self.deleteAllButton.widthAnchor constraintEqualToConstant:190],
        [self.deleteAllButton.heightAnchor constraintEqualToAnchor:self.resetAllButton.heightAnchor],
        [self.resetAllButton.topAnchor constraintEqualToAnchor:self.subtitle.bottomAnchor constant:30],
        [self.backButton.leadingAnchor constraintEqualToAnchor:self.heading.leadingAnchor],
        [self.pauseButton.leadingAnchor constraintEqualToAnchor:self.backButton.trailingAnchor constant:18],
        [done.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-110],
        [self.backButton.centerYAnchor constraintEqualToAnchor:self.resetAllButton.centerYAnchor],
        [self.pauseButton.centerYAnchor constraintEqualToAnchor:self.resetAllButton.centerYAnchor],
        [done.centerYAnchor constraintEqualToAnchor:self.resetAllButton.centerYAnchor],
        [self.resetAllButton.widthAnchor constraintEqualToConstant:190],
        [self.backButton.widthAnchor constraintEqualToConstant:160],
        [self.pauseButton.widthAnchor constraintEqualToConstant:160],
        [done.widthAnchor constraintEqualToConstant:150],
        [self.resetAllButton.heightAnchor constraintEqualToConstant:68],
        [self.backButton.heightAnchor constraintEqualToAnchor:self.resetAllButton.heightAnchor],
        [self.pauseButton.heightAnchor constraintEqualToAnchor:self.resetAllButton.heightAnchor],
        [done.heightAnchor constraintEqualToAnchor:self.resetAllButton.heightAnchor],
        [table.leadingAnchor constraintEqualToAnchor:self.heading.leadingAnchor],
        [table.topAnchor constraintEqualToAnchor:self.resetAllButton.bottomAnchor constant:32],
        [table.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor constant:-70],
    ]];
    self.tableTrailingConstraint = [table.trailingAnchor constraintEqualToAnchor:done.trailingAnchor constant:-360];
    self.tableTrailingConstraint.active = YES;
    [self refresh];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)applicationWillEnterForeground:(NSNotification *)notification {
    (void)notification;
    [self updateFileActionsPanelPosition];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    BrowserTVLayoutBackground(self.view);
    [self updateTorrentActionsPanelPosition];
}

- (void)viewWillAppear:(BOOL)animated {
    [super viewWillAppear:animated];
    self.refreshTimer = [NSTimer scheduledTimerWithTimeInterval:2 target:self selector:@selector(refresh) userInfo:nil repeats:YES];
    [self refresh];
}

- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated];
    [self.refreshTimer invalidate];
    self.refreshTimer = nil;
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if (self.focusedTorrentIdentifier) {
        [self setNeedsFocusUpdate];
        [self updateFocusIfNeeded];
    }
}

- (NSArray<BrowserTorrentFile *> *)filesInFolder:(NSString *)folder {
    NSString *prefix = [folder stringByAppendingString:@"/"];
    NSPredicate *predicate = [NSPredicate predicateWithBlock:^BOOL(BrowserTorrentFile *file, NSDictionary *bindings) {
        (void)bindings;
        return !file.padFile && [file.path hasPrefix:prefix];
    }];
    return [self.files filteredArrayUsingPredicate:predicate];
}

- (void)rebuildVisibleEntries {
    NSString *prefix = self.folderPath.length ? [self.folderPath stringByAppendingString:@"/"] : @"";
    NSMutableSet<NSString *> *folders = [NSMutableSet set];
    NSMutableArray<BrowserTorrentFile *> *files = [NSMutableArray array];
    for (BrowserTorrentFile *file in self.files) {
        if (file.padFile || ![file.path hasPrefix:prefix]) continue;
        NSString *remaining = [file.path substringFromIndex:prefix.length];
        NSRange slash = [remaining rangeOfString:@"/"];
        if (slash.location == NSNotFound) [files addObject:file];
        else [folders addObject:[prefix stringByAppendingString:[remaining substringToIndex:slash.location]]];
    }
    NSArray *sortedFolders = [[folders allObjects] sortedArrayUsingSelector:@selector(localizedStandardCompare:)];
    [files sortUsingComparator:^NSComparisonResult(BrowserTorrentFile *a, BrowserTorrentFile *b) {
        return [a.name localizedStandardCompare:b.name];
    }];
    self.visibleEntries = [sortedFolders arrayByAddingObjectsFromArray:files];
    if (self.visibleEntries.count == 0 && self.files.count > 0) {
        self.visibleEntries = self.files;
        BrowserDebugLog(@"[TorrentState] folder grouping fallback files=%lu", (unsigned long)self.files.count);
    }
}

- (void)refresh {
    if (NSDate.date.timeIntervalSince1970 - self.lastCacheSizeUpdate > 20) [self updateCacheSizeNote];
    self.torrents = [[BrowserTorrentManager sharedManager] torrents];
    if (self.selectedIdentifier.length > 0) {
        self.files = [[BrowserTorrentManager sharedManager] filesForTorrent:self.selectedIdentifier];
        [self rebuildVisibleEntries];
        BrowserTorrentSnapshot *selected = nil;
        for (BrowserTorrentSnapshot *torrent in self.torrents) {
            if ([torrent.identifier isEqualToString:self.selectedIdentifier]) { selected = torrent; break; }
        }
        if (!selected) { self.selectedIdentifier = nil; self.files = nil; self.visibleEntries = nil; self.folderPath = nil; }
        self.heading.text = selected.name.length > 0 ? selected.name : @"Torrents";
        self.subtitle.text = selected ? [NSString stringWithFormat:@"%@ • %.0f%% • %ld peers • %.1f MB/s%@\nCenter: open folder/play file • Play/Pause: download folder/play file • Hold Center: actions", selected.state, selected.progress * 100, (long)selected.peers, selected.downloadRate / 1048576.0, self.folderPath.length ? [@"  •  " stringByAppendingString:self.folderPath] : @""] : @"";
        if (self.pendingPlaybackFile && [self.pendingPlaybackIdentifier isEqualToString:self.selectedIdentifier]) {
            self.subtitle.text = [selected.state isEqualToString:@"Checking files"]
                ? [NSString stringWithFormat:@"Checking cached file before playback… %.0f%%", selected.progress * 100]
                : self.subtitle.text;
        }
        self.pauseButton.enabled = selected != nil;
        [self.pauseButton setTitle:[selected.state isEqualToString:@"Paused"] ? @"Resume" : @"Pause" forState:UIControlStateNormal];
    } else {
        self.heading.text = @"Torrents";
        self.subtitle.text = self.loadingMessage ?: [self torrentListHint];
    }
    BOOL details = self.selectedIdentifier.length > 0;
    self.backButton.hidden = !details;
    self.pauseButton.hidden = !details;
    self.resetAllButton.hidden = details;
    self.deleteAllButton.hidden = details;
    self.actionsPanel.hidden = details || self.torrents.count == 0;
    self.tableTrailingConstraint.constant = details ? -204 : -276;
    NSInteger count = details ? MAX(1, self.visibleEntries.count) : self.torrents.count;
    NSString *displayKey = details ? [NSString stringWithFormat:@"%@/%@", self.selectedIdentifier, self.folderPath ?: @""] : @"";
    if (self.displayedRowCount != count || ![(self.displayedIdentifier ?: @"") isEqualToString:displayKey]) {
        self.displayedRowCount = count;
        self.displayedIdentifier = displayKey;
        if (details) BrowserDebugLog(@"[TorrentState] library files=%lu visible=%lu", (unsigned long)self.files.count, (unsigned long)self.visibleEntries.count);
        [self.tableView reloadData];
    } else {
        for (UITableViewCell *cell in self.tableView.visibleCells) {
            NSIndexPath *path = [self.tableView indexPathForCell:cell];
            if (path && path.row < count) [self configureCell:cell atIndexPath:path];
        }
    }
    if (self.pendingPlaybackFile) {
        BrowserTorrentSnapshot *pendingTorrent = nil;
        for (BrowserTorrentSnapshot *torrent in self.torrents) {
            if ([torrent.identifier isEqualToString:self.pendingPlaybackIdentifier]) { pendingTorrent = torrent; break; }
        }
        if (!pendingTorrent || ![self.pendingPlaybackIdentifier isEqualToString:self.selectedIdentifier]) {
            self.pendingPlaybackFile = nil;
            self.pendingPlaybackIdentifier = nil;
        } else if (![pendingTorrent.state isEqualToString:@"Checking files"]) {
            BrowserTorrentFile *file = self.pendingPlaybackFile;
            self.pendingPlaybackFile = nil;
            self.pendingPlaybackIdentifier = nil;
            [self launchPlayerForFile:file];
        }
    }
    [self updateTorrentActionsPanelPosition];
}

- (void)updateCacheSizeNote {
    uint64_t bytes = [[BrowserTorrentManager sharedManager] totalTorrentCacheBytes];
    self.cacheSizeText = [NSByteCountFormatter stringFromByteCount:(long long)bytes
                                                       countStyle:NSByteCountFormatterCountStyleFile];
    if (!self.selectedIdentifier && !self.loadingMessage) self.subtitle.text = [self torrentListHint];
    self.lastCacheSizeUpdate = NSDate.date.timeIntervalSince1970;
}

- (NSString *)torrentListHint {
    return [NSString stringWithFormat:
        @"Center: files • Play/Pause: Start • Hold Center: actions  •  Cache: %@ total (tvOS may remove files)",
        self.cacheSizeText ?: @"0 bytes"];
}

- (void)selectTorrent:(NSString *)identifier {
    self.loadingMessage = nil;
    self.focusedTorrentIdentifier = nil;
    self.focusedFileRow = NSNotFound;
    self.selectedIdentifier = [identifier copy];
    self.folderPath = @"";
    [self refresh];
}

- (void)focusTorrent:(NSString *)identifier {
    self.loadingMessage = nil;
    self.selectedIdentifier = nil;
    self.folderPath = nil;
    self.focusedTorrentIdentifier = [identifier copy];
    self.focusedFileRow = NSNotFound;
    [self refresh];
    for (NSUInteger row = 0; row < self.torrents.count; row++) {
        if (![self.torrents[row].identifier isEqualToString:identifier]) continue;
        [self.tableView scrollToRowAtIndexPath:[NSIndexPath indexPathForRow:row inSection:0]
                              atScrollPosition:UITableViewScrollPositionMiddle animated:NO];
        break;
    }
    [self setNeedsFocusUpdate];
    [self updateFocusIfNeeded];
}

- (NSIndexPath *)indexPathForPreferredFocusedViewInTableView:(UITableView *)tableView {
    if (self.selectedIdentifier || !self.focusedTorrentIdentifier) return nil;
    for (NSUInteger row = 0; row < self.torrents.count; row++) {
        if ([self.torrents[row].identifier isEqualToString:self.focusedTorrentIdentifier]) {
            return [NSIndexPath indexPathForRow:row inSection:0];
        }
    }
    return nil;
}

- (void)showImportError:(NSString *)message {
    self.loadingMessage = message.length > 0 ? message : @"Could not add torrent.";
    [self refresh];
}

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    return self.selectedIdentifier ? MAX(1, self.visibleEntries.count) : self.torrents.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    UITableViewCell *cell = [tableView dequeueReusableCellWithIdentifier:@"TorrentRow"];
    if (!cell) cell = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:@"TorrentRow"];
    cell.backgroundColor = UIColor.clearColor;
    cell.contentView.backgroundColor = cell.isFocused ? BrowserTVFocusedSurfaceColor()
                                                      : BrowserTVRestingSurfaceColor();
    cell.contentView.layer.cornerRadius = 18;
    cell.contentView.layer.masksToBounds = YES;
    cell.textLabel.textColor = cell.isFocused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
    cell.detailTextLabel.textColor = cell.isFocused ? BrowserTVFocusedTextColor() : [UIColor colorWithWhite:1 alpha:0.7];
    cell.textLabel.font = [UIFont systemFontOfSize:28 weight:UIFontWeightMedium];
    cell.detailTextLabel.font = [UIFont systemFontOfSize:20];
    cell.detailTextLabel.numberOfLines = 2;
    cell.accessoryView = nil;
    [self configureCell:cell atIndexPath:indexPath];
    return cell;
}

- (UIButton *)torrentActionButtonWithSymbol:(NSString *)symbol label:(NSString *)label
                                     action:(SEL)action row:(NSInteger)row {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.backgroundColor = [UIColor colorWithWhite:0.18 alpha:0.85];
    button.layer.cornerRadius = 18;
    button.accessibilityLabel = label;
    button.tag = row;
    UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:32 weight:UIImageSymbolWeightSemibold];
    UIImageView *icon = [[UIImageView alloc] initWithImage:[UIImage systemImageNamed:symbol withConfiguration:configuration]];
    icon.translatesAutoresizingMaskIntoConstraints = NO;
    icon.tag = kTorrentRowActionIconTag;
    icon.contentMode = UIViewContentModeScaleAspectFit;
    icon.tintColor = UIColor.whiteColor;
    [button addSubview:icon];
    [NSLayoutConstraint activateConstraints:@[
        [button.widthAnchor constraintEqualToConstant:72],
        [button.heightAnchor constraintEqualToConstant:72],
        [icon.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
        [icon.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
        [icon.widthAnchor constraintEqualToConstant:38],
        [icon.heightAnchor constraintEqualToConstant:38],
    ]];
    [button addTarget:self action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

- (void)installTorrentActionsPanel {
    UIView *container = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 240, 72)];
    container.backgroundColor = UIColor.clearColor;
    [self.view addSubview:container];
    self.actionsPanel = container;
    UIButton *download = [self torrentActionButtonWithSymbol:@"arrow.down.to.line" label:@"Download all files"
                                                   action:@selector(downloadTorrentButtonPressed:) row:0];
    UIButton *up = [self torrentActionButtonWithSymbol:@"arrow.up" label:@"Raise priority"
                                             action:@selector(raiseTorrentButtonPressed:) row:0];
    UIButton *down = [self torrentActionButtonWithSymbol:@"arrow.down" label:@"Lower priority"
                                               action:@selector(lowerTorrentButtonPressed:) row:0];
    self.torrentActionButtons = @[download, up, down];
    UIStackView *buttons = [[UIStackView alloc] initWithArrangedSubviews:@[download, up, down]];
    buttons.translatesAutoresizingMaskIntoConstraints = NO;
    buttons.axis = UILayoutConstraintAxisHorizontal;
    buttons.spacing = 12;
    [container addSubview:buttons];
    [NSLayoutConstraint activateConstraints:@[
        [buttons.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [buttons.trailingAnchor constraintEqualToAnchor:container.trailingAnchor],
        [buttons.topAnchor constraintEqualToAnchor:container.topAnchor],
        [buttons.bottomAnchor constraintEqualToAnchor:container.bottomAnchor],
    ]];
}

- (void)installFileActionsPanel {
    UIView *container = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 72, 72)];
    container.backgroundColor = UIColor.clearColor;
    [self.view addSubview:container];
    self.fileActionsPanel = container;
    UIButton *download = [self torrentActionButtonWithSymbol:@"arrow.down.to.line" label:@"Download file or folder"
                                                   action:@selector(downloadFileButtonPressed:) row:0];
    UIStackView *buttons = [[UIStackView alloc] initWithArrangedSubviews:@[download]];
    buttons.translatesAutoresizingMaskIntoConstraints = NO;
    buttons.axis = UILayoutConstraintAxisHorizontal;
    buttons.spacing = 12;
    [container addSubview:buttons];
    [NSLayoutConstraint activateConstraints:@[
        [buttons.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [buttons.topAnchor constraintEqualToAnchor:container.topAnchor],
        [buttons.bottomAnchor constraintEqualToAnchor:container.bottomAnchor],
    ]];
    self.fileDownloadButton = download;
    container.hidden = YES;
}

- (void)updateFileActionsPanelPosition {
    if (!self.selectedIdentifier || self.visibleEntries.count == 0) {
        self.fileActionsPanel.hidden = YES;
        return;
    }
    NSInteger row = self.focusedFileRow;
    if (row == NSNotFound || row < 0 || row >= self.visibleEntries.count) row = 0;
    id entry = self.visibleEntries[row];
    if ([entry isKindOfClass:BrowserTorrentFile.class] && ((BrowserTorrentFile *)entry).padFile) {
        self.fileActionsPanel.hidden = YES;
        return;
    }
    NSIndexPath *path = [NSIndexPath indexPathForRow:row inSection:0];
    CGRect rowRect = [self.tableView rectForRowAtIndexPath:path];
    if (!CGRectIntersectsRect(self.tableView.bounds, rowRect)) {
        self.fileActionsPanel.hidden = YES;
        return;
    }
    CGRect inView = [self.tableView convertRect:rowRect toView:self.view];
    self.fileActionsPanel.frame = CGRectMake(CGRectGetMaxX(self.tableView.frame) + 18,
                                              CGRectGetMidY(inView) - 36, 72, 72);
    self.fileDownloadButton.tag = row;
    self.fileActionsPanel.hidden = NO;
}

- (void)downloadFileButtonPressed:(UIButton *)button {
    if (!self.selectedIdentifier || button.tag < 0 || button.tag >= self.visibleEntries.count) return;
    id entry = self.visibleEntries[button.tag];
    if ([entry isKindOfClass:NSString.class]) {
        [self setFolder:entry downloadEnabled:YES];
    } else {
        BrowserTorrentFile *file = entry;
        if (file.padFile) return;
        [[BrowserTorrentManager sharedManager] setDownloadEnabled:YES
            forTorrent:self.selectedIdentifier fileIndex:file.index];
        [self refresh];
    }
}

- (void)updateTorrentActionsPanelPosition {
    [self updateFileActionsPanelPosition];
    if (self.selectedIdentifier || self.torrents.count == 0) { self.actionsPanel.hidden = YES; return; }
    NSInteger row = self.focusedFileRow;
    if (row == NSNotFound || row < 0 || row >= self.torrents.count) {
        row = 0;
        for (NSUInteger index = 0; index < self.torrents.count; index++) {
            if ([self.torrents[index].identifier isEqualToString:self.focusedTorrentIdentifier]) { row = index; break; }
        }
    }
    if (row >= [self.tableView numberOfRowsInSection:0]) { self.actionsPanel.hidden = YES; return; }
    NSIndexPath *path = [NSIndexPath indexPathForRow:row inSection:0];
    CGRect rowRect = [self.tableView rectForRowAtIndexPath:path];
    if (!CGRectIntersectsRect(self.tableView.bounds, rowRect)) { self.actionsPanel.hidden = YES; return; }
    CGRect inView = [self.tableView convertRect:rowRect toView:self.view];
    CGRect target = CGRectMake(CGRectGetMaxX(self.tableView.frame) + 18,
                               CGRectGetMidY(inView) - 36, 240, 72);
    if (!CGRectEqualToRect(self.actionsPanel.frame, target)) self.actionsPanel.frame = target;
    self.actionsPanel.hidden = NO;
    for (UIButton *button in self.torrentActionButtons) button.tag = row;
}

- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
    if (scrollView == self.tableView) [self updateTorrentActionsPanelPosition];
}

- (void)downloadTorrentButtonPressed:(UIButton *)button {
    if (button.tag < 0 || button.tag >= self.torrents.count) return;
    [self startDownloadForTorrent:self.torrents[button.tag]];
}

- (void)raiseTorrentButtonPressed:(UIButton *)button { [self moveTorrentAtRow:button.tag by:-1]; }
- (void)lowerTorrentButtonPressed:(UIButton *)button { [self moveTorrentAtRow:button.tag by:1]; }

- (void)moveTorrentAtRow:(NSInteger)row by:(NSInteger)direction {
    if (row < 0 || row >= self.torrents.count) return;
    NSString *identifier = self.torrents[row].identifier;
    if (![[BrowserTorrentManager sharedManager] moveTorrent:identifier by:direction]) return;
    NSInteger destination = row + direction;
    self.torrents = [[BrowserTorrentManager sharedManager] torrents];
    self.focusedTorrentIdentifier = identifier;
    self.focusedFileRow = destination;
    [self.tableView beginUpdates];
    [self.tableView moveRowAtIndexPath:[NSIndexPath indexPathForRow:row inSection:0]
                          toIndexPath:[NSIndexPath indexPathForRow:destination inSection:0]];
    [self.tableView endUpdates];
    for (UITableViewCell *cell in self.tableView.visibleCells) {
        NSIndexPath *path = [self.tableView indexPathForCell:cell];
        if (path && path.row < self.torrents.count) [self configureCell:cell atIndexPath:path];
    }
    [self updateTorrentActionsPanelPosition];
}

- (void)configureCell:(UITableViewCell *)cell atIndexPath:(NSIndexPath *)indexPath {
    if (self.selectedIdentifier) {
        if (self.visibleEntries.count == 0) {
            cell.textLabel.text = @"Finding torrent files…";
            cell.detailTextLabel.text = [NSString stringWithFormat:@"Manager: %lu files • Visible: %lu rows • Folder: %@",
                (unsigned long)self.files.count, (unsigned long)self.visibleEntries.count,
                self.folderPath.length ? @"inside" : @"root"];
            return;
        }
        id entry = self.visibleEntries[indexPath.row];
        if ([entry isKindOfClass:NSString.class]) {
            NSString *folder = entry;
            NSArray<BrowserTorrentFile *> *children = [self filesInFolder:folder];
            int64_t total = 0, downloaded = 0;
            NSUInteger selected = 0;
            for (BrowserTorrentFile *file in children) {
                total += file.size;
                downloaded += file.downloaded;
                if (file.downloadEnabled) selected++;
            }
            cell.textLabel.text = [NSString stringWithFormat:@"▸ %@", folder.lastPathComponent];
            cell.detailTextLabel.text = [NSString stringWithFormat:@"Folder • %lu of %lu selected • %@ / %@ downloaded", (unsigned long)selected, (unsigned long)children.count,
                [NSByteCountFormatter stringFromByteCount:downloaded countStyle:NSByteCountFormatterCountStyleFile],
                [NSByteCountFormatter stringFromByteCount:total countStyle:NSByteCountFormatterCountStyleFile]];
        } else {
            BrowserTorrentFile *file = entry;
            cell.textLabel.text = file.name;
            BOOL complete = file.size > 0 && file.downloaded >= file.size;
            NSInteger percent = complete ? 100 : file.size > 0 ? MIN(99, (NSInteger)(100.0 * file.downloaded / file.size)) : 0;
            cell.detailTextLabel.text = [NSString stringWithFormat:@"%@ • %ld%% • %.1f MB",
                complete ? @"Complete" : file.downloadEnabled ? @"Downloading" : @"Skipped",
                (long)percent, file.size / 1048576.0];
        }
    } else {
        BrowserTorrentSnapshot *torrent = self.torrents[indexPath.row];
        cell.textLabel.text = torrent.name;
        NSString *downloaded = [NSByteCountFormatter stringFromByteCount:torrent.selectedDownloaded countStyle:NSByteCountFormatterCountStyleFile];
        NSString *selectedSize = [NSByteCountFormatter stringFromByteCount:torrent.selectedSize countStyle:NSByteCountFormatterCountStyleFile];
        NSString *totalSize = [NSByteCountFormatter stringFromByteCount:torrent.totalSize countStyle:NSByteCountFormatterCountStyleFile];
        NSString *sizes = torrent.hasMetadata
            ? [NSString stringWithFormat:@"%@ / %@ selected • %@ total", downloaded, selectedSize, totalSize]
            : @"Waiting for metadata";
        NSInteger percent = torrent.selectedSize > 0 && torrent.selectedDownloaded >= torrent.selectedSize
            ? 100 : MIN(99, (NSInteger)(torrent.progress * 100));
        cell.detailTextLabel.text = [NSString stringWithFormat:@"%@ • %ld%% • %@\n↓ %.1f MB/s  ↑ %.1f MB/s • %ld peers / %ld seeds",
            torrent.state, (long)percent, sizes, torrent.downloadRate / 1048576.0,
            torrent.uploadRate / 1048576.0, (long)torrent.peers, (long)torrent.seeds];
    }
}

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    if (!self.selectedIdentifier) {
        [self selectTorrent:self.torrents[indexPath.row].identifier];
        return;
    }
    if (self.visibleEntries.count == 0) return;
    id entry = self.visibleEntries[indexPath.row];
    if ([entry isKindOfClass:NSString.class]) {
        self.folderPath = entry;
        self.focusedFileRow = NSNotFound;
        [self refresh];
        return;
    }
    BrowserTorrentFile *file = entry;
    if ([self isPlayableFile:file]) {
        [self playFile:file];
        return;
    }
    [self presentActionsForFile:file];
}

- (void)handleContextPress:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state != UIGestureRecognizerStateBegan) return;
    NSIndexPath *path = [self.tableView indexPathForRowAtPoint:[recognizer locationInView:self.tableView]];
    if (!path && self.focusedFileRow >= 0 && self.focusedFileRow < [self tableView:self.tableView numberOfRowsInSection:0]) {
        path = [NSIndexPath indexPathForRow:self.focusedFileRow inSection:0];
    }
    if (!path) return;
    if (self.selectedIdentifier) {
        if (self.visibleEntries.count == 0) return;
        id entry = self.visibleEntries[path.row];
        if ([entry isKindOfClass:NSString.class]) [self presentActionsForFolder:entry];
        else [self presentActionsForFile:entry];
    } else {
        [self presentActionsForTorrent:self.torrents[path.row]];
    }
}

- (void)presentActionsForTorrent:(BrowserTorrentSnapshot *)torrent {
    UIAlertController *actions = [UIAlertController alertControllerWithTitle:torrent.name
                                                                     message:nil preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [actions addAction:[UIAlertAction actionWithTitle:@"Open Files" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf selectTorrent:torrent.identifier];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Download All Files" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf startDownloadForTorrent:torrent];
    }]];
    BOOL paused = [torrent.state isEqualToString:@"Paused"];
    [actions addAction:[UIAlertAction actionWithTitle:paused ? @"Resume" : @"Pause"
                                                style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [[BrowserTorrentManager sharedManager] setPaused:!paused forTorrent:torrent.identifier];
        [weakSelf refresh];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Reset Torrent" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        [weakSelf confirmResetForTorrent:torrent];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Remove Torrent" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        [weakSelf confirmRemovalForTorrent:torrent];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:actions animated:YES completion:nil];
}

- (void)presentActionsForFile:(BrowserTorrentFile *)file {
    UIAlertController *actions = [UIAlertController alertControllerWithTitle:file.name message:file.path preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    if ([self isPlayableFile:file]) {
        [actions addAction:[UIAlertAction actionWithTitle:@"Play Now (Priority)" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
            [weakSelf playFile:file];
        }]];
    }
    [actions addAction:[UIAlertAction actionWithTitle:file.downloadEnabled ? @"Skip Download" : @"Download File"
                                                style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [[BrowserTorrentManager sharedManager] setDownloadEnabled:!file.downloadEnabled forTorrent:weakSelf.selectedIdentifier fileIndex:file.index];
        [weakSelf refresh];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:actions animated:YES completion:nil];
}

- (void)setFolder:(NSString *)folder downloadEnabled:(BOOL)enabled {
    NSArray<BrowserTorrentFile *> *children = [self filesInFolder:folder];
    NSMutableArray<NSNumber *> *indexes = [NSMutableArray arrayWithCapacity:children.count];
    for (BrowserTorrentFile *file in children) [indexes addObject:@(file.index)];
    if (![[BrowserTorrentManager sharedManager] setDownloadEnabled:enabled
        forTorrent:self.selectedIdentifier fileIndexes:indexes]) {
        [self showMessage:@"Wait for torrent metadata, then try again."];
    }
    [self refresh];
}

- (void)presentActionsForFolder:(NSString *)folder {
    NSArray<BrowserTorrentFile *> *children = [self filesInFolder:folder];
    NSUInteger selected = 0;
    for (BrowserTorrentFile *file in children) if (file.downloadEnabled) selected++;
    UIAlertController *actions = [UIAlertController alertControllerWithTitle:folder.lastPathComponent
        message:[NSString stringWithFormat:@"%lu files • %lu selected", (unsigned long)children.count, (unsigned long)selected]
        preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [actions addAction:[UIAlertAction actionWithTitle:@"Download Folder" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf setFolder:folder downloadEnabled:YES];
    }]];
    if (selected > 0) {
        [actions addAction:[UIAlertAction actionWithTitle:@"Skip Folder" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
            [weakSelf setFolder:folder downloadEnabled:NO];
        }]];
    }
    [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:actions animated:YES completion:nil];
}

- (BOOL)isPlayableFile:(BrowserTorrentFile *)file {
    return file && !file.padFile && [@[@"mp4", @"m4v", @"mov", @"mp3", @"m4a", @"mkv", @"avi"]
        containsObject:file.name.pathExtension.lowercaseString];
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    UITableViewCell *focusedCell = nil;
    for (id item in @[context.previouslyFocusedView ?: [UIView new], context.nextFocusedView ?: [UIView new]]) {
        UIView *view = [item isKindOfClass:UIView.class] ? item : nil;
        while (view && ![view isKindOfClass:UITableViewCell.class] && ![view isKindOfClass:UIButton.class]) view = view.superview;
        BOOL focused = item == context.nextFocusedView;
        if ([view isKindOfClass:UITableViewCell.class]) {
            UITableViewCell *cell = (UITableViewCell *)view;
            cell.textLabel.textColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
            cell.detailTextLabel.textColor = focused ? BrowserTVFocusedTextColor() : [UIColor colorWithWhite:1 alpha:0.7];
            cell.contentView.backgroundColor = focused ? BrowserTVFocusedSurfaceColor()
                                                       : BrowserTVRestingSurfaceColor();
            if (focused) focusedCell = cell;
        } else if ([view isKindOfClass:UIButton.class]) {
            UIButton *button = (UIButton *)view;
            button.backgroundColor = focused ? BrowserTVFocusedSurfaceColor()
                : ([button isDescendantOfView:self.actionsPanel] || [button isDescendantOfView:self.fileActionsPanel])
                    ? [UIColor colorWithWhite:0.18 alpha:0.85] : BrowserTVRestingSurfaceColor();
            [button setTitleColor:focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor forState:UIControlStateNormal];
            UIImageView *icon = (UIImageView *)[button viewWithTag:kTorrentRowActionIconTag];
            icon.tintColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
            UIView *parent = button.superview;
            while (parent && ![parent isKindOfClass:UITableViewCell.class]) parent = parent.superview;
            if (focused && [parent isKindOfClass:UITableViewCell.class]) focusedCell = (UITableViewCell *)parent;
            if (focused && button == self.fileDownloadButton)
                self.focusedFileRow = button.tag;
        }
    }
    NSIndexPath *path = focusedCell ? [self.tableView indexPathForCell:focusedCell] : nil;
    if (path) {
        self.focusedFileRow = path.row;
        if (!self.selectedIdentifier && path.row < self.torrents.count)
            self.focusedTorrentIdentifier = self.torrents[path.row].identifier;
    } else if (![context.nextFocusedView isDescendantOfView:self.actionsPanel] &&
               ![context.nextFocusedView isDescendantOfView:self.fileActionsPanel]) {
        self.focusedFileRow = NSNotFound;
    }
    [self updateTorrentActionsPanelPosition];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    if (presses.anyObject.type == UIPressTypeMenu) {
        [self handleBackPress];
        return;
    }
    if (presses.anyObject.type == UIPressTypePlayPause && self.focusedFileRow >= 0) {
        if (self.selectedIdentifier && self.focusedFileRow < self.visibleEntries.count) {
            id entry = self.visibleEntries[self.focusedFileRow];
            if ([entry isKindOfClass:NSString.class]) {
                [self setFolder:entry downloadEnabled:YES];
                return;
            }
            BrowserTorrentFile *file = entry;
            if ([self isPlayableFile:file]) {
                [self playFile:file];
                return;
            }
            [[BrowserTorrentManager sharedManager] setDownloadEnabled:YES forTorrent:self.selectedIdentifier fileIndex:file.index];
            [self refresh];
            return;
        } else if (!self.selectedIdentifier && self.focusedFileRow < self.torrents.count) {
            [self startDownloadForTorrent:self.torrents[self.focusedFileRow]];
            return;
        }
    }
    [super pressesEnded:presses withEvent:event];
}

- (void)startDownloadForTorrent:(BrowserTorrentSnapshot *)torrent {
    if (![[BrowserTorrentManager sharedManager] downloadAllFilesForTorrent:torrent.identifier]) {
        [self showMessage:@"Wait for torrent metadata, then try Download All Files again."];
        return;
    }
    [self refresh];
}

- (void)playFile:(BrowserTorrentFile *)file {
    if (!self.selectedIdentifier) return;
    for (BrowserTorrentSnapshot *torrent in [[BrowserTorrentManager sharedManager] torrents]) {
        if ([torrent.identifier isEqualToString:self.selectedIdentifier] && [torrent.state isEqualToString:@"Checking files"]) {
            self.pendingPlaybackFile = file;
            self.pendingPlaybackIdentifier = self.selectedIdentifier;
            [self refresh];
            return;
        }
    }
    [self launchPlayerForFile:file];
}

- (void)launchPlayerForFile:(BrowserTorrentFile *)file {
    [[BrowserTorrentManager sharedManager] prioritizePlaybackForTorrent:self.selectedIdentifier fileIndex:file.index];
    [self refresh];
    BrowserVLCPlayerViewController *player = [[BrowserVLCPlayerViewController alloc]
        initWithTorrentIdentifier:self.selectedIdentifier fileIndex:file.index title:file.name];
    [self presentViewController:player animated:YES completion:nil];
}

- (void)showMessage:(NSString *)message {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Torrents" message:message preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)importTorrentRequest:(NSURLRequest *)request {
    if (!request.URL) return;
    self.loadingMessage = @"Fetching .torrent file…";
    [self refresh];
    NSArray<NSHTTPCookie *> *cookies = [BrowserWebView allCookies];
    NSMutableURLRequest *downloadRequest = [request mutableCopy];
    if ([downloadRequest valueForHTTPHeaderField:@"Cookie"].length == 0) {
        NSArray *matching = BrowserTorrentCookiesForURL(cookies, request.URL);
        if (matching.count > 0) {
            [downloadRequest setValue:[NSHTTPCookie requestHeaderFieldsWithCookies:matching][@"Cookie"] forHTTPHeaderField:@"Cookie"];
        }
    }
    BrowserTorrentDownloadDelegate *delegate = [BrowserTorrentDownloadDelegate new];
    delegate.cookies = cookies;
    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.HTTPShouldSetCookies = NO;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration delegate:delegate delegateQueue:nil];
    __weak typeof(self) weakSelf = self;
    [[session downloadTaskWithRequest:downloadRequest completionHandler:^(NSURL *temporaryURL, NSURLResponse *response, NSError *downloadError) {
        NSError *error = downloadError;
        NSData *data = nil;
        if (!error && [response isKindOfClass:NSHTTPURLResponse.class]) {
            NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
            if (status < 200 || status >= 300) {
                error = [NSError errorWithDomain:@"BrowserTorrent" code:status userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Torrent server returned HTTP %ld.", (long)status]}];
            }
        }
        if (!error && temporaryURL) {
            NSNumber *size = [[[NSFileManager defaultManager] attributesOfItemAtPath:temporaryURL.path error:&error] objectForKey:NSFileSize];
            if (!error && size.unsignedLongLongValue > 16 * 1024 * 1024) {
                error = [NSError errorWithDomain:@"BrowserTorrent" code:3 userInfo:@{NSLocalizedDescriptionKey: @"The .torrent file is larger than 16 MB."}];
            }
            if (!error) data = [NSData dataWithContentsOfURL:temporaryURL options:0 error:&error];
        }
        NSError *fetchError = error;
        dispatch_async(dispatch_get_main_queue(), ^{
            NSError *importError = fetchError;
            NSString *resultIdentifier = data && !importError ? [[BrowserTorrentManager sharedManager] identifierForTorrentData:data error:&importError] : nil;
            NSString *message = importError.localizedDescription ?: @"Could not add torrent.";
            weakSelf.loadingMessage = nil;
            if (resultIdentifier) [weakSelf focusTorrent:resultIdentifier];
            else [weakSelf showImportError:message];
        });
        [session finishTasksAndInvalidate];
    }] resume];
}

- (void)backPressed {
    if (self.folderPath.length > 0) {
        NSString *parent = [self.folderPath stringByDeletingLastPathComponent];
        self.folderPath = [parent isEqualToString:@"."] ? @"" : parent;
        self.focusedFileRow = NSNotFound;
        [self refresh];
        return;
    }
    self.pendingPlaybackFile = nil;
    self.pendingPlaybackIdentifier = nil;
    self.focusedTorrentIdentifier = self.selectedIdentifier;
    self.focusedFileRow = NSNotFound;
    self.selectedIdentifier = nil;
    self.folderPath = nil;
    self.files = nil;
    [self refresh];
}
- (void)handleBackGesture:(UITapGestureRecognizer *)gesture {
    if (gesture.state == UIGestureRecognizerStateRecognized) [self handleBackPress];
}
- (void)handleBackPress {
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    if (now - self.lastBackPressTime < 0.35) return;
    self.lastBackPressTime = now;
    if (self.presentedViewController) {
        [self.presentedViewController dismissViewControllerAnimated:YES completion:nil];
    } else if (self.selectedIdentifier.length > 0) {
        [self backPressed];
    } else {
        [self donePressed];
    }
}
- (void)donePressed {
    self.pendingPlaybackFile = nil;
    self.pendingPlaybackIdentifier = nil;
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)pausePressed {
    BrowserTorrentSnapshot *selected = nil;
    for (BrowserTorrentSnapshot *torrent in self.torrents) {
        if ([torrent.identifier isEqualToString:self.selectedIdentifier]) { selected = torrent; break; }
    }
    [[BrowserTorrentManager sharedManager] setPaused:![selected.state isEqualToString:@"Paused"] forTorrent:self.selectedIdentifier];
    [self refresh];
}

- (void)confirmResetForTorrent:(BrowserTorrentSnapshot *)torrent {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Reset Torrent"
        message:@"Delete this torrent's cached files, then add it again with every file skipped? Its .torrent or magnet source will be kept."
        preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [alert addAction:[UIAlertAction actionWithTitle:@"Reset" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        BOOL started = [[BrowserTorrentManager sharedManager] resetTorrent:torrent.identifier completion:^(NSError *error) {
            [weakSelf refresh];
            [weakSelf updateCacheSizeNote];
            if (error) [weakSelf showMessage:error.localizedDescription];
        }];
        if (!started) [weakSelf showMessage:@"Could not start reset. Check that the torrent source is available."];
        else [weakSelf refresh];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)confirmRemovalForTorrent:(BrowserTorrentSnapshot *)torrent {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Remove Torrent" message:@"Remove the torrent and its cached files?" preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [alert addAction:[UIAlertAction actionWithTitle:@"Remove" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        [[BrowserTorrentManager sharedManager] removeTorrent:torrent.identifier deleteFiles:YES];
        if ([weakSelf.selectedIdentifier isEqualToString:torrent.identifier]) weakSelf.selectedIdentifier = nil;
        [weakSelf refresh];
        [weakSelf updateCacheSizeNote];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)resetAllPressed {
    NSArray<BrowserTorrentSnapshot *> *torrents = [[BrowserTorrentManager sharedManager] torrents];
    if (torrents.count == 0) { [self showMessage:@"No torrents to reset."]; return; }
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Reset All Torrents"
        message:[NSString stringWithFormat:@"Reset all %lu torrents? Their cached files and playback positions will be deleted. Torrent sources remain, with every file skipped.", (unsigned long)torrents.count]
        preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [alert addAction:[UIAlertAction actionWithTitle:@"Reset All" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        weakSelf.resetAllButton.enabled = NO;
        weakSelf.deleteAllButton.enabled = NO;
        __block NSUInteger remaining = torrents.count;
        __block NSUInteger failures = 0;
        void (^completed)(NSError *) = ^(NSError *error) {
            if (error) failures++;
            [weakSelf refresh];
            if (--remaining > 0) return;
            weakSelf.resetAllButton.enabled = YES;
            weakSelf.deleteAllButton.enabled = YES;
            [weakSelf updateCacheSizeNote];
            if (failures > 0) [weakSelf showMessage:[NSString stringWithFormat:@"Could not reset %lu torrents. Their entries were kept; try again.", (unsigned long)failures]];
        };
        for (BrowserTorrentSnapshot *torrent in torrents) {
            BOOL started = [[BrowserTorrentManager sharedManager] resetTorrent:torrent.identifier completion:completed];
            if (!started) completed([NSError errorWithDomain:@"BrowserTorrent" code:1 userInfo:nil]);
        }
        [weakSelf refresh];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)deleteAllPressed {
    NSArray<BrowserTorrentSnapshot *> *torrents = [[BrowserTorrentManager sharedManager] torrents];
    if (torrents.count == 0) { [self showMessage:@"No torrents to delete."]; return; }
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Delete All Torrents"
        message:[NSString stringWithFormat:@"Delete all %lu torrent entries and their cached files and playback positions? Browser history and website data are not affected.", (unsigned long)torrents.count]
        preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [alert addAction:[UIAlertAction actionWithTitle:@"Delete All" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        NSUInteger failures = 0;
        for (BrowserTorrentSnapshot *torrent in torrents) {
            if (![[BrowserTorrentManager sharedManager] removeTorrent:torrent.identifier deleteFiles:YES]) failures++;
        }
        [weakSelf refresh];
        [weakSelf updateCacheSizeNote];
        if (failures > 0) [weakSelf showMessage:[NSString stringWithFormat:@"Could not delete %lu torrents. Try again after any pending reset finishes.", (unsigned long)failures]];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

@end
