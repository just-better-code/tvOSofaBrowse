#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@protocol BrowserRemoteInputControllerHost <NSObject>

- (nullable UIScrollView *)browserRemoteInputControllerActiveScrollView;
- (nullable UIViewController *)browserRemoteInputControllerPresentedViewController;
- (BOOL)browserRemoteInputControllerTabOverviewVisible;
- (BOOL)browserRemoteInputControllerPageFullscreenActive;
- (BOOL)browserRemoteInputControllerTabOverviewContainsPoint:(CGPoint)point;
- (BOOL)browserRemoteInputControllerHandleTabOverviewSelectionAtPoint:(CGPoint)point;
- (void)browserRemoteInputControllerDismissTabOverview;
- (void)browserRemoteInputControllerHandleTabOverviewAlternateAction;
- (void)browserRemoteInputControllerHandlePrimaryAction;
- (BOOL)browserRemoteInputControllerNewTabVisible;
- (NSUInteger)browserRemoteInputControllerNewTabPageGeneration;
- (void)browserRemoteInputControllerNavigateNewTabInDirection:(NSString *)direction;
- (void)browserRemoteInputControllerActivateNewTabSelection;
- (void)browserRemoteInputControllerHandleMediaHorizontalPress:(UIPressType)pressType;
- (void)browserRemoteInputControllerHandleTabOverviewPress;
- (void)browserRemoteInputControllerHandleMenuPress;
- (void)browserRemoteInputControllerHandlePlayPausePress;
- (void)browserRemoteInputControllerHandleNewTabOptionUsingKeyboardSelection:(BOOL)keyboardSelection;
- (void)browserRemoteInputControllerToggleMagnifier;
- (void)browserRemoteInputControllerHoverStateAtCursorPoint:(CGPoint)point
                                                completion:(void (^)(BOOL isInteractive))completion;
- (void)browserRemoteInputControllerSetWebInteractionEnabled:(BOOL)enabled;
- (void)browserRemoteInputControllerPersistSession;
- (void)browserRemoteInputControllerCaptureMagnifierAtPoint:(CGPoint)point
                                                  completion:(void (^)(UIImage * _Nullable image))completion;

@end

@interface BrowserRemoteInputController : NSObject

@property (nonatomic, readonly) UIImageView *cursorView;
@property (nonatomic, readonly) BOOL cursorVisible;
@property (nonatomic) BOOL cursorSuppressed;
@property (nullable, nonatomic, copy) void (^cursorVisibilityDidChange)(BOOL visible);
@property (nonatomic, readonly, getter=isCursorModeEnabled) BOOL cursorModeEnabled;
@property (nonatomic, getter=isMagnifierEnabled) BOOL magnifierEnabled;

- (instancetype)initWithHost:(id<BrowserRemoteInputControllerHost>)host
                    rootView:(UIView *)rootView NS_DESIGNATED_INITIALIZER;

- (instancetype)init NS_UNAVAILABLE;

- (void)handleGlobalSelectPressEndedNotification;
- (void)hideCursorForDirectionalNavigation;
- (void)handlePressesBegan:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event;
- (BOOL)handlePressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event;
- (void)handlePressesCancelled:(NSSet<UIPress *> *)presses;
- (BOOL)handleTouchesBegan:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event;
- (BOOL)handleTouchesMoved:(NSSet<UITouch *> *)touches withEvent:(UIEvent *)event;
- (void)handleTouchesEnded;
- (void)setCursorModeEnabled:(BOOL)cursorModeEnabled;
- (void)refreshInteractionState;

@end

NS_ASSUME_NONNULL_END
