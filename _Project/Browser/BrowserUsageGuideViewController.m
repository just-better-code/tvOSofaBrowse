#import "BrowserUsageGuideViewController.h"

#import "BrowserPreferencesStore.h"
#import "BrowserTVAppearance.h"

@interface BrowserUsageGuideViewController ()

@property (nonatomic, strong) BrowserPreferencesStore *preferencesStore;
@property (nonatomic, strong) UIButton *launchPreferenceButton;
@property (nonatomic, strong) UILabel *launchPreferenceStateLabel;
@property (nonatomic, strong) UIButton *continueButton;
@property (nonatomic, strong) UIImageView *cursorView;
@property (nonatomic, weak) UIView *preferredButton;
@property (nonatomic) BOOL positionedInitialCursor;
@property (nonatomic) BOOL updatingFocusFromCursor;

@end

@implementation BrowserUsageGuideViewController

- (instancetype)initWithPreferencesStore:(BrowserPreferencesStore *)preferencesStore {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _preferencesStore = preferencesStore;
        self.modalPresentationStyle = UIModalPresentationFullScreen;
        self.modalTransitionStyle = UIModalTransitionStyleCrossDissolve;
    }
    return self;
}

- (UILabel *)labelWithText:(NSString *)text size:(CGFloat)size weight:(UIFontWeight)weight color:(UIColor *)color {
    UILabel *label = [UILabel new];
    label.translatesAutoresizingMaskIntoConstraints = NO;
    label.text = text;
    label.font = [UIFont systemFontOfSize:size weight:weight];
    label.textColor = color;
    label.numberOfLines = 0;
    return label;
}

- (UIImageView *)symbol:(NSString *)name size:(CGFloat)size color:(UIColor *)color {
    UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:size
                                                                                                weight:UIImageSymbolWeightMedium];
    UIImageView *view = [[UIImageView alloc] initWithImage:[[UIImage systemImageNamed:name withConfiguration:configuration]
                                                          imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate]];
    view.translatesAutoresizingMaskIntoConstraints = NO;
    view.tintColor = color;
    view.contentMode = UIViewContentModeScaleAspectFit;
    return view;
}

- (UIView *)cardWithSymbol:(NSString *)symbol
                    title:(NSString *)title
                  gesture:(NSString *)gesture
                   detail:(NSString *)detail
                    color:(UIColor *)color {
    UIView *card = [UIView new];
    card.translatesAutoresizingMaskIntoConstraints = NO;
    card.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.075];
    card.layer.cornerRadius = 28.0;
    card.layer.borderWidth = 1.0;
    card.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.09].CGColor;

    UIView *iconTile = [UIView new];
    iconTile.translatesAutoresizingMaskIntoConstraints = NO;
    iconTile.backgroundColor = [color colorWithAlphaComponent:0.17];
    iconTile.layer.cornerRadius = 18.0;
    [card addSubview:iconTile];

    UIImageView *icon = [self symbol:symbol size:32.0 color:color];
    [iconTile addSubview:icon];

    UILabel *titleLabel = [self labelWithText:title size:32.0 weight:UIFontWeightSemibold color:UIColor.whiteColor];
    [card addSubview:titleLabel];

    UILabel *gestureLabel = [self labelWithText:gesture size:24.0 weight:UIFontWeightSemibold color:color];
    [card addSubview:gestureLabel];

    UILabel *detailLabel = [self labelWithText:detail size:23.0 weight:UIFontWeightRegular
                                       color:[UIColor colorWithWhite:1.0 alpha:0.62]];
    [card addSubview:detailLabel];

    [NSLayoutConstraint activateConstraints:@[
        [iconTile.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:26.0],
        [iconTile.topAnchor constraintEqualToAnchor:card.topAnchor constant:24.0],
        [iconTile.widthAnchor constraintEqualToConstant:62.0],
        [iconTile.heightAnchor constraintEqualToConstant:62.0],
        [icon.centerXAnchor constraintEqualToAnchor:iconTile.centerXAnchor],
        [icon.centerYAnchor constraintEqualToAnchor:iconTile.centerYAnchor],
        [icon.widthAnchor constraintEqualToConstant:38.0],
        [icon.heightAnchor constraintEqualToConstant:38.0],
        [titleLabel.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:26.0],
        [titleLabel.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-20.0],
        [titleLabel.topAnchor constraintEqualToAnchor:iconTile.bottomAnchor constant:17.0],
        [gestureLabel.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
        [gestureLabel.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
        [gestureLabel.topAnchor constraintEqualToAnchor:titleLabel.bottomAnchor constant:8.0],
        [detailLabel.leadingAnchor constraintEqualToAnchor:titleLabel.leadingAnchor],
        [detailLabel.trailingAnchor constraintEqualToAnchor:titleLabel.trailingAnchor],
        [detailLabel.topAnchor constraintEqualToAnchor:gestureLabel.bottomAnchor constant:8.0],
        [detailLabel.bottomAnchor constraintLessThanOrEqualToAnchor:card.bottomAnchor constant:-20.0],
    ]];
    return card;
}

- (UIView *)remotePanel {
    UIView *panel = [UIView new];
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    panel.backgroundColor = [UIColor colorWithRed:0.10 green:0.12 blue:0.18 alpha:1.0];
    panel.layer.cornerRadius = 32.0;
    panel.layer.borderWidth = 1.0;
    panel.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.12].CGColor;

    UILabel *eyebrow = [self labelWithText:@"THE REMOTE" size:20.0 weight:UIFontWeightBold
                                    color:[UIColor colorWithRed:0.54 green:0.70 blue:1.0 alpha:1.0]];
    [panel addSubview:eyebrow];
    UILabel *headline = [self labelWithText:@"One touchpad.\nEverywhere." size:36.0 weight:UIFontWeightBold
                                     color:UIColor.whiteColor];
    [panel addSubview:headline];

    UIView *remote = [UIView new];
    remote.translatesAutoresizingMaskIntoConstraints = NO;
    remote.backgroundColor = [UIColor colorWithRed:0.22 green:0.24 blue:0.30 alpha:1.0];
    remote.layer.cornerRadius = 52.0;
    remote.layer.borderWidth = 2.0;
    remote.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.25].CGColor;
    [panel addSubview:remote];

    UIView *touchpad = [UIView new];
    touchpad.translatesAutoresizingMaskIntoConstraints = NO;
    touchpad.backgroundColor = [UIColor colorWithWhite:0.11 alpha:1.0];
    touchpad.layer.cornerRadius = 83.0;
    touchpad.layer.borderWidth = 2.0;
    touchpad.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.26].CGColor;
    [remote addSubview:touchpad];

    UIImageView *cursor = [self symbol:@"cursorarrow" size:47.0 color:UIColor.whiteColor];
    [touchpad addSubview:cursor];

    UIImageView *back = [self symbol:@"chevron.left" size:26.0 color:UIColor.whiteColor];
    UIImageView *play = [self symbol:@"playpause.fill" size:31.0 color:UIColor.whiteColor];
    [remote addSubview:back];
    [remote addSubview:play];

    UILabel *footnote = [self labelWithText:@"Back: menu or return\nPlay/Pause: video · New Tab options"
                                      size:21.0 weight:UIFontWeightMedium
                                     color:[UIColor colorWithWhite:1.0 alpha:0.62]];
    footnote.textAlignment = NSTextAlignmentCenter;
    [panel addSubview:footnote];

    [NSLayoutConstraint activateConstraints:@[
        [eyebrow.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:30.0],
        [eyebrow.topAnchor constraintEqualToAnchor:panel.topAnchor constant:27.0],
        [headline.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [headline.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor constant:-20.0],
        [headline.topAnchor constraintEqualToAnchor:eyebrow.bottomAnchor constant:10.0],
        [remote.centerXAnchor constraintEqualToAnchor:panel.centerXAnchor],
        [remote.topAnchor constraintEqualToAnchor:headline.bottomAnchor constant:18.0],
        [remote.widthAnchor constraintEqualToConstant:198.0],
        [remote.heightAnchor constraintEqualToConstant:282.0],
        [touchpad.centerXAnchor constraintEqualToAnchor:remote.centerXAnchor],
        [touchpad.topAnchor constraintEqualToAnchor:remote.topAnchor constant:15.0],
        [touchpad.widthAnchor constraintEqualToConstant:166.0],
        [touchpad.heightAnchor constraintEqualToConstant:166.0],
        [cursor.centerXAnchor constraintEqualToAnchor:touchpad.centerXAnchor],
        [cursor.centerYAnchor constraintEqualToAnchor:touchpad.centerYAnchor],
        [cursor.widthAnchor constraintEqualToConstant:52.0],
        [cursor.heightAnchor constraintEqualToConstant:52.0],
        [back.centerXAnchor constraintEqualToAnchor:remote.centerXAnchor constant:-49.0],
        [back.topAnchor constraintEqualToAnchor:touchpad.bottomAnchor constant:29.0],
        [back.widthAnchor constraintEqualToConstant:32.0],
        [back.heightAnchor constraintEqualToConstant:32.0],
        [play.centerXAnchor constraintEqualToAnchor:remote.centerXAnchor constant:49.0],
        [play.centerYAnchor constraintEqualToAnchor:back.centerYAnchor],
        [play.widthAnchor constraintEqualToConstant:38.0],
        [play.heightAnchor constraintEqualToConstant:38.0],
        [footnote.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:18.0],
        [footnote.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor constant:-18.0],
        [footnote.bottomAnchor constraintEqualToAnchor:panel.bottomAnchor constant:-22.0],
    ]];
    return panel;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0.055 green:0.065 blue:0.09 alpha:1.0];

    UIScrollView *scrollView = [UIScrollView new];
    scrollView.translatesAutoresizingMaskIntoConstraints = NO;
    scrollView.showsVerticalScrollIndicator = NO;
    scrollView.scrollEnabled = NO;
    [self.view addSubview:scrollView];

    UIView *content = [UIView new];
    content.translatesAutoresizingMaskIntoConstraints = NO;
    [scrollView addSubview:content];

    UILabel *eyebrow = [self labelWithText:@"BROWSER BASICS" size:24.0 weight:UIFontWeightBold
                                    color:[UIColor colorWithRed:0.54 green:0.70 blue:1.0 alpha:1.0]];
    [content addSubview:eyebrow];
    UILabel *title = [self labelWithText:@"Make yourself at home." size:66.0 weight:UIFontWeightBold
                                  color:UIColor.whiteColor];
    [content addSubview:title];
    UILabel *subtitle = [self labelWithText:@"The few gestures you need to browse from the sofa."
                                     size:29.0 weight:UIFontWeightRegular
                                    color:[UIColor colorWithWhite:1.0 alpha:0.64]];
    [content addSubview:subtitle];

    UIView *remotePanel = [self remotePanel];
    [content addSubview:remotePanel];

    NSArray<NSDictionary<NSString *, NSString *> *> *tips = @[
        @{@"symbol": @"cursorarrow.motionlines", @"title": @"Point & click", @"gesture": @"Touchpad · Center", @"detail": @"Slide to move the pointer. Press Center to click."},
        @{@"symbol": @"arrow.up.and.down", @"title": @"Scroll", @"gesture": @"Up / Down", @"detail": @"Tap for a step. Hold to glide faster."},
        @{@"symbol": @"arrow.left.arrow.right", @"title": @"Video controls", @"gesture": @"Play/Pause · Left/Right", @"detail": @"Pause or resume. Seek supported video by 10 seconds."},
        @{@"symbol": @"square.on.square", @"title": @"Your tabs", @"gesture": @"Double Left", @"detail": @"Choose a tab or +. Double Up closes the focused card."},
        @{@"symbol": @"slider.horizontal.3", @"title": @"Quick menu", @"gesture": @"Back", @"detail": @"Open the menu with the domain focused. Back closes it."},
        @{@"symbol": @"magnifyingglass.circle", @"title": @"Magnifier", @"gesture": @"Hold Center", @"detail": @"Toggle the lens. It turns off after 30 seconds idle."},
    ];
    NSArray<UIColor *> *colors = @[
        [UIColor colorWithRed:0.52 green:0.71 blue:1.0 alpha:1.0],
        [UIColor colorWithRed:0.55 green:0.86 blue:0.79 alpha:1.0],
        [UIColor colorWithRed:0.84 green:0.70 blue:1.0 alpha:1.0],
        [UIColor colorWithRed:1.0 green:0.73 blue:0.55 alpha:1.0],
        [UIColor colorWithRed:0.98 green:0.67 blue:0.76 alpha:1.0],
        [UIColor colorWithRed:0.70 green:0.80 blue:1.0 alpha:1.0],
    ];
    UIStackView *cardRows = [UIStackView new];
    cardRows.translatesAutoresizingMaskIntoConstraints = NO;
    cardRows.axis = UILayoutConstraintAxisVertical;
    cardRows.distribution = UIStackViewDistributionFillEqually;
    cardRows.spacing = 18.0;
    [content addSubview:cardRows];
    for (NSUInteger rowIndex = 0; rowIndex < 2; rowIndex++) {
        UIStackView *row = [UIStackView new];
        row.axis = UILayoutConstraintAxisHorizontal;
        row.distribution = UIStackViewDistributionFillEqually;
        row.spacing = 18.0;
        for (NSUInteger columnIndex = 0; columnIndex < 3; columnIndex++) {
            NSUInteger index = rowIndex * 3 + columnIndex;
            NSDictionary<NSString *, NSString *> *tip = tips[index];
            [row addArrangedSubview:[self cardWithSymbol:tip[@"symbol"]
                                               title:tip[@"title"]
                                             gesture:tip[@"gesture"]
                                              detail:tip[@"detail"]
                                               color:colors[index]]];
        }
        [cardRows addArrangedSubview:row];
    }

    UIView *footerLine = [UIView new];
    footerLine.translatesAutoresizingMaskIntoConstraints = NO;
    footerLine.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.12];
    [content addSubview:footerLine];

    UIButton *launchButton = [UIButton buttonWithType:UIButtonTypeSystem];
    launchButton.translatesAutoresizingMaskIntoConstraints = NO;
    launchButton.titleLabel.font = [UIFont systemFontOfSize:25.0 weight:UIFontWeightMedium];
    launchButton.contentHorizontalAlignment = UIControlContentHorizontalAlignmentLeft;
    launchButton.tintColor = [UIColor colorWithWhite:1.0 alpha:0.8];
    [launchButton addTarget:self action:@selector(toggleLaunchPreference) forControlEvents:UIControlEventPrimaryActionTriggered];
    [content addSubview:launchButton];
    self.launchPreferenceButton = launchButton;

    UILabel *launchStateLabel = [UILabel new];
    launchStateLabel.translatesAutoresizingMaskIntoConstraints = NO;
    launchStateLabel.userInteractionEnabled = NO;
    [launchButton addSubview:launchStateLabel];
    self.launchPreferenceStateLabel = launchStateLabel;
    [NSLayoutConstraint activateConstraints:@[
        [launchStateLabel.trailingAnchor constraintEqualToAnchor:launchButton.trailingAnchor constant:-16.0],
        [launchStateLabel.centerYAnchor constraintEqualToAnchor:launchButton.centerYAnchor],
        [launchStateLabel.widthAnchor constraintEqualToConstant:42.0],
        [launchStateLabel.heightAnchor constraintEqualToConstant:22.0],
    ]];
    [self updateLaunchPreferenceButton];

    UIButton *continueButton = [UIButton buttonWithType:UIButtonTypeSystem];
    continueButton.translatesAutoresizingMaskIntoConstraints = NO;
    BrowserTVConfigureSystemButtonSurface(continueButton, UIColor.whiteColor, 18.0);
    continueButton.titleLabel.font = [UIFont systemFontOfSize:29.0 weight:UIFontWeightSemibold];
    [continueButton setTitle:@"Start Browsing" forState:UIControlStateNormal];
    UIColor *continueText = BrowserTVUsesNativeButtonSurface() ? UIColor.whiteColor :
        [UIColor colorWithRed:0.07 green:0.10 blue:0.16 alpha:1.0];
    [continueButton setTitleColor:continueText forState:UIControlStateNormal];
    [continueButton setTitleColor:BrowserTVFocusedTextColor() forState:UIControlStateFocused];
    [continueButton addTarget:self action:@selector(dismissGuide) forControlEvents:UIControlEventPrimaryActionTriggered];
    [content addSubview:continueButton];
    self.continueButton = continueButton;
    self.preferredButton = continueButton;

    UIImageView *cursorView = [[UIImageView alloc] initWithImage:[UIImage imageNamed:@"Cursor"]];
    cursorView.frame = CGRectMake(0.0, 0.0, 64.0, 64.0);
    cursorView.userInteractionEnabled = NO;
    [self.view addSubview:cursorView];
    self.cursorView = cursorView;

    UIPanGestureRecognizer *pointerPan = [[UIPanGestureRecognizer alloc] initWithTarget:self
                                                                                 action:@selector(moveCursorWithPan:)];
    pointerPan.cancelsTouchesInView = NO;
    pointerPan.allowedTouchTypes = @[@(UITouchTypeIndirect)];
    [self.view addGestureRecognizer:pointerPan];

    [NSLayoutConstraint activateConstraints:@[
        [scrollView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [scrollView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [scrollView.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [scrollView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
        [content.leadingAnchor constraintEqualToAnchor:scrollView.contentLayoutGuide.leadingAnchor],
        [content.trailingAnchor constraintEqualToAnchor:scrollView.contentLayoutGuide.trailingAnchor],
        [content.topAnchor constraintEqualToAnchor:scrollView.contentLayoutGuide.topAnchor],
        [content.bottomAnchor constraintEqualToAnchor:scrollView.contentLayoutGuide.bottomAnchor],
        [content.widthAnchor constraintEqualToAnchor:scrollView.frameLayoutGuide.widthAnchor],

        [eyebrow.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:100.0],
        [eyebrow.topAnchor constraintEqualToAnchor:content.topAnchor constant:54.0],
        [title.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [title.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-80.0],
        [title.topAnchor constraintEqualToAnchor:eyebrow.bottomAnchor constant:10.0],
        [subtitle.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [subtitle.trailingAnchor constraintEqualToAnchor:title.trailingAnchor],
        [subtitle.topAnchor constraintEqualToAnchor:title.bottomAnchor constant:4.0],

        [remotePanel.leadingAnchor constraintEqualToAnchor:content.leadingAnchor constant:100.0],
        [remotePanel.topAnchor constraintEqualToAnchor:subtitle.bottomAnchor constant:35.0],
        [remotePanel.widthAnchor constraintEqualToConstant:370.0],
        [remotePanel.heightAnchor constraintEqualToConstant:550.0],
        [cardRows.leadingAnchor constraintEqualToAnchor:remotePanel.trailingAnchor constant:26.0],
        [cardRows.trailingAnchor constraintEqualToAnchor:content.trailingAnchor constant:-100.0],
        [cardRows.topAnchor constraintEqualToAnchor:remotePanel.topAnchor],
        [cardRows.bottomAnchor constraintEqualToAnchor:remotePanel.bottomAnchor],

        [footerLine.leadingAnchor constraintEqualToAnchor:remotePanel.leadingAnchor],
        [footerLine.trailingAnchor constraintEqualToAnchor:cardRows.trailingAnchor],
        [footerLine.topAnchor constraintEqualToAnchor:remotePanel.bottomAnchor constant:30.0],
        [footerLine.heightAnchor constraintEqualToConstant:1.0],
        [launchButton.leadingAnchor constraintEqualToAnchor:footerLine.leadingAnchor],
        [launchButton.topAnchor constraintEqualToAnchor:footerLine.bottomAnchor constant:22.0],
        [launchButton.widthAnchor constraintEqualToConstant:460.0],
        [launchButton.heightAnchor constraintEqualToConstant:64.0],
        [continueButton.trailingAnchor constraintEqualToAnchor:footerLine.trailingAnchor],
        [continueButton.centerYAnchor constraintEqualToAnchor:launchButton.centerYAnchor],
        [continueButton.widthAnchor constraintEqualToConstant:380.0],
        [continueButton.heightAnchor constraintEqualToConstant:68.0],
        [content.bottomAnchor constraintEqualToAnchor:continueButton.bottomAnchor constant:54.0],
    ]];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    if (!self.positionedInitialCursor) {
        self.positionedInitialCursor = YES;
        [self placeCursorOnButton:self.continueButton];
    }
}

- (void)placeCursorOnButton:(UIView *)button {
    CGPoint buttonCenter = CGPointMake(CGRectGetMidX(button.bounds), CGRectGetMidY(button.bounds));
    CGPoint centerInGuide = [button convertPoint:buttonCenter toView:self.view];
    self.cursorView.frame = CGRectMake(centerInGuide.x - 12.0, centerInGuide.y - 12.0, 64.0, 64.0);
}

- (void)moveCursorWithPan:(UIPanGestureRecognizer *)pan {
    if (pan.state != UIGestureRecognizerStateBegan && pan.state != UIGestureRecognizerStateChanged) {
        return;
    }

    CGPoint movement = [pan translationInView:self.view];
    [pan setTranslation:CGPointZero inView:self.view];
    CGRect frame = self.cursorView.frame;
    frame.origin.x = MIN(MAX(frame.origin.x + movement.x * 0.75, 0.0),
                         MAX(0.0, CGRectGetWidth(self.view.bounds) - CGRectGetWidth(frame)));
    frame.origin.y = MIN(MAX(frame.origin.y + movement.y * 0.75, 0.0),
                         MAX(0.0, CGRectGetHeight(self.view.bounds) - CGRectGetHeight(frame)));
    self.cursorView.frame = frame;

    CGPoint tip = CGPointMake(CGRectGetMinX(frame) + 12.0, CGRectGetMinY(frame) + 12.0);
    for (UIButton *button in @[self.launchPreferenceButton, self.continueButton]) {
        CGPoint pointInButton = [self.view convertPoint:tip toView:button];
        if (![button pointInside:pointInButton withEvent:nil] || self.preferredButton == button) {
            continue;
        }
        self.preferredButton = button;
        self.updatingFocusFromCursor = YES;
        [self setNeedsFocusUpdate];
        [self updateFocusIfNeeded];
        self.updatingFocusFromCursor = NO;
        break;
    }
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    UIView *nextView = context.nextFocusedView;
    if (nextView == self.launchPreferenceButton || nextView == self.continueButton) {
        self.preferredButton = nextView;
        if (!self.updatingFocusFromCursor) {
            [coordinator addCoordinatedAnimations:^{
                [self placeCursorOnButton:nextView];
            } completion:nil];
        }
    }
}

- (void)updateLaunchPreferenceButton {
    BOOL showOnLaunch = !self.preferencesStore.dontShowHintsOnLaunch;
    [self.launchPreferenceButton setTitle:@"Show this guide at launch" forState:UIControlStateNormal];
    BrowserTVConfigureToggleBadge(self.launchPreferenceStateLabel, showOnLaunch);
    self.launchPreferenceButton.accessibilityValue = showOnLaunch ? @"On" : @"Off";
}

- (void)toggleLaunchPreference {
    self.preferencesStore.dontShowHintsOnLaunch = !self.preferencesStore.dontShowHintsOnLaunch;
    [self updateLaunchPreferenceButton];
}

- (void)dismissGuide {
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.preferredButton != nil ? @[self.preferredButton] : @[self.continueButton];
}

- (void)pressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeMenu) {
            [self dismissGuide];
            return;
        }
    }
    [super pressesBegan:presses withEvent:event];
}

@end
