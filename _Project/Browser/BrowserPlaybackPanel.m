#import "BrowserPlaybackPanel.h"
#import "BrowserFullscreenMediaControlsController.h"
#import "BrowserPlaybackSymbols.h"
#import "BrowserTVAppearance.h"
#import "BrowserPlaybackSession.h"
#include <math.h>

static UIVisualEffectView *BrowserPlaybackGlass(void) {
    UIVisualEffectView *glass = [[UIVisualEffectView alloc] initWithEffect:BrowserTVPanelEffect()];
    glass.translatesAutoresizingMaskIntoConstraints = NO;
    glass.userInteractionEnabled = NO;
    glass.layer.borderWidth = NSClassFromString(@"UIGlassEffect") ? 0 : 1;
    glass.layer.borderColor = [UIColor colorWithWhite:1 alpha:0.25].CGColor;
    return glass;
}
static void BrowserPlaybackFill(UIView *view, UIView *container) {
    [NSLayoutConstraint activateConstraints:@[
        [view.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [view.trailingAnchor constraintEqualToAnchor:container.trailingAnchor],
        [view.topAnchor constraintEqualToAnchor:container.topAnchor],
        [view.bottomAnchor constraintEqualToAnchor:container.bottomAnchor],
    ]];
}

@interface BrowserPlaybackPanel ()
@property (nonatomic, readwrite) UIView *header;
@property (nonatomic, readwrite) UIView *controls;
@property (nonatomic, readwrite) UILabel *titleLabel;
@property (nonatomic, readwrite) UILabel *statusLabel;
@property (nonatomic, readwrite) UILabel *timeLabel;
@property (nonatomic, readwrite) UIProgressView *progress;
@property (nonatomic, readwrite) NSArray<UIButton *> *buttons;
@property (nonatomic) NSArray<UIButton *> *accessories;
@property (nonatomic) BOOL detailedHeader;
@property (nonatomic) BOOL needsRevealFocus;
@property (nonatomic) BOOL revealFocusScheduled;
@end

@implementation BrowserPlaybackPanel
- (instancetype)initWithPlayerIcon:(UIImage *)icon accessoryButtons:(NSArray<UIButton *> *)accessories {
    self = [super initWithFrame:CGRectZero];
    if (!self) return nil;
    self.backgroundColor = UIColor.clearColor;
    self.detailedHeader = icon != nil;
    self.accessories = accessories;
    self.header = [UIView new]; self.header.translatesAutoresizingMaskIntoConstraints = NO;
    self.controls = [UIView new]; self.controls.translatesAutoresizingMaskIntoConstraints = NO;
    self.header.hidden = YES; self.controls.hidden = YES;
    [self addSubview:self.header]; [self addSubview:self.controls];
    for (UIView *container in @[self.header, self.controls]) {
        UIVisualEffectView *glass = BrowserPlaybackGlass();
        [container addSubview:glass]; BrowserPlaybackFill(glass, container);
    }
    self.titleLabel = [UILabel new]; self.titleLabel.translatesAutoresizingMaskIntoConstraints = NO;
    self.titleLabel.font = [UIFont systemFontOfSize:26 weight:UIFontWeightSemibold];
    self.titleLabel.textColor = UIColor.whiteColor;
    self.titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
    [self.header addSubview:self.titleLabel];
    self.statusLabel = [UILabel new]; self.statusLabel.translatesAutoresizingMaskIntoConstraints = NO;
    self.statusLabel.textColor = UIColor.whiteColor; self.statusLabel.font = [UIFont systemFontOfSize:22];
    self.statusLabel.hidden = !self.detailedHeader;
    [self.header addSubview:self.statusLabel];
    [NSLayoutConstraint activateConstraints:@[
        [self.header.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [self.header.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
        [self.header.topAnchor constraintEqualToAnchor:self.topAnchor],
        [self.header.heightAnchor constraintEqualToConstant:icon ? 145 : 90],
        [self.titleLabel.trailingAnchor constraintLessThanOrEqualToAnchor:self.header.trailingAnchor constant:-80],
        [self.statusLabel.leadingAnchor constraintEqualToAnchor:self.titleLabel.leadingAnchor],
        [self.statusLabel.topAnchor constraintEqualToAnchor:self.titleLabel.bottomAnchor constant:10],
    ]];
    if (icon) {
        UIImageView *playerIcon = [[UIImageView alloc] initWithImage:icon];
        playerIcon.translatesAutoresizingMaskIntoConstraints = NO; playerIcon.tintColor = UIColor.whiteColor;
        playerIcon.contentMode = UIViewContentModeScaleAspectFit; playerIcon.isAccessibilityElement = NO;
        [self.header addSubview:playerIcon];
        [NSLayoutConstraint activateConstraints:@[
            [playerIcon.leadingAnchor constraintEqualToAnchor:self.header.leadingAnchor constant:80],
            [playerIcon.centerYAnchor constraintEqualToAnchor:self.titleLabel.centerYAnchor],
            [playerIcon.widthAnchor constraintEqualToConstant:30], [playerIcon.heightAnchor constraintEqualToConstant:30],
            [self.titleLabel.leadingAnchor constraintEqualToAnchor:playerIcon.trailingAnchor constant:12],
            [self.titleLabel.topAnchor constraintEqualToAnchor:self.header.topAnchor constant:55],
        ]];
    } else {
        [NSLayoutConstraint activateConstraints:@[
            [self.titleLabel.leadingAnchor constraintEqualToAnchor:self.header.leadingAnchor constant:80],
            [self.titleLabel.centerYAnchor constraintEqualToAnchor:self.header.centerYAnchor],
        ]];
    }
    self.progress = [UIProgressView new]; self.progress.translatesAutoresizingMaskIntoConstraints = NO;
    self.progress.progressTintColor = UIColor.whiteColor;
    self.progress.trackTintColor = [UIColor colorWithWhite:1 alpha:0.35];
    [self.controls addSubview:self.progress];
    self.timeLabel = [UILabel new]; self.timeLabel.translatesAutoresizingMaskIntoConstraints = NO;
    self.timeLabel.textColor = UIColor.whiteColor;
    self.timeLabel.font = [UIFont monospacedDigitSystemFontOfSize:20 weight:UIFontWeightMedium];
    self.timeLabel.text = @"0:00 / --:--"; [self.controls addSubview:self.timeLabel];
    NSArray *symbols = @[@"backward.end.fill", @"backward.end.alt.fill", @"backward.fill", @"arrowtriangle.left.fill",
        @"playpause.fill", @"arrowtriangle.right.fill", @"forward.fill", @"forward.end.fill", @"browser.end.fill",
        @"speaker.wave.2.fill", @"speaker.minus.fill", @"speaker.plus.fill"];
    NSArray *labels = @[@"Previous media", @"Go to beginning", @"Back 10 percent", @"Back 10 seconds", @"Pause",
        @"Forward 10 seconds", @"Forward 10 percent", @"Next media", @"Go to end", @"Mute", @"Volume down", @"Volume up"];
    NSMutableArray *buttons = [NSMutableArray array];
    for (NSUInteger index = 0; index < symbols.count; index++) {
        UIButton *button = [BrowserPlaybackPanel buttonWithSymbol:symbols[index] label:labels[index] target:nil action:NULL];
        button.tag = index;
        CGFloat diameter = index == 1 || index == 4 || index == 8 ? 81.6 : 68;
        [button.widthAnchor constraintEqualToConstant:diameter].active = YES;
        [button.heightAnchor constraintEqualToConstant:diameter].active = YES;
        [buttons addObject:button];
    }
    self.buttons = buttons; self.buttons[1].hidden = YES; self.buttons[8].hidden = YES;
    UIStackView *(^row)(NSArray *) = ^UIStackView *(NSArray *items) {
        UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:items];
        stack.translatesAutoresizingMaskIntoConstraints = NO; stack.spacing = 10; stack.alignment = UIStackViewAlignmentCenter;
        [self.controls addSubview:stack]; return stack;
    };
    UIStackView *transport = row(@[buttons[0],buttons[2],buttons[3],buttons[4],buttons[5],buttons[6],buttons[7]]);
    UIStackView *volume = row(@[buttons[10],buttons[9],buttons[11]]);
    [NSLayoutConstraint activateConstraints:@[
        [self.controls.leadingAnchor constraintEqualToAnchor:self.leadingAnchor],
        [self.controls.trailingAnchor constraintEqualToAnchor:self.trailingAnchor],
        [self.controls.bottomAnchor constraintEqualToAnchor:self.bottomAnchor],
        [self.controls.heightAnchor constraintEqualToConstant:190],
        [self.progress.leadingAnchor constraintEqualToAnchor:self.controls.leadingAnchor constant:80],
        [self.progress.trailingAnchor constraintEqualToAnchor:self.controls.trailingAnchor constant:-80],
        [self.progress.topAnchor constraintEqualToAnchor:self.controls.topAnchor constant:20],
        [self.timeLabel.leadingAnchor constraintEqualToAnchor:self.progress.leadingAnchor],
        [self.timeLabel.topAnchor constraintEqualToAnchor:self.progress.bottomAnchor constant:10],
        [transport.centerXAnchor constraintEqualToAnchor:self.controls.centerXAnchor],
        [transport.topAnchor constraintEqualToAnchor:self.timeLabel.bottomAnchor constant:15.2],
        [transport.heightAnchor constraintEqualToConstant:81.6],
        [volume.leadingAnchor constraintEqualToAnchor:transport.trailingAnchor constant:34],
        [volume.centerYAnchor constraintEqualToAnchor:transport.centerYAnchor],
    ]];
    if (accessories.count) {
        for (UIButton *button in accessories) {
            NSLayoutConstraint *width = [button.widthAnchor constraintEqualToConstant:68];
            width.priority = UILayoutPriorityDefaultHigh; width.active = YES;
            [button.heightAnchor constraintEqualToConstant:68].active = YES;
        }
        UIStackView *extra = row(accessories);
        [NSLayoutConstraint activateConstraints:@[
            [extra.leadingAnchor constraintGreaterThanOrEqualToAnchor:volume.trailingAnchor constant:34],
            [extra.trailingAnchor constraintEqualToAnchor:self.controls.trailingAnchor constant:-80],
            [extra.centerYAnchor constraintEqualToAnchor:transport.centerYAnchor],
        ]];
    }
    return self;
}
+ (UIButton *)buttonWithSymbol:(NSString *)symbol label:(NSString *)label target:(id)target action:(SEL)action {
    BOOL seek = [symbol isEqualToString:@"backward.fill"] || [symbol isEqualToString:@"forward.fill"] || [symbol hasPrefix:@"arrowtriangle."];
    UIButton *button = seek ? [BrowserSeekButton buttonWithType:UIButtonTypeSystem] : [UIButton buttonWithType:UIButtonTypeSystem];
    BOOL large = [@[@"playpause.fill",@"backward.end.alt.fill",@"browser.end.fill"] containsObject:symbol];
    BrowserTVConfigureSystemButtonSurface(button, UIColor.clearColor, large ? 40.8 : 34);
    if (!BrowserTVUsesNativeButtonSurface()) {
        button.clipsToBounds = YES;
        UIVisualEffectView *glass = BrowserPlaybackGlass(); [button insertSubview:glass atIndex:0]; BrowserPlaybackFill(glass,button);
    }
    button.accessibilityLabel = label;
    UIImageView *image = [[UIImageView alloc] initWithImage:BrowserPlaybackControlImage(symbol)];
    image.tag = BrowserPlaybackPanelIconTag; image.translatesAutoresizingMaskIntoConstraints = NO;
    image.tintColor = UIColor.whiteColor; image.contentMode = UIViewContentModeScaleAspectFit; image.userInteractionEnabled = NO;
    [button addSubview:image];
    CGFloat size = [symbol isEqualToString:@"arrow.up.left.and.arrow.down.right"] ? 30 : large ? 45.6 : 38;
    [NSLayoutConstraint activateConstraints:@[
        [image.widthAnchor constraintEqualToConstant:size], [image.heightAnchor constraintEqualToConstant:size],
        [image.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
        [image.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
    ]];
    if (target && action) [button addTarget:target action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}
- (void)setSelected:(BOOL)selected forAccessoryButton:(UIButton *)button {
    button.selected = selected;
    UIImageView *imageView = (UIImageView *)[button viewWithTag:BrowserPlaybackPanelIconTag];
    if (@available(tvOS 26.0, *)) {
        if (!button.configurationUpdateHandler) {
            UIImage *symbol = imageView.image;
            UIColor *ink = BrowserTVFocusedTextColor();
            UIImage *darkSymbol = [symbol imageWithTintColor:ink renderingMode:UIImageRenderingModeAlwaysOriginal];
            UIImage *lightSymbol = [symbol imageWithTintColor:UIColor.whiteColor renderingMode:UIImageRenderingModeAlwaysOriginal];
            imageView.hidden = YES;
            button.configuration = [UIButtonConfiguration glassButtonConfiguration];
            // Keep the glyph inside the native glass control. A separate image
            // view can be covered or retinted by the selected glass surface.
            button.configurationUpdateHandler = ^(UIButton *control) {
                UIButtonConfiguration *configuration = control.selected
                    ? [UIButtonConfiguration prominentGlassButtonConfiguration] : [UIButtonConfiguration glassButtonConfiguration];
                if (control.selected) configuration.baseBackgroundColor = BrowserTVFocusedSurfaceColor();
                BOOL inverted = control.selected || control.focused || control.highlighted;
                configuration.baseForegroundColor = inverted ? ink : UIColor.whiteColor;
                configuration.image = inverted ? darkSymbol : lightSymbol;
                configuration.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
                configuration.contentInsets = NSDirectionalEdgeInsetsZero;
                control.configuration = configuration;
            };
        }
        [button setNeedsUpdateConfiguration];
        return;
    }
    imageView.image = [imageView.image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
    [self updateButtonAppearance:button focused:button.focused];
}
- (void)updateButtonAppearance:(UIButton *)button focused:(BOOL)focused {
    if (button.configurationUpdateHandler) return;
    BOOL selected = button.selected;
    BOOL native = BrowserTVUsesNativeButtonSurface();
    BOOL inverted = focused || selected;
    UIColor *legacyColor = inverted ? BrowserTVFocusedSurfaceColor() : UIColor.clearColor;
    button.backgroundColor = BrowserTVSystemButtonSurfaceColor(legacyColor);
    if (!native) {
        button.layer.borderWidth = selected ? 2 : 0;
        button.layer.borderColor = BrowserTVFocusedTextColor().CGColor;
    }
    UIImageView *image = (UIImageView *)[button viewWithTag:BrowserPlaybackPanelIconTag];
    image.tintColor = inverted ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
}
- (void)setControlsVisible:(BOOL)visible {
    if (!visible) self.needsRevealFocus = NO;
    else if (self.controls.hidden) self.needsRevealFocus = YES;
    self.controls.hidden = !visible;
    self.header.hidden = !visible || (!self.detailedHeader && !self.titleLabel.text.length);
    [self requestRevealFocusIfReady];
}
- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    if (self.controls.hidden) return @[];
    UIButton *playPause = self.buttons[4];
    if (self.needsRevealFocus && playPause.enabled) return @[playPause];
    // UIKit can reevaluate preferred focus after a control action or layout
    // change. Keep the current control during that reevaluation.
    for (UIButton *button in [self.buttons arrayByAddingObjectsFromArray:self.accessories]) {
        if (button.focused && button.enabled && !button.hidden) return @[button];
    }
    return @[];
}
- (void)didMoveToWindow {
    [super didMoveToWindow];
    [self requestRevealFocusIfReady];
}
- (void)requestRevealFocusIfReady {
    if (!self.needsRevealFocus || self.revealFocusScheduled || !self.window || !self.buttons[4].enabled) return;
    self.revealFocusScheduled = YES;
    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
        BrowserPlaybackPanel *panel = weakSelf;
        panel.revealFocusScheduled = NO;
        UIViewController *controller = panel.focusController;
        if (!panel.needsRevealFocus || !panel.window || !panel.buttons[4].enabled ||
            !controller || controller.presentedViewController) return;
        UIFocusSystem *focusSystem = [UIFocusSystem focusSystemForEnvironment:controller];
        // With no focused item, UIKit's initial focus search uses the preference.
        if (!focusSystem.focusedItem) return;
        [focusSystem requestFocusUpdateToEnvironment:controller];
        [focusSystem updateFocusIfNeeded];
        panel.needsRevealFocus = NO;
    });
}
- (void)updateState:(NSDictionary *)state {
    NSString *title = [state[@"pageTitle"] isKindOfClass:NSString.class] ? state[@"pageTitle"] : @"";
    self.titleLabel.text = title;
    double current = [state[@"currentTime"] doubleValue], duration = [state[@"duration"] doubleValue];
    self.progress.progress = duration > 0 ? MIN(1, MAX(0, current/duration)) : 0;
    self.timeLabel.text = [NSString stringWithFormat:@"%@ / %@", BrowserPlaybackTimeText(current),
        duration > 0 ? BrowserPlaybackTimeText(duration) : @"--:--"];
    if ([state[@"canVolume"] boolValue]) {
        NSString *volume = [NSString stringWithFormat:@"%ld%%", (long)lround([state[@"volume"] doubleValue]*100)];
        self.timeLabel.text = [self.timeLabel.text stringByAppendingFormat:@"  •  Volume %@",volume];
        self.buttons[10].accessibilityValue = volume; self.buttons[11].accessibilityValue = volume;
    }
    NSArray *keys = @[@"active",@"canRestart",@"canSeekBack",@"canSeekBack",@"available",@"canSeekForward",
        @"canSeekForward",@"active",@"canEnd",@"canMute",@"canVolume",@"canVolume"];
    for (NSUInteger i = 0; i < self.buttons.count; i++) {
        NSString *key = keys[i];
        if (i == 0) key = current > 5 ? @"canRestart" : (state[@"canRequestPrevious"] ? @"canRequestPrevious" : @"active");
        if (i == 7 && state[@"canRequestNext"]) key = @"canRequestNext";
        BOOL enabled = [state[key] boolValue];
        if (i == 2 || i == 6) enabled = enabled && isfinite(duration) && duration > 0;
        UIButton *button = self.buttons[i];
        if (button.enabled != enabled) button.enabled = enabled;
        CGFloat alpha = enabled ? 1 : 0.35;
        if (button.alpha != alpha) button.alpha = alpha;
    }
    self.buttons[0].accessibilityLabel = current <= 5 ? (state[@"previousLabel"] ?: @"Previous media") : @"Go to beginning";
    self.buttons[7].accessibilityLabel = state[@"nextLabel"] ?: @"Go to end and next media";
    self.buttons[4].accessibilityLabel = [state[@"paused"] boolValue] ? @"Play" : @"Pause";
    BOOL muted = [state[@"muted"] boolValue];
    ((UIImageView *)[self.buttons[9] viewWithTag:BrowserPlaybackPanelIconTag]).image =
        BrowserPlaybackControlImage(muted ? @"speaker.slash.fill" : @"speaker.wave.2.fill");
    self.buttons[9].accessibilityLabel = muted ? @"Unmute" : @"Mute";
    [self requestRevealFocusIfReady];
}
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
    UIView *hit = [super hitTest:point withEvent:event];
    return hit == self ? nil : hit;
}
- (void)updateFocusInContext:(UIFocusUpdateContext *)context coordinator:(UIFocusAnimationCoordinator *)coordinator {
    NSArray *all = [self.buttons arrayByAddingObjectsFromArray:self.accessories];
    UIView *next = context.nextFocusedView;
    if (next == self.buttons[4] || (context.focusHeading != UIFocusHeadingNone && next && [all containsObject:next]))
        self.needsRevealFocus = NO;
    for (UIView *view in @[context.previouslyFocusedView ?: [UIView new],context.nextFocusedView ?: [UIView new]]) {
        if (![all containsObject:view]) continue;
        BOOL focused = view == context.nextFocusedView;
        [coordinator addCoordinatedAnimations:^{
            [self updateButtonAppearance:(UIButton *)view focused:focused];
        } completion:nil];
    }
}
@end
