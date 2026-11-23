#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN
enum { BrowserPlaybackPanelIconTag = 9797 };

// Shared app-owned chrome; renderers keep their video surfaces and transport.
@interface BrowserPlaybackPanel : UIView
- (instancetype)initWithPlayerIcon:(nullable UIImage *)icon accessoryButtons:(NSArray<UIButton *> *)accessories;
@property (nonatomic, readonly) UIView *header;
@property (nonatomic, readonly) UIView *controls;
@property (nonatomic, readonly) UILabel *titleLabel;
@property (nonatomic, readonly) UILabel *statusLabel;
@property (nonatomic, readonly) UILabel *timeLabel;
@property (nonatomic, readonly) UIProgressView *progress;
@property (nonatomic, readonly) NSArray<UIButton *> *buttons;
@property (nonatomic, weak, nullable) UIViewController *focusController;
+ (UIButton *)buttonWithSymbol:(NSString *)symbol label:(NSString *)label target:(nullable id)target action:(SEL _Nullable)action;
- (void)setControlsVisible:(BOOL)visible;
- (void)setSelected:(BOOL)selected forAccessoryButton:(UIButton *)button;
- (void)updateState:(NSDictionary *)state;
- (void)updateFocusInContext:(UIFocusUpdateContext *)context coordinator:(UIFocusAnimationCoordinator *)coordinator;
@end
NS_ASSUME_NONNULL_END
