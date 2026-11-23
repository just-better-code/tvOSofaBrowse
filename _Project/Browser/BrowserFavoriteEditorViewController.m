#import "BrowserFavoriteEditorViewController.h"
#import "BrowserTVAppearance.h"

@interface BrowserFavoriteEditorButton : UIButton
@property (nonatomic, strong) UIColor *restingColor;
@property (nonatomic, strong) UIColor *restingTextColor;
@end

@implementation BrowserFavoriteEditorButton
- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{
        self.backgroundColor = BrowserTVSystemButtonSurfaceColor(self.isFocused ? BrowserTVFocusedSurfaceColor() : self.restingColor);
        [self setTitleColor:self.isFocused ? BrowserTVFocusedTextColor()
                                           : self.restingTextColor forState:UIControlStateNormal];
    } completion:nil];
}
@end

@interface BrowserFavoriteEditorViewController ()

@property (nonatomic, copy) NSString *initialTitle;
@property (nonatomic, copy) NSString *initialURLString;
@property (nonatomic, strong) UITextField *titleField;
@property (nonatomic, strong) UITextField *URLField;
@property (nonatomic, strong) UILabel *errorLabel;

@end

@implementation BrowserFavoriteEditorViewController

- (instancetype)initWithTitle:(NSString *)title URLString:(NSString *)URLString {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        _initialTitle = [title copy] ?: @"";
        _initialURLString = [URLString copy] ?: @"";
        self.modalPresentationStyle = UIModalPresentationOverFullScreen;
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
    return label;
}

- (UIButton *)actionButtonWithTitle:(NSString *)title color:(UIColor *)color destructive:(BOOL)destructive selector:(SEL)selector {
    BrowserFavoriteEditorButton *button = [BrowserFavoriteEditorButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.restingColor = color;
    button.restingTextColor = destructive && BrowserTVUsesNativeButtonSurface() ? UIColor.systemRedColor : UIColor.whiteColor;
    BrowserTVConfigureSystemButtonSurface(button, color, 18.0);
    button.titleLabel.font = [UIFont systemFontOfSize:28.0 weight:UIFontWeightSemibold];
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:button.restingTextColor forState:UIControlStateNormal];
    [button addTarget:self action:selector forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithWhite:0.0 alpha:0.70];

    Class glassClass = NSClassFromString(@"UIGlassEffect");
    UIVisualEffect *effect = BrowserTVPanelEffect();
    UIVisualEffectView *panel = [[UIVisualEffectView alloc] initWithEffect:effect];
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    panel.backgroundColor = UIColor.clearColor;
    panel.layer.cornerRadius = 34.0;
    panel.layer.masksToBounds = YES;
    panel.layer.borderWidth = glassClass != Nil ? 0.0 : 1.0;
    panel.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.28].CGColor;
    [self.view addSubview:panel];

    UILabel *eyebrow = [self labelWithText:@"FAVORITES" size:21.0 weight:UIFontWeightBold
                                     color:[UIColor colorWithRed:0.58 green:0.72 blue:1.0 alpha:1.0]];
    UILabel *heading = [self labelWithText:@"Edit Favorite" size:48.0 weight:UIFontWeightBold color:UIColor.whiteColor];
    UILabel *titleCaption = [self labelWithText:@"Name" size:23.0 weight:UIFontWeightMedium
                                         color:[UIColor colorWithWhite:1.0 alpha:0.68]];
    UILabel *URLCaption = [self labelWithText:@"Address" size:23.0 weight:UIFontWeightMedium
                                       color:[UIColor colorWithWhite:1.0 alpha:0.68]];
    [panel.contentView addSubview:eyebrow];
    [panel.contentView addSubview:heading];
    [panel.contentView addSubview:titleCaption];
    [panel.contentView addSubview:URLCaption];

    UITextField *titleField = [UITextField new];
    titleField.translatesAutoresizingMaskIntoConstraints = NO;
    titleField.backgroundColor = [UIColor colorWithWhite:0.96 alpha:1.0];
    titleField.textColor = UIColor.blackColor;
    titleField.font = [UIFont systemFontOfSize:29.0 weight:UIFontWeightMedium];
    titleField.layer.cornerRadius = 15.0;
    titleField.text = self.initialTitle;
    titleField.placeholder = @"Favorite name";
    titleField.leftView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 18, 1)];
    titleField.leftViewMode = UITextFieldViewModeAlways;
    [panel.contentView addSubview:titleField];
    self.titleField = titleField;

    UITextField *URLField = [UITextField new];
    URLField.translatesAutoresizingMaskIntoConstraints = NO;
    URLField.backgroundColor = [UIColor colorWithWhite:0.96 alpha:1.0];
    URLField.textColor = UIColor.blackColor;
    URLField.font = [UIFont systemFontOfSize:26.0 weight:UIFontWeightRegular];
    URLField.layer.cornerRadius = 15.0;
    URLField.keyboardType = UIKeyboardTypeURL;
    URLField.text = self.initialURLString;
    URLField.placeholder = @"https://example.com";
    URLField.leftView = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 18, 1)];
    URLField.leftViewMode = UITextFieldViewModeAlways;
    [panel.contentView addSubview:URLField];
    self.URLField = URLField;

    UILabel *errorLabel = [self labelWithText:@"" size:22.0 weight:UIFontWeightMedium
                                       color:[UIColor colorWithRed:1.0 green:0.57 blue:0.55 alpha:1.0]];
    [panel.contentView addSubview:errorLabel];
    self.errorLabel = errorLabel;

    UIButton *save = [self actionButtonWithTitle:@"Save"
                                           color:BrowserTVRestingSurfaceColor()
                                     destructive:NO
                                       selector:@selector(savePressed)];
    UIButton *cancel = [self actionButtonWithTitle:@"Cancel"
                                             color:BrowserTVRestingSurfaceColor()
                                       destructive:NO
                                         selector:@selector(cancelPressed)];
    UIButton *remove = [self actionButtonWithTitle:@"Delete"
                                             color:[UIColor colorWithRed:0.69 green:0.23 blue:0.27 alpha:0.70]
                                       destructive:YES
                                         selector:@selector(deletePressed)];
    UIStackView *actions = [[UIStackView alloc] initWithArrangedSubviews:@[save, cancel, remove]];
    actions.translatesAutoresizingMaskIntoConstraints = NO;
    actions.axis = UILayoutConstraintAxisHorizontal;
    actions.distribution = UIStackViewDistributionFillEqually;
    actions.spacing = 18.0;
    [panel.contentView addSubview:actions];

    [NSLayoutConstraint activateConstraints:@[
        [panel.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
        [panel.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],
        [panel.widthAnchor constraintEqualToConstant:900.0],
        [panel.heightAnchor constraintEqualToConstant:540.0],
        [eyebrow.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:44.0],
        [eyebrow.topAnchor constraintEqualToAnchor:panel.topAnchor constant:38.0],
        [heading.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [heading.topAnchor constraintEqualToAnchor:eyebrow.bottomAnchor constant:8.0],
        [titleCaption.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [titleCaption.topAnchor constraintEqualToAnchor:heading.bottomAnchor constant:32.0],
        [titleField.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:44.0],
        [titleField.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor constant:-44.0],
        [titleField.topAnchor constraintEqualToAnchor:titleCaption.bottomAnchor constant:10.0],
        [titleField.heightAnchor constraintEqualToConstant:66.0],
        [URLCaption.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [URLCaption.topAnchor constraintEqualToAnchor:titleField.bottomAnchor constant:24.0],
        [URLField.leadingAnchor constraintEqualToAnchor:titleField.leadingAnchor],
        [URLField.trailingAnchor constraintEqualToAnchor:titleField.trailingAnchor],
        [URLField.topAnchor constraintEqualToAnchor:URLCaption.bottomAnchor constant:10.0],
        [URLField.heightAnchor constraintEqualToConstant:66.0],
        [errorLabel.leadingAnchor constraintEqualToAnchor:titleField.leadingAnchor],
        [errorLabel.trailingAnchor constraintEqualToAnchor:titleField.trailingAnchor],
        [errorLabel.topAnchor constraintEqualToAnchor:URLField.bottomAnchor constant:8.0],
        [actions.leadingAnchor constraintEqualToAnchor:titleField.leadingAnchor],
        [actions.trailingAnchor constraintEqualToAnchor:titleField.trailingAnchor],
        [actions.bottomAnchor constraintEqualToAnchor:panel.bottomAnchor constant:-38.0],
        [actions.heightAnchor constraintEqualToConstant:68.0],
    ]];
}

- (void)savePressed {
    NSString *error = self.saveHandler != nil ? self.saveHandler(self.titleField.text ?: @"", self.URLField.text ?: @"") : nil;
    if (error.length > 0) {
        self.errorLabel.text = error;
        return;
    }
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)cancelPressed {
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)deletePressed {
    if (self.deleteHandler != nil) {
        self.deleteHandler();
    }
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeMenu) {
            [self cancelPressed];
            return;
        }
    }
    [super pressesEnded:presses withEvent:event];
}

@end
