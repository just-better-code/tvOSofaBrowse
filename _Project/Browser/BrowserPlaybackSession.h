#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef NS_ENUM(NSUInteger, BrowserPlaybackRenderer) {
    BrowserPlaybackRendererWebKit,
    BrowserPlaybackRendererVLC,
};

typedef NS_ENUM(NSUInteger, BrowserPlaybackCommand) {
    BrowserPlaybackCommandToggle,
    BrowserPlaybackCommandPrevious,
    BrowserPlaybackCommandRestart,
    BrowserPlaybackCommandNext,
    BrowserPlaybackCommandEnd,
    BrowserPlaybackCommandSeekSeconds,
    BrowserPlaybackCommandSeekFraction,
    BrowserPlaybackCommandVolume,
    BrowserPlaybackCommandMute,
    BrowserPlaybackCommandClose,
};

FOUNDATION_EXPORT NSString *BrowserPlaybackCommandName(BrowserPlaybackCommand command);
FOUNDATION_EXPORT NSString *BrowserPlaybackTimeText(double seconds);
FOUNDATION_EXPORT BOOL BrowserPlaybackCommandForControl(NSUInteger index, BrowserPlaybackCommand *command, double *value);

// Renderer-neutral control state. A backend owns its clock and validates its
// document/source at dispatch; a session never copies another backend's state.
@interface BrowserPlaybackSession : NSObject
- (instancetype)initWithRenderer:(BrowserPlaybackRenderer)renderer
                     identifier:(NSString *)identifier
                        dispatch:(void (^)(BrowserPlaybackCommand command, double value))dispatch;
@property (nonatomic, readonly) BrowserPlaybackRenderer renderer;
@property (nonatomic, readonly, copy) NSString *identifier;
@property (nonatomic, readonly, copy) NSDictionary *state;
@property (nonatomic, readonly) BOOL controlsVisible;
@property (nonatomic) BOOL controlsPinned;
@property (nonatomic, copy, nullable) void (^visibilityDidChange)(BOOL visible);
- (void)updateState:(NSDictionary *)state;
- (void)updateTitle:(NSString *)title;
- (void)performCommand:(BrowserPlaybackCommand)command value:(double)value;
- (void)showControls;
- (void)invalidate;
@end

NS_ASSUME_NONNULL_END
