#pragma once

#import <Foundation/Foundation.h>
#include <math.h>
#include <stdlib.h>
#import <QuartzCore/QuartzCore.h>

// Signed kinds distinguish a ten-second step from a ten-percent step.
static inline double BrowserPlaybackSeekSeconds(NSInteger kind, double duration) {
    double step = labs(kind) == 2 ? (isfinite(duration) && duration > 0 ? duration * 0.1 : 0) : 10;
    return kind < 0 ? -step : step;
}
static inline NSTimeInterval BrowserPlaybackSeekInterval(CFTimeInterval started) {
    double progress = MIN(1, MAX(0, (CACurrentMediaTime() - started) / 5.0));
    return 0.8 - 0.5 * progress;
}
