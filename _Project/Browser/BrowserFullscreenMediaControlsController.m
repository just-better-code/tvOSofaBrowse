#import "BrowserFullscreenMediaControlsController.h"
#import "BrowserTVAppearance.h"
#import "BrowserPlaybackSymbols.h"

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
    NSArray *labels = @[@"Previous media", @"Go to beginning", @"Back 10 seconds", @"Back 5 seconds", @"Pause", @"Forward 5 seconds", @"Forward 10 seconds", @"Next media", @"Go to end", @"Mute", @"Volume down", @"Volume up"];
    NSMutableArray *buttons = [NSMutableArray array];
    for (NSUInteger i = 0; i < symbols.count; i++) {
        UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
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
        if (i == 2 || i == 3 || i == 5 || i == 6) {
            UILongPressGestureRecognizer *hold = [[UILongPressGestureRecognizer alloc] initWithTarget:self action:@selector(seekHeld:)];
            hold.minimumPressDuration = 0.6; hold.allowedPressTypes = @[@(UIPressTypeSelect)];
            hold.cancelsTouchesInView = YES; [button addGestureRecognizer:hold];
        }
        [buttons addObject:button];
    }
    self.buttons = buttons;
    UIStackView *row = [[UIStackView alloc] initWithArrangedSubviews:@[buttons[0], buttons[2], buttons[3], buttons[1], buttons[4], buttons[8], buttons[5], buttons[6], buttons[7]]];
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
- (void)togglePlayback { [self showControls]; if ([self.mediaState[@"available"] boolValue]) self.sendCommand(@"toggle", 0); }
- (void)closePlayer { [self stopSeeking]; self.sendCommand(@"exit", 0); }
- (NSInteger)seekSeconds:(NSInteger)tag { return [@[@0, @0, @(-10), @(-5), @0, @5, @10, @0][tag] integerValue]; }
- (void)buttonPressed:(UIButton *)button {
    [self showControls];
    if (button.tag == 0) self.sendCommand(@"previous", 0);
    else if (button.tag == 1) { [self stopSeeking]; self.sendCommand(@"restart", 0); }
    else if (button.tag == 4) [self togglePlayback];
    else if (button.tag == 7) self.sendCommand(@"next", 0);
    else if (button.tag == 8) { [self stopSeeking]; self.sendCommand(@"end", 0); }
    else if (button.tag == 9) self.sendCommand(@"mute", 0);
    else if (button.tag == 10 || button.tag == 11) self.sendCommand(@"volume", button.tag == 10 ? -0.1 : 0.1);
    else self.sendCommand(@"seek", [self seekSeconds:button.tag]);
}
- (void)seekHeld:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state == UIGestureRecognizerStateBegan) {
        [self stopSeeking];
        UIButton *button = (UIButton *)recognizer.view;
        if (!button.enabled) return;
        self.seekStep = [self seekSeconds:button.tag] * 2;
        self.seekStarted = NSDate.timeIntervalSinceReferenceDate - recognizer.minimumPressDuration;
        [self repeatSeek];
        __weak typeof(self) weakSelf = self;
        self.seekTimer = [NSTimer timerWithTimeInterval:0.8 repeats:YES block:^(NSTimer *timer) { [weakSelf repeatSeek]; }];
        [[NSRunLoop mainRunLoop] addTimer:self.seekTimer forMode:NSRunLoopCommonModes];
    } else if (recognizer.state == UIGestureRecognizerStateEnded || recognizer.state == UIGestureRecognizerStateCancelled || recognizer.state == UIGestureRecognizerStateFailed) {
        [self stopSeeking]; [self showControls];
    }
}
- (void)repeatSeek {
    [self showControls]; NSInteger step = self.seekStep;
    if (labs(step) == 20 && NSDate.timeIntervalSinceReferenceDate - self.seekStarted >= 10) step *= 2;
    self.sendCommand(@"seek", step);
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
