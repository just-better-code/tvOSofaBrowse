#import "BrowserVLCCompressor.h"
#import <TVVLCKit/TVVLCKit.h>

#if DEBUG
#import "BrowserPreferencesStore.h"
#import "BrowserVLCCoreCompat.h"
#include <dlfcn.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

// The selector is declared in the framework's private VLCLibVLCBridging.h.
// Do not import its unrelated internals or access media-player struct fields.
@interface VLCMediaPlayer (BrowserCompressorCore)
@property (nonatomic, readonly) void *libVLCMediaPlayer;
@end

@interface BrowserVLCCompressorLogger : NSObject <VLCLogging>
@property (nonatomic) VLCLogLevel level;
@property (nonatomic) NSUInteger generation;
@property (nonatomic) BOOL sawIndependentDebug;
@property (nonatomic, copy) NSString *lastOutput;
@end

@implementation BrowserVLCCompressorLogger
- (instancetype)init {
    if ((self = [super init])) {
        _level = kVLCLogLevelDebug;
        static NSUInteger serial;
        @synchronized (BrowserVLCCompressorLogger.class) { _generation = ++serial; }
    }
    return self;
}

- (void)handleMessage:(NSString *)message logLevel:(VLCLogLevel)level context:(VLCLogContext *)context {
    if (!BrowserPreferencesStore.debugEnabled) return;
    // Never forward a raw VLC message/context: those can contain authenticated
    // URLs, file names, cookies, request headers or personal source locations.
    @synchronized (self) {
        if (level == kVLCLogLevelDebug && !self.sawIndependentDebug &&
            ![context.module isEqualToString:@"compressor"]) {
            self.sawIndependentDebug = YES;
            BrowserDebugLog(@"[TorrentVLC] compressor player=%lu loggerDebug=1", (unsigned long)self.generation);
        }
        if ([context.module isEqualToString:@"compressor"] &&
            [message isEqualToString:@"compressor successfully initialized"]) {
            BrowserDebugLog(@"[TorrentVLC] compressor player=%lu initialized=1", (unsigned long)self.generation);
        } else if ([message isEqualToString:@"cannot add user audio filter \"compressor\" (skipped)"]) {
            BrowserDebugLog(@"[TorrentVLC] compressor player=%lu skipped=1", (unsigned long)self.generation);
        } else if ([message isEqualToString:@"cannot setup filtering pipeline"] ||
                   ([message hasPrefix:@"cannot find "] && [message hasSuffix:@" for conversion pipeline"])) {
            BrowserDebugLog(@"[TorrentVLC] compressor player=%lu pipelineFailure=1", (unsigned long)self.generation);
        }
        if (![context.objectType isEqualToString:@"audio output"]) return;
        static NSRegularExpression *formatPattern;
        static dispatch_once_t once;
        dispatch_once(&once, ^{
            formatPattern = [NSRegularExpression regularExpressionWithPattern:@"^output '(.{4})' ([0-9]+) Hz " options:0 error:NULL];
        });
        NSTextCheckingResult *match = [formatPattern firstMatchInString:message options:0 range:NSMakeRange(0, message.length)];
        if (!match) return;
        NSString *format = [message substringWithRange:[match rangeAtIndex:1]];
        NSData *bytes = [format dataUsingEncoding:NSASCIIStringEncoding];
        if (bytes.length != 4) return;
        NSUInteger rate = [[message substringWithRange:[match rangeAtIndex:2]] integerValue];
        if (rate == 0 || rate > 768000) return;
        NSString *key = [NSString stringWithFormat:@"%@:%lu", format, (unsigned long)rate];
        if ([key isEqualToString:self.lastOutput]) return;
        self.lastOutput = key;
        const uint8_t *b = bytes.bytes;
        uint32_t fourcc = (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
        BOOL pcm = [@[@"f32l", @"f32b", @"f64l", @"f64b", @"s16l", @"s16b", @"s24l", @"s24b",
                       @"s32l", @"s32b", @"u8  ", @"s8  "] containsObject:format];
        BrowserDebugLog(@"[TorrentVLC] compressor player=%lu outputFourcc=%u rate=%lu pcm=%d",
            (unsigned long)self.generation, fourcc, (unsigned long)rate, pcm);
    }
}
@end

static BOOL BrowserVLCLoadCore(BrowserVLCCore *core) {
    core->create = (int (*)(BrowserVLCObject *, const char *, int))dlsym(RTLD_DEFAULT, "var_Create");
    core->type = (int (*)(BrowserVLCObject *, const char *))dlsym(RTLD_DEFAULT, "var_Type");
    core->set = (int (*)(BrowserVLCObject *, const char *, int, BrowserVLCValue))dlsym(RTLD_DEFAULT, "var_SetChecked");
    core->get = (int (*)(BrowserVLCObject *, const char *, int, BrowserVLCValue *))dlsym(RTLD_DEFAULT, "var_GetChecked");
    core->children = (BrowserVLCList *(*)(BrowserVLCObject *))dlsym(RTLD_DEFAULT, "vlc_list_children");
    core->releaseList = (void (*)(BrowserVLCList *))dlsym(RTLD_DEFAULT, "vlc_list_release");
    return core->create && core->type && core->set && core->get && core->children && core->releaseList;
}

static BOOL BrowserVLCHasType(BrowserVLCCore core, BrowserVLCObject *object, const char *name, int type) {
    return (core.type(object, name) & BrowserVLCVariableTypeMask) == type;
}

static BOOL BrowserVLCSetFloat(BrowserVLCCore core, BrowserVLCObject *object, const char *name, float number) {
    int type = core.type(object, name);
    if (type == 0 && core.create(object, name, BrowserVLCVariableFloat) != 0) return NO;
    if (!BrowserVLCHasType(core, object, name, BrowserVLCVariableFloat)) return NO;
    BrowserVLCValue value = {0}, stored = {0};
    value.f_float = number;
    return core.set(object, name, BrowserVLCVariableFloat, value) == 0 &&
        core.get(object, name, BrowserVLCVariableFloat, &stored) == 0 && stored.f_float == number;
}

static BOOL BrowserVLCAppendCompressor(BrowserVLCCore core, BrowserVLCObject *object) {
    BrowserVLCValue previous = {0};
    if (core.get(object, "audio-filter", BrowserVLCVariableString, &previous) != 0) return NO;
    NSString *chain = previous.psz_string ? [NSString stringWithUTF8String:previous.psz_string] : @"";
    free(previous.psz_string);
    if (!chain) return NO;
    NSArray *filters = [chain componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@" :"]];
    if (![filters containsObject:@"compressor"]) chain = chain.length ? [chain stringByAppendingString:@":compressor"] : @"compressor";
    BrowserVLCValue value = {0}, stored = {0};
    value.psz_string = (char *)chain.UTF8String;
    if (core.set(object, "audio-filter", BrowserVLCVariableString, value) != 0) return NO;
    if (core.get(object, "audio-filter", BrowserVLCVariableString, &stored) != 0) return NO;
    BOOL matches = stored.psz_string && [chain isEqualToString:[NSString stringWithUTF8String:stored.psz_string]];
    free(stored.psz_string);
    return matches;
}

// Stable numeric reasons for the private research log; never include runtime strings.
typedef NS_ENUM(NSInteger, BrowserVLCCompressorSetup) {
    BrowserVLCCompressorConfigured = 0,
    BrowserVLCCompressorUnknownRevision = 1,
    BrowserVLCCompressorMissingSymbols = 2,
    BrowserVLCCompressorMissingGetter = 3,
    BrowserVLCCompressorInvalidPlayer = 4,
    BrowserVLCCompressorMissingChildren = 5,
    BrowserVLCCompressorAmbiguousOutput = 6,
    BrowserVLCCompressorParameterFailure = 7,
    BrowserVLCCompressorFilterFailure = 8,
    BrowserVLCCompressorPCMFailure = 9,
};

static BrowserVLCCompressorSetup BrowserVLCConfigureCompressor(VLCMediaPlayer *player, float makeup) {
    // Accept only the archive revision or the locally inspected binary build.
    // A library update needs a new source/ABI review, not relaxed matching.
    NSString *revision = player.libraryInstance.changeset;
    BOOL known = [revision containsString:@"79128878"] || [revision isEqualToString:@"3.0.23-2-47-g738f288a1c"];
    if (!known || ![player.libraryInstance.version hasPrefix:@"3.0."]) return BrowserVLCCompressorUnknownRevision;
    BrowserVLCCore core = {0};
    if (!BrowserVLCLoadCore(&core)) return BrowserVLCCompressorMissingSymbols;
    if (![player respondsToSelector:@selector(libVLCMediaPlayer)]) return BrowserVLCCompressorMissingGetter;
    BrowserVLCObject *object = player.libVLCMediaPlayer;
    if (!object || !BrowserVLCHasType(core, object, "audio-filter", BrowserVLCVariableString)) return BrowserVLCCompressorInvalidPlayer;

    // media_player_new already created an aout. Enumerate only direct children
    // while the fresh player has no media/input; retain via the list until done.
    BrowserVLCList *children = core.children(object);
    if (!children) return BrowserVLCCompressorMissingChildren;
    BrowserVLCObject *output = NULL;
    NSUInteger matches = 0;
    for (int i = 0; i < children->i_count; i++) {
        BrowserVLCObject *child = children->p_values[i].p_address;
        if (BrowserVLCHasType(core, child, "audio-filter", BrowserVLCVariableString) &&
            BrowserVLCHasType(core, child, "stereo-mode", BrowserVLCVariableInteger) &&
            BrowserVLCHasType(core, child, "device", BrowserVLCVariableString)) {
            output = child;
            matches++;
        }
    }
    if (matches != 1) { core.releaseList(children); return BrowserVLCCompressorAmbiguousOutput; }
    BrowserVLCValue device = {0};
    BOOL pcm = core.get(output, "device", BrowserVLCVariableString, &device) == 0 &&
        device.psz_string && strcmp(device.psz_string, "pcm") == 0;
    free(device.psz_string);
    if (!pcm) { core.releaseList(children); return BrowserVLCCompressorPCMFailure; }
    BrowserVLCCompressorSetup result = BrowserVLCCompressorConfigured;
    const struct { const char *name; float value; } parameters[] = {
        {"compressor-rms-peak", 0.2f}, {"compressor-attack", 25.0f},
        {"compressor-release", 100.0f}, {"compressor-threshold", -11.0f},
        {"compressor-ratio", 4.0f}, {"compressor-knee", 5.0f},
        {"compressor-makeup-gain", makeup},
    };
    for (NSUInteger i = 0; i < sizeof(parameters) / sizeof(parameters[0]); i++) {
        if (!BrowserVLCSetFloat(core, object, parameters[i].name, parameters[i].value) ||
            !BrowserVLCSetFloat(core, output, parameters[i].name, parameters[i].value)) {
            result = BrowserVLCCompressorParameterFailure;
            break;
        }
    }
    if (result == BrowserVLCCompressorConfigured &&
        (!BrowserVLCAppendCompressor(core, object) || !BrowserVLCAppendCompressor(core, output))) result = BrowserVLCCompressorFilterFailure;
    core.releaseList(children);
    return result;
}
#endif

VLCMediaPlayer *BrowserVLCCreatePlayer(void) {
#if DEBUG
    // Read only the volatile argument domain; never persist experimental keys.
    NSDictionary *arguments = [NSUserDefaults.standardUserDefaults volatileDomainForName:NSArgumentDomain];
    id enabledValue = arguments[@"BrowserVLCCompressorEnabled"];
    if (enabledValue != nil) {
        NSString *flag = [[enabledValue description] uppercaseString];
        BOOL valid = [@[@"YES", @"NO", @"1", @"0"] containsObject:flag];
        BOOL enabled = [flag isEqualToString:@"YES"] || [flag isEqualToString:@"1"];
        float makeup = 7.0f;
        id makeupValue = arguments[@"BrowserVLCCompressorMakeupGain"];
        if (makeupValue != nil) {
            NSScanner *scanner = [NSScanner scannerWithString:[makeupValue description]];
            scanner.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
            valid = [scanner scanFloat:&makeup] && scanner.isAtEnd && isfinite(makeup) && makeup >= 0 && makeup <= 24 && valid;
        }
        if (valid) {
            // Explicit OFF also uses PCM/logging for a comparable A/B baseline.
            VLCLibrary *library = [[VLCLibrary alloc] initWithOptions:@[@"--no-spdif", @"--verbose=2"]];
            BrowserVLCCompressorLogger *logger = [BrowserVLCCompressorLogger new];
            library.loggers = @[logger];
            VLCMediaPlayer *player = [[VLCMediaPlayer alloc] initWithLibrary:library];
            player.audio.passthrough = NO;
            BrowserVLCCompressorSetup setup = !player ? BrowserVLCCompressorInvalidPlayer :
                (enabled ? BrowserVLCConfigureCompressor(player, makeup) : BrowserVLCCompressorConfigured);
            // PCM is requested here; actual decoded output is logged separately.
            // Configuration success is not evidence of filter initialization.
            if (setup == BrowserVLCCompressorConfigured) {
                BrowserDebugLog(@"[TorrentVLC] compressor player=%lu configured=1 enabled=%d pcmRequested=1 makeup=%.1f",
                    (unsigned long)logger.generation, enabled, enabled ? makeup : 0);
                return player;
            }
            BrowserDebugLog(@"[TorrentVLC] compressor player=%lu configured=0 reason=%ld fallback=1",
                (unsigned long)logger.generation, (long)setup);
            // Drop the entire unplayed experimental player after partial writes;
            // the fallback inherits no experimental filters, params or device.
            [player stop];
        } else {
            BrowserDebugLog(@"[TorrentVLC] compressor argumentsValid=0 fallback=1");
        }
    }
#endif
    return [[VLCMediaPlayer alloc] initWithOptions:@[]];
}
