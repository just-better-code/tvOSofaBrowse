#import <UIKit/UIKit.h>

@interface BrowserVLCPlayerViewController : UIViewController
- (instancetype)initWithTorrentIdentifier:(NSString *)identifier fileIndex:(NSInteger)index title:(NSString *)title;
- (instancetype)initWithWebVideoURL:(NSURL *)URL pageURL:(NSURL *)pageURL title:(NSString *)title
                       currentTime:(double)time volume:(double)volume muted:(BOOL)muted
                  requestHeaders:(NSDictionary<NSString *, NSString *> *)headers cookies:(NSArray<NSHTTPCookie *> *)cookies;
@property (nonatomic, copy) void (^webVideoDidClose)(double time, double volume, BOOL muted);
@end
