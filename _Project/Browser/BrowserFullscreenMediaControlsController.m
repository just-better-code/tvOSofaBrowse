#import "BrowserFullscreenMediaControlsController.h"
#import "BrowserPlaybackSeek.h"
#import "BrowserPlaybackPanel.h"

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

@interface BrowserFullscreenMediaControlsController ()
@property (nonatomic) BrowserPlaybackPanel *playbackPanel;
@property (nonatomic) UIView *panel;
@property (nonatomic) NSArray<UIButton *> *buttons;
@property (nonatomic) NSDictionary *mediaState;
@property (nonatomic) NSTimer *seekTimer;
@property (nonatomic) NSInteger seekStep;
@property (nonatomic) NSTimeInterval seekStarted;
@end

@implementation BrowserFullscreenMediaControlsController
- (void)setPlaybackSession:(BrowserPlaybackSession *)session {
    _playbackSession = session;
    __weak typeof(self) weakSelf = self;
    session.visibilityDidChange = ^(BOOL visible) { [weakSelf refreshVisibility]; };
}
- (void)loadView {
    BrowserPlaybackPanel *panel = [[BrowserPlaybackPanel alloc] initWithPlayerIcon:nil accessoryButtons:@[]];
    self.playbackPanel = panel; self.view = panel;
    self.panel = panel.controls; self.buttons = panel.buttons;
    for (UIButton *button in self.buttons) {
        NSUInteger i = button.tag;
        BOOL seekControl = i == 2 || i == 3 || i == 5 || i == 6;
        [button addTarget:self action:@selector(buttonPressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
        if (seekControl) {
            __weak typeof(self) weakSelf = self;
            NSInteger kind = [self seekKind:i];
            ((BrowserSeekButton *)button).holdBegan = ^{ [weakSelf beginHeldSeek:kind]; };
            ((BrowserSeekButton *)button).holdEnded = ^{ [weakSelf stopSeeking]; [weakSelf showControls]; };
        }
    }
}
- (BOOL)controlsVisible { return self.isViewLoaded && !self.panel.hidden; }
- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.controlsVisible ? @[self.buttons[4].enabled ? self.buttons[4] : self.buttons[0]] : @[];
}
- (void)updateMediaState:(NSDictionary *)state {
    [self loadViewIfNeeded];
    self.mediaState = state;
    [self.playbackSession updateState:state];
    [self.playbackPanel updateState:state];
    double duration = [state[@"duration"] doubleValue];
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
    self.playbackSession.controlsPinned = self.cursorVisible || self.seekStep != 0;
    BOOL visible = self.playbackSession.controlsVisible;
    BOOL changed = self.panel.hidden == visible;
    [self.playbackPanel setControlsVisible:visible];
    if (changed) {
        [self.parentViewController setNeedsFocusUpdate];
        [self.parentViewController updateFocusIfNeeded];
    }
}
- (void)showControls {
    [self loadViewIfNeeded];
    [self.playbackSession showControls];
    [self refreshVisibility];
}
- (void)beginDirectionalSeek:(NSInteger)direction { [self beginHeldSeek:direction < 0 ? -1 : 1]; }
- (void)seekWithDirection:(NSInteger)direction {
    NSString *capability = direction < 0 ? @"canSeekBack" : @"canSeekForward";
    if ([self.mediaState[capability] boolValue]) [self sendSeekKind:direction < 0 ? -1 : 1];
}
- (void)togglePlayback { [self showControls]; if ([self.mediaState[@"available"] boolValue]) [self.playbackSession performCommand:BrowserPlaybackCommandToggle value:0]; }
- (void)closePlayer { [self stopSeeking]; [self.playbackSession performCommand:BrowserPlaybackCommandClose value:0]; }
- (NSInteger)seekKind:(NSInteger)tag { return [@[@0, @0, @(-2), @(-1), @0, @1, @2, @0][tag] integerValue]; }
- (void)sendSeekKind:(NSInteger)kind {
    if (labs(kind) == 2) [self.playbackSession performCommand:BrowserPlaybackCommandSeekFraction value:kind < 0 ? -0.1 : 0.1];
    else [self.playbackSession performCommand:BrowserPlaybackCommandSeekSeconds value:BrowserPlaybackSeekSeconds(kind, 0)];
}
- (void)buttonPressed:(UIButton *)button {
    [self showControls];
    BrowserPlaybackCommand command; double value;
    if (!BrowserPlaybackCommandForControl(button.tag, &command, &value)) return;
    if (command == BrowserPlaybackCommandPrevious || command == BrowserPlaybackCommandRestart ||
        command == BrowserPlaybackCommandNext || command == BrowserPlaybackCommandEnd) [self stopSeeking];
    [self.playbackSession performCommand:command value:value];
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
- (void)stopSeeking { [self.seekTimer invalidate]; self.seekTimer = nil; self.seekStep = 0; [self refreshVisibility]; }
- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated]; [self stopSeeking];
}
- (void)dealloc { [_seekTimer invalidate]; }
- (BOOL)shouldUpdateFocusInContext:(UIFocusUpdateContext *)context {
    if (self.controlsVisible && context.nextFocusedView && ![context.nextFocusedView isDescendantOfView:self.panel] && !self.parentViewController.presentedViewController) return NO;
    return [super shouldUpdateFocusInContext:context];
}
- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    if (context.previouslyFocusedView != context.nextFocusedView) [self stopSeeking];
    [self.playbackPanel updateFocusInContext:context coordinator:coordinator];
    if ([self.buttons containsObject:context.nextFocusedView]) [self showControls];
}
@end
