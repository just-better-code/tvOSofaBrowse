#import "BrowserPreferencesStore.h"
#import "BrowserVLCPlayerViewController.h"

#import "BrowserTorrentHTTPServer.h"
#import "BrowserTorrentManager.h"
#import "BrowserTVAppearance.h"
#import "BrowserPlaybackSymbols.h"

#import <TVVLCKit/TVVLCKit.h>

@interface BrowserVLCPlayerViewController () <VLCMediaPlayerDelegate>
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
@property (nonatomic) UILabel *titleLabel;
@property (nonatomic) UILabel *timeLabel;
@property (nonatomic) UIProgressView *progressView;
@property (nonatomic) UIView *controlsView;
@property (nonatomic) UIButton *playButton;
@property (nonatomic) UIButton *muteButton;
@property (nonatomic) UIButton *audioTrackButton;
@property (nonatomic) UIButton *subtitleTrackButton;
@property (nonatomic, copy) NSString *audioMenuKey;
@property (nonatomic, copy) NSString *subtitleMenuKey;
@property (nonatomic) NSTimer *progressTimer;
@property (nonatomic) NSUInteger controlsGeneration;
@property (nonatomic) NSInteger lastReportedState;
@property (nonatomic) BOOL playbackEnded;
@property (nonatomic) UIView *headerView;
@property (nonatomic) NSTimeInterval lastDurationLogTime;
@property (nonatomic) UIView *videoView;
@property (nonatomic) int64_t lastPlaybackTime;
@property (nonatomic) NSTimeInterval lastPlaybackProgressTime;
@property (nonatomic) int64_t pendingResumeMs;
@property (nonatomic) NSTimeInterval lastPositionSaveTime;
@property (nonatomic) NSTimer *seekHoldTimer;
@property (nonatomic) int64_t seekHoldStepMs;
@property (nonatomic) int64_t seekHoldTargetMs;
@property (nonatomic) NSTimeInterval seekHoldStartTime;
@end

@implementation BrowserVLCPlayerViewController
static NSInteger const kBrowserVLCControlIconTag = 9797;

- (UIVisualEffectView *)glassBackdrop {
    Class glassClass = NSClassFromString(@"UIGlassEffect");
    UIVisualEffect *effect = BrowserTVPanelEffect();
    UIVisualEffectView *backdrop = [[UIVisualEffectView alloc] initWithEffect:effect];
    backdrop.translatesAutoresizingMaskIntoConstraints = NO;
    backdrop.layer.borderWidth = glassClass != Nil ? 0 : 1;
    backdrop.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.25].CGColor;
    return backdrop;
}

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

    UIView *header = [UIView new];
    header.translatesAutoresizingMaskIntoConstraints = NO;
    header.backgroundColor = UIColor.clearColor;
    [self.view addSubview:header];
    self.headerView = header;
    UIVisualEffectView *headerBackdrop = [self glassBackdrop];
    [header addSubview:headerBackdrop];
    UILabel *title = [UILabel new];
    title.translatesAutoresizingMaskIntoConstraints = NO;
    title.text = self.mediaTitle;
    title.textColor = UIColor.whiteColor;
    title.font = [UIFont systemFontOfSize:26 weight:UIFontWeightSemibold];
    [header addSubview:title];
    self.titleLabel = title;
    UILabel *status = [UILabel new];
    status.translatesAutoresizingMaskIntoConstraints = NO;
    status.text = self.webVideoURL ? @"Preparing video…" : @"Preparing torrent playback…";
    status.textColor = UIColor.whiteColor;
    status.font = [UIFont systemFontOfSize:22];
    [header addSubview:status];
    self.statusLabel = status;
    [NSLayoutConstraint activateConstraints:@[
        [header.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [header.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [header.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [header.heightAnchor constraintEqualToConstant:145],
        [headerBackdrop.leadingAnchor constraintEqualToAnchor:header.leadingAnchor],
        [headerBackdrop.trailingAnchor constraintEqualToAnchor:header.trailingAnchor],
        [headerBackdrop.topAnchor constraintEqualToAnchor:header.topAnchor],
        [headerBackdrop.bottomAnchor constraintEqualToAnchor:header.bottomAnchor],
        [title.leadingAnchor constraintEqualToAnchor:header.leadingAnchor constant:80],
        [title.topAnchor constraintEqualToAnchor:header.topAnchor constant:55],
        [title.trailingAnchor constraintLessThanOrEqualToAnchor:header.trailingAnchor constant:-80],
        [status.leadingAnchor constraintEqualToAnchor:title.leadingAnchor],
        [status.topAnchor constraintEqualToAnchor:title.bottomAnchor constant:10],
    ]];

    UIView *controls = [UIView new];
    controls.translatesAutoresizingMaskIntoConstraints = NO;
    controls.backgroundColor = UIColor.clearColor;
    [self.view addSubview:controls];
    self.controlsView = controls;
    UIVisualEffectView *controlsBackdrop = [self glassBackdrop];
    [controls addSubview:controlsBackdrop];
    UIProgressView *progress = [UIProgressView new];
    progress.translatesAutoresizingMaskIntoConstraints = NO;
    progress.progressTintColor = UIColor.whiteColor;
    progress.trackTintColor = [UIColor colorWithWhite:1 alpha:0.35];
    [controls addSubview:progress];
    self.progressView = progress;
    UILabel *time = [UILabel new];
    time.translatesAutoresizingMaskIntoConstraints = NO;
    time.textColor = UIColor.whiteColor;
    time.font = [UIFont monospacedDigitSystemFontOfSize:20 weight:UIFontWeightMedium];
    time.text = @"0:00 / --:--";
    [controls addSubview:time];
    self.timeLabel = time;

    UIButton *restart = [self controlButtonWithSymbol:@"backward.end.alt.fill" label:@"Go to beginning" action:@selector(restartPressed)];
    UIButton *previous = [self controlButtonWithSymbol:@"backward.end.fill" label:@"Previous file" action:@selector(previousFilePressed)];
    UIButton *backTen = [self controlButtonWithSymbol:@"backward.fill" label:@"Back 10 seconds" action:@selector(seekBackTenPressed)];
    UIButton *back = [self controlButtonWithSymbol:@"arrowtriangle.left.fill" label:@"Back 5 seconds" action:@selector(seekBackPressed)];
    UIButton *play = [self controlButtonWithSymbol:@"playpause.fill" label:@"Pause" action:@selector(playPausePressed)];
    UIButton *forward = [self controlButtonWithSymbol:@"arrowtriangle.right.fill" label:@"Forward 5 seconds" action:@selector(seekForwardPressed)];
    UIButton *forwardTen = [self controlButtonWithSymbol:@"forward.fill" label:@"Forward 10 seconds" action:@selector(seekForwardTenPressed)];
    UIButton *mute = [self controlButtonWithSymbol:@"speaker.wave.2.fill" label:@"Mute" action:@selector(mutePressed)];
    self.muteButton = mute;
    UIButton *volumeDown = [self controlButtonWithSymbol:@"speaker.minus.fill" label:@"Volume down" action:@selector(volumeDownPressed)];
    UIButton *volumeUp = [self controlButtonWithSymbol:@"speaker.plus.fill" label:@"Volume up" action:@selector(volumeUpPressed)];
    UIButton *next = [self controlButtonWithSymbol:@"forward.end.fill" label:@"Next file" action:@selector(nextFilePressed)];
    if (self.webVideoURL) {
        previous.enabled = NO; next.enabled = NO;
        previous.alpha = 0.35; next.alpha = 0.35;
    }
    backTen.tag = -10;
    back.tag = -5;
    forward.tag = 5;
    forwardTen.tag = 10;
    self.playButton = play;
    UIButton *audioTrack = [self trackButtonWithTitle:@"Audio: Unavailable" action:@selector(audioTrackPressed)];
    UIButton *subtitleTrack = [self trackButtonWithTitle:@"Subtitles: Unavailable" action:@selector(subtitleTrackPressed)];
    self.audioTrackButton = audioTrack;
    self.subtitleTrackButton = subtitleTrack;
    NSArray<UIButton *> *mainButtons = @[previous, backTen, back, restart, play, forward, forwardTen, volumeDown, mute, volumeUp, next];
    for (UIButton *button in mainButtons) {
        CGFloat diameter = (button == play || button == restart) ? 81.6 : 68;
        [button.widthAnchor constraintEqualToConstant:diameter].active = YES;
        [button.heightAnchor constraintEqualToConstant:diameter].active = YES;
    }
    for (UIButton *button in @[audioTrack, subtitleTrack]) {
        [button.widthAnchor constraintEqualToConstant:220].active = YES;
        [button.heightAnchor constraintEqualToConstant:68].active = YES;
    }
    UIStackView *buttons = [[UIStackView alloc] initWithArrangedSubviews:
        @[previous, backTen, back, restart, play, forward, forwardTen, audioTrack, subtitleTrack, next]];
    buttons.translatesAutoresizingMaskIntoConstraints = NO;
    buttons.axis = UILayoutConstraintAxisHorizontal;
    buttons.alignment = UIStackViewAlignmentCenter;
    buttons.spacing = 10;
    [controls addSubview:buttons];
    UIStackView *volumeButtons = [[UIStackView alloc] initWithArrangedSubviews:@[volumeDown, mute, volumeUp]];
    volumeButtons.translatesAutoresizingMaskIntoConstraints = NO;
    volumeButtons.spacing = 10;
    volumeButtons.alignment = UIStackViewAlignmentCenter;
    [controls addSubview:volumeButtons];
    [NSLayoutConstraint activateConstraints:@[
        [controls.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [controls.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [controls.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [controls.heightAnchor constraintEqualToConstant:190],
        [controlsBackdrop.leadingAnchor constraintEqualToAnchor:controls.leadingAnchor],
        [controlsBackdrop.trailingAnchor constraintEqualToAnchor:controls.trailingAnchor],
        [controlsBackdrop.topAnchor constraintEqualToAnchor:controls.topAnchor],
        [controlsBackdrop.bottomAnchor constraintEqualToAnchor:controls.bottomAnchor],
        [progress.leadingAnchor constraintEqualToAnchor:controls.leadingAnchor constant:80],
        [progress.trailingAnchor constraintEqualToAnchor:controls.trailingAnchor constant:-80],
        [progress.topAnchor constraintEqualToAnchor:controls.topAnchor constant:20],
        [time.leadingAnchor constraintEqualToAnchor:progress.leadingAnchor],
        [time.topAnchor constraintEqualToAnchor:progress.bottomAnchor constant:10],
        [volumeButtons.leadingAnchor constraintEqualToAnchor:buttons.trailingAnchor constant:34],
        [volumeButtons.centerYAnchor constraintEqualToAnchor:buttons.centerYAnchor],
        [buttons.centerXAnchor constraintEqualToAnchor:controls.centerXAnchor],
        [buttons.topAnchor constraintEqualToAnchor:time.bottomAnchor constant:15.2],
        [buttons.heightAnchor constraintEqualToConstant:81.6],
    ]];

    UILongPressGestureRecognizer *contextPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                               action:@selector(handleContextPress:)];
    contextPress.minimumPressDuration = 0.6;
    contextPress.allowedPressTypes = @[@(UIPressTypeSelect)];
    contextPress.cancelsTouchesInView = YES;
    [self.view addGestureRecognizer:contextPress];
    for (UIButton *button in @[backTen, back, forward, forwardTen]) {
        UILongPressGestureRecognizer *seekHold = [[UILongPressGestureRecognizer alloc]
            initWithTarget:self action:@selector(handleSeekHold:)];
        seekHold.minimumPressDuration = 0.6;
        seekHold.allowedPressTypes = @[@(UIPressTypeSelect)];
        seekHold.cancelsTouchesInView = YES;
        [button addGestureRecognizer:seekHold];
        [contextPress requireGestureRecognizerToFail:seekHold];
    }

    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(applicationWillResignActive:)
                                                 name:UIApplicationWillResignActiveNotification
                                               object:nil];

    [self prepareCurrentMedia];
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)applicationWillResignActive:(NSNotification *)notification {
    (void)notification;
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

- (void)handleSeekHold:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state == UIGestureRecognizerStateBegan) {
        NSInteger seconds = recognizer.view.tag;
        self.seekHoldStepMs = seconds * 2 * 1000;
        self.seekHoldTargetMs = self.vlcPlayer.time.value.longLongValue;
        self.seekHoldStartTime = NSDate.date.timeIntervalSince1970 - recognizer.minimumPressDuration;
        [self repeatHeldSeek];
        self.seekHoldTimer = [NSTimer timerWithTimeInterval:0.8 target:self
            selector:@selector(repeatHeldSeek) userInfo:nil repeats:YES];
        [[NSRunLoop mainRunLoop] addTimer:self.seekHoldTimer forMode:NSRunLoopCommonModes];
    } else if (recognizer.state == UIGestureRecognizerStateEnded ||
               recognizer.state == UIGestureRecognizerStateCancelled ||
               recognizer.state == UIGestureRecognizerStateFailed) {
        [self stopHeldSeek];
    }
}

- (void)repeatHeldSeek {
    int64_t step = self.seekHoldStepMs;
    if (llabs(step) == 20000 && NSDate.date.timeIntervalSince1970 - self.seekHoldStartTime >= 10)
        step *= 2;
    self.seekHoldTargetMs = MAX(0, self.seekHoldTargetMs + step);
    int64_t duration = self.vlcPlayer.media.length.value.longLongValue;
    if (duration > 0) self.seekHoldTargetMs = MIN(self.seekHoldTargetMs, duration);
    [self seekToMilliseconds:self.seekHoldTargetMs];
    [self showControls];
    [self refreshProgress];
}

- (void)stopHeldSeek {
    [self.seekHoldTimer invalidate];
    self.seekHoldTimer = nil;
    self.seekHoldStepMs = 0;
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
    self.pendingResumeMs = self.webVideoURL ? (int64_t)(self.initialWebTime * 1000)
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
    [media addOption:@":network-caching=3000"];
    if (self.webVideoURL) {
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
    self.vlcPlayer = [[VLCMediaPlayer alloc] initWithOptions:@[]];
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
    if (self.vlcPlayer) [self.vlcPlayer play];
    self.progressTimer = [NSTimer scheduledTimerWithTimeInterval:1 target:self selector:@selector(refreshProgress) userInfo:nil repeats:YES];
    [self refreshProgress];
}

- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated];
    [self stopHeldSeek];
    [self savePlaybackPosition];
    if (self.webVideoURL && self.webVideoDidClose) {
        double time = MAX(0, self.vlcPlayer.time.value.longLongValue / 1000.0);
        if (self.pendingResumeMs > 0) time = self.initialWebTime;
        self.webVideoDidClose(time, self.vlcPlayer.audio.volume / 100.0, self.vlcPlayer.audio.isMuted);
        self.webVideoDidClose = nil;
    }
    self.vlcPlayer.delegate = nil;
    [self.vlcPlayer stop];
    [self.server stop];
    [self.progressTimer invalidate];
    self.progressTimer = nil;
    self.controlsGeneration++;
}

- (BOOL)canBecomeFirstResponder { return YES; }

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.controlsView.hidden ? @[] : @[self.playButton];
}

- (UIButton *)controlButtonWithSymbol:(NSString *)symbol label:(NSString *)label action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.backgroundColor = UIColor.clearColor;
    CGFloat scale = ([symbol isEqualToString:@"playpause.fill"] || [symbol isEqualToString:@"backward.end.alt.fill"]) ? 1.2 : 1;
    button.layer.cornerRadius = 34 * scale;
    button.clipsToBounds = YES;
    UIVisualEffectView *backdrop = [self glassBackdrop];
    backdrop.userInteractionEnabled = NO;
    [button insertSubview:backdrop atIndex:0];
    [NSLayoutConstraint activateConstraints:@[
        [backdrop.leadingAnchor constraintEqualToAnchor:button.leadingAnchor],
        [backdrop.trailingAnchor constraintEqualToAnchor:button.trailingAnchor],
        [backdrop.topAnchor constraintEqualToAnchor:button.topAnchor],
        [backdrop.bottomAnchor constraintEqualToAnchor:button.bottomAnchor],
    ]];
    button.accessibilityLabel = label;
    UIImageView *icon = [[UIImageView alloc] initWithImage:BrowserPlaybackControlImage(symbol)];
    icon.translatesAutoresizingMaskIntoConstraints = NO;
    icon.tag = kBrowserVLCControlIconTag;
    icon.contentMode = UIViewContentModeScaleAspectFit;
    icon.tintColor = UIColor.whiteColor;
    icon.userInteractionEnabled = NO;
    [button addSubview:icon];
    [NSLayoutConstraint activateConstraints:@[
        [icon.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
        [icon.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
        [icon.widthAnchor constraintEqualToConstant:38 * scale],
        [icon.heightAnchor constraintEqualToConstant:38 * scale],
    ]];
    [button addTarget:self action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

- (UIButton *)trackButtonWithTitle:(NSString *)title action:(SEL)action {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.backgroundColor = UIColor.clearColor;
    button.layer.cornerRadius = 34;
    button.clipsToBounds = YES;
    UIVisualEffectView *backdrop = [self glassBackdrop];
    backdrop.userInteractionEnabled = NO;
    [button insertSubview:backdrop atIndex:0];
    [NSLayoutConstraint activateConstraints:@[
        [backdrop.leadingAnchor constraintEqualToAnchor:button.leadingAnchor],
        [backdrop.trailingAnchor constraintEqualToAnchor:button.trailingAnchor],
        [backdrop.topAnchor constraintEqualToAnchor:button.topAnchor],
        [backdrop.bottomAnchor constraintEqualToAnchor:button.bottomAnchor],
    ]];
    button.titleLabel.font = [UIFont systemFontOfSize:18 weight:UIFontWeightSemibold];
    button.titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
    button.titleLabel.adjustsFontSizeToFitWidth = YES;
    button.titleLabel.minimumScaleFactor = 0.85;
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    [button setTitleColor:BrowserTVFocusedTextColor() forState:UIControlStateFocused];
    [button addTarget:self action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    button.enabled = NO;
    return button;
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
    BOOL hasTrack = NO;
    NSString *selection = @"Off";
    for (NSUInteger i = 0; i < count; i++) {
        int trackIndex = indexes[i].intValue;
        if (trackIndex >= 0) hasTrack = YES;
        if (trackIndex == selectedIndex) selection = trackIndex < 0 ? @"Off" : names[i];
    }
    button.enabled = hasTrack;
    NSString *title = hasTrack ? [NSString stringWithFormat:@"%@: %@ ▾", prefix, selection]
                               : [NSString stringWithFormat:@"%@: Unavailable", prefix];
    if (![button.currentTitle isEqualToString:title]) [button setTitle:title forState:UIControlStateNormal];
    button.accessibilityLabel = title;
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
            button.menu = hasTrack ? [UIMenu menuWithTitle:prefix children:actions] : nil;
            button.showsMenuAsPrimaryAction = hasTrack;
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
    for (UIView *view in @[context.previouslyFocusedView ?: [UIView new], context.nextFocusedView ?: [UIView new]]) {
        if (![view isKindOfClass:UIButton.class] || ![view isDescendantOfView:self.controlsView]) continue;
        BOOL focused = view == context.nextFocusedView;
        [coordinator addCoordinatedAnimations:^{
            view.backgroundColor = focused ? BrowserTVFocusedSurfaceColor() : UIColor.clearColor;
            UIImageView *icon = (UIImageView *)[view viewWithTag:kBrowserVLCControlIconTag];
            icon.tintColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
        } completion:nil];
    }
    if ([context.nextFocusedView isKindOfClass:UIButton.class] &&
        [context.nextFocusedView isDescendantOfView:self.controlsView]) [self showControls];
}

- (NSString *)timeText:(int64_t)milliseconds {
    NSInteger seconds = MAX(0, milliseconds / 1000);
    return [NSString stringWithFormat:@"%ld:%02ld", (long)(seconds / 60), (long)(seconds % 60)];
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
    self.timeLabel.text = [NSString stringWithFormat:@"%@ / %@", [self timeText:elapsed],
        duration > 0 ? [self timeText:duration] : @"--:--"];
    self.timeLabel.text = [self.timeLabel.text stringByAppendingFormat:@"  •  Volume %d%%", self.vlcPlayer.audio.volume];
    self.progressView.progress = duration > 0 ? MIN(1.0, MAX(0.0, (double)elapsed / duration)) : 0;
    BOOL playing = self.vlcPlayer.isPlaying;
    UIImageView *playIcon = (UIImageView *)[self.playButton viewWithTag:kBrowserVLCControlIconTag];
    playIcon.image = BrowserPlaybackControlImage(@"playpause.fill");
    self.playButton.accessibilityLabel = playing ? @"Pause" : @"Play";
    BOOL muted = self.vlcPlayer.audio.isMuted;
    ((UIImageView *)[self.muteButton viewWithTag:kBrowserVLCControlIconTag]).image = BrowserPlaybackControlImage(muted ? @"speaker.slash.fill" : @"speaker.wave.2.fill");
    self.muteButton.accessibilityLabel = muted ? @"Unmute" : @"Mute";
}

- (void)showControls {
    self.controlsView.hidden = NO;
    self.headerView.hidden = NO;
    self.titleLabel.hidden = NO;
    self.controlsGeneration++;
    [self scheduleControlsHideForGeneration:self.controlsGeneration after:5];
}

- (void)scheduleControlsHideForGeneration:(NSUInteger)generation after:(NSTimeInterval)delay {
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!weakSelf || weakSelf.controlsGeneration != generation || !weakSelf.view.window) return;
        if (weakSelf.presentedViewController || !weakSelf.vlcPlayer.isPlaying ||
            NSDate.date.timeIntervalSince1970 - weakSelf.lastPlaybackProgressTime > 2.5) {
            [weakSelf scheduleControlsHideForGeneration:generation after:1];
            return;
        }
        weakSelf.controlsView.hidden = YES;
        weakSelf.headerView.hidden = YES;
        weakSelf.titleLabel.hidden = YES;
        [weakSelf setNeedsFocusUpdate];
        [weakSelf updateFocusIfNeeded];
    });
}

- (void)closePressed { [self dismissViewControllerAnimated:YES completion:nil]; }
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
- (void)seekBackPressed { [self seekByMilliseconds:-5000]; }
- (void)seekForwardPressed { [self seekByMilliseconds:5000]; }
- (void)seekBackTenPressed { [self seekByMilliseconds:-10000]; }
- (void)seekForwardTenPressed { [self seekByMilliseconds:10000]; }

- (void)restartPressed {
    [self stopHeldSeek];
    [self seekToMilliseconds:0];
    if (!self.webVideoURL) [[BrowserTorrentManager sharedManager] savePlaybackPosition:0 forTorrent:self.identifier fileIndex:self.fileIndex];
    self.lastPositionSaveTime = NSDate.date.timeIntervalSince1970;
    [self showControls];
    [self refreshProgress];
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

- (void)previousFilePressed { [self switchToAdjacentFileInDirection:-1]; }

- (void)nextFilePressed { [self switchToAdjacentFileInDirection:1]; }

- (void)switchToAdjacentFileInDirection:(NSInteger)direction {
    if (self.webVideoURL) return;
    NSArray<NSString *> *extensions = @[@"mp4", @"m4v", @"mov", @"mp3", @"m4a", @"mkv", @"avi"];
    BrowserTorrentFile *candidate = nil;
    for (BrowserTorrentFile *file in [[BrowserTorrentManager sharedManager] filesForTorrent:self.identifier]) {
        if (file.padFile || ![extensions containsObject:file.name.pathExtension.lowercaseString]) continue;
        if (direction > 0 && file.index > self.fileIndex && (!candidate || file.index < candidate.index)) candidate = file;
        if (direction < 0 && file.index < self.fileIndex && (!candidate || file.index > candidate.index)) candidate = file;
    }
    if (!candidate) {
        if (direction < 0) self.vlcPlayer.time = [VLCTime timeWithNumber:@0];
        [self showControls];
        return;
    }
    self.vlcPlayer.delegate = nil;
    [self savePlaybackPosition];
    [self.vlcPlayer stop];
    [self.server stop];
    self.fileIndex = candidate.index;
    self.mediaTitle = candidate.name;
    self.titleLabel.text = candidate.name;
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
    VLCMediaPlayer *player = [[VLCMediaPlayer alloc] initWithOptions:@[]];
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

- (void)seekByMilliseconds:(int64_t)delta {
    int64_t position = self.pendingResumeMs > 0 ? self.pendingResumeMs : self.vlcPlayer.time.value.longLongValue;
    [self seekToMilliseconds:position + delta];
    [self showControls];
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

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    UIPressType type = presses.anyObject.type;
    if (type == UIPressTypeMenu) {
        [self closePressed];
        return;
    }
    if (type == UIPressTypeSelect && self.controlsView.hidden) {
        [self showControls];
        [self setNeedsFocusUpdate];
        [self updateFocusIfNeeded];
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
