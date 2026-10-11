#import "BrowserPreferencesStore.h"
#import "BrowserRemoteInputController.h"
#import "BrowserTorrentLibraryViewController.h"

static UIImage *BrowserDefaultCursor(void) {
    static UIImage *image;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        image = [UIImage imageNamed:@"Cursor"];
    });
    return image;
}

static UIImage *BrowserPointerCursor(void) {
    static UIImage *image;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        image = [UIImage imageNamed:@"Pointer"];
    });
    return image;
}

static NSTimeInterval const kBrowserCursorIdleDelay = 3.0;
static NSTimeInterval const kBrowserMagnifierIdleDisableDelay = 30.0;
static CGFloat const kBrowserMagnifierDiameter = 384.0;
static NSTimeInterval const kBrowserSelectHoldDelay = 0.65;
static NSTimeInterval const kBrowserVerticalHoldDelay = 0.38;
static CGFloat const kBrowserVerticalHoldInitialSpeed = 560.0;
static CGFloat const kBrowserVerticalHoldMaximumSpeed = 1800.0;
static CFTimeInterval const kBrowserVerticalHoldAccelerationDuration = 1.2;

static NSString *BrowserPressTypeString(UIPressType type) {
    switch (type) {
        case UIPressTypeMenu: return @"Menu";
        case UIPressTypePlayPause: return @"PlayPause";
        case UIPressTypeSelect: return @"Select";
        case UIPressTypeUpArrow: return @"Up";
        case UIPressTypeDownArrow: return @"Down";
        case UIPressTypeLeftArrow: return @"Left";
        case UIPressTypeRightArrow: return @"Right";
        default: return [NSString stringWithFormat:@"Type-%ld", (long)type];
    }
}

static NSString *BrowserPressPhaseString(UIPressPhase phase) {
    switch (phase) {
        case UIPressPhaseBegan: return @"Began";
        case UIPressPhaseChanged: return @"Changed";
        case UIPressPhaseStationary: return @"Stationary";
        case UIPressPhaseEnded: return @"Ended";
        case UIPressPhaseCancelled: return @"Cancelled";
        default: return [NSString stringWithFormat:@"Phase-%ld", (long)phase];
    }
}

@interface BrowserRemoteInputController ()

@property (nonatomic, weak) id<BrowserRemoteInputControllerHost> host;
@property (nonatomic, weak) UIView *rootView;
@property (nonatomic, readwrite) UIImageView *cursorView;
@property (nonatomic, readwrite, getter=isCursorModeEnabled) BOOL cursorModeEnabled;
@property (nonatomic) CGPoint lastTouchLocation;
@property (nonatomic, weak) UIScrollView *animatedScrollView;
@property (nonatomic) CGFloat animatedScrollTargetY;
@property (nonatomic) CFTimeInterval lastAnimatedScrollPressTimestamp;
@property (nonatomic) CADisplayLink *verticalHoldDisplayLink;
@property (nonatomic) CFTimeInterval verticalHoldLastTimestamp;
@property (nonatomic) CFTimeInterval verticalHoldStartTimestamp;
@property (nonatomic) UIPressType heldVerticalPressType;
@property (nonatomic) BOOL verticalPressPending;
@property (nonatomic) BOOL verticalHoldActive;
@property (nonatomic) NSUInteger verticalHoldGeneration;
@property (nonatomic) CFTimeInterval lastDirectSelectPressTimestamp;
@property (nonatomic) CFTimeInterval lastLongSelectTimestamp;
@property (nonatomic) BOOL selectPressPending;
@property (nonatomic) BOOL selectHoldActivated;
@property (nonatomic) NSUInteger selectHoldGeneration;
@property (nonatomic) BOOL selectClickHandledByGlobal;
@property (nonatomic) BOOL selectLongPressEndedByGlobal;
@property (nonatomic) BOOL newTabKeyboardSelectionActive;
@property (nonatomic) CGPoint newTabKeyboardSelectionCursorOrigin;
@property (nonatomic) NSUInteger observedNewTabPageGeneration;
@property (nonatomic) BOOL cursorHiddenForDirectionalNavigation;
@property (nonatomic) CGPoint directionalNavigationCursorOrigin;
@property (nonatomic) CFTimeInterval lastTabOverviewUpPressTimestamp;
@property (nonatomic) BOOL primaryActionInProgress;
@property (nonatomic) BOOL hoverRequestInFlight;
@property (nonatomic) CGPoint latestHoverPoint;
@property (nonatomic) NSUInteger hoverGeneration;
@property (nonatomic) NSUInteger cursorIdleGeneration;
@property (nonatomic) BOOL cursorIdleHidden;
@property (nonatomic) UIView *magnifierView;
@property (nonatomic) UIImageView *magnifierImageView;
@property (nonatomic) BOOL magnifierCaptureInFlight;
@property (nonatomic) CFTimeInterval lastMagnifierCaptureTimestamp;
@property (nonatomic) CGPoint latestMagnifierPoint;
@property (nonatomic) NSUInteger magnifierGeneration;
@property (nonatomic) NSTimer *magnifierRefreshTimer;
@property (nonatomic) NSTimer *magnifierIdleTimer;

@end

@implementation BrowserRemoteInputController

- (void)resetMagnifierIdleTimer {
    [self.magnifierIdleTimer invalidate];
    self.magnifierIdleTimer = nil;
    if (!self.magnifierEnabled) {
        return;
    }

    __weak typeof(self) weakSelf = self;
    self.magnifierIdleTimer = [NSTimer timerWithTimeInterval:kBrowserMagnifierIdleDisableDelay
                                                     repeats:NO
                                                       block:^(__unused NSTimer *timer) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf.magnifierEnabled) {
            return;
        }
        strongSelf.magnifierIdleTimer = nil;
        [strongSelf.host browserRemoteInputControllerToggleMagnifier];
    }];
    [[NSRunLoop mainRunLoop] addTimer:self.magnifierIdleTimer forMode:NSRunLoopCommonModes];
}

- (instancetype)initWithHost:(id<BrowserRemoteInputControllerHost>)host
                    rootView:(UIView *)rootView {
    self = [super init];
    if (self) {
        _host = host;
        _rootView = rootView;
        _lastTouchLocation = CGPointMake(-1, -1);
        _cursorModeEnabled = YES;

        _cursorView = [[UIImageView alloc] initWithFrame:CGRectMake(0, 0, 64, 64)];
        _cursorView.center = CGPointMake(CGRectGetMidX([UIScreen mainScreen].bounds), CGRectGetMidY([UIScreen mainScreen].bounds));
        _cursorView.image = BrowserDefaultCursor();

        _magnifierView = [[UIView alloc] initWithFrame:CGRectMake(0.0, 0.0, kBrowserMagnifierDiameter, kBrowserMagnifierDiameter)];
        _magnifierView.hidden = YES;
        _magnifierView.userInteractionEnabled = NO;
        _magnifierView.backgroundColor = [UIColor colorWithWhite:0.1 alpha:1.0];
        _magnifierView.layer.cornerRadius = kBrowserMagnifierDiameter / 2.0;
        _magnifierView.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.88].CGColor;
        _magnifierView.layer.borderWidth = 5.0;
        _magnifierView.layer.shadowColor = UIColor.blackColor.CGColor;
        _magnifierView.layer.shadowOpacity = 0.6;
        _magnifierView.layer.shadowRadius = 20.0;
        _magnifierView.layer.shadowOffset = CGSizeMake(0.0, 8.0);
        _magnifierImageView = [[UIImageView alloc] initWithFrame:CGRectInset(_magnifierView.bounds, 5.0, 5.0)];
        _magnifierImageView.contentMode = UIViewContentModeScaleAspectFill;
        _magnifierImageView.clipsToBounds = YES;
        _magnifierImageView.layer.cornerRadius = (kBrowserMagnifierDiameter - 10.0) / 2.0;
        [_magnifierView addSubview:_magnifierImageView];
        [rootView addSubview:_magnifierView];
        [rootView bringSubviewToFront:_cursorView];
    }
    return self;
}

- (void)setMagnifierEnabled:(BOOL)magnifierEnabled {
    if (_magnifierEnabled == magnifierEnabled) {
        return;
    }
    _magnifierEnabled = magnifierEnabled;
    self.magnifierGeneration += 1;
    [self.magnifierRefreshTimer invalidate];
    self.magnifierRefreshTimer = nil;
    [self.magnifierIdleTimer invalidate];
    self.magnifierIdleTimer = nil;
    self.magnifierImageView.image = nil;
    self.magnifierView.hidden = YES;
    if (magnifierEnabled) {
        [self resetMagnifierIdleTimer];
        [self noteCursorActivity];
        [self updateMagnifierAtPoint:self.cursorView.frame.origin];
        __weak typeof(self) weakSelf = self;
        self.magnifierRefreshTimer = [NSTimer timerWithTimeInterval:0.25 repeats:YES block:^(__unused NSTimer *timer) {
            __strong typeof(weakSelf) strongSelf = weakSelf;
            if (strongSelf != nil && !strongSelf.cursorIdleHidden) {
                [strongSelf updateMagnifierAtPoint:strongSelf.cursorView.frame.origin];
            }
        }];
        [[NSRunLoop mainRunLoop] addTimer:self.magnifierRefreshTimer forMode:NSRunLoopCommonModes];
    }
}

- (void)updateMagnifierAtPoint:(CGPoint)point {
    if (!self.magnifierEnabled || !self.cursorModeEnabled || self.cursorIdleHidden ||
        [self.host browserRemoteInputControllerPresentedViewController] != nil ||
        [self.host browserRemoteInputControllerTabOverviewVisible]) {
        self.magnifierView.hidden = YES;
        return;
    }
    self.magnifierView.frame = CGRectMake(point.x - kBrowserMagnifierDiameter / 2.0,
                                           point.y - kBrowserMagnifierDiameter / 2.0,
                                           kBrowserMagnifierDiameter, kBrowserMagnifierDiameter);
    [self.rootView bringSubviewToFront:self.magnifierView];
    [self.rootView bringSubviewToFront:self.cursorView];
    self.latestMagnifierPoint = point;
    CFTimeInterval now = CACurrentMediaTime();
    if (self.magnifierCaptureInFlight || now - self.lastMagnifierCaptureTimestamp < 0.12) {
        return;
    }
    self.magnifierCaptureInFlight = YES;
    self.lastMagnifierCaptureTimestamp = now;
    NSUInteger generation = self.magnifierGeneration;
    __weak typeof(self) weakSelf = self;
    [self.host browserRemoteInputControllerCaptureMagnifierAtPoint:point completion:^(UIImage *image) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil) { return; }
        strongSelf.magnifierCaptureInFlight = NO;
        if (generation != strongSelf.magnifierGeneration || !strongSelf.magnifierEnabled) { return; }
        strongSelf.magnifierImageView.image = image;
        strongSelf.magnifierView.hidden = image == nil || strongSelf.cursorSuppressed || strongSelf.cursorIdleHidden ||
            [strongSelf.host browserRemoteInputControllerPresentedViewController] != nil ||
            [strongSelf.host browserRemoteInputControllerTabOverviewVisible];
        if (!CGPointEqualToPoint(point, strongSelf.latestMagnifierPoint)) {
            [strongSelf updateMagnifierAtPoint:strongSelf.latestMagnifierPoint];
        }
    }];
}

- (void)setCursorModeEnabled:(BOOL)cursorModeEnabled {
    BOOL wasCursorModeEnabled = self.cursorModeEnabled;
    _cursorModeEnabled = cursorModeEnabled;
    self.hoverGeneration += 1;
    self.lastTouchLocation = CGPointMake(-1, -1);
    [self refreshInteractionState];
    if (cursorModeEnabled) {
        [self noteCursorActivity];
    } else {
        self.cursorIdleGeneration += 1;
    }
    if (!wasCursorModeEnabled && cursorModeEnabled) {
        [self.host browserRemoteInputControllerPersistSession];
    }
}

- (void)setCursorSuppressed:(BOOL)cursorSuppressed {
    if (_cursorSuppressed == cursorSuppressed) return;
    _cursorSuppressed = cursorSuppressed;
    self.hoverGeneration += 1;
    self.magnifierGeneration += 1;
    self.cursorIdleGeneration += 1;
    self.lastTouchLocation = CGPointMake(-1, -1);
    [self refreshInteractionState];
    if (!cursorSuppressed) [self noteCursorActivity];
}

- (BOOL)cursorVisible {
    return !self.cursorView.hidden && self.cursorView.alpha > 0.01;
}

- (void)notifyCursorVisibility {
    if (self.cursorVisibilityDidChange) self.cursorVisibilityDidChange(self.cursorVisible);
}

- (void)noteCursorActivity {
    if (!self.cursorModeEnabled || self.cursorSuppressed || self.cursorHiddenForDirectionalNavigation) {
        return;
    }
    if (self.magnifierEnabled) {
        [self resetMagnifierIdleTimer];
    }
    self.cursorIdleHidden = NO;
    self.cursorView.hidden = [self.host browserRemoteInputControllerTabOverviewVisible];
    self.magnifierView.hidden = !self.magnifierEnabled || self.magnifierImageView.image == nil ||
        self.cursorView.hidden || [self.host browserRemoteInputControllerPresentedViewController] != nil;
    if (self.cursorView.alpha < 1.0) {
        [UIView animateWithDuration:0.15 animations:^{
            self.cursorView.alpha = 1.0;
        }];
    }

    [self notifyCursorVisibility];
    NSUInteger generation = ++self.cursorIdleGeneration;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kBrowserCursorIdleDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil || generation != strongSelf.cursorIdleGeneration || !strongSelf.cursorModeEnabled) {
            return;
        }
        strongSelf.cursorIdleHidden = YES;
        strongSelf.magnifierView.hidden = YES;
        [UIView animateWithDuration:0.25 animations:^{
            strongSelf.cursorView.alpha = 0.0;
            [strongSelf notifyCursorVisibility];
        } completion:^(__unused BOOL finished) {
            if (generation == strongSelf.cursorIdleGeneration && strongSelf.cursorIdleHidden) {
                strongSelf.cursorView.hidden = YES;
                [strongSelf notifyCursorVisibility];
            }
        }];
    });
}

- (void)hideCursorForDirectionalNavigation {
    self.cursorHiddenForDirectionalNavigation = YES;
    self.directionalNavigationCursorOrigin = self.cursorView.frame.origin;
    self.cursorIdleGeneration += 1;
    self.cursorIdleHidden = YES;
    self.cursorView.alpha = 0.0;
    self.cursorView.hidden = YES;
    self.magnifierView.hidden = YES;
    [self notifyCursorVisibility];
}

- (void)requestHoverStateAtPoint:(CGPoint)point {
    self.latestHoverPoint = point;
    if (self.hoverRequestInFlight) {
        return;
    }

    self.hoverRequestInFlight = YES;
    NSUInteger generation = self.hoverGeneration;
    __weak typeof(self) weakSelf = self;
    [self.host browserRemoteInputControllerHoverStateAtCursorPoint:point completion:^(BOOL isInteractive) {
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil) {
            return;
        }
        strongSelf.hoverRequestInFlight = NO;
        if (!strongSelf.cursorModeEnabled ||
            [strongSelf.host browserRemoteInputControllerTabOverviewVisible]) {
            return;
        }
        if (generation != strongSelf.hoverGeneration) {
            [strongSelf requestHoverStateAtPoint:strongSelf.latestHoverPoint];
            return;
        }
        if (!CGPointEqualToPoint(strongSelf.latestHoverPoint, point)) {
            [strongSelf requestHoverStateAtPoint:strongSelf.latestHoverPoint];
            return;
        }
        strongSelf.cursorView.image = isInteractive ? BrowserPointerCursor() : BrowserDefaultCursor();
    }];
}

- (void)refreshInteractionState {
    UIScrollView *scrollView = [self.host browserRemoteInputControllerActiveScrollView];
    BOOL shouldAllowWebInteraction = !self.cursorModeEnabled &&
        ![self.host browserRemoteInputControllerTabOverviewVisible];
    // Remote arrows own page scrolling; touchpad movement must not pan the page.
    scrollView.scrollEnabled = NO;
    [self.host browserRemoteInputControllerSetWebInteractionEnabled:shouldAllowWebInteraction];
    self.cursorView.hidden = self.cursorSuppressed || !self.cursorModeEnabled ||
        [self.host browserRemoteInputControllerTabOverviewVisible] ||
        self.cursorIdleHidden || self.cursorHiddenForDirectionalNavigation;
    self.magnifierView.hidden = !self.magnifierEnabled || self.magnifierImageView.image == nil ||
        self.cursorView.hidden || [self.host browserRemoteInputControllerPresentedViewController] != nil;
    if (self.cursorModeEnabled && self.cursorIdleGeneration == 0) {
        [self noteCursorActivity];
    }
    [self notifyCursorVisibility];
}

- (BOOL)applyManualScrollDelta:(CGPoint)delta {
    UIScrollView *scrollView = [self.host browserRemoteInputControllerActiveScrollView];
    if (scrollView == nil) {
        return NO;
    }
    self.animatedScrollView = nil;

    CGPoint contentOffset = scrollView.contentOffset;
    CGFloat maxOffsetX = MAX(0.0, scrollView.contentSize.width - CGRectGetWidth(scrollView.bounds));
    CGFloat maxOffsetY = MAX(0.0, scrollView.contentSize.height - CGRectGetHeight(scrollView.bounds));
    CGFloat nextOffsetX = MIN(MAX(contentOffset.x + delta.x, 0.0), maxOffsetX);
    CGFloat nextOffsetY = MIN(MAX(contentOffset.y + delta.y, 0.0), maxOffsetY);
    CGPoint nextOffset = CGPointMake(nextOffsetX, nextOffsetY);
    [scrollView setContentOffset:nextOffset animated:NO];
    return !CGPointEqualToPoint(contentOffset, nextOffset);
}

- (void)handleGlobalSelectPressEndedNotification {
    if (self.selectHoldActivated) {
        [self endSelectHold];
        self.selectLongPressEndedByGlobal = YES;
        return;
    }
    if (CACurrentMediaTime() - self.lastLongSelectTimestamp < 0.4) {
        return;
    }
    if ([self.host browserRemoteInputControllerPresentedViewController] != nil) {
        return;
    }

    if ((CACurrentMediaTime() - self.lastDirectSelectPressTimestamp) < 0.15) {
        return;
    }

    [self endSelectHold];
    self.selectClickHandledByGlobal = YES;
    self.lastDirectSelectPressTimestamp = CACurrentMediaTime();
    [self handleSelectPressEnded];
}

- (void)beginSelectHold {
    BOOL nativeStartPage = [self.host browserRemoteInputControllerNewTabVisible];
    if (self.selectPressPending || (!self.cursorModeEnabled && !nativeStartPage) ||
        [self.host browserRemoteInputControllerPresentedViewController] != nil ||
        [self.host browserRemoteInputControllerTabOverviewVisible]) {
        return;
    }
    self.selectPressPending = YES;
    self.selectHoldActivated = NO;
    self.selectClickHandledByGlobal = NO;
    self.selectLongPressEndedByGlobal = NO;
    NSUInteger generation = ++self.selectHoldGeneration;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kBrowserSelectHoldDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil || generation != strongSelf.selectHoldGeneration ||
            !strongSelf.selectPressPending ||
            [strongSelf.host browserRemoteInputControllerPresentedViewController] != nil) {
            return;
        }
        strongSelf.selectHoldActivated = YES;
        strongSelf.lastLongSelectTimestamp = CACurrentMediaTime();
        if ([strongSelf.host browserRemoteInputControllerNewTabVisible]) {
            [strongSelf.host browserRemoteInputControllerHandleNewTabOptionUsingKeyboardSelection:
                !strongSelf.cursorModeEnabled || strongSelf.newTabKeyboardSelectionActive];
        } else {
            [strongSelf.host browserRemoteInputControllerToggleMagnifier];
        }
    });
}

- (BOOL)endSelectHold {
    if (!self.selectPressPending) { return NO; }
    BOOL activated = self.selectHoldActivated;
    self.selectPressPending = NO;
    self.selectHoldActivated = NO;
    self.selectHoldGeneration += 1;
    if (activated) {
        self.lastLongSelectTimestamp = CACurrentMediaTime();
    }
    return activated;
}

- (void)handleSelectPressEnded {
    self.lastTouchLocation = CGPointMake(-1, -1);

    if ([self.host browserRemoteInputControllerPresentedViewController] != nil) {
        return;
    }

    if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
        [self.host browserRemoteInputControllerHandleTabOverviewSelectionAtPoint:self.cursorView.frame.origin];
        return;
    }

    if (!self.cursorHiddenForDirectionalNavigation) {
        [self noteCursorActivity];
    }

    if ([self.host browserRemoteInputControllerNewTabVisible]) {
        NSUInteger generation = [self.host browserRemoteInputControllerNewTabPageGeneration];
        if (generation != self.observedNewTabPageGeneration) {
            self.observedNewTabPageGeneration = generation;
            self.newTabKeyboardSelectionActive = NO;
        }
        if (!self.cursorModeEnabled || self.newTabKeyboardSelectionActive) {
            [self.host browserRemoteInputControllerActivateNewTabSelection];
        } else {
            [self.host browserRemoteInputControllerHandlePrimaryAction];
        }
        return;
    }

    if (self.primaryActionInProgress) {
        return;
    }
    self.primaryActionInProgress = YES;
    [self.host browserRemoteInputControllerHandlePrimaryAction];
    self.primaryActionInProgress = NO;
}

- (void)stopVerticalHold {
    self.verticalHoldGeneration += 1;
    self.verticalPressPending = NO;
    self.verticalHoldActive = NO;
    self.verticalHoldLastTimestamp = 0.0;
    self.verticalHoldStartTimestamp = 0.0;
    [self.verticalHoldDisplayLink invalidate];
    self.verticalHoldDisplayLink = nil;
}

- (void)handleVerticalHoldDisplayLink:(CADisplayLink *)displayLink {
    if (!self.verticalHoldActive ||
        [self.host browserRemoteInputControllerPresentedViewController] != nil ||
        [self.host browserRemoteInputControllerTabOverviewVisible] ||
        [self.host browserRemoteInputControllerNewTabVisible]) {
        [self stopVerticalHold];
        return;
    }
    if (self.verticalHoldLastTimestamp == 0.0) {
        self.verticalHoldLastTimestamp = displayLink.timestamp;
        self.verticalHoldStartTimestamp = displayLink.timestamp;
        return;
    }
    CFTimeInterval elapsed = MIN(0.05, displayLink.timestamp - self.verticalHoldLastTimestamp);
    self.verticalHoldLastTimestamp = displayLink.timestamp;
    CGFloat progress = MIN(1.0, (displayLink.timestamp - self.verticalHoldStartTimestamp) /
                                  kBrowserVerticalHoldAccelerationDuration);
    CGFloat easedProgress = progress * progress * (3.0 - 2.0 * progress);
    CGFloat speed = kBrowserVerticalHoldInitialSpeed +
        (kBrowserVerticalHoldMaximumSpeed - kBrowserVerticalHoldInitialSpeed) * easedProgress;
    CGFloat direction = self.heldVerticalPressType == UIPressTypeDownArrow ? 1.0 : -1.0;
    [self applyManualScrollDelta:CGPointMake(0.0, direction * speed * elapsed)];
}

- (void)beginVerticalHoldForPressType:(UIPressType)pressType {
    if ([self.host browserRemoteInputControllerPresentedViewController] != nil ||
        [self.host browserRemoteInputControllerTabOverviewVisible] ||
        [self.host browserRemoteInputControllerNewTabVisible]) {
        return;
    }
    if (self.verticalPressPending && self.heldVerticalPressType == pressType) {
        return;
    }
    [self stopVerticalHold];
    self.verticalPressPending = YES;
    self.heldVerticalPressType = pressType;
    NSUInteger generation = self.verticalHoldGeneration;
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kBrowserVerticalHoldDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        __strong typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf == nil || generation != strongSelf.verticalHoldGeneration ||
            !strongSelf.verticalPressPending || strongSelf.heldVerticalPressType != pressType) {
            return;
        }
        strongSelf.verticalHoldActive = YES;
        strongSelf.verticalHoldDisplayLink = [CADisplayLink displayLinkWithTarget:strongSelf
                                                                        selector:@selector(handleVerticalHoldDisplayLink:)];
        [strongSelf.verticalHoldDisplayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    });
}

- (void)handleVerticalPressEnded:(UIPressType)pressType {
    if ([self.host browserRemoteInputControllerPresentedViewController] != nil ||
        [self.host browserRemoteInputControllerTabOverviewVisible]) {
        return;
    }

    CGFloat direction = pressType == UIPressTypeDownArrow ? 1.0 : -1.0;
    UIScrollView *scrollView = [self.host browserRemoteInputControllerActiveScrollView];
    if (scrollView == nil) { return; }
    CGFloat pageStep = MAX(120.0, CGRectGetHeight(scrollView.bounds) * 0.275);
    CFTimeInterval now = CACurrentMediaTime();
    BOOL continuePreviousScroll = self.animatedScrollView == scrollView &&
        now - self.lastAnimatedScrollPressTimestamp < 0.6;
    CGFloat baseY = continuePreviousScroll ? self.animatedScrollTargetY : scrollView.contentOffset.y;
    CGFloat maxOffsetY = MAX(0.0, scrollView.contentSize.height - CGRectGetHeight(scrollView.bounds));
    CGFloat targetY = MIN(MAX(baseY + direction * pageStep, 0.0), maxOffsetY);
    self.animatedScrollView = scrollView;
    self.animatedScrollTargetY = targetY;
    self.lastAnimatedScrollPressTimestamp = now;
    [scrollView setContentOffset:CGPointMake(scrollView.contentOffset.x, targetY) animated:YES];
    [self.host browserRemoteInputControllerPersistSession];
}

- (void)handlePressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    UIPress *press = presses.anyObject;
    if ([self.host browserRemoteInputControllerPresentedViewController] != nil &&
        ![self.host browserRemoteInputControllerTabOverviewVisible]) {
        (void)event;
        return;
    }
    if (press.type == UIPressTypeSelect) {
        [self beginSelectHold];
    }
    if (press.type == UIPressTypeUpArrow || press.type == UIPressTypeDownArrow) {
        [self beginVerticalHoldForPressType:press.type];
    }
    if (press != nil && (press.type == UIPressTypeMenu || press.type == UIPressTypePlayPause || press.type == UIPressTypeSelect)) {
        BrowserLog(@"[InputTrace][Root] pressesBegan type=%@ phase=%@ presented=%@",
              BrowserPressTypeString(press.type),
              BrowserPressPhaseString(press.phase),
              [self.host browserRemoteInputControllerPresentedViewController] == nil ? @"(nil)" : NSStringFromClass([[self.host browserRemoteInputControllerPresentedViewController] class]));
    }
    (void)event;
}

- (BOOL)handlePressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    (void)event;
    UIPress *press = presses.anyObject;
    if (press == nil) {
        return NO;
    }
    if (press.type != UIPressTypeSelect && self.selectPressPending) {
        [self endSelectHold];
    }
    if (self.verticalPressPending && press.type != self.heldVerticalPressType) {
        BOOL wasHolding = self.verticalHoldActive;
        [self stopVerticalHold];
        if (wasHolding) {
            [self.host browserRemoteInputControllerPersistSession];
        }
    }
    if (self.verticalPressPending && press.type == self.heldVerticalPressType) {
        BOOL wasHolding = self.verticalHoldActive;
        [self stopVerticalHold];
        if (wasHolding) {
            [self.host browserRemoteInputControllerPersistSession];
            return YES;
        }
    }
    if (![self.host browserRemoteInputControllerTabOverviewVisible] || press.type != UIPressTypeUpArrow) {
        self.lastTabOverviewUpPressTimestamp = 0.0;
    }
    if (press.type == UIPressTypeMenu || press.type == UIPressTypePlayPause || press.type == UIPressTypeSelect) {
        BrowserLog(@"[InputTrace][Root] pressesEnded type=%@ phase=%@ presented=%@ tabOverview=%@",
              BrowserPressTypeString(press.type),
              BrowserPressPhaseString(press.phase),
              [self.host browserRemoteInputControllerPresentedViewController] == nil ? @"(nil)" : NSStringFromClass([[self.host browserRemoteInputControllerPresentedViewController] class]),
              [self.host browserRemoteInputControllerTabOverviewVisible] ? @"YES" : @"NO");
    }

    UIViewController *presentedViewController = [self.host browserRemoteInputControllerPresentedViewController];
    if (presentedViewController != nil) {
        if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
            if (press.type == UIPressTypeUpArrow) {
                CFTimeInterval now = CACurrentMediaTime();
                if (self.lastTabOverviewUpPressTimestamp > 0.0 &&
                    (now - self.lastTabOverviewUpPressTimestamp) < 0.42) {
                    self.lastTabOverviewUpPressTimestamp = 0.0;
                    [self.host browserRemoteInputControllerHandleTabOverviewAlternateAction];
                } else {
                    self.lastTabOverviewUpPressTimestamp = now;
                }
                return YES;
            }
            if (press.type == UIPressTypeMenu) {
                [self.host browserRemoteInputControllerDismissTabOverview];
                return YES;
            }
            if (press.type == UIPressTypePlayPause) {
                [self.host browserRemoteInputControllerHandleTabOverviewAlternateAction];
                return YES;
            }
            return NO;
        }
        if (press.type == UIPressTypeMenu) {
            if ([presentedViewController isKindOfClass:BrowserTorrentLibraryViewController.class]) {
                [(BrowserTorrentLibraryViewController *)presentedViewController handleBackPress];
            } else {
                [presentedViewController dismissViewControllerAnimated:YES completion:nil];
            }
            return YES;
        }
        return press.type == UIPressTypePlayPause;
    }

    if ([self.host browserRemoteInputControllerNewTabVisible]) {
        NSString *direction = nil;
        switch (press.type) {
            case UIPressTypeUpArrow: direction = @"up"; break;
            case UIPressTypeDownArrow: direction = @"down"; break;
            case UIPressTypeLeftArrow: direction = @"left"; break;
            case UIPressTypeRightArrow: direction = @"right"; break;
            default: break;
        }
        if (direction != nil) {
            self.observedNewTabPageGeneration = [self.host browserRemoteInputControllerNewTabPageGeneration];
            self.newTabKeyboardSelectionActive = YES;
            self.newTabKeyboardSelectionCursorOrigin = self.cursorView.frame.origin;
            [self.host browserRemoteInputControllerNavigateNewTabInDirection:direction];
            return YES;
        }
    }

    if (press.type == UIPressTypeSelect) {
        if (self.selectLongPressEndedByGlobal) {
            self.selectLongPressEndedByGlobal = NO;
            self.lastDirectSelectPressTimestamp = CACurrentMediaTime();
            return YES;
        }
        if (self.selectClickHandledByGlobal &&
            CACurrentMediaTime() - self.lastDirectSelectPressTimestamp < 0.15) {
            self.selectClickHandledByGlobal = NO;
            return YES;
        }
        self.lastDirectSelectPressTimestamp = CACurrentMediaTime();
        if ([self endSelectHold]) {
            return YES;
        }
        [self handleSelectPressEnded];
        return YES;
    }

    if (press.type == UIPressTypePlayPause && [self.host browserRemoteInputControllerNewTabVisible]) {
        NSUInteger generation = [self.host browserRemoteInputControllerNewTabPageGeneration];
        if (generation != self.observedNewTabPageGeneration) {
            self.observedNewTabPageGeneration = generation;
            self.newTabKeyboardSelectionActive = NO;
        }
        [self.host browserRemoteInputControllerHandleNewTabOptionUsingKeyboardSelection:
            !self.cursorModeEnabled || self.newTabKeyboardSelectionActive];
        return YES;
    }

    if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
        if (press.type == UIPressTypeMenu || press.type == UIPressTypePlayPause) {
            [self.host browserRemoteInputControllerDismissTabOverview];
            return YES;
        }
        if (press.type == UIPressTypeSelect) {
            [self.host browserRemoteInputControllerHandleTabOverviewSelectionAtPoint:self.cursorView.frame.origin];
            return YES;
        }
    }

    if (press.type == UIPressTypeMenu) {
        [self.host browserRemoteInputControllerHandleMenuPress];
        return YES;
    }
    if (press.type == UIPressTypePlayPause) {
        [self.host browserRemoteInputControllerHandlePlayPausePress];
        return YES;
    }
    if (press.type == UIPressTypeRightArrow) {
        [self.host browserRemoteInputControllerHandleMediaHorizontalPress:press.type];
        return YES;
    }
    if (press.type == UIPressTypeLeftArrow) {
        [self.host browserRemoteInputControllerHandleMediaHorizontalPress:press.type];
        return YES;
    }
    if (press.type == UIPressTypeUpArrow || press.type == UIPressTypeDownArrow) {
        [self handleVerticalPressEnded:press.type];
        return YES;
    }
    return NO;
}

- (void)handlePressesCancelled:(NSSet<UIPress *> *)presses {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeSelect && self.selectPressPending) {
            [self endSelectHold];
        }
        if (self.verticalPressPending && press.type == self.heldVerticalPressType) {
            BOOL wasHolding = self.verticalHoldActive;
            [self stopVerticalHold];
            if (wasHolding) {
                [self.host browserRemoteInputControllerPersistSession];
            }
            break;
        }
    }
}

- (BOOL)handleTouchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    (void)touches;
    (void)event;
    if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
        return NO;
    }
    if (!self.cursorModeEnabled) {
        return NO;
    }
    self.cursorHiddenForDirectionalNavigation = NO;
    self.cursorIdleHidden = NO;
    [self noteCursorActivity];
    self.lastTouchLocation = CGPointMake(-1, -1);
    return YES;
}

- (BOOL)handleTouchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event {
    (void)event;
    if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
        return NO;
    }
    if (!self.cursorModeEnabled) {
        return NO;
    }

    self.cursorHiddenForDirectionalNavigation = NO;
    self.cursorIdleHidden = NO;
    [self noteCursorActivity];

    for (UITouch *touch in touches) {
        UIScrollView *activeScrollView = [self.host browserRemoteInputControllerActiveScrollView];
        UIView *targetView = activeScrollView ?: self.rootView;
        CGPoint location = [touch locationInView:targetView];

        if (self.lastTouchLocation.x == -1 && self.lastTouchLocation.y == -1) {
            self.lastTouchLocation = location;
        } else {
            CGFloat xDiff = location.x - self.lastTouchLocation.x;
            CGFloat yDiff = location.y - self.lastTouchLocation.y;
            CGFloat cursorSensitivity = self.magnifierEnabled ? 0.375 : 0.75;
            xDiff *= cursorSensitivity;
            yDiff *= cursorSensitivity;
            CGRect rect = self.cursorView.frame;

            CGFloat cursorEdgeInset = 1.0;
            CGFloat maximumCursorX = MAX(0.0, CGRectGetWidth(self.rootView.bounds) - cursorEdgeInset);
            CGFloat maximumCursorY = MAX(0.0, CGRectGetHeight(self.rootView.bounds) - cursorEdgeInset);
            rect.origin.x = MIN(MAX(rect.origin.x + xDiff, 0.0), maximumCursorX);
            rect.origin.y = MIN(MAX(rect.origin.y + yDiff, 0.0), maximumCursorY);
            if (self.cursorHiddenForDirectionalNavigation &&
                fabs(rect.origin.x - self.directionalNavigationCursorOrigin.x) +
                fabs(rect.origin.y - self.directionalNavigationCursorOrigin.y) > 10.0) {
                self.cursorHiddenForDirectionalNavigation = NO;
                self.cursorIdleHidden = NO;
                [self noteCursorActivity];
            }
            if (!self.selectPressPending &&
                fabs(rect.origin.x - self.newTabKeyboardSelectionCursorOrigin.x) +
                fabs(rect.origin.y - self.newTabKeyboardSelectionCursorOrigin.y) > 40.0) {
                self.newTabKeyboardSelectionActive = NO;
            }
            self.cursorView.frame = rect;
            self.lastTouchLocation = location;
        }

        self.cursorView.image = BrowserDefaultCursor();
        if ([self.host browserRemoteInputControllerTabOverviewVisible]) {
            if ([self.host browserRemoteInputControllerTabOverviewContainsPoint:self.cursorView.frame.origin]) {
                self.cursorView.image = BrowserPointerCursor();
            }
            break;
        }
        if (self.cursorModeEnabled) {
            [self requestHoverStateAtPoint:self.cursorView.frame.origin];
            [self updateMagnifierAtPoint:self.cursorView.frame.origin];
        }
        break;
    }

    return YES;
}

- (void)handleTouchesEnded {
    self.lastTouchLocation = CGPointMake(-1, -1);
}

@end
