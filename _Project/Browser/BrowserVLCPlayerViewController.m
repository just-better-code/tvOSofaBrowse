#import "BrowserPreferencesStore.h"
#import "BrowserVLCPlayerViewController.h"

#import "BrowserTorrentHTTPServer.h"
#import "BrowserTorrentManager.h"
#import "BrowserTVAppearance.h"
#import "BrowserPlaybackSymbols.h"
#import "BrowserPlaybackSeek.h"
#import "BrowserPlaybackPanel.h"
#import "BrowserVLCCompressor.h"
#import "BrowserFullscreenMediaControlsController.h"

#import <TVVLCKit/TVVLCKit.h>

@interface BrowserVLCPlayerViewController () <VLCMediaPlayerDelegate, UIGestureRecognizerDelegate>
@property (nonatomic) BOOL playbackStarted;
@property (nonatomic) BOOL webVideoDismissalInProgress;
@property (nonatomic, copy) void (^pendingWebVideoClose)(void);
@property (nonatomic, copy) NSString *identifier;
@property (nonatomic) NSInteger fileIndex;
@property (nonatomic, copy) NSURL *webVideoURL;
@property (nonatomic, copy) NSURL *webPageURL;
@property (nonatomic) double initialWebTime;
@property (nonatomic) double initialWebVolume;
@property (nonatomic) BOOL initialWebMuted;
@property (nonatomic, copy) NSDictionary<NSString *, NSString *> *webRequestHeaders;
@property (nonatomic, copy) NSArray<NSHTTPCookie *> *webCookies;
@property (nonatomic, copy) NSString *mediaTitle;
@property (nonatomic) BrowserTorrentHTTPServer *server;
@property (nonatomic) VLCMediaPlayer *vlcPlayer;
@property (nonatomic) UILabel *statusLabel;
@property (nonatomic) BrowserPlaybackSession *playbackSession;
@property (nonatomic) BrowserPlaybackPanel *playbackPanel;
@property (nonatomic) UILabel *titleLabel;
@property (nonatomic) UIView *controlsView;
@property (nonatomic) UIButton *audioTrackButton;
@property (nonatomic) UIButton *subtitleTrackButton;
@property (nonatomic) UIButton *keepFullscreenButton;
@property (nonatomic) UILabel *keepFullscreenBadge;
@property (nonatomic, copy) NSString *audioMenuKey;
@property (nonatomic, copy) NSString *subtitleMenuKey;
@property (nonatomic) NSTimer *progressTimer;
@property (nonatomic) NSInteger lastReportedState;
@property (nonatomic) BOOL playbackEnded;
@property (nonatomic) BOOL webVideoFinished;
@property (nonatomic, copy) NSString *webVideoCompletionAction;
@property (nonatomic) NSTimeInterval lastDurationLogTime;
@property (nonatomic) UIView *videoView;
@property (nonatomic) int64_t lastPlaybackTime;
@property (nonatomic) NSTimeInterval lastPlaybackProgressTime;
@property (nonatomic) int64_t pendingResumeMs;
@property (nonatomic) NSTimeInterval lastPositionSaveTime;
@property (nonatomic) NSTimer *seekHoldTimer;
@property (nonatomic) NSInteger seekHoldKind;
@property (nonatomic) NSInteger arrowSeekDirection;
@property (nonatomic) BrowserSeekButton *arrowPressDriver;
@property (nonatomic) int64_t seekHoldTargetMs;
@property (nonatomic) NSTimeInterval seekHoldStartTime;
@end

@implementation BrowserVLCPlayerViewController

- (instancetype)initWithTorrentIdentifier:(NSString *)identifier fileIndex:(NSInteger)index title:(NSString *)title {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _identifier = [identifier copy];
        _fileIndex = index;
        _mediaTitle = [title copy] ?: @"";
        _lastReportedState = -1;
        self.modalPresentationStyle = UIModalPresentationFullScreen;
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    __weak typeof(self) weakPlayer = self;
    self.playbackSession = [[BrowserPlaybackSession alloc] initWithRenderer:BrowserPlaybackRendererVLC
        identifier:self.webVideoSourceSession ?: NSUUID.UUID.UUIDString dispatch:^(BrowserPlaybackCommand command, double value) {
        typeof(self) player = weakPlayer;
        if (!player || player.isBeingDismissed || player.webVideoFinished) return;
        switch (command) {
            case BrowserPlaybackCommandToggle: [player playPausePressed]; break;
            case BrowserPlaybackCommandPrevious: [player previousFilePressed]; break;
            case BrowserPlaybackCommandRestart: [player restartPressed]; break;
            case BrowserPlaybackCommandNext: [player nextFilePressed]; break;
            case BrowserPlaybackCommandEnd: [player endPressed]; break;
            case BrowserPlaybackCommandSeekSeconds: [player seekByMilliseconds:llround(value * 1000)]; break;
            case BrowserPlaybackCommandSeekFraction: [player seekByMilliseconds:llround([player seekDurationMilliseconds] * value)]; break;
            case BrowserPlaybackCommandVolume: [player changeVolumeBy:(int)lround(value * 100)]; break;
            case BrowserPlaybackCommandMute: [player mutePressed]; break;
            case BrowserPlaybackCommandClose: [player closePressed]; break;
        }
    }];
    self.playbackSession.visibilityDidChange = ^(BOOL visible) {
        BrowserVLCPlayerViewController *player = weakPlayer;
        if (!player.isViewLoaded) return;
        [player.playbackPanel setControlsVisible:visible];
        if (!visible) {
            [player setNeedsFocusUpdate];
            [player updateFocusIfNeeded];
        }
    };
    self.view.backgroundColor = UIColor.blackColor;
    UIView *videoView = [UIView new];
    videoView.translatesAutoresizingMaskIntoConstraints = NO;
    videoView.backgroundColor = UIColor.blackColor;
    [self.view addSubview:videoView];
    self.videoView = videoView;
    [NSLayoutConstraint activateConstraints:@[
        [videoView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [videoView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [videoView.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [videoView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
    ]];

    UIButton *audioTrack = [self controlButtonWithSymbol:@"waveform" label:@"Audio" action:@selector(audioTrackPressed)];
    UIButton *subtitleTrack = [self controlButtonWithSymbol:@"captions.bubble" label:@"Subtitles" action:@selector(subtitleTrackPressed)];
    UIButton *keepFullscreen = [self controlButtonWithSymbol:@"arrow.up.left.and.arrow.down.right"
        label:@"Keep fullscreen" action:@selector(toggleKeepFullscreen)];
    BrowserPlaybackPanel *panel = [[BrowserPlaybackPanel alloc] initWithPlayerIcon:BrowserPlaybackControlImage(@"browser.vlc")
        accessoryButtons:@[audioTrack, subtitleTrack, keepFullscreen]];
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    panel.focusController = self;
    self.playbackPanel = panel; [self.view addSubview:panel];
    [NSLayoutConstraint activateConstraints:@[
        [panel.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [panel.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [panel.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [panel.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
    ]];
    self.controlsView = panel.controls;
    self.titleLabel = panel.titleLabel; self.statusLabel = panel.statusLabel;
    self.titleLabel.text = self.mediaTitle ?: @"";
    self.statusLabel.text = self.webVideoURL ? @"Preparing video…" : @"Preparing torrent playback…";
    NSArray<UIButton *> *buttons = panel.buttons;
    UIButton *backPercent = buttons[2], *back = buttons[3], *forward = buttons[5], *forwardPercent = buttons[6];
    backPercent.tag = -2;
    back.tag = -1;
    forward.tag = 1;
    forwardPercent.tag = 2;
    self.keepFullscreenButton = keepFullscreen;
    UILabel *keepFullscreenBadge = [UILabel new];
    keepFullscreenBadge.tag = BrowserPlaybackPanelToggleBadgeTag;
    keepFullscreenBadge.translatesAutoresizingMaskIntoConstraints = NO;
    keepFullscreenBadge.isAccessibilityElement = NO;
    [keepFullscreen addSubview:keepFullscreenBadge];
    [NSLayoutConstraint activateConstraints:@[
        [keepFullscreenBadge.centerXAnchor constraintEqualToAnchor:keepFullscreen.centerXAnchor],
        [keepFullscreenBadge.bottomAnchor constraintEqualToAnchor:keepFullscreen.bottomAnchor constant:-5],
        [keepFullscreenBadge.widthAnchor constraintEqualToConstant:42],
        [keepFullscreenBadge.heightAnchor constraintEqualToConstant:22],
    ]];
    self.keepFullscreenBadge = keepFullscreenBadge;
    keepFullscreen.hidden = !self.returnWebVideoOnEnd;
    [self refreshKeepFullscreenControl];
    self.audioTrackButton = audioTrack;
    self.subtitleTrackButton = subtitleTrack;
    [buttons enumerateObjectsUsingBlock:^(UIButton *button, NSUInteger index, BOOL *stop) {
        BrowserPlaybackCommand command; double value;
        if (!BrowserPlaybackCommandForControl(index, &command, &value)) return;
        [button addAction:[UIAction actionWithHandler:^(__kindof UIAction *action) {
            [weakPlayer.playbackSession performCommand:command value:value];
        }] forControlEvents:UIControlEventPrimaryActionTriggered];
    }];

    UITapGestureRecognizer *backPress = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(closePressed)];
    backPress.allowedPressTypes = @[@(UIPressTypeMenu)];
    [self.view addGestureRecognizer:backPress];

    UILongPressGestureRecognizer *contextPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                               action:@selector(handleContextPress:)];
    contextPress.delegate = self;
    contextPress.minimumPressDuration = 0.6;
    contextPress.allowedPressTypes = @[@(UIPressTypeSelect)];
    contextPress.cancelsTouchesInView = YES;
    [self.view addGestureRecognizer:contextPress];
    for (BrowserSeekButton *button in @[backPercent, back, forward, forwardPercent]) {
        __weak typeof(self) weakSelf = self;
        NSInteger kind = button.tag;
        button.holdBegan = ^{ [weakSelf beginHeldSeek:kind]; };
        button.holdEnded = ^{ [weakSelf stopHeldSeek]; };
    }

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(applicationWillResignActive:)
                                                 name:UIApplicationWillResignActiveNotification
                                               object:nil];

    [panel setControlsVisible:self.playbackSession.controlsVisible];
    [self prepareCurrentMedia];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)applicationWillResignActive:(NSNotification *)notification {
    [self.arrowPressDriver handlePlaybackPressPhase:UIPressPhaseCancelled];
    (void)notification;
    self.arrowSeekDirection = 0;
    [self stopHeldSeek];
    if (!self.vlcPlayer.isPlaying) return;
    [self savePlaybackPosition];
    [self.vlcPlayer pause];
    BrowserDebugLog(@"[TorrentVLC] paused on app deactivation");
    [self showControls];
    [self refreshProgress];
}

- (void)handleContextPress:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state != UIGestureRecognizerStateBegan) return;
    [self showControls];
    UIAlertController *actions = [UIAlertController alertControllerWithTitle:self.mediaTitle
                                                                     message:nil preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [actions addAction:[UIAlertAction actionWithTitle:self.vlcPlayer.isPlaying ? @"Pause" : @"Play"
                                                style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf playPausePressed];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Start of File" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf restartPressed];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:actions animated:YES completion:nil];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)recognizer shouldReceivePress:(UIPress *)press {
    return ![self.view.window.screen.focusedView isKindOfClass:BrowserSeekButton.class];
}
- (int64_t)playbackTimeMilliseconds {
    if (self.pendingResumeMs > 0) return self.pendingResumeMs;
    NSNumber *time = self.vlcPlayer.time.value;
    return time ? MAX(0, time.longLongValue) : (int64_t)(self.initialWebTime * 1000);
}

- (void)beginHeldSeek:(NSInteger)kind {
    [self stopHeldSeek]; self.seekHoldKind = kind;
    self.seekHoldTargetMs = [self playbackTimeMilliseconds];
    self.seekHoldStartTime = CACurrentMediaTime(); [self repeatHeldSeek];
}

- (int64_t)seekDurationMilliseconds {
    int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
    int64_t remaining = self.vlcPlayer.remainingTime.value.longLongValue;
    if (duration <= 0 && remaining < 0) duration = self.vlcPlayer.time.value.longLongValue - remaining;
    return MAX(0, duration);
}

- (void)repeatHeldSeek {
    if (!self.seekHoldKind) return;
    int64_t duration = [self seekDurationMilliseconds];
    if (labs(self.seekHoldKind) == 2 && duration <= 0) { [self stopHeldSeek]; return; }
    int64_t step = llround(BrowserPlaybackSeekSeconds(self.seekHoldKind, duration / 1000.0) * 1000);
    self.seekHoldTargetMs = MAX(0, self.seekHoldTargetMs + step);
    if (duration > 0) self.seekHoldTargetMs = MIN(self.seekHoldTargetMs, duration);
    [self seekToMilliseconds:self.seekHoldTargetMs];
    [self showControls];
    [self refreshProgress];
    if ((step < 0 && self.seekHoldTargetMs == 0) || (step > 0 && duration > 0 && self.seekHoldTargetMs >= duration)) {
        [self stopHeldSeek]; return;
    }
    if (!self.seekHoldKind) return;
    __weak typeof(self) weakSelf = self;
    self.seekHoldTimer = [NSTimer timerWithTimeInterval:BrowserPlaybackSeekInterval(self.seekHoldStartTime) repeats:NO block:^(NSTimer *timer) { [weakSelf repeatHeldSeek]; }];
    [[NSRunLoop mainRunLoop] addTimer:self.seekHoldTimer forMode:NSRunLoopCommonModes];
}

- (void)stopHeldSeek {
    [self.seekHoldTimer invalidate];
    self.seekHoldTimer = nil;
    self.seekHoldKind = 0;
    self.playbackSession.controlsPinned = self.presentedViewController != nil;
}

- (instancetype)initWithWebVideoURL:(NSURL *)URL pageURL:(NSURL *)pageURL title:(NSString *)title
                       currentTime:(double)time volume:(double)volume muted:(BOOL)muted
                  requestHeaders:(NSDictionary<NSString *,NSString *> *)headers cookies:(NSArray<NSHTTPCookie *> *)cookies {
    self = [self initWithTorrentIdentifier:nil fileIndex:0 title:title];
    if (self) {
        _webVideoURL = [URL copy];
        _webRequestHeaders = [headers copy];
        _webCookies = [cookies copy];
        _webPageURL = [pageURL copy];
        _initialWebTime = MAX(0, time);
        _initialWebVolume = MIN(1, MAX(0, volume));
        _initialWebMuted = muted;
    }
    return self;
}

- (void)prepareCurrentMedia {
    self.playbackEnded = NO;
    BrowserTorrentManager *manager = self.webVideoURL ? nil : [BrowserTorrentManager sharedManager];
    // Web inputs seek once through :start-time. VLCKit's cached time may still
    // be null at Playing; treating that as a failed seek flushes the decoder again.
    self.pendingResumeMs = self.webVideoURL ? 0
        : [manager playbackPositionForTorrent:self.identifier fileIndex:self.fileIndex];
    self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
    NSURL *mediaURL = self.webVideoURL;
    if (!mediaURL && [manager isFileCompleteForTorrent:self.identifier fileIndex:self.fileIndex]) {
        mediaURL = [manager fileURLForTorrent:self.identifier fileIndex:self.fileIndex];
        if (![[NSFileManager defaultManager] fileExistsAtPath:mediaURL.path]) mediaURL = nil;
    }
    if (!mediaURL) {
        self.server = [[BrowserTorrentHTTPServer alloc] initWithTorrentIdentifier:self.identifier fileIndex:self.fileIndex];
        NSError *error = nil;
        if (![self.server startWithError:&error]) {
            self.statusLabel.text = error.localizedDescription ?: @"Cannot open the selected torrent file.";
            return;
        }
        mediaURL = self.server.mediaURL;
    }
    VLCMedia *media = [VLCMedia mediaWithURL:mediaURL];
    [media addOption:self.returnWebVideoOnEnd ? @":network-caching=2000" : @":network-caching=3000"];
    if (self.webVideoURL) {
        if (self.initialWebTime > 0) [media addOption:[NSString stringWithFormat:@":start-time=%.3f", self.initialWebTime]];
        NSString *agent = self.webRequestHeaders[@"User-Agent"];
        NSString *referrer = self.webRequestHeaders[@"Referer"];
        if (agent.length) [media addOption:[@":http-user-agent=" stringByAppendingString:agent]];
        if (referrer.length) [media addOption:[@":http-referrer=" stringByAppendingString:referrer]];
        [media addOption:@":http-forward-cookies=1"];
        // Each media gets its own cookie jar; no credentials are written to options or logs.
        NSUInteger stored = 0;
        NSDateFormatter *expiryFormat = [NSDateFormatter new];
        expiryFormat.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
        expiryFormat.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
        expiryFormat.dateFormat = @"EEE, dd MMM yyyy HH:mm:ss 'GMT'";
        for (NSHTTPCookie *cookie in self.webCookies) {
            if (cookie.expiresDate && [cookie.expiresDate timeIntervalSinceNow] <= 0) continue;
            if ([cookie.name rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\r\n;= "]].location != NSNotFound ||
                [cookie.value rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\r\n;"]].location != NSNotFound ||
                [cookie.path rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"\r\n;"]].location != NSNotFound) continue;
            NSMutableString *value = [NSMutableString stringWithFormat:@"%@=%@; Path=%@", cookie.name, cookie.value, cookie.path ?: @"/"];
            if ([cookie.domain hasPrefix:@"."]) [value appendFormat:@"; Domain=%@", cookie.domain];
            if (cookie.isSecure) [value appendString:@"; Secure"];
            if (cookie.isHTTPOnly) [value appendString:@"; HttpOnly"];
            if (cookie.expiresDate) [value appendFormat:@"; Expires=%@", [expiryFormat stringFromDate:cookie.expiresDate]];
            NSString *host = [cookie.domain hasPrefix:@"."] ? [cookie.domain substringFromIndex:1] : cookie.domain;
            if ([media storeCookie:value forHost:host path:cookie.path ?: @"/"] == 0) stored++;
        }
        BrowserDebugLog(@"[TorrentVLC] webContext cookies=%lu referrer=%d", (unsigned long)stored, referrer.length > 0);
    }
    self.vlcPlayer = BrowserVLCCreatePlayer();
    self.vlcPlayer.delegate = self;
    self.vlcPlayer.drawable = self.videoView;
    self.vlcPlayer.media = media;
    if (self.webVideoURL) {
        self.vlcPlayer.audio.volume = (int)lround(self.initialWebVolume * 100);
        self.vlcPlayer.audio.muted = self.initialWebMuted;
    }
    self.audioMenuKey = nil;
    self.subtitleMenuKey = nil;
    [self updateTrackButton:self.audioTrackButton prefix:@"Audio" indexes:@[] names:@[] selectedIndex:-1];
    [self updateTrackButton:self.subtitleTrackButton prefix:@"Subtitles" indexes:@[] names:@[] selectedIndex:-1];
    self.lastPlaybackTime = 0;
    self.lastPlaybackProgressTime = NSDate.date.timeIntervalSince1970;
    BrowserDebugLog(@"[TorrentVLC] prepared fileIndex=%ld local=%d", (long)self.fileIndex, mediaURL.isFileURL);
    if (self.pendingResumeMs > 0)
        BrowserDebugLog(@"[TorrentVLC] resume pending fileIndex=%ld positionMs=%lld",
            (long)self.fileIndex, (long long)self.pendingResumeMs);
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self becomeFirstResponder];
    [self startPlaybackIfNeeded];
}

- (void)startPlaybackIfNeeded {
    if (self.playbackStarted) return;
    self.playbackStarted = YES;
    if (self.vlcPlayer) [self.vlcPlayer play];
    self.progressTimer = [NSTimer scheduledTimerWithTimeInterval:1 target:self selector:@selector(refreshProgress) userInfo:nil repeats:YES];
    [self refreshProgress];
}

- (void)viewWillDisappear:(BOOL)animated {
    [self.arrowPressDriver handlePlaybackPressPhase:UIPressPhaseCancelled];
    [super viewWillDisappear:animated];
    self.arrowSeekDirection = 0;
    [self stopHeldSeek];
    [self.playbackSession invalidate];
    [self savePlaybackPosition];
    if (self.webVideoURL && self.webVideoDidClose) {
        double time = [self playbackTimeMilliseconds] / 1000.0;
        void (^closed)(double, double, BOOL, NSString *) = self.webVideoDidClose;
        double volume = self.vlcPlayer.audio.volume / 100.0;
        BOOL muted = self.vlcPlayer.audio.isMuted;
        NSString *action = self.webVideoCompletionAction ?: @"closed";
        self.pendingWebVideoClose = ^{ closed(time, volume, muted, action); };
        self.webVideoDidClose = nil;
    }
    self.vlcPlayer.delegate = nil;
    [self.vlcPlayer stop];
    [self.server stop];
    [self.progressTimer invalidate];
    self.progressTimer = nil;
}

- (void)viewDidDisappear:(BOOL)animated {
    [super viewDidDisappear:animated];
    if (!self.webVideoDismissalInProgress) [self notifyWebVideoClosed];
}

- (void)notifyWebVideoClosed {
    void (^closed)(void) = self.pendingWebVideoClose;
    self.pendingWebVideoClose = nil;
    if (closed) closed();
}

- (BOOL)canBecomeFirstResponder { return YES; }

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.playbackPanel.preferredFocusEnvironments ?: @[];
}

- (UIButton *)controlButtonWithSymbol:(NSString *)symbol label:(NSString *)label action:(SEL)action {
    return [BrowserPlaybackPanel buttonWithSymbol:symbol label:label target:self action:action];
}

- (void)refreshKeepFullscreenControl {
    // Preserve existing site preferences: keeping fullscreen is the inverse
    // presentation of the stored exit setting, not a change to playback.
    BOOL enabled = ![[BrowserPreferencesStore new] automaticallyExitIframeFullscreenForURL:self.webPageURL];
    self.keepFullscreenButton.selected = enabled;
    self.keepFullscreenButton.accessibilityValue = enabled ? @"ON" : @"OFF";
    BrowserTVConfigureToggleBadge(self.keepFullscreenBadge, enabled);
}

- (void)toggleKeepFullscreen {
    BrowserPreferencesStore *preferences = [BrowserPreferencesStore new];
    [preferences setAutomaticallyExitIframeFullscreen:![preferences automaticallyExitIframeFullscreenForURL:self.webPageURL]
                                              forURL:self.webPageURL];
    [self refreshKeepFullscreenControl];
    [self showControls];
}

- (void)refreshTrackControls {
    [self updateTrackButton:self.audioTrackButton prefix:@"Audio"
                   indexes:self.vlcPlayer.audioTrackIndexes names:self.vlcPlayer.audioTrackNames
             selectedIndex:self.vlcPlayer.currentAudioTrackIndex];
    [self updateTrackButton:self.subtitleTrackButton prefix:@"Subtitles"
                   indexes:self.vlcPlayer.videoSubTitlesIndexes names:self.vlcPlayer.videoSubTitlesNames
             selectedIndex:self.vlcPlayer.currentVideoSubTitleIndex];
}

- (void)updateTrackButton:(UIButton *)button prefix:(NSString *)prefix
                  indexes:(NSArray<NSNumber *> *)indexes names:(NSArray<NSString *> *)names
            selectedIndex:(int)selectedIndex {
    NSUInteger count = MIN(indexes.count, names.count);
    NSUInteger realTrackCount = 0;
    NSString *selection = @"Off";
    for (NSUInteger i = 0; i < count; i++) {
        int trackIndex = indexes[i].intValue;
        if (trackIndex >= 0) realTrackCount++;
        if (trackIndex == selectedIndex) selection = trackIndex < 0 ? @"Off" : names[i];
    }
    BOOL relevant = button == self.audioTrackButton ? realTrackCount > 1 : realTrackCount > 0;
    button.enabled = relevant;
    if (button.hidden != !relevant) {
        button.hidden = !relevant;
        [self setNeedsFocusUpdate];
    }
    button.accessibilityLabel = prefix;
    button.accessibilityValue = relevant ? selection : @"Unavailable";
    if (@available(tvOS 17.0, *)) {
        BOOL audio = button == self.audioTrackButton;
        NSString *menuKey = [NSString stringWithFormat:@"%@|%@|%d", indexes, names, selectedIndex];
        NSString *previousKey = audio ? self.audioMenuKey : self.subtitleMenuKey;
        if (![menuKey isEqualToString:previousKey]) {
            NSMutableArray<UIAction *> *actions = [NSMutableArray arrayWithCapacity:count];
            VLCMediaPlayer *player = self.vlcPlayer;
            __weak typeof(self) weakSelf = self;
            for (NSUInteger i = 0; i < count; i++) {
                int trackIndex = indexes[i].intValue;
                NSString *name = trackIndex < 0 ? @"Off" : names[i];
                UIAction *action = [UIAction actionWithTitle:name image:nil identifier:nil
                    handler:^(__unused UIAction *selectedAction) {
                        if (weakSelf.vlcPlayer != player) return;
                        if (audio) player.currentAudioTrackIndex = trackIndex;
                        else player.currentVideoSubTitleIndex = trackIndex;
                        [weakSelf refreshTrackControls];
                        [weakSelf showControls];
                    }];
                action.state = trackIndex == selectedIndex ? UIMenuElementStateOn : UIMenuElementStateOff;
                [actions addObject:action];
            }
            button.menu = relevant ? [UIMenu menuWithTitle:prefix children:actions] : nil;
            button.showsMenuAsPrimaryAction = relevant;
            if (audio) self.audioMenuKey = menuKey; else self.subtitleMenuKey = menuKey;
        }
    }
}

- (void)audioTrackPressed {
    [self presentTrackChoicesWithTitle:@"Audio Track" indexes:self.vlcPlayer.audioTrackIndexes
                                  names:self.vlcPlayer.audioTrackNames
                          selectedIndex:self.vlcPlayer.currentAudioTrackIndex audio:YES];
}

- (void)subtitleTrackPressed {
    [self presentTrackChoicesWithTitle:@"Subtitles" indexes:self.vlcPlayer.videoSubTitlesIndexes
                                  names:self.vlcPlayer.videoSubTitlesNames
                          selectedIndex:self.vlcPlayer.currentVideoSubTitleIndex audio:NO];
}

- (void)presentTrackChoicesWithTitle:(NSString *)title indexes:(NSArray<NSNumber *> *)indexes
                                names:(NSArray<NSString *> *)names selectedIndex:(int)selectedIndex
                               audio:(BOOL)audio {
    NSUInteger count = MIN(indexes.count, names.count);
    if (!count || self.presentedViewController) return;
    [self showControls];
    UIAlertController *choices = [UIAlertController alertControllerWithTitle:title message:nil
                                                               preferredStyle:UIAlertControllerStyleAlert];
    VLCMediaPlayer *player = self.vlcPlayer;
    __weak typeof(self) weakSelf = self;
    for (NSUInteger i = 0; i < count; i++) {
        int trackIndex = indexes[i].intValue;
        NSString *name = trackIndex < 0 ? @"Off" : names[i];
        NSString *optionTitle = trackIndex == selectedIndex ? [@"✓ " stringByAppendingString:name] : name;
        [choices addAction:[UIAlertAction actionWithTitle:optionTitle style:UIAlertActionStyleDefault
            handler:^(__unused UIAlertAction *action) {
                if (weakSelf.vlcPlayer != player) return;
                if (audio) player.currentAudioTrackIndex = trackIndex;
                else player.currentVideoSubTitleIndex = trackIndex;
                [weakSelf refreshTrackControls];
                [weakSelf showControls];
            }]];
    }
    [choices addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:choices animated:YES completion:nil];
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    if (context.previouslyFocusedView != context.nextFocusedView) [self stopHeldSeek];
    [self.playbackPanel updateFocusInContext:context coordinator:coordinator];
    if ([context.nextFocusedView isKindOfClass:UIButton.class] &&
        [context.nextFocusedView isDescendantOfView:self.controlsView]) [self showControls];
}

- (NSString *)downloadStatusWithPrefix:(NSString *)prefix {
    if (self.webVideoURL) return prefix;
    double progress = [[BrowserTorrentManager sharedManager] downloadProgressForTorrent:self.identifier
                                                                             fileIndex:self.fileIndex];
    if (progress < 0) return prefix;
    NSInteger percent = progress >= 1 ? 100 : MIN(99, (NSInteger)(progress * 100));
    return [NSString stringWithFormat:@"%@ · Complete: %ld%%", prefix, (long)percent];
}

- (void)savePlaybackPosition {
    if (self.webVideoURL) {
        [[BrowserPreferencesStore new] setPlayerVolume:self.vlcPlayer.audio.volume / 100.0 forURL:self.webPageURL];
        self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
        return;
    }
    BrowserTorrentManager *manager = [BrowserTorrentManager sharedManager];
    if (self.vlcPlayer.state == VLCMediaPlayerStateEnded) {
        [manager savePlaybackPosition:0 forTorrent:self.identifier fileIndex:self.fileIndex];
        return;
    }
    int64_t position = self.vlcPlayer.time.value.longLongValue;
    if (position < 5000 || self.pendingResumeMs > 0) return;
    int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
    if (duration > 0 && duration - position <= MIN(30000, duration / 20)) position = 0;
    [manager savePlaybackPosition:position forTorrent:self.identifier fileIndex:self.fileIndex];
    self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
}

- (void)refreshProgress {
    [self refreshTrackControls];
    if (self.pendingResumeMs > 0 && self.vlcPlayer.isPlaying && self.vlcPlayer.isSeekable) {
        int64_t target = self.pendingResumeMs;
        self.pendingResumeMs = 0;
        self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
        // Only torrent resume and explicit user seeks reach this queue.
        self.vlcPlayer.time = [VLCTime timeWithNumber:@(target)];
        BrowserDebugLog(@"[TorrentVLC] resume seek fileIndex=%ld positionMs=%lld",
            (long)self.fileIndex, (long long)target);
    }
    int64_t elapsed = self.vlcPlayer.time.value.longLongValue;
    int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
    int64_t remaining = self.vlcPlayer.remainingTime.value.longLongValue;
    if (duration <= 0 && remaining < 0) duration = elapsed - remaining;
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    BOOL advanced = elapsed > self.lastPlaybackTime;
    if (advanced) {
        self.lastPlaybackProgressTime = now;
        if (self.vlcPlayer.isPlaying) self.statusLabel.text = @"";
    } else if (self.vlcPlayer.state == VLCMediaPlayerStateBuffering &&
               now - self.lastPlaybackProgressTime > 2.5) {
        self.statusLabel.text = [self downloadStatusWithPrefix:@"Buffering"];
    }
    double completion = self.webVideoURL ? -1 : [[BrowserTorrentManager sharedManager] downloadProgressForTorrent:self.identifier
                                                                                 fileIndex:self.fileIndex];
    VLCMediaPlayerState state = self.vlcPlayer.state;
    BOOL streaming = self.vlcPlayer.isPlaying && now - self.lastPlaybackProgressTime <= 2.5;
    if (completion >= 0 && state != VLCMediaPlayerStatePaused &&
        state != VLCMediaPlayerStateError && state != VLCMediaPlayerStateEnded) {
        self.statusLabel.text = [self downloadStatusWithPrefix:streaming ? @"Streaming" : @"Buffering"];
    }
    self.lastPlaybackTime = elapsed;
    if (self.pendingResumeMs == 0 && elapsed >= 5000 && now - self.lastPositionSaveTime >= 10)
        [self savePlaybackPosition];
    if (now - self.lastDurationLogTime >= 15) {
        BrowserDebugLog(@"[TorrentVLC] elapsedMs=%lld durationMs=%lld remainingMs=%lld playing=%d",
            (long long)elapsed, (long long)duration, (long long)remaining, self.vlcPlayer.isPlaying);
        self.lastDurationLogTime = now;
    }
    NSDictionary *snapshot = @{@"active":@YES, @"available":@YES,
        @"currentTime":@([self playbackTimeMilliseconds] / 1000.0), @"duration":@(MAX(0,duration) / 1000.0),
        @"paused":@(!self.vlcPlayer.isPlaying), @"buffering":@(!streaming && self.vlcPlayer.isPlaying),
        @"volume":@(self.vlcPlayer.audio.volume / 100.0), @"muted":@(self.vlcPlayer.audio.isMuted),
        @"canVolume":@YES, @"canMute":@YES, @"canRestart":@YES, @"canEnd":@(duration > 0),
        @"canSeekBack":@YES, @"canSeekForward":@YES,
        @"canRequestPrevious":@(self.returnWebVideoOnEnd || !self.webVideoURL),
        @"canRequestNext":@(self.returnWebVideoOnEnd || duration > 0 || !self.webVideoURL),
        @"previousLabel":self.returnWebVideoOnEnd ? @"Previous episode" : @"Previous file",
        @"nextLabel":self.returnWebVideoOnEnd ? @"Next episode" : @"Go to end and next file",
        @"pageTitle":self.mediaTitle ?: @""};
    self.playbackSession.controlsPinned = self.presentedViewController != nil || self.seekHoldKind != 0;
    [self.playbackSession updateState:snapshot];
    [self.playbackPanel updateState:snapshot];
}

- (void)showControls {
    self.playbackSession.controlsPinned = self.presentedViewController != nil || self.seekHoldKind != 0;
    [self.playbackSession showControls];
}

- (void)closePlayer { [self closePressed]; }

- (void)updateWebVideoTitle:(NSString *)title {
    if (!self.webVideoURL || ![title isKindOfClass:NSString.class] || !title.length || title.length > 512) return;
    self.mediaTitle = title;
    [self.playbackSession updateTitle:title];
    if (self.isViewLoaded) self.titleLabel.text = title;
}

- (void)closePressed {
    if (!self.isBeingDismissed && self.presentingViewController) {
        self.webVideoDismissalInProgress = YES;
        [self dismissViewControllerAnimated:YES completion:^{
            self.webVideoDismissalInProgress = NO;
            [self notifyWebVideoClosed];
        }];
    }
}
- (void)playPausePressed {
    if (self.playbackEnded || self.vlcPlayer.state == VLCMediaPlayerStateEnded) {
        [self reopenFinishedMediaAtMilliseconds:0];
    } else if (self.vlcPlayer.isPlaying) {
        [self savePlaybackPosition];
        [self.vlcPlayer pause];
    } else [self.vlcPlayer play];
    [self showControls];
    [self refreshProgress];
}
- (void)seekBackPressed { [self seekByMilliseconds:-10000]; }
- (void)seekForwardPressed { [self seekByMilliseconds:10000]; }
- (void)seekBackPercentPressed { [self seekByMilliseconds:-llround([self seekDurationMilliseconds] * 0.1)]; }
- (void)seekForwardPercentPressed { [self seekByMilliseconds:llround([self seekDurationMilliseconds] * 0.1)]; }

- (void)restartPressed {
    [self stopHeldSeek];
    [self seekToMilliseconds:0];
    if (!self.webVideoURL) [[BrowserTorrentManager sharedManager] savePlaybackPosition:0 forTorrent:self.identifier fileIndex:self.fileIndex];
    self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
    [self showControls];
    [self refreshProgress];
}

- (void)endPressed {
    int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
    if (duration <= 0) return;
    [self stopHeldSeek];
    [self seekToMilliseconds:MAX(0, duration - 2000)];
    [self showControls]; [self refreshProgress];
}

- (void)mutePressed {
    self.vlcPlayer.audio.muted = !self.vlcPlayer.audio.isMuted;
    [self showControls];
    [self refreshProgress];
}

- (void)changeVolumeBy:(int)delta {
    self.vlcPlayer.audio.volume = MAX(0, MIN(100, self.vlcPlayer.audio.volume + delta));
    [self showControls];
    [self refreshProgress];
}

- (void)volumeDownPressed { [self changeVolumeBy:-10]; }
- (void)volumeUpPressed { [self changeVolumeBy:10]; }

- (void)previousFilePressed {
    [self stopHeldSeek];
    int64_t position = [self playbackTimeMilliseconds];
    if (position <= 5000 && self.returnWebVideoOnEnd) [self finishWebVideo:@"previous"];
    else if (position <= 5000) [self switchToAdjacentFileInDirection:-1];
    else [self restartPressed];
}

- (void)nextFilePressed {
    if (self.returnWebVideoOnEnd) {
        [self finishWebVideo:@"next"];
        return;
    }
    [self endPressed]; [self switchToAdjacentFileInDirection:1];
}

- (void)finishWebVideo:(NSString *)action {
    if (self.webVideoFinished || self.isBeingDismissed) return;
    self.webVideoFinished = YES;
    self.webVideoCompletionAction = action;
    [self stopHeldSeek];
    [self closePressed];
}

- (void)switchToAdjacentFileInDirection:(NSInteger)direction {
    [self stopHeldSeek];
    if (self.webVideoURL) return;
    NSArray<NSString *> *extensions = @[@"mp4", @"m4v", @"mov", @"mp3", @"m4a", @"mkv", @"avi"];
    BrowserTorrentFile *candidate = nil;
    for (BrowserTorrentFile *file in [[BrowserTorrentManager sharedManager] filesForTorrent:self.identifier]) {
        if (file.padFile || ![extensions containsObject:file.name.pathExtension.lowercaseString]) continue;
        if (direction > 0 && file.index > self.fileIndex && (!candidate || file.index < candidate.index)) candidate = file;
        if (direction < 0 && file.index < self.fileIndex && (!candidate || file.index > candidate.index)) candidate = file;
    }
    if (!candidate) {

        [self showControls];
        return;
    }
    self.vlcPlayer.delegate = nil;
    [self savePlaybackPosition];
    [self.vlcPlayer stop];
    [self.server stop];
    self.fileIndex = candidate.index;
    self.mediaTitle = candidate.name;
    self.titleLabel.text = candidate.name ?: @"";
    self.statusLabel.text = @"Preparing torrent playback…";
    self.lastReportedState = -1;
    self.lastDurationLogTime = 0;
    [[BrowserTorrentManager sharedManager] prioritizePlaybackForTorrent:self.identifier fileIndex:self.fileIndex];
    [self prepareCurrentMedia];
    [self.vlcPlayer play];
    [self showControls];
    [self refreshProgress];
}
// VLC releases its input at EOF and can then report Stopped. Keep EOF latched until
// a fresh player/input is created; setting time on the released input does nothing.
- (void)reopenFinishedMediaAtMilliseconds:(int64_t)target {
    VLCMediaPlayer *previous = self.vlcPlayer;
    VLCMedia *media = previous.media;
    if (!media) return;
    int volume = previous.audio.volume;
    BOOL muted = previous.audio.isMuted;
    previous.delegate = nil;
    [previous stop];
    previous.drawable = nil;
    VLCMediaPlayer *player = BrowserVLCCreatePlayer();
    self.vlcPlayer = player;
    self.playbackEnded = NO;
    self.lastReportedState = -1;
    self.lastPlaybackTime = 0;
    self.lastPlaybackProgressTime = NSDate.date.timeIntervalSince1970;
    self.pendingResumeMs = MAX(0, target);
    player.delegate = self;
    player.drawable = self.videoView;
    player.media = media;
    player.audio.volume = volume;
    player.audio.muted = muted;
    self.audioMenuKey = nil;
    self.subtitleMenuKey = nil;
    self.statusLabel.text = @"Opening media…";
    BrowserDebugLog(@"[TorrentVLC] reopen positionMs=%lld", (long long)self.pendingResumeMs);
    [player play];
}

- (void)seekToMilliseconds:(int64_t)target {
    target = MAX(0, target);
    int64_t knownDuration = [self seekDurationMilliseconds];
    if (knownDuration > 0) target = MIN(target, knownDuration);
    if (self.playbackEnded || self.vlcPlayer.state == VLCMediaPlayerStateEnded) {
        int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
        if (duration > 0) target = MIN(target, MAX(0, duration - 1000));
        [self reopenFinishedMediaAtMilliseconds:target];
    } else if (!self.vlcPlayer.isSeekable &&
               (self.vlcPlayer.state == VLCMediaPlayerStateOpening ||
                self.vlcPlayer.state == VLCMediaPlayerStateBuffering)) {
        self.pendingResumeMs = target;
    } else {
        self.pendingResumeMs = 0;
        self.vlcPlayer.time = [VLCTime timeWithNumber:@(target)];
    }
}

- (void)seekByMilliseconds:(int64_t)delta { [self seekByMilliseconds:delta revealControls:YES]; }
- (void)seekByMilliseconds:(int64_t)delta revealControls:(BOOL)reveal {
    int64_t position = [self playbackTimeMilliseconds];
    [self seekToMilliseconds:position + delta];
    if (reveal) [self showControls];
    [self refreshProgress];
}

- (void)mediaPlayerStateChanged:(NSNotification *)notification {
    VLCMediaPlayer *player = self.vlcPlayer;
    if (notification.object != player) return;
    VLCMediaPlayerState state = player.state;
    if (self.lastReportedState == state) return;
    self.lastReportedState = state;
    BrowserDebugLog(@"[TorrentVLC] state=%ld", (long)state);
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.vlcPlayer != player) return;
        switch (state) {
            case VLCMediaPlayerStateOpening: self.statusLabel.text = @"Opening media…"; break;
            case VLCMediaPlayerStateBuffering:
                if (NSDate.date.timeIntervalSince1970 - self.lastPlaybackProgressTime > 2.5)
                    self.statusLabel.text = [self downloadStatusWithPrefix:@"Buffering"];
                break;
            case VLCMediaPlayerStatePlaying: self.statusLabel.text = @""; [self showControls]; break;
            case VLCMediaPlayerStatePaused: self.statusLabel.text = @"Paused"; break;
            case VLCMediaPlayerStateError: self.statusLabel.text = self.webVideoURL
                ? @"Playback failed. Return to the page to use its player." : @"Playback failed. Check torrent availability or file format."; break;
            case VLCMediaPlayerStateEnded:
                if (self.returnWebVideoOnEnd) {
                    VLCMediaStats stats = player.media.statistics;
                    // Adaptive HTTP failures can report Ended without decoding
                    // anything. Do not turn a failed start into website EOF/Next.
                    if (stats.decodedVideo == 0 && stats.decodedAudio == 0) {
                        self.statusLabel.text = @"Playback could not start. Return to the page and try again.";
                        [self showControls];
                        BrowserDebugLog(@"[WebVLC] endedBeforeDecode=1");
                        return;
                    }
                    [self finishWebVideo:@"ended"]; return;
                }
                self.playbackEnded = YES;
                self.statusLabel.text = @"Playback finished";
                [self savePlaybackPosition];
                break;
            default: break;
        }
        if (state == VLCMediaPlayerStateOpening || state == VLCMediaPlayerStateBuffering ||
            state == VLCMediaPlayerStatePaused || state == VLCMediaPlayerStateError ||
            state == VLCMediaPlayerStateEnded) [self showControls];
        [self refreshProgress];
    });
}

- (void)arrowShortSeek { [self seekByMilliseconds:self.arrowSeekDirection * 10000 revealControls:NO]; }
- (BOOL)browserHandlePlaybackArrow:(UIPress *)press {
    if (press.phase == UIPressPhaseBegan) {
        if (!(self.view.window && self.controlsView.hidden && !self.presentedViewController)) return NO;
        self.arrowSeekDirection = press.type == UIPressTypeLeftArrow ? -1 : 1;
        if (!self.arrowPressDriver) {
            self.arrowPressDriver = [BrowserSeekButton new];
            self.arrowPressDriver.acceptsUnfocusedPress = YES;
            [self.arrowPressDriver addTarget:self action:@selector(arrowShortSeek) forControlEvents:UIControlEventPrimaryActionTriggered];
            __weak typeof(self) weakSelf = self;
            self.arrowPressDriver.holdBegan = ^{ [weakSelf beginHeldSeek:weakSelf.arrowSeekDirection]; };
            self.arrowPressDriver.holdEnded = ^{ [weakSelf stopHeldSeek]; };
        }
    }
    [self.arrowPressDriver handlePlaybackPressPhase:press.phase];
    return YES;
}

- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    UIPressType type = presses.anyObject.type;
    if (self.controlsView.hidden && (type == UIPressTypeLeftArrow || type == UIPressTypeRightArrow)) {
        self.arrowSeekDirection = type == UIPressTypeLeftArrow ? -1 : 1; return;
    }
    [super pressesBegan:presses withEvent:event];
}
- (void)pressesCancelled:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    self.arrowSeekDirection = 0;
    [self stopHeldSeek];
    [super pressesCancelled:presses withEvent:event];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    UIPressType type = presses.anyObject.type;
    if (self.arrowSeekDirection && (type == UIPressTypeLeftArrow || type == UIPressTypeRightArrow)) {
        NSInteger direction = self.arrowSeekDirection; self.arrowSeekDirection = 0;
        [self seekByMilliseconds:direction * 10000 revealControls:NO]; return;
    }
    if (type == UIPressTypeMenu) {
        [self closePressed];
        return;
    }
    if (type == UIPressTypeSelect && self.controlsView.hidden) {
        [self showControls];
        return;
    }
    if (type == UIPressTypeSelect) {
        [super pressesEnded:presses withEvent:event];
        return;
    }
    if (type == UIPressTypePlayPause) {
        [self playPausePressed];
        return;
    }
    if (type == UIPressTypeLeftArrow || type == UIPressTypeRightArrow ||
        type == UIPressTypeUpArrow || type == UIPressTypeDownArrow) {
        if (!self.controlsView.hidden) [super pressesEnded:presses withEvent:event];
        return;
    }
    [super pressesEnded:presses withEvent:event];
}

@end
