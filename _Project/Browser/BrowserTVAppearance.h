#import <UIKit/UIKit.h>

// The tvOS Settings reference uses a soft blue-gray field with a warm glow,
// translucent resting rows, and a light focused row. Keep those surfaces shared.
static inline UIColor *BrowserTVRestingSurfaceColor(void) {
    return [UIColor colorWithWhite:0.72 alpha:0.32];
}

static inline UIColor *BrowserTVFocusedSurfaceColor(void) {
    return [UIColor colorWithRed:0.95 green:0.94 blue:1.0 alpha:0.98];
}

static inline UIColor *BrowserTVFocusedTextColor(void) {
    return [UIColor colorWithRed:0.29 green:0.25 blue:0.37 alpha:1.0];
}

static inline UIColor *BrowserTVToggleBadgeColor(BOOL enabled) {
    return enabled ? [UIColor colorWithRed:0.20 green:0.72 blue:0.42 alpha:0.95]
                   : [UIColor colorWithWhite:0.42 alpha:0.65];
}

static inline void BrowserTVConfigureToggleBadge(UILabel *badge, BOOL enabled) {
    badge.font = [UIFont systemFontOfSize:14.0 weight:UIFontWeightSemibold];
    badge.textAlignment = NSTextAlignmentCenter;
    badge.textColor = UIColor.whiteColor;
    badge.layer.cornerRadius = 11.0;
    badge.layer.masksToBounds = YES;
    badge.text = enabled ? @"ON" : @"OFF";
    badge.backgroundColor = BrowserTVToggleBadgeColor(enabled);
}

static inline UIVisualEffect *BrowserTVPanelEffect(void) {
    Class glassClass = NSClassFromString(@"UIGlassEffect");
    return glassClass != Nil ? [[glassClass alloc] init]
                             : [UIBlurEffect effectWithStyle:UIBlurEffectStyleDark];
}

static inline void BrowserTVInstallBackground(UIView *view) {
    view.backgroundColor = [UIColor colorWithRed:0.25 green:0.26 blue:0.29 alpha:1.0];

    CAGradientLayer *base = [CAGradientLayer layer];
    base.name = @"BrowserTVBackgroundBase";
    base.colors = @[(id)[UIColor colorWithRed:0.40 green:0.45 blue:0.58 alpha:1.0].CGColor,
                    (id)[UIColor colorWithRed:0.38 green:0.38 blue:0.39 alpha:1.0].CGColor,
                    (id)[UIColor colorWithRed:0.28 green:0.28 blue:0.29 alpha:1.0].CGColor];
    base.locations = @[@0, @0.55, @1];
    base.startPoint = CGPointMake(0.65, 0);
    base.endPoint = CGPointMake(0.45, 1);
    [view.layer insertSublayer:base atIndex:0];

    CAGradientLayer *warm = [CAGradientLayer layer];
    warm.name = @"BrowserTVBackgroundWarm";
    warm.type = kCAGradientLayerRadial;
    warm.colors = @[(id)[UIColor colorWithRed:0.83 green:0.68 blue:0.39 alpha:0.48].CGColor,
                    (id)[UIColor colorWithRed:0.83 green:0.68 blue:0.39 alpha:0.0].CGColor];
    warm.startPoint = CGPointMake(0.12, 0.60);
    warm.endPoint = CGPointMake(0.75, 1.20);
    [view.layer insertSublayer:warm above:base];

    CAGradientLayer *cool = [CAGradientLayer layer];
    cool.name = @"BrowserTVBackgroundCool";
    cool.type = kCAGradientLayerRadial;
    cool.colors = @[(id)[UIColor colorWithRed:0.58 green:0.62 blue:0.84 alpha:0.37].CGColor,
                    (id)[UIColor colorWithRed:0.58 green:0.62 blue:0.84 alpha:0.0].CGColor];
    cool.startPoint = CGPointMake(0.57, 0.12);
    cool.endPoint = CGPointMake(1.05, 0.80);
    [view.layer insertSublayer:cool above:warm];
}

static inline void BrowserTVLayoutBackground(UIView *view) {
    for (CALayer *layer in view.layer.sublayers) {
        if ([layer.name hasPrefix:@"BrowserTVBackground"]) layer.frame = view.bounds;
    }
}
