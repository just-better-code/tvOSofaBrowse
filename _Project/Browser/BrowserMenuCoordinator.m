#import "BrowserMenuCoordinator.h"
#import "BrowserFavoriteEditorViewController.h"
#import "BrowserHistoryViewController.h"
#import "BrowserHistoryStore.h"
#import "BrowserPreferencesStore.h"
#import "BrowserTorrentKeepAlive.h"
#import "BrowserTVAppearance.h"
#import "BrowserWebView.h"

static UIColor *MenuTextColor(void) {
    if (@available(tvOS 13, *)) {
        return UIColor.labelColor;
    } else {
        return UIColor.blackColor;
    }
}

static NSString * const kBrowserMediaDiagnosticsLogPrefix = @"[MediaDiagnostics]";
static NSString * const kBrowserWebKitMediaPrefsLogPrefix = @"[WebKitMediaPrefs]";
static NSUInteger const kBrowserNavigationToolbarItemCount = 4;

typedef void (^BrowserAdvancedMenuItemHandler)(void);
typedef BOOL (^BrowserAdvancedMenuToggleStateProvider)(void);
typedef NSString * (^BrowserAdvancedMenuTitleProvider)(void);

@interface BrowserAdvancedMenuItem : NSObject

@property (nonatomic, copy) NSString *title;
@property (nonatomic, copy) NSString *tileTitle;
@property (nonatomic, copy) NSString *tileSymbolName;
@property (nonatomic) UIAlertActionStyle style;
@property (nonatomic, copy) BrowserAdvancedMenuItemHandler handler;
@property (nonatomic, copy) BrowserAdvancedMenuItemHandler longPressHandler;
@property (nonatomic, copy) BrowserAdvancedMenuToggleStateProvider toggleStateProvider;
@property (nonatomic, copy) BrowserAdvancedMenuTitleProvider tileTitleProvider;
@property (nonatomic) BOOL enabled;
@property (nonatomic) BOOL keepsMenuOpen;

+ (instancetype)itemWithTitle:(NSString *)title
                        style:(UIAlertActionStyle)style
                      handler:(BrowserAdvancedMenuItemHandler)handler;

@end

@implementation BrowserAdvancedMenuItem

+ (instancetype)itemWithTitle:(NSString *)title
                        style:(UIAlertActionStyle)style
                      handler:(BrowserAdvancedMenuItemHandler)handler {
    BrowserAdvancedMenuItem *item = [BrowserAdvancedMenuItem new];
    item.title = title ?: @"";
    item.style = style;
    item.handler = handler;
    item.enabled = YES;
    return item;
}

@end

@interface BrowserAdvancedMenuSection : NSObject

@property (nonatomic, copy) NSString *title;
@property (nonatomic, copy) NSArray<BrowserAdvancedMenuItem *> *items;

+ (instancetype)sectionWithTitle:(NSString *)title items:(NSArray<BrowserAdvancedMenuItem *> *)items;

@end

@interface BrowserAdvancedMenuTileCell : UICollectionViewCell

@property (nonatomic) UIImageView *symbolView;
@property (nonatomic) UILabel *titleLabel;
@property (nonatomic) UILabel *stateLabel;
@property (nonatomic) BOOL destructive;
@property (nonatomic) BOOL toggle;

- (void)configureWithItem:(BrowserAdvancedMenuItem *)item;

@end

@implementation BrowserAdvancedMenuTileCell

- (instancetype)initWithFrame:(CGRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        self.backgroundColor = UIColor.clearColor;
        self.contentView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.13];
        self.contentView.layer.cornerRadius = 16.0;
        self.contentView.layer.masksToBounds = YES;

        UIImageView *symbolView = [UIImageView new];
        symbolView.translatesAutoresizingMaskIntoConstraints = NO;
        symbolView.contentMode = UIViewContentModeScaleAspectFit;
        [self.contentView addSubview:symbolView];
        self.symbolView = symbolView;

        UILabel *titleLabel = [UILabel new];
        titleLabel.translatesAutoresizingMaskIntoConstraints = NO;
        titleLabel.font = [UIFont systemFontOfSize:19.0 weight:UIFontWeightMedium];
        titleLabel.numberOfLines = 2;
        titleLabel.lineBreakMode = NSLineBreakByTruncatingTail;
        [self.contentView addSubview:titleLabel];
        self.titleLabel = titleLabel;

        UILabel *stateLabel = [UILabel new];
        stateLabel.translatesAutoresizingMaskIntoConstraints = NO;
        stateLabel.font = [UIFont systemFontOfSize:14.0 weight:UIFontWeightSemibold];
        stateLabel.textAlignment = NSTextAlignmentCenter;
        stateLabel.layer.cornerRadius = 11.0;
        stateLabel.layer.masksToBounds = YES;
        [self.contentView addSubview:stateLabel];
        self.stateLabel = stateLabel;

        [NSLayoutConstraint activateConstraints:@[
            [symbolView.leadingAnchor constraintEqualToAnchor:self.contentView.leadingAnchor constant:16.0],
            [symbolView.topAnchor constraintEqualToAnchor:self.contentView.topAnchor constant:10.0],
            [symbolView.widthAnchor constraintEqualToConstant:32.0],
            [symbolView.heightAnchor constraintEqualToConstant:32.0],
            [titleLabel.leadingAnchor constraintEqualToAnchor:self.contentView.leadingAnchor constant:16.0],
            [titleLabel.trailingAnchor constraintEqualToAnchor:self.contentView.trailingAnchor constant:-10.0],
            [titleLabel.bottomAnchor constraintEqualToAnchor:self.contentView.bottomAnchor constant:-10.0],
            [stateLabel.trailingAnchor constraintEqualToAnchor:self.contentView.trailingAnchor constant:-10.0],
            [stateLabel.topAnchor constraintEqualToAnchor:self.contentView.topAnchor constant:10.0],
            [stateLabel.widthAnchor constraintEqualToConstant:42.0],
            [stateLabel.heightAnchor constraintEqualToConstant:22.0],
        ]];
    }
    return self;
}

- (void)configureWithItem:(BrowserAdvancedMenuItem *)item {
    self.destructive = item.style == UIAlertActionStyleDestructive;
    self.toggle = item.toggleStateProvider != nil;
    NSString *tileTitle = item.tileTitleProvider != nil ? item.tileTitleProvider() : item.tileTitle;
    self.titleLabel.text = tileTitle.length > 0 ? tileTitle : item.title;
    UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:30.0
                                                                                                 weight:UIImageSymbolWeightMedium];
    UIImage *symbol = [UIImage systemImageNamed:item.tileSymbolName ?: @"square.grid.2x2"
                             withConfiguration:configuration];
    if (symbol == nil) {
        symbol = [UIImage systemImageNamed:@"square.grid.2x2" withConfiguration:configuration];
    }
    self.symbolView.image = [symbol imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
    self.stateLabel.hidden = !self.toggle;
    if (self.toggle) {
        BOOL isOn = item.toggleStateProvider();
        self.stateLabel.text = isOn ? @"ON" : @"OFF";
        self.stateLabel.backgroundColor = isOn ? [UIColor colorWithRed:0.20 green:0.72 blue:0.42 alpha:0.95]
                                                   : [UIColor colorWithWhite:0.42 alpha:0.65];
        self.accessibilityValue = isOn ? @"On" : @"Off";
    } else {
        self.accessibilityValue = nil;
    }
    self.accessibilityLabel = item.tileTitleProvider != nil ? [self.titleLabel.text stringByReplacingOccurrencesOfString:@"\n" withString:@", "] : item.title;
    [self updateAppearance];
}

- (void)updateAppearance {
    BOOL focused = self.isFocused;
    self.contentView.backgroundColor = focused
        ? (self.destructive ? [UIColor colorWithRed:1.0 green:0.82 blue:0.89 alpha:0.98]
                            : [UIColor colorWithWhite:1.0 alpha:0.96])
        : [UIColor colorWithWhite:1.0 alpha:0.13];
    UIColor *foreground = focused
        ? (self.destructive ? [UIColor colorWithRed:0.69 green:0.12 blue:0.36 alpha:1.0] : UIColor.blackColor)
        : UIColor.whiteColor;
    self.symbolView.tintColor = foreground;
    self.titleLabel.textColor = foreground;
    self.stateLabel.textColor = UIColor.whiteColor;
    self.layer.zPosition = focused ? 1.0 : 0.0;
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{
        [self updateAppearance];
    } completion:nil];
}

@end

@implementation BrowserAdvancedMenuSection

+ (instancetype)sectionWithTitle:(NSString *)title items:(NSArray<BrowserAdvancedMenuItem *> *)items {
    BrowserAdvancedMenuSection *section = [BrowserAdvancedMenuSection new];
    section.title = title ?: @"";
    section.items = [items copy] ?: @[];
    return section;
}

@end

@interface BrowserAdvancedMenuViewController : UIViewController <UICollectionViewDataSource, UICollectionViewDelegateFlowLayout>

@property (nonatomic, copy) NSString *addressText;
@property (nonatomic, copy) BrowserAdvancedMenuItemHandler addressHandler;
@property (nonatomic, copy) BrowserAdvancedMenuItemHandler backHandler;
@property (nonatomic, copy) BrowserAdvancedMenuItemHandler forwardHandler;
@property (nonatomic) BOOL backEnabled;
@property (nonatomic) BOOL forwardEnabled;

- (instancetype)initWithToolbarItems:(NSArray<BrowserAdvancedMenuItem *> *)toolbarItems
                           sections:(NSArray<BrowserAdvancedMenuSection *> *)sections
                   footerText:(NSString *)footerText;

@end

@interface BrowserAdvancedMenuViewController ()

@property (nonatomic, copy) NSArray<BrowserAdvancedMenuItem *> *toolbarItems;
@property (nonatomic, copy) NSArray<UIButton *> *toolbarButtons;
@property (nonatomic, copy) NSArray<UIButton *> *historyButtons;
@property (nonatomic) UIButton *addressButton;
@property (nonatomic, copy) NSArray<BrowserAdvancedMenuSection *> *sections;
@property (nonatomic, copy) NSString *footerText;
@property (nonatomic) UIView *dimView;
@property (nonatomic) UIVisualEffectView *panelView;
@property (nonatomic) UICollectionView *tileView;
@property (nonatomic) NSIndexPath *focusedTileIndexPath;
@property (nonatomic) NSLayoutConstraint *panelTrailingConstraint;
@property (nonatomic) CGFloat panelWidth;
@property (nonatomic) BOOL didAnimateIn;
@property (nonatomic) BOOL dismissalInProgress;
@property (nonatomic) BOOL usingNativeGlassEffect;

@end

@implementation BrowserAdvancedMenuViewController

- (UIVisualEffect *)panelEffect {
    Class glassEffectClass = NSClassFromString(@"UIGlassEffect");
    if (glassEffectClass != Nil) {
        id effect = [[glassEffectClass alloc] init];
        if ([effect isKindOfClass:[UIVisualEffect class]]) {
            return (UIVisualEffect *)effect;
        }
    }
    return [UIBlurEffect effectWithStyle:UIBlurEffectStyleLight];
}

- (instancetype)initWithToolbarItems:(NSArray<BrowserAdvancedMenuItem *> *)toolbarItems
                           sections:(NSArray<BrowserAdvancedMenuSection *> *)sections
                   footerText:(NSString *)footerText {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _toolbarItems = [toolbarItems copy] ?: @[];
        _sections = [sections copy] ?: @[];
        _footerText = [footerText copy] ?: @"";
        self.modalPresentationStyle = UIModalPresentationOverCurrentContext;
        self.modalTransitionStyle = UIModalTransitionStyleCrossDissolve;
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.clearColor;

    self.panelWidth = MIN(MAX(CGRectGetWidth(UIScreen.mainScreen.bounds) * 0.38, 480.0), 700.0);
    self.usingNativeGlassEffect = (NSClassFromString(@"UIGlassEffect") != Nil);

    UIView *dimView = [UIView new];
    dimView.translatesAutoresizingMaskIntoConstraints = NO;
    dimView.backgroundColor = self.usingNativeGlassEffect ? UIColor.clearColor : [UIColor colorWithWhite:0.0 alpha:0.45];
    dimView.alpha = 0.0;
    [self.view addSubview:dimView];
    self.dimView = dimView;

    UIVisualEffectView *panelView = [[UIVisualEffectView alloc] initWithEffect:[self panelEffect]];
    panelView.translatesAutoresizingMaskIntoConstraints = NO;
    panelView.backgroundColor = UIColor.clearColor;
    panelView.layer.cornerRadius = 28.0;
    panelView.layer.masksToBounds = YES;
    panelView.layer.borderWidth = self.usingNativeGlassEffect ? 0.0 : 1.0;
    panelView.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.28].CGColor;
    [self.view addSubview:panelView];
    self.panelView = panelView;

    UIView *panelTint = nil;
    if (!self.usingNativeGlassEffect) {
        panelTint = [UIView new];
        panelTint.translatesAutoresizingMaskIntoConstraints = NO;
        panelTint.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.08];
        [panelView.contentView addSubview:panelTint];
    }

    UIButton *addressButton = [UIButton buttonWithType:UIButtonTypeSystem];
    addressButton.translatesAutoresizingMaskIntoConstraints = NO;
    addressButton.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.12];
    addressButton.layer.cornerRadius = 16.0;
    addressButton.accessibilityLabel = @"Edit Address";
    addressButton.accessibilityValue = self.addressText;
    [addressButton addTarget:self action:@selector(addressButtonPressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
    self.addressButton = addressButton;

    UIImageSymbolConfiguration *addressSymbolConfiguration = [UIImageSymbolConfiguration configurationWithPointSize:28.0
                                                                                                              weight:UIImageSymbolWeightMedium];
    UIImageView *addressIcon = [[UIImageView alloc] initWithImage:[[UIImage systemImageNamed:@"globe" withConfiguration:addressSymbolConfiguration]
                                                                   imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate]];
    addressIcon.translatesAutoresizingMaskIntoConstraints = NO;
    addressIcon.tag = 9797;
    addressIcon.tintColor = UIColor.whiteColor;
    addressIcon.userInteractionEnabled = NO;
    [addressButton addSubview:addressIcon];

    UILabel *addressLabel = [UILabel new];
    addressLabel.translatesAutoresizingMaskIntoConstraints = NO;
    addressLabel.tag = 9898;
    NSURL *displayURL = [NSURL URLWithString:self.addressText ?: @""];
    NSString *displayDomain = displayURL.host;
    addressLabel.text = displayDomain.length > 0 ? displayDomain : @"Search or enter address";
    addressLabel.font = [UIFont systemFontOfSize:25.0 weight:UIFontWeightMedium];
    addressLabel.textColor = UIColor.whiteColor;
    addressLabel.lineBreakMode = NSLineBreakByTruncatingMiddle;
    addressLabel.userInteractionEnabled = NO;
    [addressButton addSubview:addressLabel];

    [panelView.contentView addSubview:addressButton];

    NSMutableArray<UIButton *> *historyButtons = [NSMutableArray arrayWithCapacity:2];
    NSArray<NSString *> *historySymbols = @[@"chevron.left", @"chevron.right"];
    NSArray<NSString *> *historyLabels = @[@"Back", @"Forward"];
    NSArray<NSNumber *> *historyEnabledStates = @[@(self.backEnabled), @(self.forwardEnabled)];
    for (NSUInteger index = 0; index < historySymbols.count; index++) {
        UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
        button.tag = 11000 + (NSInteger)index;
        button.enabled = historyEnabledStates[index].boolValue;
        button.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.12];
        button.layer.cornerRadius = 12.0;
        button.accessibilityLabel = historyLabels[index];
        UIImageSymbolConfiguration *configuration = [UIImageSymbolConfiguration configurationWithPointSize:30.0
                                                                                                      weight:UIImageSymbolWeightSemibold];
        UIImage *image = [UIImage systemImageNamed:historySymbols[index] withConfiguration:configuration];
        UIImageView *iconView = [[UIImageView alloc] initWithImage:[image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate]];
        iconView.translatesAutoresizingMaskIntoConstraints = NO;
        iconView.tag = 9797;
        iconView.contentMode = UIViewContentModeScaleAspectFit;
        iconView.tintColor = UIColor.whiteColor;
        iconView.alpha = button.enabled ? 1.0 : 0.35;
        iconView.userInteractionEnabled = NO;
        [button addSubview:iconView];
        [button addTarget:self action:@selector(historyButtonPressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
        [NSLayoutConstraint activateConstraints:@[
            [iconView.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
            [iconView.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
            [iconView.widthAnchor constraintEqualToConstant:36.0],
            [iconView.heightAnchor constraintEqualToConstant:36.0],
        ]];
        [historyButtons addObject:button];
    }
    self.historyButtons = historyButtons;

    UIStackView *navigationToolbar = [UIStackView new];
    navigationToolbar.translatesAutoresizingMaskIntoConstraints = NO;
    navigationToolbar.axis = UILayoutConstraintAxisHorizontal;
    navigationToolbar.alignment = UIStackViewAlignmentFill;
    navigationToolbar.distribution = UIStackViewDistributionFillEqually;
    navigationToolbar.spacing = 8.0;
    [panelView.contentView addSubview:navigationToolbar];
    [navigationToolbar addArrangedSubview:historyButtons[0]];
    [navigationToolbar addArrangedSubview:historyButtons[1]];
    NSArray<NSString *> *toolbarSymbols = @[@"house.fill", @"arrow.clockwise", @"plus", @"square.on.square"];
    NSMutableArray<UIButton *> *toolbarButtons = [NSMutableArray arrayWithCapacity:self.toolbarItems.count];
    [self.toolbarItems enumerateObjectsUsingBlock:^(BrowserAdvancedMenuItem *item, NSUInteger index, __unused BOOL *stop) {
        UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
        button.tag = 10000 + (NSInteger)index;
        button.enabled = item.enabled;
        button.backgroundColor = item.toggleStateProvider != nil && item.toggleStateProvider()
            ? [UIColor colorWithRed:0.20 green:0.54 blue:0.90 alpha:0.72]
            : [UIColor colorWithWhite:1.0 alpha:0.12];
        button.layer.cornerRadius = 12.0;
        UIImageSymbolConfiguration *symbolConfiguration = [UIImageSymbolConfiguration configurationWithPointSize:34.0
                                                                                                           weight:UIImageSymbolWeightMedium];
        UIImage *symbol = [UIImage systemImageNamed:toolbarSymbols[index] withConfiguration:symbolConfiguration];
        UIImageView *iconView = [[UIImageView alloc] initWithImage:[symbol imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate]];
        iconView.translatesAutoresizingMaskIntoConstraints = NO;
        iconView.tag = 9797;
        iconView.contentMode = UIViewContentModeScaleAspectFit;
        iconView.tintColor = UIColor.whiteColor;
        iconView.alpha = item.enabled ? 1.0 : 0.35;
        iconView.userInteractionEnabled = NO;
        [button addSubview:iconView];
        [NSLayoutConstraint activateConstraints:@[
            [iconView.centerXAnchor constraintEqualToAnchor:button.centerXAnchor],
            [iconView.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
            [iconView.widthAnchor constraintEqualToConstant:42.0],
            [iconView.heightAnchor constraintEqualToConstant:42.0],
        ]];
        button.accessibilityLabel = item.title;
        button.accessibilityValue = item.toggleStateProvider != nil ? (item.toggleStateProvider() ? @"On" : @"Off") : nil;
        [button addTarget:self action:@selector(toolbarButtonPressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
        [navigationToolbar addArrangedSubview:button];
        [toolbarButtons addObject:button];
    }];
    self.toolbarButtons = toolbarButtons;

    UIView *toolbarSeparator = [UIView new];
    toolbarSeparator.translatesAutoresizingMaskIntoConstraints = NO;
    toolbarSeparator.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.24];
    [panelView.contentView addSubview:toolbarSeparator];

    UILabel *footerLabel = [UILabel new];
    footerLabel.translatesAutoresizingMaskIntoConstraints = NO;
    footerLabel.text = self.footerText;
    footerLabel.textAlignment = NSTextAlignmentCenter;
    footerLabel.font = [UIFont systemFontOfSize:20.0 weight:UIFontWeightRegular];
    if (@available(tvOS 13.0, *)) {
        footerLabel.textColor = UIColor.secondaryLabelColor;
    } else {
        footerLabel.textColor = [UIColor colorWithWhite:1.0 alpha:0.7];
    }
    [panelView.contentView addSubview:footerLabel];

    UICollectionViewFlowLayout *tileLayout = [UICollectionViewFlowLayout new];
    tileLayout.itemSize = CGSizeMake((self.panelWidth - 32.0 - 32.0 - 20.0) / 3.0, 104.0);
    tileLayout.minimumInteritemSpacing = 10.0;
    tileLayout.minimumLineSpacing = 10.0;
    tileLayout.sectionInset = UIEdgeInsetsMake(4.0, 16.0, 8.0, 16.0);
    tileLayout.headerReferenceSize = CGSizeMake(self.panelWidth - 32.0, 36.0);

    UICollectionView *tileView = [[UICollectionView alloc] initWithFrame:CGRectZero collectionViewLayout:tileLayout];
    tileView.translatesAutoresizingMaskIntoConstraints = NO;
    tileView.dataSource = self;
    tileView.delegate = self;
    tileView.backgroundColor = UIColor.clearColor;
    tileView.remembersLastFocusedIndexPath = YES;
    tileView.showsVerticalScrollIndicator = NO;
    tileView.contentInset = UIEdgeInsetsZero;
    if (@available(tvOS 11.0, *)) {
        tileView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    }
    [tileView registerClass:BrowserAdvancedMenuTileCell.class forCellWithReuseIdentifier:@"MenuTile"];
    [tileView registerClass:UICollectionReusableView.class
        forSupplementaryViewOfKind:UICollectionElementKindSectionHeader
               withReuseIdentifier:@"MenuSectionHeader"];
    [panelView.contentView addSubview:tileView];
    self.tileView = tileView;
    UILongPressGestureRecognizer *settingsPress = [[UILongPressGestureRecognizer alloc]
        initWithTarget:self action:@selector(handleTileLongPress:)];
    settingsPress.minimumPressDuration = 0.6;
    settingsPress.allowedPressTypes = @[@(UIPressTypeSelect)];
    settingsPress.cancelsTouchesInView = YES;
    [tileView addGestureRecognizer:settingsPress];

    self.panelTrailingConstraint = [panelView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor
                                                                             constant:self.panelWidth + 32.0];

    NSMutableArray<NSLayoutConstraint *> *constraints = [NSMutableArray arrayWithArray:@[
        [dimView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [dimView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [dimView.topAnchor constraintEqualToAnchor:self.view.topAnchor],
        [dimView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],

        [panelView.widthAnchor constraintEqualToConstant:self.panelWidth],
        [panelView.topAnchor constraintEqualToAnchor:self.view.topAnchor constant:16.0],
        [panelView.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor constant:-16.0],
        self.panelTrailingConstraint,

        [addressButton.heightAnchor constraintEqualToConstant:64.0],
        [addressButton.leadingAnchor constraintEqualToAnchor:panelView.leadingAnchor constant:24.0],
        [addressButton.trailingAnchor constraintEqualToAnchor:panelView.trailingAnchor constant:-24.0],
        [addressButton.topAnchor constraintEqualToAnchor:panelView.topAnchor constant:24.0],
        [addressIcon.leadingAnchor constraintEqualToAnchor:addressButton.leadingAnchor constant:18.0],
        [addressIcon.centerYAnchor constraintEqualToAnchor:addressButton.centerYAnchor],
        [addressIcon.widthAnchor constraintEqualToConstant:32.0],
        [addressIcon.heightAnchor constraintEqualToConstant:32.0],
        [addressLabel.leadingAnchor constraintEqualToAnchor:addressIcon.trailingAnchor constant:14.0],
        [addressLabel.trailingAnchor constraintEqualToAnchor:addressButton.trailingAnchor constant:-18.0],
        [addressLabel.centerYAnchor constraintEqualToAnchor:addressButton.centerYAnchor],

        [navigationToolbar.leadingAnchor constraintEqualToAnchor:panelView.leadingAnchor constant:24.0],
        [navigationToolbar.trailingAnchor constraintEqualToAnchor:panelView.trailingAnchor constant:-24.0],
        [navigationToolbar.topAnchor constraintEqualToAnchor:addressButton.bottomAnchor constant:12.0],
        [navigationToolbar.heightAnchor constraintEqualToConstant:64.0],

        [toolbarSeparator.leadingAnchor constraintEqualToAnchor:panelView.leadingAnchor constant:32.0],
        [toolbarSeparator.trailingAnchor constraintEqualToAnchor:panelView.trailingAnchor constant:-32.0],
        [toolbarSeparator.topAnchor constraintEqualToAnchor:navigationToolbar.bottomAnchor constant:14.0],
        [toolbarSeparator.heightAnchor constraintEqualToConstant:1.0],

        [tileView.topAnchor constraintEqualToAnchor:toolbarSeparator.bottomAnchor constant:12.0],
        [tileView.leadingAnchor constraintEqualToAnchor:panelView.leadingAnchor constant:16.0],
        [tileView.trailingAnchor constraintEqualToAnchor:panelView.trailingAnchor constant:-16.0],
        [tileView.bottomAnchor constraintEqualToAnchor:footerLabel.topAnchor constant:-8.0],

        [footerLabel.leadingAnchor constraintEqualToAnchor:panelView.leadingAnchor constant:24.0],
        [footerLabel.trailingAnchor constraintEqualToAnchor:panelView.trailingAnchor constant:-24.0],
        [footerLabel.bottomAnchor constraintEqualToAnchor:panelView.bottomAnchor constant:-12.0],
    ]];
    if (panelTint != nil) {
        [constraints addObject:[panelTint.leadingAnchor constraintEqualToAnchor:panelView.contentView.leadingAnchor]];
        [constraints addObject:[panelTint.trailingAnchor constraintEqualToAnchor:panelView.contentView.trailingAnchor]];
        [constraints addObject:[panelTint.topAnchor constraintEqualToAnchor:panelView.contentView.topAnchor]];
        [constraints addObject:[panelTint.bottomAnchor constraintEqualToAnchor:panelView.contentView.bottomAnchor]];
    }
    [NSLayoutConstraint activateConstraints:constraints];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if (self.didAnimateIn) {
        return;
    }
    self.didAnimateIn = YES;
    self.panelTrailingConstraint.constant = -16.0;
    [UIView animateWithDuration:0.28
                          delay:0.0
                        options:UIViewAnimationOptionCurveEaseOut
                     animations:^{
        self.dimView.alpha = 1.0;
        [self.view layoutIfNeeded];
    } completion:^(__unused BOOL finished) {
        [self setNeedsFocusUpdate];
        [self updateFocusIfNeeded];
    }];
}

- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated];

    if (!self.isBeingDismissed || self.dismissalInProgress) {
        return;
    }

    self.panelTrailingConstraint.constant = self.panelWidth + 32.0;
    id<UIViewControllerTransitionCoordinator> coordinator = self.transitionCoordinator;
    if (coordinator != nil) {
        [coordinator animateAlongsideTransition:^(__unused id<UIViewControllerTransitionCoordinatorContext> context) {
            self.dimView.alpha = 0.0;
            [self.view layoutIfNeeded];
        } completion:nil];
        return;
    }

    [UIView animateWithDuration:0.22
                          delay:0.0
                        options:UIViewAnimationOptionCurveEaseIn
                     animations:^{
        self.dimView.alpha = 0.0;
        [self.view layoutIfNeeded];
    } completion:nil];
}

- (void)dismissMenuWithCompletion:(void (^)(void))completion {
    if (self.dismissalInProgress) {
        return;
    }
    self.dismissalInProgress = YES;
    self.panelTrailingConstraint.constant = self.panelWidth + 32.0;
    [UIView animateWithDuration:0.22
                          delay:0.0
                        options:UIViewAnimationOptionCurveEaseIn
                     animations:^{
        self.dimView.alpha = 0.0;
        [self.view layoutIfNeeded];
    } completion:^(__unused BOOL finished) {
        [self dismissViewControllerAnimated:NO completion:completion];
    }];
}

- (NSInteger)numberOfSectionsInCollectionView:(__unused UICollectionView *)collectionView {
    return (NSInteger)self.sections.count;
}

- (NSInteger)collectionView:(__unused UICollectionView *)collectionView
     numberOfItemsInSection:(NSInteger)section {
    return (NSInteger)self.sections[(NSUInteger)section].items.count;
}

- (CGSize)collectionView:(__unused UICollectionView *)collectionView
                  layout:(__unused UICollectionViewLayout *)collectionViewLayout
  sizeForItemAtIndexPath:(NSIndexPath *)indexPath {
    CGFloat availableWidth = self.panelWidth - 32.0 - 32.0;
    CGFloat thirdWidth = floor((availableWidth - 20.0) / 3.0);
    CGFloat width = indexPath.section == 2 && indexPath.item == 4
        ? availableWidth - thirdWidth - 10.0
        : thirdWidth;
    return CGSizeMake(width, 104.0);
}

- (UICollectionViewCell *)collectionView:(UICollectionView *)collectionView
                  cellForItemAtIndexPath:(NSIndexPath *)indexPath {
    BrowserAdvancedMenuTileCell *cell = [collectionView dequeueReusableCellWithReuseIdentifier:@"MenuTile"
                                                                                    forIndexPath:indexPath];
    BrowserAdvancedMenuItem *item = self.sections[(NSUInteger)indexPath.section].items[(NSUInteger)indexPath.item];
    [cell configureWithItem:item];
    return cell;
}

- (UICollectionReusableView *)collectionView:(UICollectionView *)collectionView
           viewForSupplementaryElementOfKind:(NSString *)kind
                                 atIndexPath:(NSIndexPath *)indexPath {
    UICollectionReusableView *header = [collectionView dequeueReusableSupplementaryViewOfKind:kind
                                                                           withReuseIdentifier:@"MenuSectionHeader"
                                                                                  forIndexPath:indexPath];
    UILabel *titleLabel = [header viewWithTag:9191];
    if (titleLabel == nil) {
        titleLabel = [UILabel new];
        titleLabel.translatesAutoresizingMaskIntoConstraints = NO;
        titleLabel.tag = 9191;
        titleLabel.font = [UIFont systemFontOfSize:21.0 weight:UIFontWeightSemibold];
        titleLabel.textColor = [UIColor colorWithWhite:1.0 alpha:0.72];
        [header addSubview:titleLabel];
        [NSLayoutConstraint activateConstraints:@[
            [titleLabel.leadingAnchor constraintEqualToAnchor:header.leadingAnchor constant:20.0],
            [titleLabel.trailingAnchor constraintEqualToAnchor:header.trailingAnchor constant:-20.0],
            [titleLabel.bottomAnchor constraintEqualToAnchor:header.bottomAnchor constant:-4.0],
        ]];
    }
    titleLabel.text = self.sections[(NSUInteger)indexPath.section].title.uppercaseString;
    return header;
}

- (BOOL)collectionView:(__unused UICollectionView *)collectionView
 canFocusItemAtIndexPath:(NSIndexPath *)indexPath {
    return self.sections[(NSUInteger)indexPath.section].items[(NSUInteger)indexPath.item].enabled;
}

- (void)collectionView:(UICollectionView *)collectionView didSelectItemAtIndexPath:(NSIndexPath *)indexPath {
    [collectionView deselectItemAtIndexPath:indexPath animated:YES];
    BrowserAdvancedMenuItem *item = self.sections[(NSUInteger)indexPath.section].items[(NSUInteger)indexPath.item];
    BrowserAdvancedMenuItemHandler handler = item.handler;
    if (item.toggleStateProvider != nil || item.keepsMenuOpen) {
        if (handler != nil) {
            handler();
        }
        for (NSIndexPath *visibleIndexPath in collectionView.indexPathsForVisibleItems) {
            BrowserAdvancedMenuItem *visibleItem = self.sections[(NSUInteger)visibleIndexPath.section].items[(NSUInteger)visibleIndexPath.item];
            BrowserAdvancedMenuTileCell *cell = (BrowserAdvancedMenuTileCell *)[collectionView cellForItemAtIndexPath:visibleIndexPath];
            [cell configureWithItem:visibleItem];
        }
        return;
    }
    [self dismissMenuWithCompletion:handler];
}

- (void)handleTileLongPress:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state != UIGestureRecognizerStateBegan) return;
    NSIndexPath *indexPath = [self.tileView indexPathForItemAtPoint:[recognizer locationInView:self.tileView]];
    if (indexPath == nil) indexPath = self.focusedTileIndexPath;
    if (indexPath == nil) return;
    BrowserAdvancedMenuItem *item = self.sections[(NSUInteger)indexPath.section].items[(NSUInteger)indexPath.item];
    if (item.longPressHandler != nil) [self dismissMenuWithCompletion:item.longPressHandler];
}

- (void)toolbarButtonPressed:(UIButton *)button {
    NSInteger index = button.tag - 10000;
    if (index < 0 || index >= (NSInteger)self.toolbarItems.count) {
        return;
    }
    BrowserAdvancedMenuItem *item = self.toolbarItems[(NSUInteger)index];
    if (!item.enabled || item.handler == nil) {
        return;
    }
    if (item.keepsMenuOpen) {
        item.handler();
        if (item.toggleStateProvider != nil) {
            BOOL isOn = item.toggleStateProvider();
            button.backgroundColor = isOn ? [UIColor colorWithRed:0.20 green:0.54 blue:0.90 alpha:0.72]
                                          : [UIColor colorWithWhite:1.0 alpha:0.12];
            button.accessibilityValue = isOn ? @"On" : @"Off";
        }
    } else {
        [self dismissMenuWithCompletion:item.handler];
    }
}

- (void)addressButtonPressed:(__unused UIButton *)button {
    if (self.addressHandler != nil) {
        [self dismissMenuWithCompletion:self.addressHandler];
    }
}

- (void)historyButtonPressed:(UIButton *)button {
    BrowserAdvancedMenuItemHandler handler = button.tag == 11000 ? self.backHandler : self.forwardHandler;
    if (button.enabled && handler != nil) {
        [self dismissMenuWithCompletion:handler];
    }
}

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    if (self.addressButton.enabled) {
        return @[self.addressButton];
    }
    if (self.toolbarButtons.count >= kBrowserNavigationToolbarItemCount) {
        UIButton *newTabButton = self.toolbarButtons[kBrowserNavigationToolbarItemCount - 2];
        if (newTabButton.enabled) {
            return @[newTabButton];
        }
    }
    for (UIButton *button in self.toolbarButtons) {
        if (button.enabled) {
            return @[button];
        }
    }
    return @[self.tileView];
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    UIView *previousView = context.previouslyFocusedView;
    UIView *nextView = context.nextFocusedView;
    if ([nextView isKindOfClass:BrowserAdvancedMenuTileCell.class]) {
        self.focusedTileIndexPath = [self.tileView indexPathForCell:(BrowserAdvancedMenuTileCell *)nextView];
    }
    if (previousView == self.addressButton) {
        previousView.layer.zPosition = 0.0;
        previousView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.12];
        ((UILabel *)[self.addressButton viewWithTag:9898]).textColor = UIColor.whiteColor;
        [self setToolbarIconColor:UIColor.whiteColor forButton:self.addressButton];
    }
    if (nextView == self.addressButton) {
        [nextView.superview bringSubviewToFront:nextView];
        nextView.layer.zPosition = 2.0;
        nextView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.96];
        ((UILabel *)[self.addressButton viewWithTag:9898]).textColor = UIColor.blackColor;
        [self setToolbarIconColor:UIColor.blackColor forButton:self.addressButton];
    }
    if ([self.toolbarButtons containsObject:(UIButton *)previousView]) {
        previousView.layer.zPosition = 0.0;
    }
    if ([self.toolbarButtons containsObject:(UIButton *)nextView]) {
        [nextView.superview bringSubviewToFront:nextView];
        nextView.layer.zPosition = 1.0;
    }
    if ([self.historyButtons containsObject:(UIButton *)previousView]) {
        previousView.layer.zPosition = 0.0;
        previousView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.12];
        [self setToolbarIconColor:UIColor.whiteColor forButton:(UIButton *)previousView];
    }
    if ([self.historyButtons containsObject:(UIButton *)nextView]) {
        [nextView.superview bringSubviewToFront:nextView];
        nextView.layer.zPosition = 3.0;
        nextView.backgroundColor = [UIColor colorWithWhite:1.0 alpha:0.96];
        [self setToolbarIconColor:UIColor.blackColor forButton:(UIButton *)nextView];
    }
    [coordinator addCoordinatedAnimations:^{
        if ([self.toolbarButtons containsObject:(UIButton *)previousView]) {
            [self setToolbarIconColor:UIColor.whiteColor forButton:(UIButton *)previousView];
        }
        if ([self.toolbarButtons containsObject:(UIButton *)nextView]) {
            [self setToolbarIconColor:UIColor.blackColor forButton:(UIButton *)nextView];
        }
    } completion:nil];
}

- (void)setToolbarIconColor:(UIColor *)color forButton:(UIButton *)button {
    UIView *icon = [button viewWithTag:9797];
    if ([icon isKindOfClass:[UIImageView class]]) {
        ((UIImageView *)icon).tintColor = color;
    } else if ([icon isKindOfClass:[UILabel class]]) {
        ((UILabel *)icon).textColor = color;
    }
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    UIPress *press = presses.anyObject;
    if (press != nil && press.type == UIPressTypeMenu) {
        [self dismissMenuWithCompletion:nil];
        return;
    }
    [super pressesEnded:presses withEvent:event];
}

@end

@interface BrowserOptionsCell : UITableViewCell
@property (nonatomic, strong) UILabel *optionLabel;
@property (nonatomic, strong) UILabel *stateLabel;
@property (nonatomic, strong) UILabel *detailLabel;
@property (nonatomic, strong) NSLayoutConstraint *accessoryTitleConstraint;
@property (nonatomic, strong) NSLayoutConstraint *fullWidthTitleConstraint;
- (void)refreshAppearance;
@end

@implementation BrowserOptionsCell

- (instancetype)initWithStyle:(UITableViewCellStyle)style reuseIdentifier:(NSString *)identifier {
    self = [super initWithStyle:UITableViewCellStyleDefault reuseIdentifier:identifier];
    if (self) {
        self.backgroundColor = UIColor.clearColor;
        self.selectionStyle = UITableViewCellSelectionStyleNone;
        self.contentView.layer.cornerRadius = 14.0;
        self.contentView.layer.masksToBounds = YES;

        UILabel *optionLabel = [UILabel new];
        optionLabel.translatesAutoresizingMaskIntoConstraints = NO;
        optionLabel.font = [UIFont systemFontOfSize:23.0 weight:UIFontWeightMedium];
        optionLabel.lineBreakMode = NSLineBreakByTruncatingTail;
        [self.contentView addSubview:optionLabel];
        self.optionLabel = optionLabel;

        UILabel *stateLabel = [UILabel new];
        stateLabel.translatesAutoresizingMaskIntoConstraints = NO;
        BrowserTVConfigureToggleBadge(stateLabel, NO);
        [self.contentView addSubview:stateLabel];
        self.stateLabel = stateLabel;

        UILabel *detailLabel = [UILabel new];
        detailLabel.translatesAutoresizingMaskIntoConstraints = NO;
        detailLabel.font = [UIFont systemFontOfSize:18.0 weight:UIFontWeightRegular];
        detailLabel.textAlignment = NSTextAlignmentRight;
        detailLabel.lineBreakMode = NSLineBreakByTruncatingTail;
        [self.contentView addSubview:detailLabel];
        self.detailLabel = detailLabel;

        self.accessoryTitleConstraint = [optionLabel.trailingAnchor constraintLessThanOrEqualToAnchor:detailLabel.leadingAnchor constant:-10.0];
        self.fullWidthTitleConstraint = [optionLabel.trailingAnchor constraintEqualToAnchor:self.contentView.trailingAnchor constant:-16.0];
        [NSLayoutConstraint activateConstraints:@[
            [optionLabel.leadingAnchor constraintEqualToAnchor:self.contentView.leadingAnchor constant:16.0],
            [optionLabel.centerYAnchor constraintEqualToAnchor:self.contentView.centerYAnchor],
            self.accessoryTitleConstraint,
            [stateLabel.centerYAnchor constraintEqualToAnchor:self.contentView.centerYAnchor],
            [stateLabel.widthAnchor constraintEqualToConstant:42.0],
            [stateLabel.heightAnchor constraintEqualToConstant:22.0],
            [stateLabel.trailingAnchor constraintEqualToAnchor:self.contentView.trailingAnchor constant:-16.0],
            [detailLabel.centerYAnchor constraintEqualToAnchor:self.contentView.centerYAnchor],
            [detailLabel.trailingAnchor constraintEqualToAnchor:stateLabel.leadingAnchor constant:-8.0],
            [detailLabel.widthAnchor constraintEqualToConstant:196.0],
        ]];
        [self refreshAppearance];
    }
    return self;
}

- (void)layoutSubviews {
    [super layoutSubviews];
    self.contentView.frame = CGRectInset(self.bounds, 0.0, 5.0);
}

- (void)refreshAppearance {
    BOOL focused = self.isFocused;
    self.contentView.backgroundColor = focused ? BrowserTVFocusedSurfaceColor()
                                               : BrowserTVRestingSurfaceColor();
    self.optionLabel.textColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
    self.detailLabel.textColor = focused ? BrowserTVFocusedTextColor()
                                          : [UIColor colorWithWhite:1.0 alpha:0.72];
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{ [self refreshAppearance]; } completion:nil];
}

@end

@interface BrowserBadgeToggleControl : UIControl
@property (nonatomic, strong) UILabel *titleLabel;
@property (nonatomic, strong) UILabel *stateLabel;
@end

@implementation BrowserBadgeToggleControl

- (instancetype)initWithFrame:(CGRect)frame {
    self = [super initWithFrame:frame];
    if (self) {
        self.backgroundColor = BrowserTVRestingSurfaceColor();
        self.layer.cornerRadius = 14.0;
        self.layer.masksToBounds = YES;
        self.accessibilityTraits = UIAccessibilityTraitButton;
        UILabel *titleLabel = [UILabel new];
        titleLabel.translatesAutoresizingMaskIntoConstraints = NO;
        titleLabel.userInteractionEnabled = NO;
        titleLabel.text = @"";
        titleLabel.font = [UIFont systemFontOfSize:23.0 weight:UIFontWeightMedium];
        titleLabel.textColor = UIColor.whiteColor;
        [self addSubview:titleLabel];
        self.titleLabel = titleLabel;
        UILabel *stateLabel = [UILabel new];
        stateLabel.translatesAutoresizingMaskIntoConstraints = NO;
        stateLabel.userInteractionEnabled = NO;
        BrowserTVConfigureToggleBadge(stateLabel, NO);
        [self addSubview:stateLabel];
        self.stateLabel = stateLabel;
        [NSLayoutConstraint activateConstraints:@[
            [titleLabel.leadingAnchor constraintEqualToAnchor:self.leadingAnchor constant:16.0],
            [titleLabel.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
            [titleLabel.trailingAnchor constraintEqualToAnchor:stateLabel.leadingAnchor constant:-8.0],
            [stateLabel.trailingAnchor constraintEqualToAnchor:self.trailingAnchor constant:-16.0],
            [stateLabel.centerYAnchor constraintEqualToAnchor:self.centerYAnchor],
            [stateLabel.widthAnchor constraintEqualToConstant:42.0],
            [stateLabel.heightAnchor constraintEqualToConstant:22.0],
        ]];
    }
    return self;
}

- (BOOL)canBecomeFocused {
    return YES;
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeSelect) {
            [self sendActionsForControlEvents:UIControlEventPrimaryActionTriggered];
            return;
        }
    }
    [super pressesEnded:presses withEvent:event];
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{
        self.backgroundColor = self.isFocused ? BrowserTVFocusedSurfaceColor() : BrowserTVRestingSurfaceColor();
        self.titleLabel.textColor = self.isFocused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
    } completion:nil];
}

@end

@interface BrowserOptionsViewController : UIViewController <UITableViewDataSource, UITableViewDelegate>

@property (nonatomic, copy) BOOL (^enabledProvider)(void);
@property (nonatomic, copy) void (^toggleEnabled)(void);
@property (nonatomic, copy) void (^activateRow)(NSString *identifier);
@property (nonatomic, copy) NSArray<NSDictionary<NSString *, NSString *> *> *rows;
@property (nonatomic, strong) UITableView *tableView;
@property (nonatomic, strong) BrowserBadgeToggleControl *headerToggleButton;
@property (nonatomic, copy) NSString *toggleTitle;
@property (nonatomic, copy) BOOL (^rowEnabledProvider)(NSString *identifier);
@property (nonatomic, copy) NSString * (^rowDetailProvider)(NSString *identifier);
@property (nonatomic) BOOL dismissBeforeRowAction;
@property (nonatomic, copy) NSString *secondaryActionTitle;
@property (nonatomic, copy) void (^secondaryAction)(void);
@property (nonatomic, copy) NSNotificationName statusNotification;

- (instancetype)initWithEnabledProvider:(BOOL (^)(void))enabledProvider
                         toggleEnabled:(void (^)(void))toggleEnabled
                             activateRow:(void (^ _Nullable)(NSString *identifier))activateRow;

@end

@implementation BrowserOptionsViewController

- (instancetype)initWithEnabledProvider:(BOOL (^)(void))enabledProvider
                         toggleEnabled:(void (^)(void))toggleEnabled
                             activateRow:(void (^)(NSString *identifier))activateRow {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _enabledProvider = [enabledProvider copy];
        _toggleEnabled = [toggleEnabled copy];
        _activateRow = [activateRow copy];
        _rows = @[];
        self.modalPresentationStyle = UIModalPresentationOverCurrentContext;
        self.modalTransitionStyle = UIModalTransitionStyleCrossDissolve;
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.48];

    UIVisualEffectView *panel = [[UIVisualEffectView alloc] initWithEffect:BrowserTVPanelEffect()];
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    panel.layer.cornerRadius = 28.0;
    panel.layer.masksToBounds = YES;
    panel.layer.borderWidth = NSClassFromString(@"UIGlassEffect") != Nil ? 0.0 : 1.0;
    panel.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.25].CGColor;
    [self.view addSubview:panel];

    UILabel *heading = [UILabel new];
    heading.translatesAutoresizingMaskIntoConstraints = NO;
    heading.text = @"Settings";
    heading.textColor = UIColor.whiteColor;
    heading.font = [UIFont systemFontOfSize:40.0 weight:UIFontWeightBold];
    [panel.contentView addSubview:heading];

    BrowserBadgeToggleControl *headerToggleButton = [[BrowserBadgeToggleControl alloc] initWithFrame:CGRectZero];
    headerToggleButton.translatesAutoresizingMaskIntoConstraints = NO;
    headerToggleButton.accessibilityLabel = self.toggleTitle;
    headerToggleButton.titleLabel.text = headerToggleButton.accessibilityLabel;
    [headerToggleButton addTarget:self action:@selector(headerTogglePressed:)
               forControlEvents:UIControlEventPrimaryActionTriggered];
    self.headerToggleButton = headerToggleButton;

    [panel.contentView addSubview:headerToggleButton];
    [self refreshHeaderToggle];

    UITableView *table = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStylePlain];
    table.translatesAutoresizingMaskIntoConstraints = NO;
    table.dataSource = self;
    table.delegate = self;
    table.rowHeight = 72.0;
    table.backgroundColor = UIColor.clearColor;
    table.showsVerticalScrollIndicator = YES;
    [panel.contentView addSubview:table];
    self.tableView = table;

    UIButton *updateButton = [UIButton buttonWithType:UIButtonTypeSystem];
    updateButton.translatesAutoresizingMaskIntoConstraints = NO;
    updateButton.backgroundColor = BrowserTVRestingSurfaceColor();
    updateButton.layer.cornerRadius = 14.0;
    updateButton.titleLabel.font = [UIFont systemFontOfSize:21.0 weight:UIFontWeightMedium];
    [updateButton setTitle:self.secondaryActionTitle forState:UIControlStateNormal];
    [updateButton setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    [updateButton setTitleColor:BrowserTVFocusedTextColor() forState:UIControlStateFocused];
    [updateButton addTarget:self action:@selector(updatePressed:) forControlEvents:UIControlEventPrimaryActionTriggered];

    UIButton *doneButton = [UIButton buttonWithType:UIButtonTypeSystem];
    doneButton.translatesAutoresizingMaskIntoConstraints = NO;
    doneButton.backgroundColor = BrowserTVRestingSurfaceColor();
    doneButton.layer.cornerRadius = 14.0;
    doneButton.titleLabel.font = [UIFont systemFontOfSize:24.0 weight:UIFontWeightMedium];
    [doneButton setTitle:@"Done" forState:UIControlStateNormal];
    [doneButton setTitleColor:UIColor.whiteColor forState:UIControlStateNormal];
    [doneButton setTitleColor:BrowserTVFocusedTextColor() forState:UIControlStateFocused];
    [doneButton addTarget:self action:@selector(donePressed:) forControlEvents:UIControlEventPrimaryActionTriggered];
    UIStackView *actionButtons = [[UIStackView alloc] initWithArrangedSubviews:@[updateButton, doneButton]];
    actionButtons.translatesAutoresizingMaskIntoConstraints = NO;
    actionButtons.axis = UILayoutConstraintAxisHorizontal;
    actionButtons.spacing = 12.0;
    [panel.contentView addSubview:actionButtons];
    updateButton.hidden = self.secondaryAction == nil;

    CGFloat width = MIN(MAX(CGRectGetWidth(UIScreen.mainScreen.bounds) * 0.58, 720.0), 1100.0) * 0.5;
    CGFloat contentHeight = 28.0 + 48.0 + 22.0 + ((CGFloat)self.rows.count + 1.5) * table.rowHeight + 18.0 + 64.0 + 24.0;
    NSLayoutConstraint *preferredHeight = [panel.heightAnchor constraintEqualToConstant:MIN(contentHeight, 860.0)];
    preferredHeight.priority = UILayoutPriorityDefaultHigh;
    [NSLayoutConstraint activateConstraints:@[
        [panel.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
        [panel.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],
        [panel.widthAnchor constraintEqualToConstant:width],
        [panel.widthAnchor constraintLessThanOrEqualToAnchor:self.view.safeAreaLayoutGuide.widthAnchor constant:-60.0],
        preferredHeight,
        [panel.heightAnchor constraintLessThanOrEqualToAnchor:self.view.safeAreaLayoutGuide.heightAnchor constant:-50.0],
        [heading.leadingAnchor constraintEqualToAnchor:panel.contentView.leadingAnchor constant:24.0],
        [heading.trailingAnchor constraintLessThanOrEqualToAnchor:headerToggleButton.leadingAnchor constant:-16.0],
        [heading.topAnchor constraintEqualToAnchor:panel.contentView.topAnchor constant:28.0],
        [headerToggleButton.centerYAnchor constraintEqualToAnchor:heading.centerYAnchor],
        [headerToggleButton.trailingAnchor constraintEqualToAnchor:panel.contentView.trailingAnchor constant:-24.0],
        [headerToggleButton.heightAnchor constraintEqualToConstant:44.0],
        [table.leadingAnchor constraintEqualToAnchor:panel.contentView.leadingAnchor constant:20.0],
        [table.trailingAnchor constraintEqualToAnchor:panel.contentView.trailingAnchor constant:-20.0],
        [table.topAnchor constraintEqualToAnchor:heading.bottomAnchor constant:22.0],
        [table.bottomAnchor constraintEqualToAnchor:actionButtons.topAnchor constant:-18.0],
        [actionButtons.centerXAnchor constraintEqualToAnchor:panel.contentView.centerXAnchor],
        [actionButtons.bottomAnchor constraintEqualToAnchor:panel.contentView.bottomAnchor constant:-24.0],
        [actionButtons.heightAnchor constraintEqualToConstant:64.0],
        [updateButton.widthAnchor constraintEqualToConstant:self.secondaryAction != nil ? 300.0 : 0.0],
        [doneButton.widthAnchor constraintEqualToConstant:150.0],
    ]];

    if (self.statusNotification != nil) {
        [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(rowStatusDidChange:)
            name:self.statusNotification object:nil];
    }
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (NSInteger)tableView:(UITableView *)tableView numberOfRowsInSection:(NSInteger)section {
    (void)tableView;
    (void)section;
    return (NSInteger)self.rows.count;
}

- (void)configureCell:(BrowserOptionsCell *)cell atIndexPath:(NSIndexPath *)indexPath {
    NSDictionary *source = self.rows[(NSUInteger)indexPath.row];
    BOOL showsToggle = self.rowEnabledProvider != nil && ![source[@"action"] isEqualToString:@"yes"];
    cell.stateLabel.hidden = !showsToggle;
    cell.detailLabel.hidden = !showsToggle;
    cell.accessoryTitleConstraint.active = showsToggle;
    cell.fullWidthTitleConstraint.active = !showsToggle;
    if (!showsToggle) {
        cell.optionLabel.text = source[@"title"];
        cell.detailLabel.text = @"";
        cell.accessibilityLabel = cell.optionLabel.text;
        [cell refreshAppearance];
        return;
    }
    NSString *identifier = source[@"id"];
    NSString *title = source[@"title"];
    BOOL enabled = self.rowEnabledProvider(identifier);
    NSString *version = self.rowDetailProvider ? self.rowDetailProvider(identifier) : @"";
    cell.optionLabel.text = title;
    BrowserTVConfigureToggleBadge(cell.stateLabel, enabled);
    cell.detailLabel.text = version;
    cell.accessibilityLabel = [NSString stringWithFormat:@"%@, %@, %@", source[@"title"], enabled ? @"On" : @"Off", version];
    [cell refreshAppearance];
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    BrowserOptionsCell *cell = [tableView dequeueReusableCellWithIdentifier:@"OptionsRow"];
    if (cell == nil) cell = [[BrowserOptionsCell alloc] initWithStyle:UITableViewCellStyleDefault
                                                            reuseIdentifier:@"OptionsRow"];
    [self configureCell:cell atIndexPath:indexPath];
    return cell;
}

- (void)refreshVisibleRows {
    for (BrowserOptionsCell *cell in self.tableView.visibleCells) {
        NSIndexPath *indexPath = [self.tableView indexPathForCell:cell];
        if (indexPath != nil) [self configureCell:cell atIndexPath:indexPath];
    }
}

- (void)rowStatusDidChange:(NSNotification *)notification {
    (void)notification;
    [self refreshVisibleRows];
}

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];
    void (^activateRow)(NSString *) = self.activateRow;
    NSString *identifier = self.rows[(NSUInteger)indexPath.row][@"id"];
    if (self.dismissBeforeRowAction) {
        [self dismissViewControllerAnimated:YES completion:^{
            if (activateRow) activateRow(identifier);
        }];
        return;
    }
    if (activateRow) activateRow(identifier);
    [self refreshVisibleRows];
}

- (void)refreshHeaderToggle {
    BOOL (^enabledProvider)(void) = self.enabledProvider;
    BOOL enabled = enabledProvider != nil && enabledProvider();
    BrowserTVConfigureToggleBadge(self.headerToggleButton.stateLabel, enabled);
    self.headerToggleButton.accessibilityValue = enabled ? @"On" : @"Off";
}

- (void)headerTogglePressed:(BrowserBadgeToggleControl *)button {
    (void)button;
    void (^toggleEnabled)(void) = self.toggleEnabled;
    if (toggleEnabled != nil) toggleEnabled();
    [self refreshHeaderToggle];
}

- (void)updatePressed:(UIButton *)button {
    (void)button;
    if (self.secondaryAction) self.secondaryAction();
    [self refreshVisibleRows];
}

- (void)donePressed:(UIButton *)button {
    (void)button;
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeMenu) {
            [self dismissViewControllerAnimated:YES completion:nil];
            return;
        }
        if (press.type == UIPressTypePlayPause) {
            if (self.secondaryAction) self.secondaryAction();
            [self refreshVisibleRows];
            return;
        }
    }
    [super pressesEnded:presses withEvent:event];
}

@end

@interface BrowserMenuCoordinator ()

@property (nonatomic, weak) id<BrowserMenuCoordinatorHost> host;
@property (nonatomic) BrowserPreferencesStore *preferencesStore;

@end

@implementation BrowserMenuCoordinator

- (instancetype)initWithHost:(id<BrowserMenuCoordinatorHost>)host
            preferencesStore:(BrowserPreferencesStore *)preferencesStore {
    self = [super init];
    if (self) {
        _host = host;
        _preferencesStore = preferencesStore ?: [BrowserPreferencesStore new];
        [_preferencesStore ensureUserAgentConsistency];
    }
    return self;
}

- (void)showAdvancedMenu {
    BrowserAdvancedMenuViewController *menuViewController = [[BrowserAdvancedMenuViewController alloc] initWithToolbarItems:[self advancedMenuToolbarItems]
                                                                                                                     sections:[self advancedMenuSections]
                                                                                                                   footerText:[self advancedMenuFooterText]];
    NSString *address = self.host.browserWebView.request.URL.absoluteString;
    menuViewController.addressText = [address isEqualToString:@"about:blank"] ? @"" : address;
    __weak typeof(self) weakSelf = self;
    menuViewController.addressHandler = ^{
        [weakSelf.host browserEditCurrentAddress];
    };
    menuViewController.backEnabled = [self.host browserCanGoBack];
    menuViewController.forwardEnabled = [self.host browserCanGoForward];
    menuViewController.backHandler = ^{
        [weakSelf.host browserGoBack];
    };
    menuViewController.forwardHandler = ^{
        [weakSelf.host browserGoForward];
    };
    [self.host browserPresentViewController:menuViewController];
}

- (UIAlertController *)browserAlertControllerWithTitle:(NSString *)title message:(NSString *)message {
    return [UIAlertController alertControllerWithTitle:title
                                               message:message
                                        preferredStyle:UIAlertControllerStyleAlert];
}

- (UIAlertAction *)browserActionWithTitle:(NSString *)title
                                    style:(UIAlertActionStyle)style
                                  handler:(void (^ __nullable)(UIAlertAction *action))handler {
    return [UIAlertAction actionWithTitle:title style:style handler:handler];
}

- (BrowserAdvancedMenuItem *)advancedMenuItemWithTitle:(NSString *)title
                                                  style:(UIAlertActionStyle)style
                                                handler:(BrowserAdvancedMenuItemHandler)handler {
    return [BrowserAdvancedMenuItem itemWithTitle:title style:style handler:handler];
}

- (UIAlertAction *)browserCancelAction {
    return [self browserActionWithTitle:nil style:UIAlertActionStyleCancel handler:nil];
}

- (BOOL)stringHasVisibleContent:(NSString *)string {
    NSString *trimmedString = [string stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    return trimmedString.length > 0;
}

- (void)saveFavoritesArray:(NSArray *)favorites {
    [[BrowserHistoryStore sharedStore] saveFavorites:favorites];
    [self.host browserRefreshNewTabPageSelectingGroup:@"favorites" index:0];
}

- (NSArray *)storedEntryForKind:(NSString *)kind index:(NSUInteger)index {
    NSArray *entries = [kind isEqualToString:@"favorite"] ? [[BrowserHistoryStore sharedStore] favorites] : @[];
    if (index >= entries.count || ![entries[index] isKindOfClass:[NSArray class]]) {
        return nil;
    }
    return entries[index];
}

- (void)presentEditFavoriteAtIndex:(NSUInteger)index title:(NSString *)title URLString:(NSString *)URLString {
    BrowserFavoriteEditorViewController *editor = [[BrowserFavoriteEditorViewController alloc]
                                                    initWithTitle:title URLString:URLString];
    __weak typeof(self) weakSelf = self;
    editor.saveHandler = ^NSString *(NSString *rawTitle, NSString *rawURL) {
        NSString *enteredTitle = [rawTitle stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        NSString *enteredURL = [rawURL stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if ([enteredURL rangeOfString:@"://"].location == NSNotFound) {
            enteredURL = [@"https://" stringByAppendingString:enteredURL];
        }
        NSURLComponents *components = [NSURLComponents componentsWithString:enteredURL];
        NSString *scheme = components.scheme.lowercaseString;
        if (components.host.length == 0 || !([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) {
            return @"Enter a valid http or https address.";
        }
        NSMutableArray *favorites = [[[BrowserHistoryStore sharedStore] favorites] mutableCopy];
        if (index >= favorites.count) {
            return @"This favorite is no longer available.";
        }
        NSString *savedTitle = enteredTitle.length > 0 ? enteredTitle : components.host;
        favorites[index] = @[components.URL.absoluteString ?: enteredURL, savedTitle ?: @""];
        [[BrowserHistoryStore sharedStore] saveFavorites:favorites];
        [weakSelf.host browserRefreshNewTabPageSelectingGroup:@"favorites" index:index];
        return nil;
    };
    editor.deleteHandler = ^{
        NSMutableArray *favorites = [[[BrowserHistoryStore sharedStore] favorites] mutableCopy];
        if (index >= favorites.count) {
            return;
        }
        [favorites removeObjectAtIndex:index];
        [[BrowserHistoryStore sharedStore] saveFavorites:favorites];
        [weakSelf.host browserRefreshNewTabPageSelectingGroup:@"favorites" index:index];
    };
    [self.host browserPresentViewController:editor];
}

- (void)presentStoredItemActionsForKind:(NSString *)kind index:(NSUInteger)index {
    if (![kind isEqualToString:@"favorite"]) {
        return;
    }
    NSArray *entry = [self storedEntryForKind:kind index:index];
    if (entry == nil || entry.count == 0 || ![entry[0] isKindOfClass:[NSString class]]) {
        return;
    }
    NSString *URLString = entry[0];
    NSString *title = entry.count > 1 && [entry[1] isKindOfClass:[NSString class]] ? entry[1] : @"";
    [self presentEditFavoriteAtIndex:index title:title URLString:URLString];
}

- (void)presentAllHistory {
    BrowserHistoryViewController *controller = [BrowserHistoryViewController new];
    __weak typeof(self) weakSelf = self;
    controller.historyDidChange = ^{
        [weakSelf.host browserRefreshNewTabPageSelectingGroup:@"history" index:0];
    };
    controller.openURLString = ^(NSString *URLString) {
        [weakSelf.host browserOpenHistoryURLString:URLString];
    };
    [self.host browserPresentViewController:controller];
}

- (void)presentRecentHistory {
    NSArray<NSDictionary *> *entries = [[BrowserHistoryStore sharedStore] recentVisitsWithLimit:20];
    NSString *message = entries.count > 0 ? @"Select a page to open it." : @"No browsing history yet.";
    UIAlertController *history = [self browserAlertControllerWithTitle:@"History" message:message];
    __weak typeof(self) weakSelf = self;
    for (NSDictionary *entry in entries) {
        NSString *URLString = entry[@"url"] ?: @"";
        NSString *title = entry[@"title"] ?: @"";
        NSURL *URL = [NSURL URLWithString:URLString];
        NSString *actionTitle = title.length > 0 ? title : URL.host;
        if (actionTitle.length == 0 || URL.host.length == 0) {
            continue;
        }
        [history addAction:[self browserActionWithTitle:actionTitle
                                                  style:UIAlertActionStyleDefault
                                                handler:^(__unused UIAlertAction *action) {
            [weakSelf.host browserOpenHistoryURLString:URLString];
        }]];
    }
    [history addAction:[self browserActionWithTitle:@"All History"
                                              style:UIAlertActionStyleDefault
                                            handler:^(__unused UIAlertAction *action) {
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf presentAllHistory]; });
    }]];
    [history addAction:[self browserCancelAction]];
    [self.host browserPresentViewController:history];
}

- (void)deleteHistoryForURLString:(NSString *)URLString {
    [[BrowserHistoryStore sharedStore] deleteVisitsForURLString:URLString];
    [self.host browserRefreshNewTabPageSelectingGroup:@"history" index:0];
}

- (void)presentAddFavoritePrompt {
    NSString *pageTitle = [[self.host browserWebView] title];
    NSURLRequest *request = [[self.host browserWebView] request];
    NSString *currentURL = request.URL.absoluteString ?: @"";
    if (![self stringHasVisibleContent:currentURL]) {
        return;
    }
    UIAlertController *alertController = [self browserAlertControllerWithTitle:@"Name New Favorite"
                                                                       message:currentURL];
    __weak typeof(self) weakSelf = self;
    
    [alertController addTextFieldWithConfigurationHandler:^(UITextField *textField) {
        textField.keyboardType = UIKeyboardTypeDefault;
        textField.placeholder = @"Name New Favorite";
        textField.text = pageTitle;
        textField.textColor = MenuTextColor();
        [textField setReturnKeyType:UIReturnKeyDone];
    }];
    
    [alertController addAction:[self browserActionWithTitle:@"Save"
                                                      style:UIAlertActionStyleDestructive
                                                    handler:^(__unused UIAlertAction *action) {
        UITextField *titleTextField = alertController.textFields.firstObject;
        NSString *savedTitle = titleTextField.text;
        if (![weakSelf stringHasVisibleContent:savedTitle]) {
            savedTitle = currentURL;
        }
        
        NSArray *favoriteEntry = @[currentURL, savedTitle ?: @""];
        NSMutableArray *favorites = [[[BrowserHistoryStore sharedStore] favorites] mutableCopy];
        if (favorites == nil) {
            favorites = [NSMutableArray array];
        }
        NSUInteger existingIndex = [favorites indexOfObjectPassingTest:^BOOL(id entry, NSUInteger index, BOOL *stop) {
            return [entry isKindOfClass:[NSArray class]] && [entry count] > 0 && [entry[0] isEqualToString:currentURL];
        }];
        if (existingIndex != NSNotFound) {
            [favorites replaceObjectAtIndex:existingIndex withObject:favoriteEntry];
        } else {
            [favorites addObject:favoriteEntry];
        }
        [weakSelf saveFavoritesArray:favorites];
    }]];
    [alertController addAction:[self browserCancelAction]];
    [self.host browserPresentViewController:alertController];
}

- (void)applyUserAgent:(NSString *)userAgent mobileMode:(BOOL)mobileMode {
    self.preferencesStore.userAgent = userAgent;
    self.preferencesStore.mobileModeEnabled = mobileMode;
    
    NSURLRequest *request = [[self.host browserWebView] request];
    if (request != nil && [self stringHasVisibleContent:request.URL.absoluteString]) {
        [self.host browserCaptureSnapshotForCurrentTab];
    }
    
    [self.host browserRecreateActiveWebViewPreservingCurrentURL];
    [self.host browserBringCursorToFront];
}

- (NSUInteger)currentPageZoomPercent {
    return [self.preferencesStore pageZoomPercentForURL:self.host.browserWebView.request.URL];
}

- (void)setPageZoomPercent:(NSUInteger)percent {
    BrowserWebView *webView = self.host.browserWebView;
    UIScrollView *scrollView = webView.scrollView;
    NSURL *pageURL = webView.request.URL;
    [self.preferencesStore setPageZoomPercent:percent forURL:pageURL];
    webView.pageZoomFactor = [self.preferencesStore pageZoomPercentForURL:pageURL] / 100.0;
    // Page zoom scales text and layout together. Anchor reading at the left edge.
    [scrollView setContentOffset:CGPointMake(0.0, scrollView.contentOffset.y) animated:NO];
    __weak typeof(self) weakSelf = self;
    __weak BrowserWebView *weakWebView = webView;
    dispatch_async(dispatch_get_main_queue(), ^{
        BrowserWebView *currentWebView = weakWebView;
        if (currentWebView == nil || weakSelf.host.browserWebView != currentWebView ||
            ![currentWebView.request.URL isEqual:pageURL] ||
            [weakSelf.preferencesStore pageZoomPercentForURL:pageURL] != percent) {
            return;
        }
        UIScrollView *currentScrollView = currentWebView.scrollView;
        [currentScrollView layoutIfNeeded];
        [currentScrollView setContentOffset:CGPointMake(0.0, currentScrollView.contentOffset.y) animated:NO];
        [weakSelf.host browserCaptureSnapshotForCurrentTab];
    });
}

- (void)confirmClearData:(NSString *)kind {
    BrowserWebView *webView = [self.host browserWebView];
    NSURL *pageURL = webView.request.URL;
    NSUInteger generation = webView.documentGeneration;
    BOOL hasSite = pageURL.host.length && [@[@"http", @"https"] containsObject:pageURL.scheme.lowercaseString];
    NSString *title = [NSString stringWithFormat:@"Clear %@?", kind];
    NSString *message = hasSite
        ? [NSString stringWithFormat:@"Choose this site (%@) or all sites.%@", pageURL.host,
           [kind isEqualToString:@"History"] ? @" Favorites stay saved." :
           [kind isEqualToString:@"Cache"] ? @" Also reset saved volume, zoom and tab previews." : @""]
        : @"Open a website to use This Site.";
    UIAlertController *alert = [self browserAlertControllerWithTitle:title message:message];
    __weak typeof(self) weakSelf = self;
    void (^clear)(NSURL *) = ^(NSURL *siteURL) {
        if ([kind isEqualToString:@"History"]) {
            if (siteURL) [[BrowserHistoryStore sharedStore] deleteVisitsForSiteURL:siteURL];
            else [[BrowserHistoryStore sharedStore] deleteAllVisits];
            [weakSelf.host browserRefreshNewTabPageSelectingGroup:@"history" index:0];
            return;
        }
        void (^reload)(void) = ^{
            // Clear the selected scope even if navigation changed, but reload only the original document.
            if (webView.documentGeneration != generation || ![webView.request.URL isEqual:pageURL]) return;
            if ([weakSelf.host browserWebView] == webView) weakSelf.host.browserPreviousURL = @"";
            [webView reload];
        };
        if ([kind isEqualToString:@"Cache"]) {
            [weakSelf.preferencesStore clearSitePreferencesForURL:siteURL];
            [weakSelf.host browserClearSitePreviewsAndSettingsForURL:siteURL];
            [BrowserWebView clearCachedDataForURL:siteURL completion:reload];
        }
        else [BrowserWebView clearCookiesForURL:siteURL completion:reload];
    };
    UIAlertAction *siteAction = [self browserActionWithTitle:@"This Site" style:UIAlertActionStyleDestructive
                                                   handler:^(__unused UIAlertAction *action) { clear(pageURL); }];
    siteAction.enabled = hasSite;
    [alert addAction:siteAction];
    [alert addAction:[self browserActionWithTitle:@"All" style:UIAlertActionStyleDestructive
                                        handler:^(__unused UIAlertAction *action) { clear(nil); }]];
    [alert addAction:[self browserActionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self.host browserPresentViewController:alert];
}

- (NSString *)mediaDiagnosticsJavaScript {
    return @"(function(){"
            "function canPlay(type){"
                "try {"
                    "var video=document.createElement('video');"
                    "if (!video || typeof video.canPlayType!=='function') { return 'n/a'; }"
                    "var value=video.canPlayType(type);"
                    "return value ? String(value) : '';"
                "} catch (error) { return 'error'; }"
            "}"
            "function mse(type){"
                "try {"
                    "if (typeof MediaSource==='undefined' || typeof MediaSource.isTypeSupported!=='function') { return 'n/a'; }"
                    "return MediaSource.isTypeSupported(type) ? 'yes' : 'no';"
                "} catch (error) { return 'error'; }"
            "}"
            "function probeGlobal(name){"
                "try {"
                    "var value=window[name];"
                    "if (typeof value==='undefined') { return 'undefined'; }"
                    "if (value === null) { return 'null'; }"
                    "return typeof value;"
                "} catch (error) { return 'error'; }"
            "}"
            "var video=document.querySelector('video');"
            "var result={"
                "href:(window.location && window.location.href) ? String(window.location.href) : '',"
                "title:(document && document.title) ? String(document.title) : '',"
                "userAgent:(navigator && navigator.userAgent) ? String(navigator.userAgent) : '',"
                "platform:(navigator && navigator.platform) ? String(navigator.platform) : '',"
                "mediaSource:(typeof MediaSource!=='undefined') ? 'yes' : 'no',"
                "managedMediaSource:(typeof ManagedMediaSource!=='undefined') ? 'yes' : 'no',"
                "mediaCapabilities:(typeof navigator.mediaCapabilities!=='undefined') ? 'yes' : 'no',"
                "videoElement:video ? 'yes' : 'no',"
                "videoSrc:video ? String(video.currentSrc||video.src||'') : '',"
                "globalMediaSource:probeGlobal('MediaSource'),"
                "globalManagedMediaSource:probeGlobal('ManagedMediaSource'),"
                "globalWebKitMediaSource:probeGlobal('WebKitMediaSource'),"
                "globalSourceBuffer:probeGlobal('SourceBuffer'),"
                "globalManagedSourceBuffer:probeGlobal('ManagedSourceBuffer'),"
                "globalWebKitSourceBuffer:probeGlobal('WebKitSourceBuffer'),"
                "hls:canPlay('application/vnd.apple.mpegurl'),"
                "mp4H264:canPlay('video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"'),"
                "mp4Hevc:canPlay('video/mp4; codecs=\"hvc1.1.6.L93.B0, mp4a.40.2\"'),"
                "webmVp9:canPlay('video/webm; codecs=\"vp9\"'),"
                "mp4Av1:canPlay('video/mp4; codecs=\"av01.0.05M.08, mp4a.40.2\"'),"
                "webmAv1:canPlay('video/webm; codecs=\"av01.0.05M.08\"'),"
                "mseMp4H264:mse('video/mp4; codecs=\"avc1.42E01E, mp4a.40.2\"'),"
                "mseWebmVp9:mse('video/webm; codecs=\"vp9\"'),"
                "mseMp4Av1:mse('video/mp4; codecs=\"av01.0.05M.08, mp4a.40.2\"'),"
                "mseWebmAv1:mse('video/webm; codecs=\"av01.0.05M.08\"')"
            "};"
            "return JSON.stringify(result);"
           "})()";
}

- (NSString *)stringValueForDiagnosticsKey:(NSString *)key dictionary:(NSDictionary *)dictionary fallback:(NSString *)fallback {
    id value = dictionary[key];
    if ([value isKindOfClass:[NSString class]] && [self stringHasVisibleContent:value]) {
        return value;
    }
    if ([value respondsToSelector:@selector(stringValue)]) {
        NSString *stringValue = [value stringValue];
        if ([self stringHasVisibleContent:stringValue]) {
            return stringValue;
        }
    }
    return fallback;
}

- (void)presentMediaDiagnostics {
    BrowserWebView *webView = [self.host browserWebView];
    if (webView == nil) {
        UIAlertController *alert = [self browserAlertControllerWithTitle:@"Media Diagnostics"
                                                                message:@"The page did not return diagnostics data."];
        [alert addAction:[self browserCancelAction]];
        [self.host browserPresentViewController:alert];
        return;
    }
    NSUInteger generation = webView.documentGeneration;
    NSURL *URL = webView.request.URL;
    [webView evaluateJavaScript:[self mediaDiagnosticsJavaScript] completionHandler:^(NSString *resultString, NSError *error) {
        NSURL *currentURL = webView.request.URL;
        if ([self.host browserWebView] != webView || webView.documentGeneration != generation ||
            !(URL == currentURL || [URL isEqual:currentURL])) { return; }
        if ([error.domain isEqualToString:NSURLErrorDomain] && error.code == NSURLErrorCancelled) { return; }
        NSData *data = [resultString dataUsingEncoding:NSUTF8StringEncoding];
        id object = data != nil && error == nil ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        NSDictionary *diagnostics = [object isKindOfClass:[NSDictionary class]] ? object : nil;
        if (diagnostics == nil) {
            UIAlertController *alertController = [self browserAlertControllerWithTitle:@"Media Diagnostics"
                                                                               message:@"The page did not return diagnostics data."];
            [alertController addAction:[self browserCancelAction]];
            [self.host browserPresentViewController:alertController];
            return;
        }

        BOOL mobileModeEnabled = self.preferencesStore.mobileModeEnabled;
        NSString *message = [NSString stringWithFormat:
                             @"Mode: %@\n"
                              "URL: %@\n"
                              "UA: %@\n\n"
                              "MediaSource: %@\n"
                              "ManagedMediaSource: %@\n"
                              "MediaCapabilities: %@\n"
                              "Video Element: %@\n"
                              "Video Src: %@\n\n"
                              "Global MediaSource: %@\n"
                              "Global ManagedMediaSource: %@\n"
                              "Global WebKitMediaSource: %@\n"
                              "Global SourceBuffer: %@\n"
                              "Global ManagedSourceBuffer: %@\n"
                              "Global WebKitSourceBuffer: %@\n\n"
                              "canPlay HLS: %@\n"
                              "canPlay MP4 H.264: %@\n"
                              "canPlay MP4 HEVC: %@\n"
                              "canPlay WebM VP9: %@\n"
                              "canPlay MP4 AV1: %@\n"
                              "canPlay WebM AV1: %@\n\n"
                              "MSE MP4 H.264: %@\n"
                              "MSE WebM VP9: %@\n"
                              "MSE MP4 AV1: %@\n"
                              "MSE WebM AV1: %@",
                             mobileModeEnabled ? @"Mobile" : @"Desktop",
                             [self stringValueForDiagnosticsKey:@"href" dictionary:diagnostics fallback:@"Unavailable"],
                             [self stringValueForDiagnosticsKey:@"userAgent" dictionary:diagnostics fallback:@"Unavailable"],
                             [self stringValueForDiagnosticsKey:@"mediaSource" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"managedMediaSource" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mediaCapabilities" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"videoElement" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"videoSrc" dictionary:diagnostics fallback:@"Unavailable"],
                             [self stringValueForDiagnosticsKey:@"globalMediaSource" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"globalManagedMediaSource" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"globalWebKitMediaSource" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"globalSourceBuffer" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"globalManagedSourceBuffer" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"globalWebKitSourceBuffer" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"hls" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mp4H264" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mp4Hevc" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"webmVp9" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mp4Av1" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"webmAv1" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mseMp4H264" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mseWebmVp9" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mseMp4Av1" dictionary:diagnostics fallback:@"n/a"],
                             [self stringValueForDiagnosticsKey:@"mseWebmAv1" dictionary:diagnostics fallback:@"n/a"]];

        BrowserLog(@"%@ %@", kBrowserMediaDiagnosticsLogPrefix, message);

        UIAlertController *alertController = [self browserAlertControllerWithTitle:@"Media Diagnostics"
                                                                           message:message];
        [alertController addAction:[self browserCancelAction]];
        [self.host browserPresentViewController:alertController];
    }];
}

- (void)presentWebKitRuntimeMediaPreferences {
    NSString *report = [[self.host browserWebView] runtimeMediaPreferenceReport];
    if (![self stringHasVisibleContent:report]) {
        report = @"No runtime WebKit media preference information was returned.";
    }

    BrowserLog(@"%@ %@", kBrowserWebKitMediaPrefsLogPrefix, report);

    NSString *message = report;
    if (message.length > 1800) {
        message = [[message substringToIndex:1800] stringByAppendingString:@"\n\nFull report logged to console."];
    }

    UIAlertController *alertController = [self browserAlertControllerWithTitle:@"WebKit Media Prefs"
                                                                       message:message];
    [alertController addAction:[self browserCancelAction]];
    [self.host browserPresentViewController:alertController];
}

- (BrowserAdvancedMenuItem *)usageGuideMenuItem {
    return [self advancedMenuItemWithTitle:@"Usage Guide"
                                     style:UIAlertActionStyleDefault
                                   handler:^{
        [self.host browserShowHints];
    }];
}

- (BrowserAdvancedMenuItem *)userAgentModeMenuItem {
    BrowserAdvancedMenuItem *item = [self advancedMenuItemWithTitle:@"Mobile User Agent"
                                                               style:UIAlertActionStyleDefault
                                                             handler:^{
        BOOL mobileMode = !self.preferencesStore.mobileModeEnabled;
        NSString *userAgent = mobileMode ? BrowserPreferencesStore.mobileUserAgent : BrowserPreferencesStore.desktopUserAgent;
        [self applyUserAgent:userAgent mobileMode:mobileMode];
    }];
    item.toggleStateProvider = ^BOOL {
        return self.preferencesStore.mobileModeEnabled;
    };
    return item;
}

- (BrowserAdvancedMenuItem *)cursorMagnifierToggleMenuItem {
    BrowserAdvancedMenuItem *item = [self advancedMenuItemWithTitle:@"Cursor Magnifier"
                                                               style:UIAlertActionStyleDefault
                                                             handler:^{
        self.host.browserCursorMagnifierEnabled = !self.host.browserCursorMagnifierEnabled;
    }];
    item.toggleStateProvider = ^BOOL {
        return self.host.browserCursorMagnifierEnabled;
    };
    return item;
}

- (void)presentAdBlockSettings {
    __weak typeof(self) weakSelf = self;
    __block __weak BrowserOptionsViewController *weakSettings;
    BrowserOptionsViewController *settings =
        [[BrowserOptionsViewController alloc] initWithEnabledProvider:^BOOL {
            return weakSelf.preferencesStore.adBlockEnabled;
        } toggleEnabled:^{
            BrowserMenuCoordinator *strongSelf = weakSelf;
            if (strongSelf == nil) return;
            BOOL enabled = !strongSelf.preferencesStore.adBlockEnabled;
            strongSelf.preferencesStore.adBlockEnabled = enabled;
            [strongSelf.host browserSetAdBlockEnabled:enabled];
        } activateRow:^(NSString *identifier) {
            if ([identifier isEqualToString:@"site"]) {
                BrowserWebView *view = weakSelf.host.browserWebView;
                [view setAdBlockSiteEnabled:!view.adBlockSiteEnabled]; return;
            }
            if ([identifier isEqualToString:@"coverage"]) {
                UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Ad Block Coverage" message:[weakSelf.host.browserWebView adBlockDiagnosticSummary] preferredStyle:UIAlertControllerStyleAlert];
                [alert addAction:[UIAlertAction actionWithTitle:@"Done" style:UIAlertActionStyleCancel handler:nil]];
                [weakSettings dismissViewControllerAnimated:YES completion:^{ [weakSelf.host browserPresentViewController:alert]; }]; return;
            }
            [BrowserWebView setAdBlockSource:identifier
                                    enabled:![BrowserWebView adBlockSourceEnabled:identifier]];
        }];
    weakSettings = settings;
    settings.toggleTitle = @"Ad Block";
    NSMutableArray *rows = [NSMutableArray array];
    if (self.host.browserWebView.request.URL.host.length) [rows addObject:@{@"id":@"site", @"title":@"This Site (including subdomains)"}];
    for (NSDictionary *source in BrowserWebView.adBlockSources) {
        if ([source[@"id"] isEqualToString:@"custom"] && !BrowserWebView.adBlockUserFilters.length) continue;
        NSMutableDictionary *row = [source mutableCopy];
        row[@"title"] = [source[@"title"] stringByReplacingOccurrencesOfString:@"AdGuard " withString:@""];
        [rows addObject:row];
    }
    [rows addObject:@{@"id":@"coverage", @"title":@"Coverage and Diagnostics", @"action":@"yes"}];
    settings.rows = rows;
    settings.rowEnabledProvider = ^BOOL(NSString *identifier) {
        return [identifier isEqualToString:@"site"] ? weakSelf.host.browserWebView.adBlockSiteEnabled : [BrowserWebView adBlockSourceEnabled:identifier];
    };
    settings.rowDetailProvider = ^NSString *(NSString *identifier) {
        if ([identifier isEqualToString:@"site"]) return weakSelf.preferencesStore.adBlockEnabled ? @"Remembered" : @"Global OFF";
        return [BrowserWebView adBlockSourceStatus:identifier];
    };
    settings.secondaryActionTitle = @"Update Filters Now";
    settings.secondaryAction = ^{ [BrowserWebView refreshAdBlockSources]; };
    settings.statusNotification = BrowserAdBlockSourceStatusDidChangeNotification;
    [self.host browserPresentViewController:settings];
}

- (BrowserAdvancedMenuItem *)adBlockToggleMenuItem {
    BrowserAdvancedMenuItem *item = [self advancedMenuItemWithTitle:@"Ad Block"
                                                               style:UIAlertActionStyleDefault
                                                             handler:^{
        BOOL enabled = self.preferencesStore.adBlockEnabled;
        BOOL removalUnavailable = [self.host.browserWebView.adBlockStatus isEqualToString:@"removal-unavailable"];
        BOOL newValue = removalUnavailable ? NO : !enabled;
        self.preferencesStore.adBlockEnabled = newValue;
        [self.host browserSetAdBlockEnabled:newValue];
    }];
    item.toggleStateProvider = ^BOOL {
        return self.preferencesStore.adBlockEnabled ||
            [self.host.browserWebView.adBlockStatus isEqualToString:@"removal-unavailable"];
    };
    item.longPressHandler = ^{
        [self presentAdBlockSettings];
    };
    return item;
}

- (BrowserAdvancedMenuItem *)torrentKeepAliveToggleMenuItem {
    BrowserAdvancedMenuItem *item = [self advancedMenuItemWithTitle:@"Torrent Keep Alive (Experimental)"
                                                               style:UIAlertActionStyleDefault
                                                             handler:^{
        BrowserTorrentKeepAlive *keepAlive = BrowserTorrentKeepAlive.sharedKeepAlive;
        keepAlive.enabled = !keepAlive.enabled;
    }];
    item.toggleStateProvider = ^BOOL {
        return BrowserTorrentKeepAlive.sharedKeepAlive.enabled;
    };
    return item;
}

- (NSArray<BrowserAdvancedMenuItem *> *)advancedMenuToolbarItems {
    BrowserAdvancedMenuItem *homeItem = [self advancedMenuItemWithTitle:@"Home"
                                                                  style:UIAlertActionStyleDefault
                                                                handler:^{
        [self.host browserLoadHomePage];
    }];
    BrowserAdvancedMenuItem *reloadItem = [self advancedMenuItemWithTitle:@"Reload Page"
                                                                   style:UIAlertActionStyleDefault
                                                                 handler:^{
        [self.host.browserWebView reload];
    }];
    BrowserAdvancedMenuItem *newTabItem = [self advancedMenuItemWithTitle:@"New Tab"
                                                                     style:UIAlertActionStyleDefault
                                                                   handler:^{
        [self.host browserCreateNewTab];
    }];
    BrowserAdvancedMenuItem *tabsItem = [self advancedMenuItemWithTitle:@"Tabs"
                                                                 style:UIAlertActionStyleDefault
                                                               handler:^{
        [self.host browserShowTabOverview];
    }];
    return @[homeItem, reloadItem, newTabItem, tabsItem];
}

- (BrowserAdvancedMenuItem *)tileItem:(BrowserAdvancedMenuItem *)item
                                title:(NSString *)title
                               symbol:(NSString *)symbol {
    item.tileTitle = title;
    item.tileSymbolName = symbol;
    return item;
}

- (void)presentDebugOptions {
    __weak typeof(self) weakSelf = self;
    BrowserOptionsViewController *settings = [[BrowserOptionsViewController alloc]
        initWithEnabledProvider:^BOOL { return weakSelf.preferencesStore.debugEnabled; }
        toggleEnabled:^{
            BrowserMenuCoordinator *strongSelf = weakSelf;
            strongSelf.preferencesStore.debugEnabled = !strongSelf.preferencesStore.debugEnabled;
        } activateRow:^(NSString *identifier) { [weakSelf presentDebugReport:identifier.integerValue]; }];
    settings.toggleTitle = @"Debug";
    settings.dismissBeforeRowAction = YES;
    settings.rows = @[
        @{ @"id": @"0", @"title": @"Recent Diagnostic Logs" },
        @{ @"id": @"1", @"title": @"Media Diagnostics" },
        @{ @"id": @"2", @"title": @"Background Probe" },
        @{ @"id": @"3", @"title": @"Inspect WebKit Media Prefs" },
    ];
    [self.host browserPresentViewController:settings];
}

- (void)presentDebugReport:(NSUInteger)index {
    switch (index) {
    case 0: {
        NSArray<NSString *> *recent = BrowserDebugRecentLogs();
        NSString *message = recent.count ? [recent componentsJoinedByString:@"\n"] : @"No diagnostic logs yet.";
        UIAlertController *result = [self browserAlertControllerWithTitle:@"Recent Diagnostic Logs" message:message];
        [result addAction:[self browserCancelAction]];
        [self.host browserPresentViewController:result];
        break;
    }
    case 1: {
        if (!self.preferencesStore.debugEnabled) {
            UIAlertController *result = [self browserAlertControllerWithTitle:@"Debug is off"
                message:@"Turn Debug on to collect diagnostics."];
            [result addAction:[self browserCancelAction]];
            [self.host browserPresentViewController:result];
            return;
        }
        [self presentMediaDiagnostics];
        break;
    }
    case 2: {
        NSDictionary *probe = [[NSUserDefaults standardUserDefaults] dictionaryForKey:@"BrowserBackgroundProbeSummary"];
        NSString *message = @"No background probe result yet.";
        if ([probe isKindOfClass:NSDictionary.class]) {
            NSString *state = [probe[@"running"] boolValue] ? @"running" :
                [probe[@"interrupted"] boolValue] ? @"interrupted" : @"finished";
            NSString *mode = [probe[@"keepAlive"] boolValue] ? @"Keep Alive on" : @"Keep Alive off";
            message = [NSString stringWithFormat:@"%@ • %@\n%.0f s elapsed • %.0f s active • %.0f s longest gap • %lu ticks",
                mode, state, [probe[@"elapsed"] doubleValue], [probe[@"active"] doubleValue],
                [probe[@"maxGap"] doubleValue], (unsigned long)[probe[@"ticks"] unsignedIntegerValue]];
        }
        UIAlertController *result = [self browserAlertControllerWithTitle:@"Background Probe" message:message];
        [result addAction:[self browserCancelAction]];
        [self.host browserPresentViewController:result];
        break;
    }
    case 3: {
        if (!self.preferencesStore.debugEnabled) {
            UIAlertController *result = [self browserAlertControllerWithTitle:@"Debug is off"
                message:@"Turn Debug on to collect diagnostics."];
            [result addAction:[self browserCancelAction]];
            [self.host browserPresentViewController:result];
            return;
        }
        [self presentWebKitRuntimeMediaPreferences];
        break;
    }
    default: break;
    }
}

- (NSArray<BrowserAdvancedMenuSection *> *)advancedMenuSections {
    BrowserAdvancedMenuItem *addFavoriteItem = [self advancedMenuItemWithTitle:@"Add to Favorites"
                                                                         style:UIAlertActionStyleDefault
                                                                       handler:^{
        [self presentAddFavoritePrompt];
    }];
    BrowserAdvancedMenuItem *historyItem = [self advancedMenuItemWithTitle:@"History"
                                                                     style:UIAlertActionStyleDefault
                                                                   handler:^{
        [self presentRecentHistory];
    }];
    BrowserAdvancedMenuItem *torrentsItem = [self advancedMenuItemWithTitle:@"Torrents"
                                                                      style:UIAlertActionStyleDefault
                                                                    handler:^{
        [self.host browserShowTorrents];
    }];
    BrowserAdvancedMenuItem *zoomOutItem = [self advancedMenuItemWithTitle:@"Zoom Out"
                                                                    style:UIAlertActionStyleDefault
                                                                  handler:^{
        [self setPageZoomPercent:MAX((NSUInteger)50, [self currentPageZoomPercent] - 10)];
    }];
    BrowserAdvancedMenuItem *zoomResetItem = [self advancedMenuItemWithTitle:@"Reset Zoom"
                                                                      style:UIAlertActionStyleDefault
                                                                    handler:^{
        [self setPageZoomPercent:100];
    }];
    BrowserAdvancedMenuItem *zoomInItem = [self advancedMenuItemWithTitle:@"Zoom In"
                                                                   style:UIAlertActionStyleDefault
                                                                 handler:^{
        [self setPageZoomPercent:MIN((NSUInteger)200, [self currentPageZoomPercent] + 10)];
    }];
    zoomOutItem.keepsMenuOpen = YES;
    zoomResetItem.keepsMenuOpen = YES;
    zoomInItem.keepsMenuOpen = YES;
    zoomResetItem.tileTitleProvider = ^NSString *{
        return [NSString stringWithFormat:@"Reset Zoom\n%lu%%", (unsigned long)[self currentPageZoomPercent]];
    };
    BrowserAdvancedMenuItem *debugItem = [self advancedMenuItemWithTitle:@"Debug"
                                                                   style:UIAlertActionStyleDefault
                                                                 handler:^{
        self.preferencesStore.debugEnabled = !self.preferencesStore.debugEnabled;
    }];
    debugItem.toggleStateProvider = ^BOOL {
        return self.preferencesStore.debugEnabled;
    };
    debugItem.longPressHandler = ^{
        [self presentDebugOptions];
    };
    BrowserAdvancedMenuItem *clearCacheItem = [self advancedMenuItemWithTitle:@"Clear Cache"
                                                                         style:UIAlertActionStyleDestructive
                                                                       handler:^{
        [self confirmClearData:@"Cache"];
    }];
    BrowserAdvancedMenuItem *clearCookiesItem = [self advancedMenuItemWithTitle:@"Clear Cookies"
                                                                           style:UIAlertActionStyleDestructive
                                                                         handler:^{
        [self confirmClearData:@"Cookies"];
    }];
    BrowserAdvancedMenuItem *clearHistoryItem = [self advancedMenuItemWithTitle:@"Clear History"
                                                                           style:UIAlertActionStyleDestructive
                                                                         handler:^{
        [self confirmClearData:@"History"];
    }];

    return @[
        [BrowserAdvancedMenuSection sectionWithTitle:@"Quick Actions"
                                               items:@[
            [self tileItem:zoomOutItem title:@"Zoom Out" symbol:@"minus.magnifyingglass"],
            [self tileItem:zoomResetItem title:@"Reset Zoom" symbol:@"arrow.counterclockwise"],
            [self tileItem:zoomInItem title:@"Zoom In" symbol:@"plus.magnifyingglass"],
            [self tileItem:addFavoriteItem title:@"Add Favorite" symbol:@"star.fill"],
            [self tileItem:historyItem title:@"History" symbol:@"clock.arrow.circlepath"],
            [self tileItem:torrentsItem title:@"Torrents" symbol:@"arrow.down.circle.fill"],
        ]],
        [BrowserAdvancedMenuSection sectionWithTitle:@"Settings"
                                               items:@[
            [self tileItem:[self adBlockToggleMenuItem] title:@"Ad Block" symbol:@"hand.raised.fill"],
            [self tileItem:[self cursorMagnifierToggleMenuItem] title:@"Magnifier" symbol:@"magnifyingglass"],
            [self tileItem:[self torrentKeepAliveToggleMenuItem] title:@"Keep Alive" symbol:@"waveform"],
            [self tileItem:[self userAgentModeMenuItem] title:@"Mobile Site" symbol:@"iphone"],
        ]],
        [BrowserAdvancedMenuSection sectionWithTitle:@"Tools"
                                               items:@[
            [self tileItem:clearCacheItem title:@"Clear Cache" symbol:@"externaldrive"],
            [self tileItem:clearCookiesItem title:@"Clear Cookies" symbol:@"trash"],
            [self tileItem:clearHistoryItem title:@"Clear History" symbol:@"clock.arrow.circlepath"],
            [self tileItem:debugItem title:@"Debug" symbol:@"ladybug"],
            [self tileItem:[self usageGuideMenuItem] title:@"User Guide" symbol:@"book.closed.fill"],
        ]],
    ];
}

- (NSString *)advancedMenuFooterText {
    NSDictionary *infoDictionary = NSBundle.mainBundle.infoDictionary;
    NSString *version = infoDictionary[@"CFBundleShortVersionString"];
    BOOL hasVersion = [self stringHasVisibleContent:version];

    if (hasVersion) {
        return [NSString stringWithFormat:@"Version %@", version];
    }
    return @"";
}

@end
