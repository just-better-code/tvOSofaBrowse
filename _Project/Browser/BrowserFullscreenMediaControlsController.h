#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN
@interface BrowserFullscreenMediaControlsController : UIViewController
@property (nonatomic, copy) void (^sendCommand)(NSString *command, double value);
@property (nonatomic, readonly) BOOL controlsVisible;
@property (nonatomic) BOOL cursorVisible;
- (void)updateMediaState:(NSDictionary *)state;
- (void)showControls;
- (void)stopSeeking;
- (void)seekWithDirection:(NSInteger)direction;
- (void)togglePlayback;
- (void)closePlayer;
@end
NS_ASSUME_NONNULL_END

// Own Select press lifecycle so held seeking does not depend on gesture arbitration.
@interface BrowserSeekButton : UIButton
@property (nonatomic, copy) void (^holdBegan)(void);
@property (nonatomic, copy) void (^holdEnded)(void);
@end
