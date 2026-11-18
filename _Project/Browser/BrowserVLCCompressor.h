#import <Foundation/Foundation.h>

@class VLCMediaPlayer;

NS_ASSUME_NONNULL_BEGIN

// Both initial playback and EOF recovery use this factory. Without explicit
// Debug launch arguments it creates exactly the ordinary shared-library player.
FOUNDATION_EXPORT VLCMediaPlayer *BrowserVLCCreatePlayer(void);

NS_ASSUME_NONNULL_END
