#import <UIKit/UIKit.h>

@interface BrowserVLCPlayerViewController : UIViewController
- (instancetype)initWithTorrentIdentifier:(NSString *)identifier fileIndex:(NSInteger)index title:(NSString *)title;
- (instancetype)initWithWebVideoURL:(NSURL *)URL pageURL:(NSURL *)pageURL title:(NSString *)title
                       currentTime:(double)time volume:(double)volume muted:(BOOL)muted
                  requestHeaders:(NSDictionary<NSString *, NSString *> *)headers cookies:(NSArray<NSHTTPCookie *> *)cookies;
// Experimental iframe startup keeps VLC muted until the exact website source accepts.
@property (nonatomic) BOOL prepareWebVideoHandoff;
@property (nonatomic, copy) void (^webVideoDidPrepare)(void);
- (void)activateWebVideoHandoffAtTime:(double)time;
@property (nonatomic, copy) void (^webVideoPreparationDidFail)(void);
- (void)startBackgroundWebVideoPreparation;
- (void)cancelBackgroundWebVideoPreparation;
- (void)detachBackgroundWebVideoForPresentation;
- (void)closePlayer;
// Return experimental iframe EOF/End to the site's own episode lifecycle.
@property (nonatomic) BOOL returnWebVideoOnEnd;
@property (nonatomic, copy) void (^webVideoDidClose)(double time, double volume, BOOL muted, NSString *action);
@end
