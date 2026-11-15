#import <UIKit/UIKit.h>

// Classic transport glyphs share one canvas and geometry in both native players.
// Draw vectors directly; the local reference image is not packaged into the app.
static inline UIImage *BrowserPlaybackControlImage(NSString *symbol) {
    static NSCache<NSString *, UIImage *> *cache;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ cache = [NSCache new]; });
    UIImage *cached = [cache objectForKey:symbol];
    if (cached) return cached;
    BOOL singleRight = [symbol isEqualToString:@"arrowtriangle.right.fill"] || [symbol isEqualToString:@"play.fill"];
    BOOL singleLeft = [symbol isEqualToString:@"arrowtriangle.left.fill"];
    BOOL rewind = [symbol isEqualToString:@"backward.fill"];
    BOOL forward = [symbol isEqualToString:@"forward.fill"];
    BOOL previous = [symbol isEqualToString:@"backward.end.fill"];
    BOOL next = [symbol isEqualToString:@"forward.end.fill"];
    BOOL beginning = [symbol isEqualToString:@"backward.end.alt.fill"];
    BOOL pause = [symbol isEqualToString:@"pause.fill"];
    BOOL ending = [symbol isEqualToString:@"browser.end.fill"];
    BOOL vlc = [symbol isEqualToString:@"browser.vlc"];
    BOOL playPause = [symbol isEqualToString:@"playpause.fill"];
    if (!(singleRight || singleLeft || rewind || forward || previous || next || beginning || pause || playPause || ending || vlc)) {
        return [UIImage systemImageNamed:symbol withConfiguration:
            [UIImageSymbolConfiguration configurationWithPointSize:29 weight:UIImageSymbolWeightSemibold]];
    }
    UIGraphicsImageRenderer *renderer = [[UIGraphicsImageRenderer alloc] initWithSize:CGSizeMake(38, 38)];
    UIImage *image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
        [UIColor.whiteColor setFill];
        void (^triangle)(CGFloat, CGFloat, BOOL) = ^(CGFloat x, CGFloat width, BOOL right) {
            UIBezierPath *path = [UIBezierPath bezierPath];
            [path moveToPoint:CGPointMake(right ? x : x + width, 5)];
            [path addLineToPoint:CGPointMake(right ? x + width : x, 19)];
            [path addLineToPoint:CGPointMake(right ? x : x + width, 33)];
            [path closePath]; [path fill];
        };
        if (vlc) {
            // Reuse the original monochrome torrent VLC cone geometry.
            UIBezierPath *cone = [UIBezierPath bezierPath];
            [cone moveToPoint:CGPointMake(19, 2)];
            [cone addLineToPoint:CGPointMake(29, 29)];
            [cone addLineToPoint:CGPointMake(9, 29)];
            [cone closePath]; [cone fill];
            CGContextSetBlendMode(context.CGContext, kCGBlendModeClear);
            UIBezierPath *upperBand = [UIBezierPath bezierPath];
            [upperBand moveToPoint:CGPointMake(16, 10)];
            [upperBand addLineToPoint:CGPointMake(22, 10)];
            [upperBand addLineToPoint:CGPointMake(23.5, 14)];
            [upperBand addLineToPoint:CGPointMake(14.5, 14)];
            [upperBand closePath]; [upperBand fill];
            UIBezierPath *lowerBand = [UIBezierPath bezierPath];
            [lowerBand moveToPoint:CGPointMake(12.5, 20)];
            [lowerBand addLineToPoint:CGPointMake(25.5, 20)];
            [lowerBand addLineToPoint:CGPointMake(27, 24)];
            [lowerBand addLineToPoint:CGPointMake(11, 24)];
            [lowerBand closePath]; [lowerBand fill];
            CGContextSetBlendMode(context.CGContext, kCGBlendModeNormal);
            [[UIBezierPath bezierPathWithRoundedRect:CGRectMake(7, 28, 24, 4) cornerRadius:1] fill];
            [[UIBezierPath bezierPathWithRoundedRect:CGRectMake(4, 32, 30, 5) cornerRadius:1.5] fill];
        } else if (ending) {
            triangle(3, 19, YES);
            UIRectFill(CGRectMake(25, 5, 4, 28)); UIRectFill(CGRectMake(31, 5, 4, 28));
        } else if (playPause) {
            UIRectFill(CGRectMake(5, 5, 3, 28)); triangle(10, 23, YES);
        } else if (pause) {
            UIRectFill(CGRectMake(9, 5, 7, 28)); UIRectFill(CGRectMake(22, 5, 7, 28));
        } else if (singleRight || singleLeft) {
            triangle(singleRight ? 10 : 4, 24, singleRight);
        } else if (rewind || forward) {
            triangle(3, 16, forward); triangle(19, 16, forward);
        } else if (beginning) {
            UIRectFill(CGRectMake(3, 5, 4, 28)); UIRectFill(CGRectMake(9, 5, 4, 28));
            triangle(16, 19, NO);
        } else if (previous) {
            UIRectFill(CGRectMake(3, 5, 3, 28)); triangle(9, 13, NO); triangle(22, 13, NO);
        } else if (next) {
            triangle(3, 13, YES); triangle(16, 13, YES); UIRectFill(CGRectMake(32, 5, 3, 28));
        }
    }];
    image = [image imageWithRenderingMode:UIImageRenderingModeAlwaysTemplate];
    [cache setObject:image forKey:symbol];
    return image;
}
