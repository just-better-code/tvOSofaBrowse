#import "BrowserPlaybackSession.h"
#import <math.h>

NSString *BrowserPlaybackCommandName(BrowserPlaybackCommand command) {
    switch (command) {
        case BrowserPlaybackCommandToggle: return @"toggle";
        case BrowserPlaybackCommandPrevious: return @"previous";
        case BrowserPlaybackCommandRestart: return @"restart";
        case BrowserPlaybackCommandNext: return @"next";
        case BrowserPlaybackCommandEnd: return @"end";
        case BrowserPlaybackCommandSeekSeconds: return @"seek";
        case BrowserPlaybackCommandSeekFraction: return @"seekPercent";
        case BrowserPlaybackCommandVolume: return @"volume";
        case BrowserPlaybackCommandMute: return @"mute";
        case BrowserPlaybackCommandClose: return @"exit";
    }
    return @"";
}
NSString *BrowserPlaybackTimeText(double seconds) {
    NSInteger total = isfinite(seconds) ? MAX(0, (NSInteger)seconds) : 0;
    return total >= 3600 ? [NSString stringWithFormat:@"%ld:%02ld:%02ld", (long)(total/3600), (long)(total/60%60), (long)(total%60)] :
        [NSString stringWithFormat:@"%ld:%02ld", (long)(total/60), (long)(total%60)];
}
BOOL BrowserPlaybackCommandForControl(NSUInteger index, BrowserPlaybackCommand *command, double *value) {
    static const BrowserPlaybackCommand commands[] = {
        BrowserPlaybackCommandPrevious, BrowserPlaybackCommandRestart, BrowserPlaybackCommandSeekFraction,
        BrowserPlaybackCommandSeekSeconds, BrowserPlaybackCommandToggle, BrowserPlaybackCommandSeekSeconds,
        BrowserPlaybackCommandSeekFraction, BrowserPlaybackCommandNext, BrowserPlaybackCommandEnd,
        BrowserPlaybackCommandMute, BrowserPlaybackCommandVolume, BrowserPlaybackCommandVolume,
    };
    static const double values[] = {0,0,-0.1,-10,0,10,0.1,0,0,0,-0.1,0.1};
    if (index >= sizeof(commands)/sizeof(commands[0])) return NO;
    *command = commands[index]; *value = values[index];
    return YES;
}

@interface BrowserPlaybackSession ()
@property (nonatomic, readwrite) BrowserPlaybackRenderer renderer;
@property (nonatomic, readwrite, copy) NSString *identifier;
@property (nonatomic, readwrite, copy) NSDictionary *state;
@property (nonatomic, copy, nullable) void (^dispatchCommand)(BrowserPlaybackCommand, double);
@property (nonatomic, readwrite) BOOL controlsVisible;
@property (nonatomic) BOOL visibilityRequested;
@property (nonatomic) NSTimer *hideTimer;
@end

@implementation BrowserPlaybackSession
- (instancetype)initWithRenderer:(BrowserPlaybackRenderer)renderer identifier:(NSString *)identifier
                        dispatch:(void (^)(BrowserPlaybackCommand, double))dispatch {
    self = [super init];
    if (self) {
        _renderer = renderer;
        _identifier = [identifier copy];
        _dispatchCommand = [dispatch copy];
        _state = @{};
        _controlsVisible = YES;
        _visibilityRequested = YES;
    }
    return self;
}
- (BOOL)isPlaying {
    return [self.state[@"available"] boolValue] && ![self.state[@"paused"] boolValue] && ![self.state[@"buffering"] boolValue];
}
- (void)updateState:(NSDictionary *)state {
    BOOL wasPlaying = [self isPlaying];
    self.state = state ?: @{};
    if (!wasPlaying && [self isPlaying] && self.controlsVisible) [self showControls];
    [self refreshVisibility];
}
- (void)updateTitle:(NSString *)title {
    if (![title isKindOfClass:NSString.class] || title.length > 512) return;
    NSMutableDictionary *state = [self.state mutableCopy];
    state[@"pageTitle"] = title;
    self.state = state;
}
- (void)performCommand:(BrowserPlaybackCommand)command value:(double)value {
    if (!self.dispatchCommand || !isfinite(value)) return;
    if (command == BrowserPlaybackCommandPrevious && [self.state[@"currentTime"] doubleValue] > 5)
        command = BrowserPlaybackCommandRestart;
    self.dispatchCommand(command, value);
}
- (void)setControlsPinned:(BOOL)pinned {
    if (_controlsPinned == pinned) return;
    _controlsPinned = pinned;
    [self refreshVisibility];
}
- (void)refreshVisibility {
    BOOL paused = [self.state[@"available"] boolValue] && [self.state[@"paused"] boolValue];
    BOOL visible = self.visibilityRequested || self.controlsPinned || paused || [self.state[@"buffering"] boolValue];
    if (visible == self.controlsVisible) return;
    self.controlsVisible = visible;
    if (self.visibilityDidChange) self.visibilityDidChange(visible);
}
- (void)showControls {
    self.visibilityRequested = YES;
    [self.hideTimer invalidate];
    __weak typeof(self) weakSelf = self;
    self.hideTimer = [NSTimer timerWithTimeInterval:5 repeats:NO block:^(NSTimer *timer) {
        weakSelf.visibilityRequested = NO;
        [weakSelf refreshVisibility];
    }];
    [[NSRunLoop mainRunLoop] addTimer:self.hideTimer forMode:NSRunLoopCommonModes];
    [self refreshVisibility];
}
- (void)invalidate {
    [self.hideTimer invalidate]; self.hideTimer = nil;
    self.dispatchCommand = nil; self.visibilityDidChange = nil;
}
- (void)dealloc { [_hideTimer invalidate]; }
@end
