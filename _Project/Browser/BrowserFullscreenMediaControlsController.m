#import "BrowserFullscreenMediaControlsController.h"
#import "BrowserTVAppearance.h"
#import "BrowserPlaybackSymbols.h"
#import "BrowserPlaybackSeek.h"

@interface BrowserSeekButton ()
@property (nonatomic) NSTimer *holdThresholdTimer;
@property (nonatomic) BOOL selectPending;
@property (nonatomic) BOOL holding;
@end
@implementation BrowserSeekButton
- (void)cancelHeldPress {
    [self.holdThresholdTimer invalidate]; self.holdThresholdTimer = nil;
    BOOL hadPress = self.selectPending;
    self.selectPending = NO; self.holding = NO; self.highlighted = NO;
    if (hadPress && self.holdEnded) self.holdEnded();
}
- (void)handlePlaybackPressPhase:(UIPressPhase)phase {
    if (phase == UIPressPhaseBegan) {
        if (!self.enabled || self.selectPending) return;
        self.selectPending = YES; self.highlighted = YES;
        __weak typeof(self) weakSelf = self;
        self.holdThresholdTimer = [NSTimer timerWithTimeInterval:0.6 repeats:NO block:^(NSTimer *timer) {
            BrowserSeekButton *button = weakSelf;
            if (!button.selectPending || !button.enabled || (!button.acceptsUnfocusedPress && !button.focused) || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) { [button cancelHeldPress]; return; }
            button.holding = YES;
            if (button.holdBegan) button.holdBegan();
        }];
        [[NSRunLoop mainRunLoop] addTimer:self.holdThresholdTimer forMode:NSRunLoopCommonModes];
    } else if (phase == UIPressPhaseEnded) {
        BOOL activate = self.selectPending && !self.holding && self.enabled && (self.focused || self.acceptsUnfocusedPress);
        [self cancelHeldPress];
        if (activate) [self sendActionsForControlEvents:UIControlEventPrimaryActionTriggered];
    } else if (phase == UIPressPhaseCancelled) [self cancelHeldPress];
}
- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    if (presses.anyObject.type == UIPressTypeSelect) [self handlePlaybackPressPhase:UIPressPhaseBegan];
    else [super pressesBegan:presses withEvent:event];
}
- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    if (presses.anyObject.type == UIPressTypeSelect) [self handlePlaybackPressPhase:UIPressPhaseEnded];
    else [super pressesEnded:presses withEvent:event];
}
- (void)pressesCancelled:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    [self cancelHeldPress]; [super pressesCancelled:presses withEvent:event];
}
- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    if (!self.focused) [self cancelHeldPress];
}
- (void)applicationResigned:(NSNotification *)notification { [self cancelHeldPress]; }
- (void)didMoveToWindow {
    [super didMoveToWindow];
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (!self.window) [self cancelHeldPress];
    else [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(applicationResigned:) name:UIApplicationWillResignActiveNotification object:nil];
}
- (void)dealloc { [[NSNotificationCenter defaultCenter] removeObserver:self]; [_holdThresholdTimer invalidate]; }
@end

static NSInteger const BrowserMediaIconTag = 891;

// Leave website hit testing available outside the native panel.
@interface BrowserMediaOverlayView : UIView
@end
@implementation BrowserMediaOverlayView
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *hit = [super hitTest:point withEvent:event];
    return hit == self ? nil : hit;
}
@end

@interface BrowserFullscreenMediaControlsController ()
@property (nonatomic) UIView *panel;
@property (nonatomic) UIView *header;
@property (nonatomic) UILabel *pageTitle;
@property (nonatomic) UIProgressView *progress;
@property (nonatomic) UILabel *timeLabel;
@property (nonatomic) NSArray<UIButton *> *buttons;
@property (nonatomic) NSDictionary *mediaState;
@property (nonatomic) NSTimer *hideTimer;
@property (nonatomic) NSTimer *seekTimer;
@property (nonatomic) NSInteger seekStep;
@property (nonatomic) NSTimeInterval seekStarted;
@end

@implementation BrowserFullscreenMediaControlsController
- (void)loadView {
    self.view = [BrowserMediaOverlayView new];
    self.view.backgroundColor = UIColor.clearColor;
    self.header = [UIView new];
    self.header.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:self.header];
    UIVisualEffectView *headerGlass = [self glassBackdrop];
    [self.header addSubview:headerGlass];
    [self fillView:headerGlass inView:self.header];
    self.pageTitle = [UILabel new];
    self.pageTitle.translatesAutoresizingMaskIntoConstraints = NO;
    self.pageTitle.font = [UIFont systemFontOfSize:26 weight:UIFontWeightSemibold];
    self.pageTitle.textColor = UIColor.whiteColor;
    self.pageTitle.lineBreakMode = NSLineBreakByTruncatingTail;
    [self.header addSubview:self.pageTitle];
    [NSLayoutConstraint activateConstraints:@[
        [self.header.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [self.header.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.header.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.header.heightAnchor constraintEqualToConstant:90],
        [self.pageTitle.leadingAnchor constraintEqualToAnchor:self.header.leadingAnchor constant:80],
        [self.pageTitle.trailingAnchor constraintEqualToAnchor:self.header.trailingAnchor constant:-80],
        [self.pageTitle.centerYAnchor constraintEqualToAnchor:self.header.centerYAnchor]
    ]];
    UIView *panel = [UIView new];
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:panel]; self.panel = panel;
    UIVisualEffectView *backdrop = [self glassBackdrop];
    [panel addSubview:backdrop];
    self.progress = [UIProgressView new];
    self.progress.translatesAutoresizingMaskIntoConstraints = NO;
    self.progress.progressTintColor = UIColor.whiteColor;
    self.progress.trackTintColor = [UIColor colorWithWhite:1 alpha:0.35];
    [panel addSubview:self.progress];
    self.timeLabel = [UILabel new];
    self.timeLabel.translatesAutoresizingMaskIntoConstraints = NO;
    self.timeLabel.textColor = UIColor.whiteColor;
    self.timeLabel.font = [UIFont monospacedDigitSystemFontOfSize:20 weight:UIFontWeightMedium];
    [panel addSubview:self.timeLabel];
    NSArray *symbols = @[@"backward.end.fill", @"backward.end.alt.fill", @"backward.fill", @"arrowtriangle.left.fill", @"playpause.fill", @"arrowtriangle.right.fill", @"forward.fill", @"forward.end.fill", @"browser.end.fill", @"speaker.wave.2.fill", @"speaker.minus.fill", @"speaker.plus.fill"];
    NSArray *labels = @[@"Previous media", @"Go to beginning", @"Back 10 percent", @"Back 10 seconds", @"Pause", @"Forward 10 seconds", @"Forward 10 percent", @"Next media", @"Go to end", @"Mute", @"Volume down", @"Volume up"];
    NSMutableArray *buttons = [NSMutableArray array];
    for (NSUInteger i = 0; i < symbols.count; i++) {
        BOOL seekControl = i == 2 || i == 3 || i == 5 || i == 6;
        UIButton *button = seekControl ? [BrowserSeekButton buttonWithType:UIButtonTypeSystem] : [UIButton buttonWithType:UIButtonTypeSystem];
        button.tag = i; button.backgroundColor = UIColor.clearColor;
        CGFloat scale = (i == 1 || i == 4 || i == 8) ? 1.2 : 1;
        button.layer.cornerRadius = 34 * scale; button.clipsToBounds = YES;
        button.accessibilityLabel = labels[i];
        UIVisualEffectView *glass = [self glassBackdrop];
        glass.userInteractionEnabled = NO; [button addSubview:glass];
        [self fillView:glass inView:button];
        UIImageView *icon = [[UIImageView alloc] initWithImage:[self image:symbols[i]]];
        icon.tag = BrowserMediaIconTag; icon.translatesAutoresizingMaskIntoConstraints = NO;
        icon.tintColor = UIColor.whiteColor; icon.contentMode = UIViewContentModeScaleAspectFit;
        icon.userInteractionEnabled = NO; [button addSubview:icon];
        [NSLayoutConstraint activateConstraints:@[
            [button.widthAnchor constraintEqualToConstant:68 * scale], [button.heightAnchor constraintEqualToConstant:68 * scale],
            [icon.widthAnchor constraintEqualToConstant:38 * scale], [icon.heightAnchor constraintEqualToConstant:38 * scale],
            [icon.centerXAnchor constraintEqualToAnchor:button.centerXAnchor], [icon.centerYAnchor constraintEqualToAnchor:button.centerYAnchor]
        ]];
        [button addTarget:self action:@selector(buttonPressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
        if (seekControl) {
            __weak typeof(self) weakSelf = self;
            NSInteger kind = [self seekKind:i];
            ((BrowserSeekButton *)button).holdBegan = ^{ [weakSelf beginHeldSeek:kind]; };
            ((BrowserSeekButton *)button).holdEnded = ^{ [weakSelf stopSeeking]; [weakSelf showControls]; };
        }
        [buttons addObject:button];
    }
    self.buttons = buttons;
    ((UIButton *)buttons[1]).hidden = YES; ((UIButton *)buttons[8]).hidden = YES;
    UIStackView *row = [[UIStackView alloc] initWithArrangedSubviews:@[buttons[0], buttons[2], buttons[3], buttons[4], buttons[5], buttons[6], buttons[7]]];
    row.translatesAutoresizingMaskIntoConstraints = NO; row.spacing = 10;
    row.alignment = UIStackViewAlignmentCenter; [panel addSubview:row];
    UIStackView *volumeRow = [[UIStackView alloc] initWithArrangedSubviews:@[buttons[10], buttons[9], buttons[11]]];
    volumeRow.translatesAutoresizingMaskIntoConstraints = NO;
    volumeRow.spacing = 10; volumeRow.alignment = UIStackViewAlignmentCenter;
    [panel addSubview:volumeRow];
    [self fillView:backdrop inView:panel];
    [NSLayoutConstraint activateConstraints:@[
        [panel.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [panel.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [panel.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor], [panel.heightAnchor constraintEqualToConstant:190],
        [self.progress.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:80],
        [self.progress.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor constant:-80],
        [self.progress.topAnchor constraintEqualToAnchor:panel.topAnchor constant:20],
        [self.timeLabel.leadingAnchor constraintEqualToAnchor:self.progress.leadingAnchor],
        [self.timeLabel.topAnchor constraintEqualToAnchor:self.progress.bottomAnchor constant:10],
        [volumeRow.leadingAnchor constraintEqualToAnchor:row.trailingAnchor constant:34],
        [volumeRow.centerYAnchor constraintEqualToAnchor:row.centerYAnchor],
        [row.centerXAnchor constraintEqualToAnchor:panel.centerXAnchor],
        [row.topAnchor constraintEqualToAnchor:self.timeLabel.bottomAnchor constant:15.2], [row.heightAnchor constraintEqualToConstant:81.6]
    ]];
}
- (UIVisualEffectView *)glassBackdrop {
    UIVisualEffectView *view = [[UIVisualEffectView alloc] initWithEffect:BrowserTVPanelEffect()];
    view.translatesAutoresizingMaskIntoConstraints = NO;
    view.layer.borderWidth = NSClassFromString(@"UIGlassEffect") ? 0 : 1;
    view.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.25].CGColor;
    return view;
}
- (void)fillView:(UIView *)view inView:(UIView *)container {
    [NSLayoutConstraint activateConstraints:@[[view.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [view.trailingAnchor constraintEqualToAnchor:container.trailingAnchor],
        [view.topAnchor constraintEqualToAnchor:container.topAnchor], [view.bottomAnchor constraintEqualToAnchor:container.bottomAnchor]]];
}
- (UIImage *)image:(NSString *)symbol {
    return BrowserPlaybackControlImage(symbol);
}
- (BOOL)controlsVisible { return self.isViewLoaded && !self.panel.hidden; }
- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.controlsVisible ? @[self.buttons[4].enabled ? self.buttons[4] : self.buttons[0]] : @[];
}
- (NSString *)timeText:(double)seconds {
    NSInteger total = MAX(0, (NSInteger)seconds);
    return total >= 3600 ? [NSString stringWithFormat:@"%ld:%02ld:%02ld", (long)(total / 3600), (long)(total / 60 % 60), (long)(total % 60)] : [NSString stringWithFormat:@"%ld:%02ld", (long)(total / 60), (long)(total % 60)];
}
- (void)updateMediaState:(NSDictionary *)state {
    [self loadViewIfNeeded];
    BOOL wasPlaying = self.mediaState && ![self.mediaState[@"paused"] boolValue] && [self.mediaState[@"available"] boolValue];
    self.mediaState = state;
    self.pageTitle.text = state[@"pageTitle"];
    double current = [state[@"currentTime"] doubleValue], duration = [state[@"duration"] doubleValue];
    self.progress.progress = duration > 0 ? MIN(1, MAX(0, current / duration)) : 0;
    self.timeLabel.text = [NSString stringWithFormat:@"%@ / %@", [self timeText:current], duration > 0 ? [self timeText:duration] : @"--:--"];
    if ([state[@"canVolume"] boolValue]) {
        NSString *volume = [NSString stringWithFormat:@"%ld%%", (long)lround([state[@"volume"] doubleValue] * 100)];
        self.timeLabel.text = [self.timeLabel.text stringByAppendingFormat:@"  •  Volume %@", volume];
        self.buttons[10].accessibilityValue = volume;
        self.buttons[11].accessibilityValue = volume;
    }
    NSArray *keys = @[@"active", @"canRestart", @"canSeekBack", @"canSeekBack", @"available", @"canSeekForward", @"canSeekForward", @"active", @"canEnd", @"canMute", @"canVolume", @"canVolume"];
    for (NSUInteger i = 0; i < self.buttons.count; i++) {
        self.buttons[i].enabled = [state[keys[i]] boolValue];
        self.buttons[i].alpha = self.buttons[i].enabled ? 1 : 0.35;
    }
    for (NSNumber *index in @[@2, @6]) {
        UIButton *button = self.buttons[index.unsignedIntegerValue];
        button.enabled = button.enabled && duration > 0 && isfinite(duration);
        button.alpha = button.enabled ? 1 : 0.35;
    }
    self.buttons[0].enabled = current <= 5 ? [state[@"active"] boolValue] : [state[@"canRestart"] boolValue];
    self.buttons[0].accessibilityLabel = current <= 5 ? @"Previous media" : @"Go to beginning";
    self.buttons[0].alpha = self.buttons[0].enabled ? 1 : 0.35;
    self.buttons[7].accessibilityLabel = @"Go to end and next media";
    BOOL paused = [state[@"paused"] boolValue];
    ((UIImageView *)[self.buttons[4] viewWithTag:BrowserMediaIconTag]).image = [self image:@"playpause.fill"];
    self.buttons[4].accessibilityLabel = paused ? @"Play" : @"Pause";
    BOOL muted = [state[@"muted"] boolValue];
    ((UIImageView *)[self.buttons[9] viewWithTag:BrowserMediaIconTag]).image = [self image:muted ? @"speaker.slash.fill" : @"speaker.wave.2.fill"];
    self.buttons[9].accessibilityLabel = muted ? @"Unmute" : @"Mute";
    BOOL playing = !paused && [state[@"available"] boolValue];
    if (!playing) { [self.hideTimer invalidate]; self.hideTimer = nil; }
    else if (!wasPlaying && self.controlsVisible) [self scheduleHide];
    if (self.seekTimer && ![state[self.seekStep < 0 ? @"canSeekBack" : @"canSeekForward"] boolValue]) [self stopSeeking];
    if (self.seekTimer && ((labs(self.seekStep) == 2 && duration <= 0) ||
        ([state[@"seekAtEnd"] boolValue] && self.seekStep > 0) || ([state[@"seekAtStart"] boolValue] && self.seekStep < 0))) [self stopSeeking];
    [self refreshVisibility];
}
- (void)setCursorVisible:(BOOL)cursorVisible {
    _cursorVisible = cursorVisible;
    [self refreshVisibility];
}
- (void)refreshVisibility {
    if (!self.isViewLoaded) return;
    BOOL paused = [self.mediaState[@"available"] boolValue] && [self.mediaState[@"paused"] boolValue];
    BOOL visible = paused || self.cursorVisible || self.seekTimer != nil || self.hideTimer != nil;
    BOOL changed = self.panel.hidden == visible;
    self.panel.hidden = !visible;
    self.header.hidden = !visible || self.pageTitle.text.length == 0;
    if (changed) {
        [self.parentViewController setNeedsFocusUpdate];
        [self.parentViewController updateFocusIfNeeded];
    }
}
- (void)scheduleHide {
    [self.hideTimer invalidate];
    __weak typeof(self) weakSelf = self;
    self.hideTimer = [NSTimer scheduledTimerWithTimeInterval:5 repeats:NO block:^(NSTimer *timer) {
        weakSelf.hideTimer = nil;
        [weakSelf refreshVisibility];
    }];
}
- (void)showControls {
    [self loadViewIfNeeded];
    [self scheduleHide];
    [self refreshVisibility];
}
- (void)beginDirectionalSeek:(NSInteger)direction { [self beginHeldSeek:direction < 0 ? -1 : 1]; }
- (void)seekWithDirection:(NSInteger)direction {
    NSString *capability = direction < 0 ? @"canSeekBack" : @"canSeekForward";
    if ([self.mediaState[capability] boolValue]) [self sendSeekKind:direction < 0 ? -1 : 1];
}
- (void)togglePlayback { [self showControls]; if ([self.mediaState[@"available"] boolValue]) self.sendCommand(@"toggle", 0); }
- (void)closePlayer { [self stopSeeking]; self.sendCommand(@"exit", 0); }
- (NSInteger)seekKind:(NSInteger)tag { return [@[@0, @0, @(-2), @(-1), @0, @1, @2, @0][tag] integerValue]; }
- (void)sendSeekKind:(NSInteger)kind {
    if (labs(kind) == 2) self.sendCommand(@"seekPercent", kind < 0 ? -0.1 : 0.1);
    else self.sendCommand(@"seek", BrowserPlaybackSeekSeconds(kind, 0));
}
- (void)buttonPressed:(UIButton *)button {
    [self showControls];
    if (button.tag == 0) { [self stopSeeking]; self.sendCommand([self.mediaState[@"currentTime"] doubleValue] <= 5 ? @"previous" : @"restart", 0); }
    else if (button.tag == 1) { [self stopSeeking]; self.sendCommand(@"restart", 0); }
    else if (button.tag == 4) [self togglePlayback];
    else if (button.tag == 7) { [self stopSeeking]; self.sendCommand(@"endNext", 0); }
    else if (button.tag == 8) { [self stopSeeking]; self.sendCommand(@"end", 0); }
    else if (button.tag == 9) self.sendCommand(@"mute", 0);
    else if (button.tag == 10 || button.tag == 11) self.sendCommand(@"volume", button.tag == 10 ? -0.1 : 0.1);
    else [self sendSeekKind:[self seekKind:button.tag]];
}
- (void)beginHeldSeek:(NSInteger)kind {
    [self stopSeeking]; self.seekStep = kind;
    self.seekStarted = CACurrentMediaTime(); [self repeatSeek];
}
- (void)repeatSeek {
    if (!self.seekStep) return;
    [self showControls];
    [self sendSeekKind:self.seekStep];
    __weak typeof(self) weakSelf = self;
    self.seekTimer = [NSTimer timerWithTimeInterval:BrowserPlaybackSeekInterval(self.seekStarted) repeats:NO block:^(NSTimer *timer) { [weakSelf repeatSeek]; }];
    [[NSRunLoop mainRunLoop] addTimer:self.seekTimer forMode:NSRunLoopCommonModes];
}
- (void)stopSeeking { [self.seekTimer invalidate]; self.seekTimer = nil; self.seekStep = 0; }
- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated]; [self stopSeeking]; [self.hideTimer invalidate]; self.hideTimer = nil;
}
- (void)dealloc { [_seekTimer invalidate]; [_hideTimer invalidate]; }
- (BOOL)shouldUpdateFocusInContext:(UIFocusUpdateContext *)context {
    if (self.controlsVisible && context.nextFocusedView && ![context.nextFocusedView isDescendantOfView:self.panel] && !self.parentViewController.presentedViewController) return NO;
    return [super shouldUpdateFocusInContext:context];
}
- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    if (context.previouslyFocusedView != context.nextFocusedView) [self stopSeeking];
    for (UIView *view in @[context.previouslyFocusedView ?: [UIView new], context.nextFocusedView ?: [UIView new]]) {
        if (![self.buttons containsObject:view]) continue;
        BOOL focused = view == context.nextFocusedView;
        [coordinator addCoordinatedAnimations:^{
            view.backgroundColor = focused ? BrowserTVFocusedSurfaceColor() : UIColor.clearColor;
            ((UIImageView *)[view viewWithTag:BrowserMediaIconTag]).tintColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
        } completion:nil];
    }
    if ([self.buttons containsObject:context.nextFocusedView]) [self showControls];
}
@end
