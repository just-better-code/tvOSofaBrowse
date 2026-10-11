#import "BrowserWebView.h"
#import <math.h>
#import "BrowserPreferencesStore.h"

@interface BrowserAdBlockConverter : NSObject
+ (NSDictionary *)convertRules:(NSString *)source;
@end

#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>

static NSString * const kBrowserWebViewClassName = @"WKWebView";
static NSString * const kBrowserWebViewConfigurationClassName = @"WKWebViewConfiguration";
static NSString * const kBrowserWebsiteDataStoreClassName = @"WKWebsiteDataStore";
static NSString * const kBrowserUserContentControllerClassName = @"WKUserContentController";
static NSString * const kBrowserUserScriptClassName = @"WKUserScript";
static NSString * const kBrowserAdBlockEnabledDefaultsKey = @"AdBlockEnabled";
static NSString * const kBrowserAdBlockRuleListIdentifier = @"BrowserAdBlock-v10";
static NSString * const kBrowserAdBlockUpdateNotification = @"BrowserAdBlockRulesDidUpdate";
NSString * const BrowserAdBlockSourceStatusDidChangeNotification = @"BrowserAdBlockSourceStatusDidChange";
static NSString * const kBrowserAdBlockSourceEnabledKeyPrefix = @"AdBlockSourceEnabled.";
static NSString * const kBrowserAdBlockSourceLastCheckKeyPrefix = @"AdBlockSourceLastCheck.";
static NSArray *sBrowserAdBlockCachedRuleLists = nil;
static NSSet<NSString *> *sBrowserAdBlockRuleFailures = nil;
static NSUInteger sBrowserAdBlockRulesGeneration = 0;
static char kBrowserNavigationURLObservationContext;

static void BrowserEnsureWebKitRuntimeLoaded(void) {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        if (NSClassFromString(kBrowserWebViewClassName) != Nil) {
            return;
        }

        NSArray<NSString *> *candidatePaths = @[
            @"/System/Library/Frameworks/WebKit.framework/WebKit",
            @"/System/Library/PrivateFrameworks/WebKit.framework/WebKit",
            @"/System/Library/StagedFrameworks/Safari/WebKit.framework/WebKit",
        ];

        for (NSString *candidatePath in candidatePaths) {
            if (dlopen(candidatePath.UTF8String, RTLD_NOW | RTLD_GLOBAL) != NULL && NSClassFromString(kBrowserWebViewClassName) != Nil) {
                break;
            }
        }
    });
}

static BOOL BrowserPumpRunLoopUntil(BOOL *done) {
    static BOOL isPumpingRunLoop = NO;
    if (*done) {
        return YES;
    }
    if (isPumpingRunLoop) {
        return NO;
    }
    isPumpingRunLoop = YES;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:2.0];
    while (!*done && [deadline timeIntervalSinceNow] > 0.0) {
        @autoreleasepool {
            [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        }
    }
    isPumpingRunLoop = NO;
    if (!*done) {
        BrowserLog(@"[WebKit] timed out waiting for a synchronous callback");
    }
    return *done;
}

static NSString *BrowserStringFromJavaScriptResult(id result) {
    if (result == nil || result == [NSNull null]) {
        return nil;
    }
    if ([result isKindOfClass:[NSString class]]) {
        return result;
    }
    if ([result respondsToSelector:@selector(stringValue)]) {
        return [result stringValue];
    }
    return [result description];
}

static BOOL BrowserSelectorNameMatchesMediaFilter(NSString *selectorName) {
    static NSArray<NSString *> *keywords = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        keywords = @[
            @"mediasource",
            @"managedmediasource",
            @"sourcebuffer",
            @"media",
            @"video",
            @"inline",
            @"autoplay",
            @"fullscreen",
            @"pictureinpicture",
            @"airplay",
            @"webm",
            @"vp9",
            @"av1",
            @"hls",
            @"mse",
            @"codec",
        ];
    });

    NSString *lowercaseSelectorName = selectorName.lowercaseString;
    for (NSString *keyword in keywords) {
        if ([lowercaseSelectorName containsString:keyword]) {
            return YES;
        }
    }
    return NO;
}

static NSArray<NSString *> *BrowserFilteredSelectorNamesForClass(Class klass) {
    if (klass == Nil) {
        return @[];
    }

    NSMutableOrderedSet<NSString *> *selectorNames = [NSMutableOrderedSet orderedSet];
    for (Class currentClass = klass; currentClass != Nil && currentClass != [NSObject class]; currentClass = class_getSuperclass(currentClass)) {
        unsigned int methodCount = 0;
        Method *methods = class_copyMethodList(currentClass, &methodCount);
        for (unsigned int methodIndex = 0; methodIndex < methodCount; methodIndex += 1) {
            SEL selector = method_getName(methods[methodIndex]);
            NSString *selectorName = NSStringFromSelector(selector);
            if (selectorName.length > 0 && BrowserSelectorNameMatchesMediaFilter(selectorName)) {
                [selectorNames addObject:selectorName];
            }
        }
        free(methods);
    }

    return [selectorNames.array sortedArrayUsingSelector:@selector(localizedCaseInsensitiveCompare:)];
}

static NSString *BrowserGetterNameFromSetterName(NSString *setterName) {
    if (![setterName hasPrefix:@"set"] || ![setterName hasSuffix:@":"] || setterName.length <= 4) {
        return nil;
    }

    NSString *propertyStem = [setterName substringWithRange:NSMakeRange(3, setterName.length - 4)];
    if (propertyStem.length == 0) {
        return nil;
    }

    NSString *firstCharacter = [[propertyStem substringToIndex:1] lowercaseString];
    if (propertyStem.length == 1) {
        return firstCharacter;
    }

    return [firstCharacter stringByAppendingString:[propertyStem substringFromIndex:1]];
}

static NSString *BrowserBooleanValueDescriptionForObjectAndSelector(id object, NSString *selectorName) {
    if (object == nil || selectorName.length == 0) {
        return nil;
    }

    SEL selector = NSSelectorFromString(selectorName);
    if (![object respondsToSelector:selector]) {
        return nil;
    }

    NSMethodSignature *signature = [object methodSignatureForSelector:selector];
    if (signature == nil || signature.numberOfArguments != 2) {
        return nil;
    }

    const char *returnType = signature.methodReturnType;
    if (returnType == NULL) {
        return nil;
    }

    if (returnType[0] != 'B' && returnType[0] != 'c') {
        return nil;
    }

    BOOL value = ((BOOL (*)(id, SEL))objc_msgSend)(object, selector);
    return value ? @"YES" : @"NO";
}

static id BrowserObjectResultForGetter(id object, NSString *selectorName) {
    if (object == nil || selectorName.length == 0) {
        return nil;
    }

    SEL selector = NSSelectorFromString(selectorName);
    if (![object respondsToSelector:selector]) {
        return nil;
    }

    NSMethodSignature *signature = [object methodSignatureForSelector:selector];
    if (signature == nil || signature.numberOfArguments != 2) {
        return nil;
    }

    const char *returnType = signature.methodReturnType;
    if (returnType == NULL || returnType[0] != '@') {
        return nil;
    }

    return ((id (*)(id, SEL))objc_msgSend)(object, selector);
}

static NSString *BrowserPreviewString(NSString *string, NSUInteger maxLength) {
    if (string.length <= maxLength) {
        return string;
    }
    return [[string substringToIndex:maxLength] stringByAppendingString:@"\n…"];
}

static NSString *BrowserStringValueForKnownSelectors(id object, NSArray<NSString *> *selectorNames) {
    for (NSString *selectorName in selectorNames) {
        id result = BrowserObjectResultForGetter(object, selectorName);
        if (result == nil || result == [NSNull null]) {
            continue;
        }
        NSString *stringResult = nil;
        if ([result isKindOfClass:[NSString class]]) {
            stringResult = result;
        } else if ([result respondsToSelector:@selector(stringValue)]) {
            stringResult = [result stringValue];
        } else {
            stringResult = [result description];
        }

        if (stringResult.length > 0) {
            return stringResult;
        }
    }
    return nil;
}

static NSArray<NSDictionary<NSString *, NSString *> *> *BrowserFeatureEntriesForPreferences(id preferences) {
    if (preferences == nil) {
        return @[];
    }

    NSArray<NSString *> *collectionSelectors = @[
        @"_experimentalFeatures",
        @"_internalDebugFeatures",
        @"_features",
    ];

    NSMutableArray<NSDictionary<NSString *, NSString *> *> *entries = [NSMutableArray array];
    for (NSString *collectionSelectorName in collectionSelectors) {
        id collection = BrowserObjectResultForGetter(preferences, collectionSelectorName);
        if (![collection conformsToProtocol:@protocol(NSFastEnumeration)]) {
            continue;
        }

        for (id feature in collection) {
            NSString *name = BrowserStringValueForKnownSelectors(feature, @[@"name", @"key", @"identifier", @"title", @"details"]);
            if (name.length == 0) {
                continue;
            }

            NSString *lowercaseName = name.lowercaseString;
            if (![lowercaseName containsString:@"media"] &&
                ![lowercaseName containsString:@"source"] &&
                ![lowercaseName containsString:@"vp9"] &&
                ![lowercaseName containsString:@"av1"] &&
                ![lowercaseName containsString:@"webm"] &&
                ![lowercaseName containsString:@"video"] &&
                ![lowercaseName containsString:@"mse"] &&
                ![lowercaseName containsString:@"managed"]) {
                continue;
            }

            NSString *enabledValue = BrowserBooleanValueDescriptionForObjectAndSelector(feature, @"enabled");
            if (enabledValue == nil) {
                enabledValue = BrowserBooleanValueDescriptionForObjectAndSelector(feature, @"isEnabled");
            }
            if (enabledValue == nil) {
                enabledValue = @"unknown";
            }

            NSString *key = BrowserStringValueForKnownSelectors(feature, @[@"key", @"identifier"]);
            NSString *source = [collectionSelectorName stringByReplacingOccurrencesOfString:@"_" withString:@""];
            [entries addObject:@{
                @"source": source ?: @"features",
                @"name": name,
                @"enabled": enabledValue,
                @"key": key ?: @"",
            }];
        }
    }

    return entries;
}

static void BrowserSetBooleanSelectorIfAvailable(id object, NSString *selectorName, BOOL value) {
    if (object == nil || selectorName.length == 0) {
        return;
    }

    SEL selector = NSSelectorFromString(selectorName);
    if ([object respondsToSelector:selector]) {
        ((void (*)(id, SEL, BOOL))objc_msgSend)(object, selector, value);
    }
}

static void BrowserConfigurePrivateMediaPreferences(id configuration) {
    if (configuration == nil) {
        return;
    }

    SEL preferencesSelector = NSSelectorFromString(@"preferences");
    if (![configuration respondsToSelector:preferencesSelector]) {
        return;
    }

    id preferences = ((id (*)(id, SEL))objc_msgSend)(configuration, preferencesSelector);
    if (preferences == nil) {
        return;
    }

    BrowserSetBooleanSelectorIfAvailable(preferences, @"_setMediaSourceEnabled:", YES);
    BrowserSetBooleanSelectorIfAvailable(preferences, @"_setManagedMediaSourceEnabled:", YES);
    BrowserSetBooleanSelectorIfAvailable(preferences, @"_setMediaCapabilityGrantsEnabled:", YES);
    BrowserSetBooleanSelectorIfAvailable(preferences, @"_setVideoQualityIncludesDisplayCompositingEnabled:", YES);
}

static NSString *BrowserFrameClickBridgeScript(NSString *secret, NSString *nativeToken) {
    NSString *path = [NSBundle.mainBundle pathForResource:@"BrowserFullscreenMediaBridge" ofType:@"js"];
    NSString *mediaBridge = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : @"";
    return [NSString stringWithFormat:
            @"(function(){"
                "if (window.__browserTVFrameClick) { return; }"
                "var secret = '%@';"
                "var fullscreenTarget = null;"
                "var fullscreenTargetStyle = '';"
                "var fullscreenFrame = null;"
                "var fullscreenFrameStyle = '';"
                "var theaterBackdrop = null;"
                "var raisedAncestors = [];"
                "var lastActiveFrame = null;"
                "var nativeToken = '%@';"
                "%@"
                "function notifyFullscreenChange() {"
                    "refreshFullscreenMedia();"
                    "try { document.dispatchEvent(new Event('fullscreenchange')); } catch (error) {}"
                    "try { document.dispatchEvent(new Event('webkitfullscreenchange')); } catch (error) {}"
                "}"
                "function sendFullscreenToParent(action) {"
                    "if (window.parent !== window) {"
                        "window.parent.postMessage({browserTVFrameFullscreen: secret, action: action}, '*');"
                    "}"
                "}"
                "function beginTheater(element) {"
                    "var body = document.body;"
                    "if (!body) { return; }"
                    "theaterBackdrop = document.createElement('div');"
                    "theaterBackdrop.style.cssText = 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;background:rgba(0,0,0,.88)!important;z-index:2147483645!important;opacity:0;transition:opacity .22s ease!important';"
                    "theaterBackdrop.addEventListener('click', function() { if (window.__browserTVExitFullscreen) { window.__browserTVExitFullscreen(); } });"
                    "body.appendChild(theaterBackdrop);"
                    "requestAnimationFrame(function() { if (theaterBackdrop) { theaterBackdrop.style.opacity = '1'; } });"
                    "var ancestor = element.parentElement || (element.getRootNode && element.getRootNode().host);"
                    "while (ancestor && ancestor !== body) {"
                        "raisedAncestors.push({element:ancestor, style:ancestor.style.cssText});"
                        "if (getComputedStyle(ancestor).position === 'static') { ancestor.style.setProperty('position', 'relative', 'important'); }"
                        "ancestor.style.setProperty('z-index', '2147483646', 'important');"
                        "ancestor.style.setProperty('overflow', 'visible', 'important');"
                        "ancestor = ancestor.parentElement || (ancestor.getRootNode && ancestor.getRootNode().host);"
                    "}"
                "}"
                "function endTheater() {"
                    "for (var i = raisedAncestors.length - 1; i >= 0; i--) {"
                        "raisedAncestors[i].element.style.cssText = raisedAncestors[i].style;"
                    "}"
                    "raisedAncestors = [];"
                    "if (theaterBackdrop) { theaterBackdrop.remove(); theaterBackdrop = null; }"
                "}"
                "function enterFullscreen(element) {"
                    "if (!element || fullscreenTarget) { return; }"
                    "fullscreenTarget = element;"
                    "fullscreenTargetStyle = element.style.cssText;"
                    "beginTheater(element);"
                    "element.style.cssText += ';position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;background:#000!important';"
                    "sendFullscreenToParent('enter');"
                    "notifyFullscreenChange();"
                "}"
                "function exitFullscreen() {"
                    "if (!fullscreenTarget) { return false; }"
                    "fullscreenTarget.style.cssText = fullscreenTargetStyle;"
                    "endTheater();"
                    "fullscreenTarget = null;"
                    "fullscreenTargetStyle = '';"
                    "sendFullscreenToParent('exit');"
                    "notifyFullscreenChange();"
                    "return true;"
                "}"
                "function toggleVideo() {"
                    "var frame = fullscreenFrame || (lastActiveFrame && lastActiveFrame.isConnected ? lastActiveFrame : null);"
                    "if (frame && frame.contentWindow) {"
                        "frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'toggle'}, '*');"
                        "return true;"
                    "}"
                    "var videos = document.querySelectorAll('video');"
                    "var video = null;"
                    "var bestArea = 0;"
                    "for (var i = 0; i < videos.length; i++) {"
                        "if (!videos[i].paused && !videos[i].ended) { video = videos[i]; break; }"
                        "var rect = videos[i].getBoundingClientRect();"
                        "var area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));"
                        "if (area > bestArea) { bestArea = area; video = videos[i]; }"
                    "}"
                    "if (video) {"
                        "if (video.paused) { var result = video.play(); if (result && result.catch) { result.catch(function(){}); } }"
                        "else { video.pause(); }"
                        "return true;"
                    "}"
                    "return false;"
                "}"
                "function handleMediaHorizontalPress(direction) {"
                    "if (fullscreenFrame && fullscreenFrame.contentWindow) {"
                        "fullscreenFrame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'seek', direction: direction}, '*');"
                        "return true;"
                    "}"
                    "var video = fullscreenTarget && fullscreenTarget.tagName === 'VIDEO' ? fullscreenTarget :"
                        "(fullscreenTarget && fullscreenTarget.querySelector ? fullscreenTarget.querySelector('video') : null);"
                    "var videos = document.querySelectorAll('video');"
                    "if (!video) {"
                        "for (var i = 0; i < videos.length; i++) {"
                            "if (!videos[i].paused && !videos[i].ended) { video = videos[i]; break; }"
                        "}"
                    "}"
                    "if (video) {"
                        "var delta = direction === 'right' ? 10 : -10;"
                        "var current = Number(video.currentTime);"
                        "var duration = Number(video.duration);"
                        "var targetTime = (isFinite(current) ? current : 0) + delta;"
                        "if (isFinite(duration) && duration > 0) { targetTime = Math.min(targetTime, Math.max(0, duration - 0.05)); }"
                        "video.currentTime = Math.max(0, targetTime);"
                        "return true;"
                    "}"
                    "if (lastActiveFrame && lastActiveFrame.isConnected && lastActiveFrame.contentWindow) {"
                        "lastActiveFrame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'seek', direction: direction}, '*');"
                        "return true;"
                    "}"
                    "return false;"
                "}"
                "function frameForSource(source) {"
                    "function search(root) {"
                        "var elements = root.querySelectorAll('*');"
                        "for (var i = 0; i < elements.length; i++) {"
                            "var element = elements[i];"
                            "if (element.tagName === 'IFRAME' && element.contentWindow === source) { return element; }"
                            "if (element.shadowRoot) { var nested = search(element.shadowRoot); if (nested) { return nested; } }"
                        "}"
                        "return null;"
                    "}"
                    "return search(document);"
                "}"
                "function frameAtPoint(x, y) {"
                    "var hit = document.elementFromPoint(x, y);"
                    "if (!hit) { return null; }"
                    "if (hit.tagName === 'IFRAME') { return hit; }"
                    "function search(root) {"
                        "var elements = root.querySelectorAll('*');"
                        "for (var i = elements.length - 1; i >= 0; i--) {"
                            "var element = elements[i];"
                            "if (element.shadowRoot) { var nested = search(element.shadowRoot); if (nested) { return nested; } }"
                            "if (element.tagName !== 'IFRAME') { continue; }"
                            "var rect = element.getBoundingClientRect();"
                            "if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom && rect.width > 0 && rect.height > 0) { return element; }"
                        "}"
                        "return null;"
                    "}"
                    "for (var element = hit; element; element = element.parentElement) {"
                        "if (element.shadowRoot) { var frame = search(element.shadowRoot); if (frame) { return frame; } }"
                    "}"
                    "return null;"
                "}"
                "function isFullscreenButton(element) {"
                    "if (!element || !document.querySelector('video')) { return false; }"
                    "var label = [element.id || '', element.className || '', element.getAttribute('aria-label') || '', element.getAttribute('title') || '', element.getAttribute('data-plyr') || ''].join(' ').toLowerCase();"
                    "return /full.?screen|expand|maximize|enlarge|розгорнути|повн.*екран/.test(label);"
                "}"
                "function videoContainer(element) {"
                    "var video = document.querySelector('video');"
                    "var candidate = element;"
                    "while (candidate && candidate !== document.body) {"
                        "if (candidate !== video && candidate.querySelector && candidate.querySelector('video')) { return candidate; }"
                        "candidate = candidate.parentElement;"
                    "}"
                    "return (video && video.parentElement) || element;"
                "}"
                "function clickAt(x, y) {"
                    "if (!isFinite(x) || !isFinite(y)) { return false; }"
                    "var element = document.elementFromPoint(x, y);"
                    "if (!element) { return false; }"
                    "var frame = frameAtPoint(x, y);"
                    "if (frame && frame.contentWindow) {"
                        "lastActiveFrame = frame;"
                        "var rect = frame.getBoundingClientRect();"
                        "var scaleX = rect.width ? frame.offsetWidth / rect.width : 1;"
                        "var scaleY = rect.height ? frame.offsetHeight / rect.height : 1;"
                        "frame.contentWindow.postMessage({browserTVFrameClick: secret, x: (x - rect.left) * scaleX - frame.clientLeft, y: (y - rect.top) * scaleY - frame.clientTop}, '*');"
                        "return true;"
                    "}"
                    "var target = element.closest ? (element.closest('a, button, input, label, select, [role=button], [onclick], [tabindex]') || element) : element;"
                    "if (isFullscreenButton(target) || isFullscreenButton(element)) {"
                        "if (!exitFullscreen()) { enterFullscreen(videoContainer(target)); }"
                        "return true;"
                    "}"
                    "try { if (target.focus) { target.focus(); } } catch (error) {}"
                    "function dispatch(type, constructorName) {"
                        "try {"
                            "var Constructor = window[constructorName];"
                            "if (Constructor) {"
                                "target.dispatchEvent(new Constructor(type, {bubbles:true, cancelable:true, composed:true, view:window, clientX:x, clientY:y, screenX:x, screenY:y, button:0, buttons:1, pointerType:'mouse'}));"
                                "return;"
                            "}"
                        "} catch (error) {}"
                        "var event = document.createEvent('MouseEvents');"
                        "event.initMouseEvent(type, true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);"
                        "target.dispatchEvent(event);"
                    "}"
                    "dispatch('pointerdown', 'PointerEvent');"
                    "dispatch('mousedown', 'MouseEvent');"
                    "dispatch('pointerup', 'PointerEvent');"
                    "dispatch('mouseup', 'MouseEvent');"
                    "if (typeof target.click === 'function') { target.click(); }"
                    "else { dispatch('click', 'MouseEvent'); }"
                    "return true;"
                "}"
                "window.__browserTVFrameClick = clickAt;"
                "window.__browserTVFrameAtPoint = function(x, y) { return !!frameAtPoint(x, y); };"
                "window.__browserTVExitFullscreen = function() {"
                    "if (exitFullscreen()) { return true; }"
                    "if (fullscreenFrame && fullscreenFrame.contentWindow) {"
                        "fullscreenFrame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'exit'}, '*');"
                        "return true;"
                    "}"
                    "return false;"
                "};"
                "window.__browserTVToggleVideo = toggleVideo;"
                "window.__browserTVHandleMediaHorizontalPress = handleMediaHorizontalPress;"
                "function fullscreenElement() { return fullscreenTarget || fullscreenFrame; }"
                "try { Object.defineProperty(document, 'fullscreenElement', {configurable:true, get:fullscreenElement}); } catch (error) {}"
                "try { Object.defineProperty(document, 'webkitFullscreenElement', {configurable:true, get:fullscreenElement}); } catch (error) {}"
                "try { Object.defineProperty(document, 'webkitIsFullScreen', {configurable:true, get:function() { return !!fullscreenElement(); }}); } catch (error) {}"
                "function overrideMethod(object, name, implementation) {"
                    "try { Object.defineProperty(object, name, {configurable:true, writable:true, value:implementation}); } catch (error) {}"
                "}"
                "if (window.Element && Element.prototype) {"
                    "overrideMethod(Element.prototype, 'requestFullscreen', function() { enterFullscreen(this); return Promise.resolve(); });"
                    "overrideMethod(Element.prototype, 'webkitRequestFullscreen', function() { enterFullscreen(this); });"
                    "overrideMethod(Element.prototype, 'webkitRequestFullScreen', function() { enterFullscreen(this); });"
                "}"
                "if (window.HTMLVideoElement && HTMLVideoElement.prototype) {"
                    "overrideMethod(HTMLVideoElement.prototype, 'webkitEnterFullscreen', function() { enterFullscreen(videoContainer(this)); });"
                    "overrideMethod(HTMLVideoElement.prototype, 'webkitEnterFullScreen', function() { enterFullscreen(videoContainer(this)); });"
                "}"
                "overrideMethod(document, 'exitFullscreen', function() { exitFullscreen(); return Promise.resolve(); });"
                "overrideMethod(document, 'webkitExitFullscreen', exitFullscreen);"
                "overrideMethod(document, 'webkitCancelFullScreen', exitFullscreen);"
                "window.addEventListener('message', function(event) {"
                    "var data = event.data;"
                    "if (!data) { return; }"
                    "if (event.source === window.parent && data.browserTVFrameClick === secret) {"
                        "clickAt(Number(data.x), Number(data.y));"
                    "} else if (event.source === window.parent && data.browserTVFullscreenCommand === secret) {"
                        "if (data.action === 'exit') { window.__browserTVExitFullscreen(); }"
                        "if (data.action === 'toggle') { toggleVideo(); }"
                        "if (data.action === 'seek') { handleMediaHorizontalPress(data.direction); }"
                        "if (data.action === 'media') { performMediaCommand(data.command, data.value, data.request); }"
                    "} else if (data.browserTVMediaState === secret) {"
                        "receiveMediaState(event, data);"
                    "} else if (data.browserTVFrameFullscreen === secret) {"
                        "var frame = frameForSource(event.source);"
                        "if (!frame) { return; }"
                        "if (data.action === 'enter') {"
                            "fullscreenFrame = frame;"
                            "fullscreenFrameStyle = frame.style.cssText;"
                            "beginTheater(frame);"
                            "frame.style.cssText += ';position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;background:#000!important';"
                        "} else if (data.action === 'exit' && fullscreenFrame === frame) {"
                            "frame.style.cssText = fullscreenFrameStyle;"
                            "endTheater();"
                            "fullscreenFrame = null;"
                            "fullscreenFrameStyle = '';"
                        "}"
                        "sendFullscreenToParent(data.action);"
                        "refreshFullscreenMedia();"
                    "}"
                "});"
            "})();", secret, nativeToken, mediaBridge ?: @"function refreshFullscreenMedia() {} function receiveMediaState() {} function performMediaCommand() {}"];
}

static void BrowserWriteWebsiteDiagnostic(NSDictionary *entry) {
    if (!BrowserPreferencesStore.websiteLoggingEnabled) return;
    NSData *data = [NSJSONSerialization dataWithJSONObject:entry options:0 error:nil];
    if (data == nil || data.length > 4096) return;
    NSURL *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
    NSString *path = [[cache URLByAppendingPathComponent:@"BrowserWebsiteDiagnostics.log"] path];
    if (!path) return;
    NSString *line = [NSString stringWithFormat:@"%@ %@\n", NSDate.date,
        [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
    NSFileManager *manager = NSFileManager.defaultManager;
    if ([[manager attributesOfItemAtPath:path error:nil][NSFileSize] unsignedIntegerValue] > 128 * 1024) {
        NSString *previous = [path stringByAppendingString:@".previous"];
        [manager removeItemAtPath:previous error:nil];
        [manager moveItemAtPath:path toPath:previous error:nil];
    }
    if (![manager fileExistsAtPath:path]) [manager createFileAtPath:path contents:nil attributes:nil];
    NSFileHandle *file = [NSFileHandle fileHandleForWritingAtPath:path];
    @try {
        [file seekToEndOfFile];
        [file writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
        [file closeFile];
    } @catch (NSException *exception) { BrowserLog(@"[WebsiteDiagnostics] Log write failed: %@", exception.name); }
}

// Shared handler avoids retaining a web view through its message controller.
@interface BrowserWebsiteDiagnosticsHandler : NSObject
- (void)userContentController:(id)controller didReceiveScriptMessage:(id)message;
@end
@implementation BrowserWebsiteDiagnosticsHandler
- (void)userContentController:(id)controller didReceiveScriptMessage:(id)message {
    if (!BrowserPreferencesStore.websiteLoggingEnabled) return;
    id body = [message valueForKey:@"body"];
    if (![body isKindOfClass:NSDictionary.class]) return;
    NSMutableDictionary *entry = [NSMutableDictionary dictionary];
    for (NSString *key in @[@"event", @"origin", @"episode", @"season", @"seconds",
                            @"storageCount", @"storageError", @"length"]) {
        id value = body[key];
        if ([value isKindOfClass:NSString.class]) entry[key] = [value substringToIndex:MIN([value length], 160)];
        else if ([value isKindOfClass:NSNumber.class]) entry[key] = value;
    }
    if (entry.count) BrowserWriteWebsiteDiagnostic(entry);
}
@end

static NSString *BrowserWebsiteDiagnosticsScript(NSString *token, BOOL enabled) {
    NSString *source = @"/* BrowserWebsiteDiagnostics */"
        "(function(){"
        "var token=TOKEN, enabled=false, timer=null, last='', originalGet=null, originalSet=null, hookedGet=null, hookedSet=null;"
        "function send(e){if(!enabled)return;try{e.origin=location.origin;window.webkit.messageHandlers.browserWebsiteDiagnostics.postMessage(e)}catch(x){}}"
        "function state(){if(!enabled)return;try{var text=document.body?document.body.innerText:'';"
        "var episode=text.match(/Серія\\s*\\d+/),season=text.match(/Сезон\\s*\\d+/),video=document.querySelector('video');"
        "if(!episode&&!video)return;var e={event:'player',episode:episode?episode[0]:'',season:season?season[0]:''};"
        "if(video)e.seconds=Math.floor(video.currentTime/15)*15;var key=JSON.stringify(e);if(key!==last){last=key;send(e)}}catch(x){}}"
        "function playerMessage(e){try{var d=e.data&&e.data.payload&&e.data.payload.data;if(!d||typeof d!=='object')return;"
        "var v={event:'player-info'};if(typeof d.e==='string')v.episode=d.e;if(typeof d.s==='string')v.season=d.s;"
        "if(typeof d.t==='number')v.seconds=d.t;if(v.episode||v.season||typeof v.seconds==='number')send(v)}catch(x){}}"
        "function setEnabled(value){value=!!value;if(enabled===value)return;enabled=value;"
        "if(enabled){last='';try{send({event:'document',storageCount:localStorage.length})}catch(e){send({event:'document',storageError:String(e.name||'Error')})}"
        "try{var get=Storage.prototype.getItem,set=Storage.prototype.setItem;originalGet=get;originalSet=set;"
        "hookedGet=function(k){try{var v=get.call(this,k);send({event:'storage-get',length:v===null?0:v.length});return v}catch(e){send({event:'storage-get',storageError:String(e.name||'Error')});throw e}};"
        "hookedSet=function(k,v){try{var r=set.call(this,k,v);send({event:'storage-set',length:String(v).length});return r}catch(e){send({event:'storage-set',storageError:String(e.name||'Error')});throw e}};"
        "Storage.prototype.getItem=hookedGet;Storage.prototype.setItem=hookedSet;"
        "}catch(e){send({event:'storage-hook',storageError:String(e.name||'Error')})}"
        "timer=setInterval(state,2000);addEventListener('message',playerMessage);"
        "}else{if(timer!==null)clearInterval(timer);timer=null;removeEventListener('message',playerMessage);"
        "try{if(Storage.prototype.getItem===hookedGet)Storage.prototype.getItem=originalGet;if(Storage.prototype.setItem===hookedSet)Storage.prototype.setItem=originalSet}catch(x){}}"
        "}"
        "function broadcast(value){setEnabled(value);for(var i=0;i<frames.length;i++){try{frames[i].postMessage({browserDiagnostics:token,enabled:enabled},'*')}catch(x){}}}"
        "addEventListener('message',function(e){var d=e.data;if(!d||d.browserDiagnostics!==token)return;"
        "if(d.request&&window===window.top){try{e.source.postMessage({browserDiagnostics:token,enabled:enabled},'*')}catch(x){};return}"
        "if(window!==window.top&&(e.source===window.top||e.source===window.parent)&&typeof d.enabled==='boolean')broadcast(d.enabled);"
        "});"
        "if(window===window.top){window[token]=broadcast;broadcast(INITIAL)}"
        "else{try{window.top.postMessage({browserDiagnostics:token,request:true},'*')}catch(x){}}"
        "})();";
    source = [source stringByReplacingOccurrencesOfString:@"TOKEN" withString:[NSString stringWithFormat:@"\"%@\"", token]];
    return [source stringByReplacingOccurrencesOfString:@"INITIAL" withString:enabled ? @"true" : @"false"];
}

// tvOS denies WebKit's default Library/WebKit directory. Use one shared
// persistent store rooted in the app's writable cache directory instead.
static id BrowserPersistentWebsiteDataStore(void) {
    BrowserEnsureWebKitRuntimeLoaded();
    static id store;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class storeClass = NSClassFromString(kBrowserWebsiteDataStoreClassName);
        Class configurationClass = NSClassFromString(@"_WKWebsiteDataStoreConfiguration");
        SEL directoryInitializer = NSSelectorFromString(@"initWithDirectory:");
        SEL storeFactory = NSSelectorFromString(@"_storeWithConfiguration:");
        SEL storeInitializer = NSSelectorFromString(@"_initWithConfiguration:");
        NSURL *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
        NSURL *directory = [cache URLByAppendingPathComponent:@"BrowserWebsiteData" isDirectory:YES];
        NSError *error = nil;
        if (directory && [configurationClass instancesRespondToSelector:directoryInitializer] &&
            ([storeClass respondsToSelector:storeFactory] || [storeClass instancesRespondToSelector:storeInitializer]) &&
            [NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:nil error:&error]) {
            id configuration = ((id (*)(id, SEL))objc_msgSend)((id)configurationClass, @selector(alloc));
            configuration = ((id (*)(id, SEL, id))objc_msgSend)(configuration, directoryInitializer, directory);
            if ([storeClass respondsToSelector:storeFactory])
                store = ((id (*)(id, SEL, id))objc_msgSend)((id)storeClass, storeFactory, configuration);
            else {
                id allocated = ((id (*)(id, SEL))objc_msgSend)((id)storeClass, @selector(alloc));
                store = ((id (*)(id, SEL, id))objc_msgSend)(allocated, storeInitializer, configuration);
            }
            if (store) {
                BrowserLog(@"[WebsiteData] Persistent store at %@", directory.path);
                BrowserWriteWebsiteDiagnostic(@{@"event": @"store-start", @"directory": directory.path, @"process": @(NSProcessInfo.processInfo.processIdentifier)});
            }
        }
        if (store == nil && [storeClass respondsToSelector:NSSelectorFromString(@"defaultDataStore")]) {
            BrowserLog(@"[WebsiteData] Custom persistent store unavailable: %@", error);
            store = ((id (*)(id, SEL))objc_msgSend)((id)storeClass, NSSelectorFromString(@"defaultDataStore"));
        }
    });
    return store;
}

// WebKit retains its handler; retain only a weak owner to avoid a cycle.
@interface BrowserFullscreenMediaHandler : NSObject
@property (nonatomic, weak) BrowserWebView *owner;
@property (nonatomic, copy) NSString *token;
@end
@implementation BrowserFullscreenMediaHandler
- (void)userContentController:(id)controller didReceiveScriptMessage:(id)message {
    BrowserWebView *owner = self.owner;
    if (!owner || owner.loading) return;
    if (!owner.window) {
        [owner setFullscreenMediaControlsSuspended:YES];
        return;
    }
    id frame = [message valueForKey:@"frameInfo"];
    if (![[frame valueForKey:@"isMainFrame"] boolValue]) return;
    NSURLRequest *request = [frame valueForKey:@"request"];
    if (![request.URL isEqual:owner.request.URL]) return;
    id body = [message valueForKey:@"body"];
    if (![body isKindOfClass:NSDictionary.class] || ![body[@"token"] isEqual:self.token]) return;
    if (![body[@"session"] isKindOfClass:NSString.class] || [body[@"session"] length] > 128) return;
    NSMutableDictionary *state = [NSMutableDictionary dictionaryWithObject:body[@"session"] forKey:@"session"];
    for (NSString *key in @[@"active", @"available", @"paused", @"canSeekBack", @"canSeekForward", @"canPrevious", @"canNext", @"canRestart", @"canEnd"]) {
        state[key] = @([body[key] isKindOfClass:NSNumber.class] && [body[key] boolValue]);
    }
    for (NSString *key in @[@"currentTime", @"duration"]) {
        double value = [body[key] isKindOfClass:NSNumber.class] ? [body[key] doubleValue] : 0;
        state[key] = @(isfinite(value) && value >= 0 && value < 1e12 ? value : 0);
    }
    if ([owner.delegate respondsToSelector:@selector(webView:didUpdateFullscreenMediaState:)]) {
        [owner.delegate webView:owner didUpdateFullscreenMediaState:state];
    }
}
@end

static void BrowserInstallUserScripts(id configuration, NSString *diagnosticToken, BrowserWebView *owner) {
    if (configuration == nil) {
        return;
    }

    Class userContentControllerClass = NSClassFromString(kBrowserUserContentControllerClassName);
    Class userScriptClass = NSClassFromString(kBrowserUserScriptClassName);
    if (userContentControllerClass == Nil || userScriptClass == Nil) {
        return;
    }

    SEL userContentControllerGetter = NSSelectorFromString(@"userContentController");
    SEL setUserContentControllerSelector = NSSelectorFromString(@"setUserContentController:");
    id userContentController = nil;
    if ([configuration respondsToSelector:userContentControllerGetter]) {
        userContentController = ((id (*)(id, SEL))objc_msgSend)(configuration, userContentControllerGetter);
    }

    if (userContentController == nil && [configuration respondsToSelector:setUserContentControllerSelector]) {
        userContentController = ((id (*)(id, SEL))objc_msgSend)((id)userContentControllerClass, @selector(new));
        ((void (*)(id, SEL, id))objc_msgSend)(configuration, setUserContentControllerSelector, userContentController);
    }

    SEL addUserScriptSelector = NSSelectorFromString(@"addUserScript:");
    SEL userScriptInitializer = NSSelectorFromString(@"initWithSource:injectionTime:forMainFrameOnly:");
    if (userContentController == nil ||
        ![userContentController respondsToSelector:addUserScriptSelector] ||
        ![userScriptClass instancesRespondToSelector:userScriptInitializer]) {
        return;
    }

    SEL addHandler = NSSelectorFromString(@"addScriptMessageHandler:name:");
    if ([userContentController respondsToSelector:addHandler]) {
        BrowserFullscreenMediaHandler *mediaHandler = [BrowserFullscreenMediaHandler new];
        mediaHandler.owner = owner; mediaHandler.token = diagnosticToken;
        ((void (*)(id, SEL, id, id))objc_msgSend)(userContentController, addHandler, mediaHandler, @"browserFullscreenMedia");
        static BrowserWebsiteDiagnosticsHandler *handler;
        static dispatch_once_t handlerToken;
        dispatch_once(&handlerToken, ^{ handler = [BrowserWebsiteDiagnosticsHandler new]; });
        ((void (*)(id, SEL, id, id))objc_msgSend)(userContentController, addHandler, handler, @"browserWebsiteDiagnostics");
        id diagnosticScript = ((id (*)(id, SEL))objc_msgSend)((id)userScriptClass, @selector(alloc));
        diagnosticScript = ((id (*)(id, SEL, id, NSInteger, BOOL))objc_msgSend)(diagnosticScript, userScriptInitializer, BrowserWebsiteDiagnosticsScript(diagnosticToken, BrowserPreferencesStore.websiteLoggingEnabled), 0, NO);
        if (diagnosticScript) ((void (*)(id, SEL, id))objc_msgSend)(userContentController, addUserScriptSelector, diagnosticScript);
    }

    NSString *frameClickSecret = [NSUUID UUID].UUIDString;
    id frameClickScript = ((id (*)(id, SEL))objc_msgSend)((id)userScriptClass, @selector(alloc));
    frameClickScript = ((id (*)(id, SEL, id, NSInteger, BOOL))objc_msgSend)(frameClickScript, userScriptInitializer, BrowserFrameClickBridgeScript(frameClickSecret, diagnosticToken), 0, NO);
    if (frameClickScript != nil) {
        ((void (*)(id, SEL, id))objc_msgSend)(userContentController, addUserScriptSelector, frameClickScript);
    }
}

static NSArray<NSDictionary<NSString *, NSString *> *> *BrowserAdBlockSources(void) {
    return @[
        @{@"id": @"dns", @"title": @"AdGuard DNS", @"file": @"AdGuardDNS.txt",
          @"url": @"https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt"},
        @{@"id": @"base", @"title": @"AdGuard Base", @"file": @"AdGuardBase.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_2_Base/filter.txt"},
        @{@"id": @"ukrainian", @"title": @"AdGuard Ukrainian", @"file": @"AdGuardUkrainian.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_23_Ukrainian/filter.txt"},
        @{@"id": @"social", @"title": @"AdGuard Social Media", @"file": @"AdGuardSocial.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_4_Social/filter.txt"},
        @{@"id": @"mobile", @"title": @"AdGuard Mobile Ads", @"file": @"AdGuardMobile.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_11_Mobile/filter.txt"},
        @{@"id": @"annoyances", @"title": @"AdGuard Annoyances", @"file": @"AdGuardAnnoyances.txt",
          @"url": @"https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14_Annoyances/filter.txt"}
    ];
}

static BOOL BrowserAdBlockSourceEnabled(NSString *identifier) {
    id stored = [NSUserDefaults.standardUserDefaults objectForKey:
        [kBrowserAdBlockSourceEnabledKeyPrefix stringByAppendingString:identifier]];
    return stored == nil || [stored boolValue];
}

static NSURL *BrowserAdBlockSourceURL(NSDictionary<NSString *, NSString *> *source) {
    NSURL *cache = [NSFileManager.defaultManager URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject;
    return [[cache URLByAppendingPathComponent:@"BrowserContentRules" isDirectory:YES]
            URLByAppendingPathComponent:source[@"file"]];
}

static NSURL *BrowserAdBlockOnlineHostsURL(void) {
    return BrowserAdBlockSourceURL(BrowserAdBlockSources().firstObject);
}

static NSUInteger BrowserAddAdBlockHosts(NSMutableOrderedSet<NSString *> *domains, NSString *hosts) {
    NSCharacterSet *invalidCharacters = [[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyz0123456789.-"] invertedSet];
    [hosts enumerateLinesUsingBlock:^(NSString *line, BOOL *stop) {
        (void)stop;
        if (![line hasPrefix:@"||"] || ![line hasSuffix:@"^"]) return;
        NSString *domain = [[line substringWithRange:NSMakeRange(2, line.length - 3)] lowercaseString];
        if ([domain containsString:@"."] &&
            [domain rangeOfCharacterFromSet:invalidCharacters].location == NSNotFound) [domains addObject:domain];
    }];
    return domains.count;
}

static NSArray<NSString *> *BrowserAdBlockRuleChunks(BOOL includeOnlineHosts,
    NSMutableArray<NSString *> *sourceIDs, NSMutableSet<NSString *> *failedSources) {
    NSString *customPath = [NSBundle.mainBundle pathForResource:@"AdBlockCustomRules" ofType:@"json"];
    NSData *customData = customPath != nil ? [NSData dataWithContentsOfFile:customPath] : nil;
    NSDictionary *customRules = customData != nil ? [NSJSONSerialization JSONObjectWithData:customData options:0 error:nil] : nil;
    if (![customRules isKindOfClass:NSDictionary.class]) return nil;
    NSMutableOrderedSet<NSString *> *domains = [NSMutableOrderedSet orderedSet];
    NSArray *blockedHosts = customRules[@"blockedHosts"];
    if (![blockedHosts isKindOfClass:NSArray.class]) return nil;
    for (id host in blockedHosts) {
        if (![host isKindOfClass:NSString.class]) return nil;
        [domains addObject:[host lowercaseString]];
    }
    if (includeOnlineHosts && BrowserAdBlockSourceEnabled(@"dns")) {
        BrowserAddAdBlockHosts(domains, [NSString stringWithContentsOfURL:BrowserAdBlockOnlineHostsURL()
                                                                 encoding:NSUTF8StringEncoding error:nil]);
    }
    NSMutableArray<NSString *> *chunks = [NSMutableArray array];
    NSMutableArray<NSDictionary *> *rules = [NSMutableArray arrayWithCapacity:25000];
    NSCharacterSet *invalidCharacters = [[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyz0123456789.-"] invertedSet];
    for (NSString *domain in domains) {
        if ([domain rangeOfCharacterFromSet:invalidCharacters].location != NSNotFound) continue;
        NSString *escapedDomain = [domain stringByReplacingOccurrencesOfString:@"." withString:@"\\."];
        NSString *URLFilter = [NSString stringWithFormat:@"^https?://([a-z0-9-]+\\.)*%@(:[0-9]+)?/", escapedDomain];
        [rules addObject:@{
            @"trigger": @{
                @"url-filter": URLFilter,
                @"load-type": @[@"third-party"]
            },
            @"action": @{@"type": @"block"}
        }];
        if (rules.count == 25000) {
            NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:0 error:nil];
            if (data == nil) return nil;
            [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
            [sourceIDs addObject:@"dns"];
            [rules removeAllObjects];
        }
    }
    NSArray *contentRules = customRules[@"contentRules"];
    if (![contentRules isKindOfClass:NSArray.class]) return nil;
    for (id contentRule in contentRules) {
        if (![contentRule isKindOfClass:NSDictionary.class]) return nil;
        [rules addObject:contentRule];
        if (rules.count == 25000) {
            NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:0 error:nil];
            if (data == nil) return nil;
            [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
            [sourceIDs addObject:@"dns"];
            [rules removeAllObjects];
        }
    }
    if (rules.count > 0) {
        NSData *data = [NSJSONSerialization dataWithJSONObject:rules options:0 error:nil];
        if (data == nil) return nil;
        [chunks addObject:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]];
        [sourceIDs addObject:@"dns"];
    }
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        if ([source[@"id"] isEqualToString:@"dns"] || !BrowserAdBlockSourceEnabled(source[@"id"])) continue;
        NSString *filter = [NSString stringWithContentsOfURL:BrowserAdBlockSourceURL(source)
                                                    encoding:NSUTF8StringEncoding error:nil];
        if (filter.length == 0) continue;
        NSDictionary *converted = [BrowserAdBlockConverter convertRules:filter];
        NSString *json = converted[@"json"];
        if (![json isKindOfClass:NSString.class] || json.length == 0) {
            [failedSources addObject:source[@"id"]];
            BrowserLog(@"[AdBlock] source=%@ conversion failed", source[@"id"]);
            continue;
        }
        [chunks addObject:json];
        [sourceIDs addObject:source[@"id"]];
        BrowserLog(@"[AdBlock] source=%@ rules=%ld advanced=%ld discarded=%ld errors=%ld", source[@"id"],
              (long)[converted[@"rules"] integerValue], (long)[converted[@"advanced"] integerValue],
              (long)[converted[@"discarded"] integerValue], (long)[converted[@"errors"] integerValue]);
    }
    return chunks;
}

static NSString *BrowserAdBlockRuleListIdentifier(BOOL includeOnlineHosts) {
    NSString *customPath = [NSBundle.mainBundle pathForResource:@"AdBlockCustomRules" ofType:@"json"];
    NSData *customData = customPath != nil ? [NSData dataWithContentsOfFile:customPath] : nil;
    const uint8_t *bytes = customData.bytes;
    uint64_t fingerprint = 14695981039346656037ULL;
    for (NSUInteger index = 0; index < customData.length; index++) {
        fingerprint = (fingerprint ^ bytes[index]) * 1099511628211ULL;
    }
    NSMutableString *signature = [NSMutableString stringWithFormat:@"%016llx-%d", fingerprint, includeOnlineHosts];
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        BOOL enabled = BrowserAdBlockSourceEnabled(source[@"id"]);
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:
            BrowserAdBlockSourceURL(source).path error:nil];
        [signature appendFormat:@"-%@-%d-%.9f-%lld", source[@"id"], enabled,
            [attributes[NSFileModificationDate] timeIntervalSince1970],
            [attributes[NSFileSize] longLongValue]];
    }
    // Use an explicit stable fingerprint for the cache shared by app launches.
    NSData *signatureData = [signature dataUsingEncoding:NSUTF8StringEncoding];
    const uint8_t *signatureBytes = signatureData.bytes;
    uint64_t signatureFingerprint = 14695981039346656037ULL;
    for (NSUInteger index = 0; index < signatureData.length; index++) {
        signatureFingerprint = (signatureFingerprint ^ signatureBytes[index]) * 1099511628211ULL;
    }
    return [kBrowserAdBlockRuleListIdentifier stringByAppendingFormat:@"-%016llx", signatureFingerprint];
}

typedef void (^BrowserAdBlockRuleListCompletion)(NSArray *ruleLists, NSError *error);

static void BrowserCompileAdBlockChunks(id store, NSString *identifier, NSArray<NSString *> *chunks,
    NSArray<NSString *> *sourceIDs, NSMutableSet<NSString *> *failedSources,
    void (^completion)(NSArray *ruleLists, NSSet<NSString *> *failedSources, NSError *error)) {
    SEL lookupSelector = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
    SEL compileSelector = NSSelectorFromString(@"compileContentRuleListForIdentifier:encodedContentRuleList:completionHandler:");
    NSMutableArray *ruleLists = [NSMutableArray arrayWithCapacity:chunks.count];
    __block NSError *lastError = nil;
    __block void (^loadChunk)(NSUInteger);
    loadChunk = ^(NSUInteger index) {
        if (index == chunks.count) {
            completion(ruleLists.count > 0 || failedSources.count == 0 ? [ruleLists copy] : nil,
                       [failedSources copy], lastError);
            loadChunk = nil;
            return;
        }
        NSString *chunkIdentifier = [identifier stringByAppendingFormat:@"-%lu", (unsigned long)index];
        void (^finishChunk)(id, NSError *) = ^(id ruleList, NSError *error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                if (ruleList == nil) {
                    NSString *sourceID = sourceIDs[index];
                    [failedSources addObject:sourceID];
                    lastError = error;
                    BrowserLog(@"[AdBlock] source=%@ chunk=%lu compile failed: %@",
                          sourceID, (unsigned long)index, error.localizedDescription ?: @"unknown error");
                    loadChunk(index + 1);
                    return;
                }
                [ruleLists addObject:ruleList];
                loadChunk(index + 1);
            });
        };
        void (^compileChunk)(void) = ^{
            ((void (*)(id, SEL, NSString *, NSString *, void (^)(id, NSError *)))objc_msgSend)(
                store, compileSelector, chunkIdentifier, chunks[index], finishChunk);
        };
        if ([store respondsToSelector:lookupSelector]) {
            ((void (*)(id, SEL, NSString *, void (^)(id, NSError *)))objc_msgSend)(
                store, lookupSelector, chunkIdentifier, ^(id ruleList, NSError *error) {
                    (void)error;
                    if (ruleList != nil) finishChunk(ruleList, nil);
                    else dispatch_async(dispatch_get_main_queue(), compileChunk);
                });
        } else {
            compileChunk();
        }
    };
    loadChunk(0);
}

// A manifest lets us look up compiled chunks before parsing or converting filters.
// Only complete, successful compilations are eligible for this fast path.
static void BrowserLookUpAdBlockManifest(id store, NSURL *manifestURL, NSString *identifier,
                                       BrowserAdBlockRuleListCompletion completion) {
    NSDictionary *manifest = [NSDictionary dictionaryWithContentsOfURL:manifestURL];
    SEL lookupSelector = NSSelectorFromString(@"lookUpContentRuleListForIdentifier:completionHandler:");
    id storedIdentifier = manifest[@"identifier"];
    id storedCount = manifest[@"chunkCount"];
    if (![storedIdentifier isKindOfClass:NSString.class] ||
        ![storedIdentifier isEqualToString:identifier] ||
        ![storedCount isKindOfClass:NSNumber.class] ||
        ![store respondsToSelector:lookupSelector]) {
        completion(nil, nil);
        return;
    }
    NSInteger count = [storedCount integerValue];
    if (count <= 0 || count > 1024) {
        completion(nil, nil);
        return;
    }
    NSMutableArray *ruleLists = [NSMutableArray arrayWithCapacity:(NSUInteger)count];
    for (NSInteger index = 0; index < count; index++) [ruleLists addObject:NSNull.null];
    __block NSInteger remaining = count;
    __block BOOL missingChunk = NO;
    for (NSInteger index = 0; index < count; index++) {
        NSString *chunkIdentifier = [identifier stringByAppendingFormat:@"-%lu", (unsigned long)index];
        ((void (*)(id, SEL, NSString *, void (^)(id, NSError *)))objc_msgSend)(
            store, lookupSelector, chunkIdentifier, ^(id ruleList, NSError *error) {
                (void)error;
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (ruleList != nil) ruleLists[(NSUInteger)index] = ruleList;
                    else missingChunk = YES;
                    remaining--;
                    if (remaining == 0) completion(missingChunk ? nil : [ruleLists copy], nil);
                });
            });
    }
}

static void BrowserLoadAdBlockRuleList(BrowserAdBlockRuleListCompletion completion) {
    static NSMutableArray *pendingCompletions = nil;
    static BOOL compiling = NO;
    if (sBrowserAdBlockCachedRuleLists != nil) {
        completion(sBrowserAdBlockCachedRuleLists, nil);
        return;
    }
    Class storeClass = NSClassFromString(@"WKContentRuleListStore");
    SEL customStoreSelector = NSSelectorFromString(@"storeWithURL:");
    SEL compileSelector = NSSelectorFromString(@"compileContentRuleListForIdentifier:encodedContentRuleList:completionHandler:");
    NSURL *cacheURL = [[[NSFileManager defaultManager] URLsForDirectory:NSCachesDirectory inDomains:NSUserDomainMask].firstObject
        URLByAppendingPathComponent:@"BrowserContentRules" isDirectory:YES];
    NSError *directoryError = nil;
    if (cacheURL != nil) {
        [[NSFileManager defaultManager] createDirectoryAtURL:cacheURL
                                  withIntermediateDirectories:YES attributes:nil error:&directoryError];
    }
    id store = cacheURL != nil && directoryError == nil && storeClass != Nil && [storeClass respondsToSelector:customStoreSelector]
        ? ((id (*)(id, SEL, NSURL *))objc_msgSend)((id)storeClass, customStoreSelector, cacheURL) : nil;
    if (store == nil || ![store respondsToSelector:compileSelector]) {
        NSError *error = [NSError errorWithDomain:@"BrowserAdBlock" code:1
                                        userInfo:@{NSLocalizedDescriptionKey: directoryError.localizedDescription ?: @"WebKit content rule lists are unavailable on this device."}];
        completion(nil, error);
        return;
    }
    if (pendingCompletions == nil) {
        pendingCompletions = [NSMutableArray array];
    }
    [pendingCompletions addObject:[completion copy]];
    if (compiling) {
        return;
    }
    compiling = YES;
    NSUInteger generation = sBrowserAdBlockRulesGeneration;
    BOOL includeOnlineHosts = NO;
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        if (BrowserAdBlockSourceEnabled(source[@"id"]) &&
            [NSFileManager.defaultManager fileExistsAtPath:BrowserAdBlockSourceURL(source).path]) {
            includeOnlineHosts = YES;
            break;
        }
    }
    NSString *identifier = BrowserAdBlockRuleListIdentifier(includeOnlineHosts);
    NSURL *manifestURL = [cacheURL URLByAppendingPathComponent:@"CompiledRulesManifest.plist"];
    void (^finishLoading)(NSArray *, NSSet<NSString *> *, NSError *) =
        ^(NSArray *ruleLists, NSSet<NSString *> *ruleFailures, NSError *error) {
        if (generation != sBrowserAdBlockRulesGeneration ||
            ![identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts)]) {
            compiling = NO;
            NSArray *callbacks = [pendingCompletions copy];
            [pendingCompletions removeAllObjects];
            for (id callbackObject in callbacks) BrowserLoadAdBlockRuleList(callbackObject);
            return;
        }
        sBrowserAdBlockRuleFailures = ruleFailures;
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        sBrowserAdBlockCachedRuleLists = ruleLists;
        compiling = NO;
        NSArray *callbacks = [pendingCompletions copy];
        [pendingCompletions removeAllObjects];
        for (id callbackObject in callbacks) {
            BrowserAdBlockRuleListCompletion callback = callbackObject;
            callback(ruleLists, error);
        }
    };
    BrowserLookUpAdBlockManifest(store, manifestURL, identifier, ^(NSArray *cachedRuleLists, NSError *error) {
        (void)error;
        if (cachedRuleLists != nil) {
            BrowserLog(@"[AdBlock] restored %lu compiled chunks without filter conversion", (unsigned long)cachedRuleLists.count);
            finishLoading(cachedRuleLists, [NSSet set], nil);
            return;
        }
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSMutableArray<NSString *> *sourceIDs = [NSMutableArray array];
            NSMutableSet<NSString *> *failedSources = [NSMutableSet set];
            NSArray<NSString *> *chunks = BrowserAdBlockRuleChunks(includeOnlineHosts, sourceIDs, failedSources);
            dispatch_async(dispatch_get_main_queue(), ^{
                if (generation != sBrowserAdBlockRulesGeneration ||
                    ![identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts)]) {
                    finishLoading(nil, [NSSet set], nil);
                    return;
                }
                if (chunks == nil) {
                    NSError *preparationError = [NSError errorWithDomain:@"BrowserAdBlock" code:2
                        userInfo:@{NSLocalizedDescriptionKey: @"Ad Block rules could not be prepared."}];
                    finishLoading(nil, [failedSources copy], preparationError);
                    return;
                }
                BrowserCompileAdBlockChunks(store, identifier, chunks, sourceIDs, failedSources,
                    ^(NSArray *ruleLists, NSSet<NSString *> *ruleFailures, NSError *compileError) {
                    if (generation == sBrowserAdBlockRulesGeneration &&
                        [identifier isEqualToString:BrowserAdBlockRuleListIdentifier(includeOnlineHosts)] &&
                        ruleFailures.count == 0 && ruleLists.count > 0 && ruleLists.count == chunks.count) {
                        [@{@"identifier": identifier, @"chunkCount": @(chunks.count)}
                            writeToURL:manifestURL atomically:YES];
                    }
                    finishLoading(ruleLists, ruleFailures, compileError);
                });
            });
        });
    });
}

static NSMutableSet<NSString *> *sBrowserAdBlockCheckingSources = nil;
static NSMutableSet<NSString *> *sBrowserAdBlockFailedSources = nil;
static BOOL sBrowserAdBlockPendingDownloadChanges = NO;

static void BrowserCheckForAdBlockUpdate(BOOL force) {
    static NSMutableDictionary<NSString *, NSDate *> *lastAttempts = nil;
    if (lastAttempts == nil) lastAttempts = [NSMutableDictionary dictionary];
    if (sBrowserAdBlockCheckingSources == nil) sBrowserAdBlockCheckingSources = [NSMutableSet set];
    if (sBrowserAdBlockFailedSources == nil) sBrowserAdBlockFailedSources = [NSMutableSet set];
    NSDate *now = NSDate.date;
    for (NSDictionary<NSString *, NSString *> *source in BrowserAdBlockSources()) {
        NSString *identifier = source[@"id"];
        if (!BrowserAdBlockSourceEnabled(identifier) ||
            [sBrowserAdBlockCheckingSources containsObject:identifier]) continue;
        NSString *checkKey = [kBrowserAdBlockSourceLastCheckKeyPrefix stringByAppendingString:identifier];
        NSDate *lastSuccess = [NSUserDefaults.standardUserDefaults objectForKey:checkKey];
        if (!force && ((lastAttempts[identifier] != nil &&
                        [now timeIntervalSinceDate:lastAttempts[identifier]] < 3600) ||
                       (lastSuccess != nil && [now timeIntervalSinceDate:lastSuccess] < 7 * 24 * 3600))) continue;
        [sBrowserAdBlockCheckingSources addObject:identifier];
        [sBrowserAdBlockFailedSources removeObject:identifier];
        lastAttempts[identifier] = now;
        [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
        NSURL *sourceURL = [NSURL URLWithString:source[@"url"]];
        NSURLSessionDataTask *task = [NSURLSession.sharedSession dataTaskWithURL:sourceURL
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            BOOL validResponse = error == nil && [response isKindOfClass:NSHTTPURLResponse.class] &&
                ((NSHTTPURLResponse *)response).statusCode == 200 && data.length > 10000 && data.length < 20000000;
            NSString *filter = validResponse ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
            BOOL validFilter = NO;
            if ([identifier isEqualToString:@"dns"]) {
                validFilter = BrowserAddAdBlockHosts([NSMutableOrderedSet orderedSet], filter) > 100000;
            } else {
                validFilter = filter.length > 10000 && [filter containsString:@"||"] &&
                    ([filter containsString:@"##"] || [filter containsString:@"@@"]);
            }
            BOOL updated = NO;
            BOOL saved = validFilter;
            if (validFilter) {
                NSURL *destination = BrowserAdBlockSourceURL(source);
                [NSFileManager.defaultManager createDirectoryAtURL:destination.URLByDeletingLastPathComponent
                    withIntermediateDirectories:YES attributes:nil error:nil];
                NSData *previous = [NSData dataWithContentsOfURL:destination];
                if (![previous isEqualToData:data]) {
                    saved = [data writeToURL:destination options:NSDataWritingAtomic error:nil];
                    updated = saved;
                }
            }
            dispatch_async(dispatch_get_main_queue(), ^{
                [sBrowserAdBlockCheckingSources removeObject:identifier];
                if (saved) {
                    [NSUserDefaults.standardUserDefaults setObject:NSDate.date forKey:checkKey];
                } else {
                    [sBrowserAdBlockFailedSources addObject:identifier];
                    BrowserLog(@"[AdBlock] source=%@ update failed: %@", identifier,
                          error.localizedDescription ?: @"invalid filter response");
                }
                [NSNotificationCenter.defaultCenter postNotificationName:BrowserAdBlockSourceStatusDidChangeNotification object:nil];
                if (updated) sBrowserAdBlockPendingDownloadChanges = YES;
                if (sBrowserAdBlockCheckingSources.count == 0 && sBrowserAdBlockPendingDownloadChanges) {
                    sBrowserAdBlockPendingDownloadChanges = NO;
                    sBrowserAdBlockRulesGeneration++;
                    sBrowserAdBlockCachedRuleLists = nil;
                    [NSNotificationCenter.defaultCenter postNotificationName:kBrowserAdBlockUpdateNotification object:nil];
                }
            });
        }];
        [task resume];
    }
}

static void BrowserCheckForAdBlockUpdateIfNeeded(void) {
    BrowserCheckForAdBlockUpdate(NO);
}

static NSString *BrowserAdBlockSourceRevision(NSURL *url) {
    NSFileHandle *file = [NSFileHandle fileHandleForReadingAtPath:url.path];
    if (file == nil) return nil;
    NSData *header = nil;
    @try {
        header = [file readDataOfLength:4096];
    } @finally {
        [file closeFile];
    }
    NSString *text = [[NSString alloc] initWithData:header encoding:NSISOLatin1StringEncoding];
    __block NSString *modified = nil;
    __block NSString *version = nil;
    [text enumerateLinesUsingBlock:^(NSString *line, BOOL *stop) {
        NSString *entry = [line stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        if ([entry hasPrefix:@"! Version:"]) {
            version = [[entry substringFromIndex:@"! Version:".length]
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
            *stop = YES;
        } else if ([entry hasPrefix:@"! Last modified:"]) {
            modified = [[entry substringFromIndex:@"! Last modified:".length]
                stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
        }
    }];
    if (version.length > 0) return [NSString stringWithFormat:@"v%@", version];
    if (modified.length >= 10) return [NSString stringWithFormat:@"Updated %@", [modified substringToIndex:10]];
    return nil;
}

@interface BrowserWebView ()

@property (nullable, nonatomic, strong) id runtimeWebView;
@property (nonatomic, readwrite) NSUInteger documentGeneration;
@property (nullable, nonatomic, strong) NSURLRequest *lastRequest;
@property (nullable, nonatomic, copy) NSString *lastTitle;
@property (nonatomic, copy) NSString *userAgent;
@property (nonatomic) BOOL loading;
@property (nonatomic, strong) id userContentController;
@property (nonatomic, copy) NSString *diagnosticToken;
@property (nonatomic, strong) NSArray *appliedAdBlockRuleLists;
@property (nonatomic, readwrite) BOOL adBlockEnabled;
@property (nonatomic, readwrite, copy) NSString *adBlockStatus;
@property (nonatomic) CGFloat lastAppliedPageZoom;
@property (nonatomic) CGFloat lastAppliedTextZoom;

@end

@implementation BrowserWebView

- (void)didMoveToWindow {
    [super didMoveToWindow];
    if (!self.window) [self setFullscreenMediaControlsSuspended:YES];
}

// ABI and command values follow WebKit's MediaRemoteSPI.h and its MediaSession
// sendMediaRemoteCommand helper. Send to system Now Playing, letting WebKit select
// the actual media session rather than guessing which DOM frame owns its handler.
- (BOOL)sendSystemMediaTrackCommand:(BOOL)nextTrack {
    if (!self.runtimeWebView || !self.window || self.loading ||
        UIApplication.sharedApplication.applicationState != UIApplicationStateActive) return NO;
    typedef Boolean (*SendCommandFunction)(uint32_t, CFDictionaryRef, void *, CFStringRef,
                                           uint32_t, dispatch_queue_t, void (^)(uint32_t, CFArrayRef));
    static SendCommandFunction sendCommand;
    static void *framework;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        framework = dlopen("/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote", RTLD_NOW | RTLD_LOCAL);
        if (framework) sendCommand = (SendCommandFunction)dlsym(framework, "MRMediaRemoteSendCommandToApp");
    });
    uint32_t command = nextTrack ? 4 : 5; // MRMediaRemoteCommandNextTrack / PreviousTrack.
    if (!sendCommand) {
        BrowserLog(@"[FullscreenMedia] systemRoute=0 command=%u", command);
        return NO;
    }
    // NULL origin/app matches WebKit's test helper: the current Now Playing client
    // can be WebKit's GPU process, so targeting our app bundle would miss it.
    Boolean accepted = sendCommand(command, NULL, NULL, NULL, 0, dispatch_get_main_queue(),
        ^(uint32_t error, CFArrayRef statuses) {
            NSArray *results = (__bridge NSArray *)statuses;
            NSNumber *status = [results.firstObject isKindOfClass:NSNumber.class] ? results.firstObject : nil;
            BrowserLog(@"[FullscreenMedia] systemReply command=%u error=%u status=%ld", command, error,
                       status ? (long)status.integerValue : -1L);
        });
    BrowserLog(@"[FullscreenMedia] systemRoute=1 command=%u accepted=%d", command, accepted);
    // Do not send a second JS command after an ambiguous system result: that can
    // advance twice if the first command already reached the player.
    return YES;
}

- (void)setFullscreenMediaControlsSuspended:(BOOL)suspended {
    NSString *script = [NSString stringWithFormat:@"window.__browserTVSetFullscreenMediaSuspended && window.__browserTVSetFullscreenMediaSuspended(%@)", suspended ? @"true" : @"false"];
    [self evaluateJavaScript:script completionHandler:^(__unused NSString *result, __unused NSError *error) {}];
}

+ (NSArray<NSDictionary<NSString *, NSString *> *> *)adBlockSources {
    return BrowserAdBlockSources();
}

+ (BOOL)adBlockSourceEnabled:(NSString *)identifier {
    return BrowserAdBlockSourceEnabled(identifier);
}

+ (void)setAdBlockSource:(NSString *)identifier enabled:(BOOL)enabled {
    BOOL known = NO;
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if ([source[@"id"] isEqualToString:identifier]) known = YES;
    }
    if (!known || BrowserAdBlockSourceEnabled(identifier) == enabled) return;
    [NSUserDefaults.standardUserDefaults setBool:enabled forKey:
        [kBrowserAdBlockSourceEnabledKeyPrefix stringByAppendingString:identifier]];
    sBrowserAdBlockRulesGeneration++;
    sBrowserAdBlockCachedRuleLists = nil;
    [NSNotificationCenter.defaultCenter postNotificationName:kBrowserAdBlockUpdateNotification object:nil];
}

+ (NSString *)adBlockSourceStatus:(NSString *)identifier {
    for (NSDictionary *source in BrowserAdBlockSources()) {
        if (![source[@"id"] isEqualToString:identifier]) continue;
        NSDictionary *attributes = [NSFileManager.defaultManager attributesOfItemAtPath:
            BrowserAdBlockSourceURL(source).path error:nil];
        NSDate *date = attributes[NSFileModificationDate];
        NSString *revision = date == nil ? nil : BrowserAdBlockSourceRevision(BrowserAdBlockSourceURL(source));
        if ([sBrowserAdBlockCheckingSources containsObject:identifier]) {
            return revision == nil ? @"Updating" : [NSString stringWithFormat:@"%@ · Updating", revision];
        }
        if ([sBrowserAdBlockFailedSources containsObject:identifier]) {
            return revision == nil ? @"Update failed" : [NSString stringWithFormat:@"%@ · Update failed", revision];
        }
        if ([sBrowserAdBlockRuleFailures containsObject:identifier]) {
            return revision == nil ? @"Rule error" : [NSString stringWithFormat:@"%@ · Rule error", revision];
        }
        if (date == nil) return @"Not downloaded";
        if (revision != nil) return revision;
        NSDateFormatter *formatter = [NSDateFormatter new];
        formatter.dateStyle = NSDateFormatterShortStyle;
        return [NSString stringWithFormat:@"Updated %@", [formatter stringFromDate:date]];
    }
    return @"Unknown source";
}

+ (void)refreshAdBlockSources {
    BrowserCheckForAdBlockUpdate(YES);
}

- (instancetype)initWithFrame:(CGRect)frame {
    return [self initWithUserAgent:nil allowsInlineMediaPlayback:YES];
}

- (instancetype)initWithCoder:(NSCoder *)coder {
    self = [super initWithCoder:coder];
    if (self) {
        [self commonInitWithUserAgent:nil allowsInlineMediaPlayback:YES];
    }
    return self;
}

- (instancetype)initWithUserAgent:(NSString *)userAgent allowsInlineMediaPlayback:(BOOL)allowsInlineMediaPlayback {
    self = [super initWithFrame:CGRectZero];
    if (self) {
        [self commonInitWithUserAgent:userAgent allowsInlineMediaPlayback:allowsInlineMediaPlayback];
    }
    return self;
}

- (void)commonInitWithUserAgent:(NSString *)userAgent allowsInlineMediaPlayback:(BOOL)allowsInlineMediaPlayback {
    BrowserEnsureWebKitRuntimeLoaded();

    self.backgroundColor = UIColor.blackColor;
    self.userAgent = userAgent;
    self.pageZoomFactor = 1.0;
    self.textZoomFactor = 1.0;

    Class configurationClass = NSClassFromString(kBrowserWebViewConfigurationClassName);
    Class webViewClass = NSClassFromString(kBrowserWebViewClassName);
    if (configurationClass == Nil || webViewClass == Nil) {
        return;
    }

    id configuration = ((id (*)(id, SEL))objc_msgSend)((id)configurationClass, @selector(new));
    SEL allowsInlineMediaPlaybackSelector = NSSelectorFromString(@"setAllowsInlineMediaPlayback:");
    if (configuration != nil && [configuration respondsToSelector:allowsInlineMediaPlaybackSelector]) {
        ((void (*)(id, SEL, BOOL))objc_msgSend)(configuration, allowsInlineMediaPlaybackSelector, allowsInlineMediaPlayback);
    }
    SEL dataStoreSetter = NSSelectorFromString(@"setWebsiteDataStore:");
    id dataStore = BrowserPersistentWebsiteDataStore();
    if (dataStore && [configuration respondsToSelector:dataStoreSetter])
        ((void (*)(id, SEL, id))objc_msgSend)(configuration, dataStoreSetter, dataStore);
    BrowserConfigurePrivateMediaPreferences(configuration);
    self.diagnosticToken = [@"browserDiagnostics_" stringByAppendingString:NSUUID.UUID.UUIDString];
    BrowserInstallUserScripts(configuration, self.diagnosticToken, self);
    SEL userContentControllerSelector = NSSelectorFromString(@"userContentController");
    if ([configuration respondsToSelector:userContentControllerSelector]) {
        self.userContentController = ((id (*)(id, SEL))objc_msgSend)(configuration, userContentControllerSelector);
    }

    id webViewObject = ((id (*)(id, SEL))objc_msgSend)((id)webViewClass, @selector(alloc));
    SEL initializer = NSSelectorFromString(@"initWithFrame:configuration:");
    webViewObject = ((id (*)(id, SEL, CGRect, id))objc_msgSend)(webViewObject, initializer, self.bounds, configuration);
    if (webViewObject == nil) {
        return;
    }

    self.runtimeWebView = webViewObject;
    [webViewObject addObserver:self forKeyPath:@"URL" options:0 context:&kBrowserNavigationURLObservationContext];
    [webViewObject addObserver:self forKeyPath:@"loading" options:0 context:&kBrowserNavigationURLObservationContext];
    UIView *runtimeView = (UIView *)webViewObject;
    runtimeView.frame = self.bounds;
    runtimeView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    runtimeView.backgroundColor = UIColor.blackColor;

    SEL navigationDelegateSelector = NSSelectorFromString(@"setNavigationDelegate:");
    if ([webViewObject respondsToSelector:navigationDelegateSelector]) {
        ((void (*)(id, SEL, id))objc_msgSend)(webViewObject, navigationDelegateSelector, self);
    }

    SEL UIDelegateSelector = NSSelectorFromString(@"setUIDelegate:");
    if ([webViewObject respondsToSelector:UIDelegateSelector]) {
        ((void (*)(id, SEL, id))objc_msgSend)(webViewObject, UIDelegateSelector, self);
    }

    [self addSubview:runtimeView];
    [self setUserAgent:userAgent];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(adBlockRulesDidUpdate:)
                                                 name:kBrowserAdBlockUpdateNotification object:nil];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(websiteDiagnosticsDidChange:)
                                                 name:BrowserDebugEnabledDidChangeNotification object:nil];
    [self setAdBlockEnabled:[[NSUserDefaults standardUserDefaults] boolForKey:kBrowserAdBlockEnabledDefaultsKey]];
}


- (void)websiteDiagnosticsDidChange:(NSNotification *)notification {
    (void)notification;
    if (!NSThread.isMainThread) {
        __weak typeof(self) weakSelf = self;
        dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf websiteDiagnosticsDidChange:nil]; });
        return;
    }
    BOOL enabled = BrowserPreferencesStore.websiteLoggingEnabled;
    // Replace only the diagnostics bootstrap for future documents; retain every other script.
    SEL scriptsSelector = NSSelectorFromString(@"userScripts");
    SEL removeSelector = NSSelectorFromString(@"removeAllUserScripts");
    SEL addSelector = NSSelectorFromString(@"addUserScript:");
    id controller = self.userContentController;
    if ([controller respondsToSelector:scriptsSelector] && [controller respondsToSelector:removeSelector] &&
        [controller respondsToSelector:addSelector]) {
        NSArray *scripts = [((id (*)(id, SEL))objc_msgSend)(controller, scriptsSelector) copy];
        NSMutableArray *updated = [NSMutableArray array];
        for (id script in scripts) {
            NSString *source = [script valueForKey:@"source"];
            if ([source hasPrefix:@"/* BrowserWebsiteDiagnostics */"]) {
                SEL initializer = NSSelectorFromString(@"initWithSource:injectionTime:forMainFrameOnly:");
                id replacement = ((id (*)(id, SEL))objc_msgSend)((id)[script class], @selector(alloc));
                replacement = ((id (*)(id, SEL, id, NSInteger, BOOL))objc_msgSend)(replacement, initializer,
                    BrowserWebsiteDiagnosticsScript(self.diagnosticToken, enabled), 0, NO);
                if (replacement == nil) return;
                [updated addObject:replacement];
            } else {
                [updated addObject:script];
            }
        }
        ((void (*)(id, SEL))objc_msgSend)(controller, removeSelector);
        for (id script in updated) ((void (*)(id, SEL, id))objc_msgSend)(controller, addSelector, script);
    }
    // Existing cross-origin frames receive the setting through the lightweight bootstrap.
    NSString *script = [NSString stringWithFormat:@"if(typeof window['%@']==='function')window['%@'](%@);",
        self.diagnosticToken, self.diagnosticToken, enabled ? @"true" : @"false"];
    [self evaluateJavaScript:script completion:nil];
}

- (void)adBlockRulesDidUpdate:(NSNotification *)notification {
    (void)notification;
    if (self.adBlockEnabled) {
        [self setAdBlockEnabled:YES];
    }
}

- (void)setAdBlockEnabled:(BOOL)enabled {
    _adBlockEnabled = enabled;
    if (!enabled) {
        NSArray *ruleLists = self.appliedAdBlockRuleLists;
        SEL removeSelector = NSSelectorFromString(@"removeContentRuleList:");
        SEL removeAllSelector = NSSelectorFromString(@"removeAllContentRuleLists");
        if (ruleLists.count > 0) {
            if ([self.userContentController respondsToSelector:removeAllSelector]) {
                ((void (*)(id, SEL))objc_msgSend)(self.userContentController, removeAllSelector);
            } else if ([self.userContentController respondsToSelector:removeSelector]) {
                for (id ruleList in ruleLists) {
                    ((void (*)(id, SEL, id))objc_msgSend)(self.userContentController, removeSelector, ruleList);
                }
            } else {
                self.adBlockStatus = @"removal-unavailable";
                BrowserLog(@"[AdBlock] cannot remove content rules from this WebKit view");
                return;
            }
            self.appliedAdBlockRuleLists = nil;
            if (self.request != nil) {
                [self reload];
            }
        }
        self.adBlockStatus = @"off";
        return;
    }

    self.adBlockStatus = @"loading";
    __weak typeof(self) weakSelf = self;
    BrowserLoadAdBlockRuleList(^(NSArray *ruleLists, NSError *error) {
        BrowserWebView *strongSelf = weakSelf;
        if (strongSelf == nil || !strongSelf.adBlockEnabled) {
            return;
        }
        SEL addSelector = NSSelectorFromString(@"addContentRuleList:");
        if (ruleLists == nil || ![strongSelf.userContentController respondsToSelector:addSelector]) {
            strongSelf.adBlockStatus = @"unavailable";
            BrowserLog(@"[AdBlock] unavailable: %@", error ?: @"WKUserContentController cannot install rule lists");
            return;
        }
        if (ruleLists.count == 0) {
            if (strongSelf.appliedAdBlockRuleLists.count > 0) {
                SEL removeAllSelector = NSSelectorFromString(@"removeAllContentRuleLists");
                if ([strongSelf.userContentController respondsToSelector:removeAllSelector]) {
                    ((void (*)(id, SEL))objc_msgSend)(strongSelf.userContentController, removeAllSelector);
                }
                strongSelf.appliedAdBlockRuleLists = nil;
                if (strongSelf.request != nil) [strongSelf reload];
            }
            strongSelf.adBlockStatus = @"loading";
            BrowserCheckForAdBlockUpdateIfNeeded();
            return;
        }
        if ([strongSelf.appliedAdBlockRuleLists isEqualToArray:ruleLists]) {
            strongSelf.adBlockStatus = @"on";
            BrowserCheckForAdBlockUpdateIfNeeded();
            return;
        }
        NSArray *previousRuleLists = strongSelf.appliedAdBlockRuleLists;
        SEL removeSelector = NSSelectorFromString(@"removeContentRuleList:");
        SEL removeAllSelector = NSSelectorFromString(@"removeAllContentRuleLists");
        if (previousRuleLists.count > 0 && [strongSelf.userContentController respondsToSelector:removeAllSelector]) {
            ((void (*)(id, SEL))objc_msgSend)(strongSelf.userContentController, removeAllSelector);
        } else if (previousRuleLists.count > 0 && [strongSelf.userContentController respondsToSelector:removeSelector]) {
            for (id previousRuleList in previousRuleLists) {
                ((void (*)(id, SEL, id))objc_msgSend)(strongSelf.userContentController, removeSelector, previousRuleList);
            }
        } else if (previousRuleLists.count > 0) {
            strongSelf.adBlockStatus = @"removal-unavailable";
            return;
        }
        for (id ruleList in ruleLists) {
            ((void (*)(id, SEL, id))objc_msgSend)(strongSelf.userContentController, addSelector, ruleList);
        }
        strongSelf.appliedAdBlockRuleLists = ruleLists;
        strongSelf.adBlockStatus = @"on";
        BrowserCheckForAdBlockUpdateIfNeeded();
        if (strongSelf.request != nil) {
            [strongSelf reload];
        }
    });
}

- (void)layoutSubviews {
    [super layoutSubviews];
    ((UIView *)self.runtimeWebView).frame = self.bounds;
    [self applyPageScalingIfNeeded];
}

- (void)setUserInteractionEnabled:(BOOL)userInteractionEnabled {
    [super setUserInteractionEnabled:userInteractionEnabled];

    UIView *runtimeView = (UIView *)self.runtimeWebView;
    runtimeView.userInteractionEnabled = userInteractionEnabled;

    UIScrollView *scrollView = [self scrollView];
    scrollView.userInteractionEnabled = userInteractionEnabled;
}

- (UIScrollView *)scrollView {
    SEL selector = NSSelectorFromString(@"scrollView");
    if (self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:selector]) {
        return nil;
    }
    return ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
}

- (NSURL *)currentURL {
    SEL selector = NSSelectorFromString(@"URL");
    if (self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:selector]) {
        return nil;
    }
    return ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
}

- (NSURLRequest *)request {
    NSURL *currentURL = [self currentURL];
    if (currentURL != nil) {
        return [NSURLRequest requestWithURL:currentURL];
    }
    return self.lastRequest;
}

- (NSString *)title {
    SEL selector = NSSelectorFromString(@"title");
    if (self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:selector]) {
        return self.lastTitle;
    }
    NSString *title = ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
    return title ?: self.lastTitle;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:self name:kBrowserAdBlockUpdateNotification object:nil];
    [NSNotificationCenter.defaultCenter removeObserver:self name:BrowserDebugEnabledDidChangeNotification object:nil];
    [self.runtimeWebView removeObserver:self forKeyPath:@"URL" context:&kBrowserNavigationURLObservationContext];
    [self.runtimeWebView removeObserver:self forKeyPath:@"loading" context:&kBrowserNavigationURLObservationContext];
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object
                      change:(NSDictionary *)change context:(void *)context {
    if (context != &kBrowserNavigationURLObservationContext) {
        [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
        return;
    }
    __weak typeof(self) weakSelf = self;
    dispatch_async(dispatch_get_main_queue(), ^{
        BrowserWebView *webView = weakSelf;
        SEL loadingSelector = NSSelectorFromString(@"isLoading");
        if (webView == nil || webView.loading ||
            ([webView.runtimeWebView respondsToSelector:loadingSelector] &&
             ((BOOL (*)(id, SEL))objc_msgSend)(webView.runtimeWebView, loadingSelector))) return;
        [webView applyDomainZoomForURL:[webView request].URL];
        if ([webView.delegate respondsToSelector:@selector(webViewDidChangeNavigationHistory:)]) {
            [webView.delegate webViewDidChangeNavigationHistory:webView];
        }
    });
}

- (NSDictionary *)navigationHistorySnapshot {
    SEL listSelector = NSSelectorFromString(@"backForwardList");
    if (![self.runtimeWebView respondsToSelector:listSelector]) return nil;
    id list = ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, listSelector);
    SEL backSelector = NSSelectorFromString(@"backList");
    SEL currentSelector = NSSelectorFromString(@"currentItem");
    SEL forwardSelector = NSSelectorFromString(@"forwardList");
    if (![list respondsToSelector:backSelector] || ![list respondsToSelector:currentSelector] ||
        ![list respondsToSelector:forwardSelector]) return nil;
    id current = ((id (*)(id, SEL))objc_msgSend)(list, currentSelector);
    if (current == nil) return nil;
    NSMutableArray *items = [NSMutableArray arrayWithArray:((id (*)(id, SEL))objc_msgSend)(list, backSelector)];
    [items addObject:current];
    [items addObjectsFromArray:((id (*)(id, SEL))objc_msgSend)(list, forwardSelector)];
    NSMutableArray *URLs = [NSMutableArray array];
    NSInteger index = NSNotFound;
    for (id item in items) {
        SEL URLSelector = NSSelectorFromString(@"URL");
        if (![item respondsToSelector:URLSelector]) continue;
        NSURL *URL = ((id (*)(id, SEL))objc_msgSend)(item, URLSelector);
        if (URL.host.length == 0 || ![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString]) continue;
        if (item == current) index = URLs.count;
        [URLs addObject:URL.absoluteString];
    }
    if (index == NSNotFound) return nil;
    return @{@"navigationURLs": URLs, @"navigationIndex": @(index)};
}

- (BOOL)canGoBack {
    SEL selector = NSSelectorFromString(@"canGoBack");
    return self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector] ? ((BOOL (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector) : NO;
}

- (BOOL)canGoForward {
    SEL selector = NSSelectorFromString(@"canGoForward");
    return self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector] ? ((BOOL (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector) : NO;
}

- (NSString *)URLStringForHistoryItemSelector:(SEL)itemSelector {
    SEL listSelector = NSSelectorFromString(@"backForwardList");
    if (self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:listSelector]) return nil;
    id list = ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, listSelector);
    if (![list respondsToSelector:itemSelector]) return nil;
    id item = ((id (*)(id, SEL))objc_msgSend)(list, itemSelector);
    SEL URLSelector = NSSelectorFromString(@"URL");
    if (![item respondsToSelector:URLSelector]) return nil;
    NSURL *URL = ((id (*)(id, SEL))objc_msgSend)(item, URLSelector);
    return URL.absoluteString;
}

- (NSString *)backURLString {
    return [self URLStringForHistoryItemSelector:NSSelectorFromString(@"backItem")];
}

- (NSString *)forwardURLString {
    return [self URLStringForHistoryItemSelector:NSSelectorFromString(@"forwardItem")];
}

- (void)loadRequest:(NSURLRequest *)request {
    self.documentGeneration += 1;
    if (request == nil || self.runtimeWebView == nil) {
        return;
    }
    self.lastRequest = request;
    [self applyDomainZoomForURL:request.URL];
    SEL selector = NSSelectorFromString(@"loadRequest:");
    if ([self.runtimeWebView respondsToSelector:selector]) {
        ((id (*)(id, SEL, id))objc_msgSend)(self.runtimeWebView, selector, request);
    }
}

- (void)loadHTMLString:(NSString *)HTMLString {
    self.documentGeneration += 1;
    if (self.runtimeWebView == nil || HTMLString.length == 0) {
        return;
    }
    SEL selector = NSSelectorFromString(@"loadHTMLString:baseURL:");
    if ([self.runtimeWebView respondsToSelector:selector]) {
        self.lastRequest = [NSURLRequest requestWithURL:[NSURL URLWithString:@"about:blank"]];
        ((id (*)(id, SEL, id, id))objc_msgSend)(self.runtimeWebView, selector, HTMLString, nil);
    }
}

- (void)reload {
    self.documentGeneration += 1;
    SEL selector = NSSelectorFromString(@"reload");
    if (self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector]) {
        ((void (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
    }
}

- (void)stopLoading {
    self.documentGeneration += 1;
    SEL selector = NSSelectorFromString(@"stopLoading");
    if (self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector]) {
        ((void (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
    }
    self.loading = NO;
}

- (void)goBack {
    self.documentGeneration += 1;
    SEL selector = NSSelectorFromString(@"goBack");
    if (self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector]) {
        ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
    }
}

- (void)goForward {
    self.documentGeneration += 1;
    SEL selector = NSSelectorFromString(@"goForward");
    if (self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector]) {
        ((id (*)(id, SEL))objc_msgSend)(self.runtimeWebView, selector);
    }
}

- (NSString *)stringByEvaluatingJavaScriptFromString:(NSString *)script {
    if (script.length == 0 || self.runtimeWebView == nil) {
        return nil;
    }

    SEL selector = NSSelectorFromString(@"evaluateJavaScript:completionHandler:");
    if (![self.runtimeWebView respondsToSelector:selector]) {
        return nil;
    }

    __block id evaluationResult = nil;
    __block NSError *evaluationError = nil;
    __block BOOL finished = NO;
    ((void (*)(id, SEL, id, id))objc_msgSend)(self.runtimeWebView, selector, script, ^(id result, NSError *error) {
        evaluationResult = result;
        evaluationError = error;
        finished = YES;
    });
    if (!BrowserPumpRunLoopUntil(&finished)) {
        return nil;
    }

    if (evaluationError != nil) {
        return nil;
    }
    return BrowserStringFromJavaScriptResult(evaluationResult);
}

- (void)evaluateJavaScript:(NSString *)script completion:(void (^)(NSString *result))completion {
    SEL selector = NSSelectorFromString(@"evaluateJavaScript:completionHandler:");
    if (script.length == 0 || self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:selector]) {
        if (completion != nil) {
            completion(nil);
        }
        return;
    }

    ((void (*)(id, SEL, id, id))objc_msgSend)(self.runtimeWebView, selector, script, ^(id result, NSError *error) {
        if (completion != nil) {
            completion(error == nil ? BrowserStringFromJavaScriptResult(result) : nil);
        }
    });
}

- (void)evaluateJavaScript:(NSString *)script
        completionHandler:(void (^)(NSString *result, NSError *error))completion {
    if (![NSThread isMainThread]) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self evaluateJavaScript:script completionHandler:completion];
        });
        return;
    }
    id runtime = self.runtimeWebView;
    NSUInteger generation = self.documentGeneration;
    NSURL *URL = [self request].URL;
    __weak typeof(self) weakSelf = self;
    __block BOOL finished = NO;
    __block void (^callback)(NSString *, NSError *) = [completion copy];
    void (^finish)(id, NSError *) = ^(id result, NSError *error) {
        if (finished) { return; }
        finished = YES;
        BrowserWebView *webView = weakSelf;
        NSURL *currentURL = [webView request].URL;
        BOOL sameURL = URL == currentURL || [URL isEqual:currentURL];
        if (webView == nil || webView.runtimeWebView != runtime ||
            webView.documentGeneration != generation || !sameURL) {
            error = [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil];
        }
        void (^reply)(NSString *, NSError *) = callback;
        callback = nil;
        if (reply != nil) { reply(error == nil ? BrowserStringFromJavaScriptResult(result) : nil, error); }
    };
    SEL selector = NSSelectorFromString(@"evaluateJavaScript:completionHandler:");
    if (script.length == 0 || runtime == nil || ![runtime respondsToSelector:selector]) {
        finish(nil, [NSError errorWithDomain:@"BrowserJavaScript" code:1 userInfo:nil]);
        return;
    }
    ((void (*)(id, SEL, id, id))objc_msgSend)(runtime, selector, script, ^(id result, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{ finish(result, error); });
    });
    // Bound the reply without pumping a nested run loop or blocking the caller.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2.0 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        finish(nil, [NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorTimedOut userInfo:nil]);
    });
}

- (void)pauseAllMediaPlayback {
    if (self.runtimeWebView == nil) {
        return;
    }

    // Prefer WebKit's internal media pause APIs when available.
    SEL pauseWithCompletionHandlerSelector = NSSelectorFromString(@"pauseAllMediaPlaybackWithCompletionHandler:");
    if ([self.runtimeWebView respondsToSelector:pauseWithCompletionHandlerSelector]) {
        ((void (*)(id, SEL, id))objc_msgSend)(self.runtimeWebView, pauseWithCompletionHandlerSelector, nil);
    } else {
        SEL pauseSelector = NSSelectorFromString(@"pauseAllMediaPlayback:");
        if ([self.runtimeWebView respondsToSelector:pauseSelector]) {
            ((void (*)(id, SEL, id))objc_msgSend)(self.runtimeWebView, pauseSelector, nil);
        } else {
            SEL privatePauseSelector = NSSelectorFromString(@"_pauseAllMediaPlayback");
            if ([self.runtimeWebView respondsToSelector:privatePauseSelector]) {
                ((void (*)(id, SEL))objc_msgSend)(self.runtimeWebView, privatePauseSelector);
            }
        }
    }

    // JS fallback for page media elements and common iframe-based players.
    NSString *pauseScript =
        @"(function(){"
            "function safe(fn){ try { fn(); } catch (error) {} }"
            "var media = document.querySelectorAll('video,audio');"
            "for (var i = 0; i < media.length; i++) {"
                "var element = media[i];"
                "safe(function(){ element.pause(); });"
                "safe(function(){ element.autoplay = false; });"
                "safe(function(){ element.removeAttribute('autoplay'); });"
            "}"
            "var iframePlayers = document.querySelectorAll('iframe');"
            "for (var j = 0; j < iframePlayers.length; j++) {"
                "var frame = iframePlayers[j];"
                "var src = String(frame.src || '').toLowerCase();"
                "if (!src) { continue; }"
                "safe(function(){"
                    "if (src.indexOf('youtube.com') !== -1 || src.indexOf('youtube-nocookie.com') !== -1) {"
                        "frame.contentWindow.postMessage(JSON.stringify({event:'command',func:'pauseVideo',args:''}), '*');"
                    "}"
                "});"
                "safe(function(){"
                    "if (src.indexOf('vimeo.com') !== -1) {"
                        "frame.contentWindow.postMessage(JSON.stringify({method:'pause'}), '*');"
                    "}"
                "});"
            "}"
        "})();";
    [self evaluateJavaScript:pauseScript completionHandler:^(__unused NSString *result, __unused NSError *error) {}];
}

- (NSString *)runtimeMediaPreferenceReport {
    if (self.runtimeWebView == nil) {
        return @"Runtime web view unavailable.";
    }

    NSArray<NSDictionary<NSString *, NSString *> *> *objectSelectors = @[
        @{@"label": @"WKWebView", @"selector": @""},
        @{@"label": @"Configuration", @"selector": @"configuration"},
        @{@"label": @"Configuration._preferences", @"selector": @"configuration._preferences"},
        @{@"label": @"Configuration.preferences", @"selector": @"configuration.preferences"},
        @{@"label": @"Configuration.defaultWebpagePreferences", @"selector": @"configuration.defaultWebpagePreferences"},
        @{@"label": @"Configuration.websiteDataStore", @"selector": @"configuration.websiteDataStore"},
        @{@"label": @"WKWebView._configuration", @"selector": @"_configuration"},
        @{@"label": @"WKWebView._page", @"selector": @"_page"},
    ];

    NSMutableDictionary<NSValue *, NSString *> *seenObjects = [NSMutableDictionary dictionary];
    NSMutableString *report = [NSMutableString string];

    for (NSDictionary<NSString *, NSString *> *entry in objectSelectors) {
        NSString *label = entry[@"label"] ?: @"Object";
        NSString *selectorPath = entry[@"selector"] ?: @"";
        id currentObject = self.runtimeWebView;

        if (selectorPath.length > 0) {
            NSArray<NSString *> *components = [selectorPath componentsSeparatedByString:@"."];
            for (NSString *component in components) {
                currentObject = BrowserObjectResultForGetter(currentObject, component);
                if (currentObject == nil) {
                    break;
                }
            }
        }

        if (currentObject == nil) {
            [report appendFormat:@"[%@] unavailable\n\n", label];
            continue;
        }

        NSValue *objectKey = [NSValue valueWithNonretainedObject:currentObject];
        NSString *previousLabel = seenObjects[objectKey];
        if (previousLabel != nil) {
            [report appendFormat:@"[%@] same object as %@ (%@)\n\n", label, previousLabel, NSStringFromClass([currentObject class])];
            continue;
        }
        seenObjects[objectKey] = label;

        NSArray<NSString *> *selectorNames = BrowserFilteredSelectorNamesForClass([currentObject class]);
        NSMutableArray<NSString *> *booleanLines = [NSMutableArray array];
        for (NSString *selectorName in selectorNames) {
            NSString *getterName = nil;
            if ([selectorName hasPrefix:@"set"] && [selectorName hasSuffix:@":"]) {
                getterName = BrowserGetterNameFromSetterName(selectorName);
            } else {
                getterName = selectorName;
            }

            NSString *valueDescription = BrowserBooleanValueDescriptionForObjectAndSelector(currentObject, getterName);
            if (valueDescription != nil) {
                [booleanLines addObject:[NSString stringWithFormat:@"%@ = %@", getterName, valueDescription]];
            }
        }

        [report appendFormat:@"[%@] %@\n", label, NSStringFromClass([currentObject class])];
        if (booleanLines.count > 0) {
            [report appendString:@"Boolean getters:\n"];
            for (NSString *line in booleanLines) {
                [report appendFormat:@"- %@\n", line];
            }
        } else {
            [report appendString:@"Boolean getters:\n- none resolved\n"];
        }

        [report appendString:@"Matching selectors:\n"];
        if (selectorNames.count == 0) {
            [report appendString:@"- none\n\n"];
            continue;
        }

        for (NSString *selectorName in selectorNames) {
            [report appendFormat:@"- %@\n", selectorName];
        }

        if ([label isEqualToString:@"Configuration.preferences"]) {
            NSArray<NSDictionary<NSString *, NSString *> *> *featureEntries = BrowserFeatureEntriesForPreferences(currentObject);
            [report appendString:@"Feature entries:\n"];
            if (featureEntries.count == 0) {
                [report appendString:@"- none\n"];
            } else {
                for (NSDictionary<NSString *, NSString *> *featureEntry in featureEntries) {
                    NSString *featureSource = featureEntry[@"source"] ?: @"features";
                    NSString *featureName = featureEntry[@"name"] ?: @"Unknown";
                    NSString *featureEnabled = featureEntry[@"enabled"] ?: @"unknown";
                    NSString *featureKey = featureEntry[@"key"];
                    if (featureKey.length > 0) {
                        [report appendFormat:@"- [%@] %@ (%@) = %@\n", featureSource, featureName, featureKey, featureEnabled];
                    } else {
                        [report appendFormat:@"- [%@] %@ = %@\n", featureSource, featureName, featureEnabled];
                    }
                }
            }
        }
        [report appendString:@"\n"];
    }

    return BrowserPreviewString(report, 24000);
}



- (void)setUserAgent:(NSString *)userAgent {
    _userAgent = [userAgent copy];
    SEL selector = NSSelectorFromString(@"setCustomUserAgent:");
    if (self.runtimeWebView != nil && [self.runtimeWebView respondsToSelector:selector]) {
        ((void (*)(id, SEL, id))objc_msgSend)(self.runtimeWebView, selector, _userAgent);
    }
}

- (void)applyDomainZoomForURL:(NSURL *)URL {
    self.pageZoomFactor = [[BrowserPreferencesStore new] pageZoomPercentForURL:URL] / 100.0;
}

- (void)setPageZoomFactor:(CGFloat)pageZoomFactor {
    CGFloat nextFactor = MIN(2.0, MAX(0.5, pageZoomFactor));
    if (fabs(_pageZoomFactor - nextFactor) < 0.001) {
        return;
    }
    _pageZoomFactor = nextFactor;
    [self applyPageScalingIfNeeded];
}

- (void)setTextZoomFactor:(CGFloat)textZoomFactor {
    CGFloat nextFactor = MIN(2.0, MAX(0.5, textZoomFactor));
    if (fabs(_textZoomFactor - nextFactor) < 0.001) {
        return;
    }
    _textZoomFactor = nextFactor;
    [self applyTextZoomIfNeeded];
}

- (void)applyTextZoomIfNeeded {
    if (self.runtimeWebView == nil || fabs(self.lastAppliedTextZoom - self.textZoomFactor) < 0.001) {
        return;
    }
    SEL setter = NSSelectorFromString(@"_setTextZoomFactor:");
    SEL supportQuery = NSSelectorFromString(@"_supportsTextZoom");
    BOOL hasSetter = [self.runtimeWebView respondsToSelector:setter];
    BOOL supportsTextZoom = ![self.runtimeWebView respondsToSelector:supportQuery] ||
        ((BOOL (*)(id, SEL))objc_msgSend)(self.runtimeWebView, supportQuery);
    if (!hasSetter || !supportsTextZoom) {
        return;
    }
    self.lastAppliedTextZoom = self.textZoomFactor;
    ((void (*)(id, SEL, double))objc_msgSend)(self.runtimeWebView, setter, self.textZoomFactor);
}

- (void)applyPageScalingIfNeeded {
    if (self.runtimeWebView == nil) {
        return;
    }

    UIScrollView *scrollView = [self scrollView];
    if (scrollView == nil || CGRectIsEmpty(scrollView.bounds)) {
        return;
    }

    CGFloat zoomValue = self.pageZoomFactor;

    if (fabs(self.lastAppliedPageZoom - zoomValue) < 0.001) {
        return;
    }
    SEL pageZoomSelector = NSSelectorFromString(@"setPageZoom:");
    BOOL supportsPageZoom = [self.runtimeWebView respondsToSelector:pageZoomSelector];
    BOOL appliedViewScale = NO;
    @try {
        // Firefox iOS uses WebKit's viewScale. On tvOS, pageZoom changes the
        // viewport but compensates font sizes, so it does not enlarge text.
        if (supportsPageZoom) {
            ((void (*)(id, SEL, double))objc_msgSend)(self.runtimeWebView, pageZoomSelector, 1.0);
        }
        [self.runtimeWebView setValue:@(zoomValue) forKey:@"viewScale"];
        appliedViewScale = YES;
    } @catch (__unused NSException *exception) {
        // Older WebKit runtimes may not expose the KVC key.
    }

    if (appliedViewScale) {
        self.textZoomFactor = 1.0;
        self.lastAppliedPageZoom = zoomValue;
    } else if (supportsPageZoom) {
        ((void (*)(id, SEL, double))objc_msgSend)(self.runtimeWebView, pageZoomSelector, zoomValue);
        self.textZoomFactor = zoomValue;
        self.lastAppliedPageZoom = zoomValue;
    }
}

- (void)captureSnapshotWithCompletion:(void (^)(UIImage *snapshot))completion {
    SEL selector = NSSelectorFromString(@"takeSnapshotWithConfiguration:completionHandler:");
    if (self.runtimeWebView == nil || ![self.runtimeWebView respondsToSelector:selector]) {
        if (completion != nil) {
            completion(nil);
        }
        return;
    }
    ((void (*)(id, SEL, id, id))objc_msgSend)(self.runtimeWebView, selector, nil, ^(UIImage *snapshot, NSError *error) {
        if (completion != nil) {
            completion(error == nil ? snapshot : nil);
        }
    });
}

- (void)captureSnapshotInRect:(CGRect)rect
                       width:(CGFloat)width
                  completion:(void (^)(UIImage *snapshot))completion {
    SEL snapshotSelector = NSSelectorFromString(@"takeSnapshotWithConfiguration:completionHandler:");
    Class configurationClass = NSClassFromString(@"WKSnapshotConfiguration");
    if (self.runtimeWebView == nil || configurationClass == Nil ||
        ![self.runtimeWebView respondsToSelector:snapshotSelector]) {
        if (completion != nil) { completion(nil); }
        return;
    }
    id configuration = ((id (*)(id, SEL))objc_msgSend)((id)configurationClass, @selector(new));
    SEL rectSelector = NSSelectorFromString(@"setRect:");
    SEL widthSelector = NSSelectorFromString(@"setSnapshotWidth:");
    if (![configuration respondsToSelector:rectSelector] || ![configuration respondsToSelector:widthSelector]) {
        if (completion != nil) { completion(nil); }
        return;
    }
    ((void (*)(id, SEL, CGRect))objc_msgSend)(configuration, rectSelector, rect);
    ((void (*)(id, SEL, id))objc_msgSend)(configuration, widthSelector, @(width));
    ((id (*)(id, SEL, id, id))objc_msgSend)(self.runtimeWebView, snapshotSelector, configuration,
        ^(UIImage *snapshot, NSError *error) {
            if (completion != nil) {
                completion(error == nil ? snapshot : nil);
            }
        });
}

- (void)webView:(id)webView didStartProvisionalNavigation:(id)navigation {
    self.documentGeneration += 1;
    self.loading = YES;
    if ([self.delegate respondsToSelector:@selector(webViewDidStartLoad:)]) {
        [self.delegate webViewDidStartLoad:self];
    }
}

- (void)webView:(id)webView didCommitNavigation:(id)navigation {
    self.documentGeneration += 1;
    [self applyDomainZoomForURL:[self request].URL];
}

- (void)webView:(id)webView didFinishNavigation:(id)navigation {
    self.loading = NO;
    if (self.adBlockEnabled && [self.adBlockStatus isEqualToString:@"on"]) {
        BrowserCheckForAdBlockUpdateIfNeeded();
    }
    self.lastTitle = [self title];
    self.lastRequest = [self request];
    [self applyDomainZoomForURL:self.lastRequest.URL];
    self.lastAppliedPageZoom = 0.0;
    self.lastAppliedTextZoom = 0.0;
    [self applyPageScalingIfNeeded];
    [self applyTextZoomIfNeeded];
    if ([self.delegate respondsToSelector:@selector(webViewDidFinishLoad:)]) {
        [self.delegate webViewDidFinishLoad:self];
    }
}

- (void)webView:(id)webView didFailNavigation:(id)navigation withError:(NSError *)error {
    self.loading = NO;
    if ([self.delegate respondsToSelector:@selector(webView:didFailLoadWithError:)]) {
        [self.delegate webView:self didFailLoadWithError:error];
    }
}

- (void)webView:(id)webView didFailProvisionalNavigation:(id)navigation withError:(NSError *)error {
    self.loading = NO;
    if ([self.delegate respondsToSelector:@selector(webView:didFailLoadWithError:)]) {
        [self.delegate webView:self didFailLoadWithError:error];
    }
}

- (void)webViewWebContentProcessDidTerminate:(id)webView {
    self.documentGeneration += 1;
    self.loading = NO;
    if ([self.delegate respondsToSelector:@selector(webViewWebContentProcessDidTerminate:)]) {
        [self.delegate webViewWebContentProcessDidTerminate:self];
    }
}

- (NSURLRequest *)requestFromNavigationAction:(id)navigationAction {
    if (navigationAction == nil) {
        return nil;
    }
    SEL requestSelector = NSSelectorFromString(@"request");
    if (![navigationAction respondsToSelector:requestSelector]) {
        return nil;
    }
    return ((id (*)(id, SEL))objc_msgSend)(navigationAction, requestSelector);
}

- (NSInteger)navigationTypeFromNavigationAction:(id)navigationAction {
    if (navigationAction == nil) {
        return 0;
    }
    SEL navigationTypeSelector = NSSelectorFromString(@"navigationType");
    if (![navigationAction respondsToSelector:navigationTypeSelector]) {
        return 0;
    }
    return ((NSInteger (*)(id, SEL))objc_msgSend)(navigationAction, navigationTypeSelector);
}

- (void)webView:(id)webView decidePolicyForNavigationAction:(id)navigationAction decisionHandler:(void (^)(NSInteger policy))decisionHandler {
    NSURLRequest *request = [self requestFromNavigationAction:navigationAction];
    NSInteger navigationType = [self navigationTypeFromNavigationAction:navigationAction];
    BOOL isMainFrameRequest = YES;

    SEL targetFrameSelector = NSSelectorFromString(@"targetFrame");
    if ([navigationAction respondsToSelector:targetFrameSelector]) {
        id targetFrame = ((id (*)(id, SEL))objc_msgSend)(navigationAction, targetFrameSelector);
        SEL mainFrameSelector = NSSelectorFromString(@"isMainFrame");
        if (targetFrame != nil && [targetFrame respondsToSelector:mainFrameSelector]) {
            isMainFrameRequest = ((BOOL (*)(id, SEL))objc_msgSend)(targetFrame, mainFrameSelector);
        }
    }

    BOOL shouldAllow = YES;
    if ([self.delegate respondsToSelector:@selector(webView:shouldStartLoadWithRequest:navigationType:)]) {
        shouldAllow = [self.delegate webView:self shouldStartLoadWithRequest:request navigationType:navigationType];
    }

    if (shouldAllow && isMainFrameRequest && request != nil) {
        self.lastRequest = request;
    }

    if (decisionHandler != nil) {
        decisionHandler(shouldAllow ? 1 : 0);
    }
}

- (void)webView:(id)webView decidePolicyForNavigationResponse:(id)navigationResponse decisionHandler:(void (^)(NSInteger policy))decisionHandler {
    (void)webView;
    BOOL isMainFrame = NO;
    SEL mainFrameSelector = NSSelectorFromString(@"isForMainFrame");
    if ([navigationResponse respondsToSelector:mainFrameSelector]) {
        isMainFrame = ((BOOL (*)(id, SEL))objc_msgSend)(navigationResponse, mainFrameSelector);
    }
    NSURLResponse *response = nil;
    SEL responseSelector = NSSelectorFromString(@"response");
    if ([navigationResponse respondsToSelector:responseSelector]) {
        response = ((id (*)(id, SEL))objc_msgSend)(navigationResponse, responseSelector);
    }
    BOOL imported = NO;
    if (isMainFrame && response != nil &&
        [self.delegate respondsToSelector:@selector(webView:shouldImportTorrentResponse:request:)]) {
        imported = [self.delegate webView:self shouldImportTorrentResponse:response request:self.lastRequest];
    }
    decisionHandler(imported ? 0 : 1);
}

- (id)webView:(id)webView
createWebViewWithConfiguration:(id)configuration
forNavigationAction:(id)navigationAction
windowFeatures:(id)windowFeatures {
    (void)webView;
    (void)configuration;
    (void)windowFeatures;

    NSURLRequest *request = [self requestFromNavigationAction:navigationAction];
    NSInteger navigationType = [self navigationTypeFromNavigationAction:navigationAction];

    // Script-created external windows are a common popunder path. Keep same-host
    // windows and ordinary links available for sites that use them legitimately.
    NSString *currentHost = self.currentURL.host;
    NSString *destinationHost = request.URL.host;
    if (self.adBlockEnabled && navigationType == -1 && currentHost.length > 0 &&
        destinationHost.length > 0 &&
        [currentHost caseInsensitiveCompare:destinationHost] != NSOrderedSame) {
        return nil;
    }

    BOOL delegateHandlesNewTabRequests = [self.delegate respondsToSelector:@selector(webView:shouldCreateNewTabWithRequest:navigationType:)];
    BOOL handledInTab = NO;
    if (delegateHandlesNewTabRequests) {
        handledInTab = [self.delegate webView:self shouldCreateNewTabWithRequest:request navigationType:navigationType];
    }

    if (!delegateHandlesNewTabRequests && !handledInTab && request != nil) {
        BOOL shouldAllow = YES;
        if ([self.delegate respondsToSelector:@selector(webView:shouldStartLoadWithRequest:navigationType:)]) {
            shouldAllow = [self.delegate webView:self shouldStartLoadWithRequest:request navigationType:navigationType];
        }
        if (shouldAllow) {
            [self loadRequest:request];
        }
    }

    return nil;
}

+ (id)defaultWebsiteDataStore {
    return BrowserPersistentWebsiteDataStore();
}

+ (id)defaultCookieStore {
    id dataStore = [self defaultWebsiteDataStore];
    SEL selector = NSSelectorFromString(@"httpCookieStore");
    if (dataStore == nil || ![dataStore respondsToSelector:selector]) {
        return nil;
    }
    return ((id (*)(id, SEL))objc_msgSend)(dataStore, selector);
}

+ (NSArray<NSHTTPCookie *> *)allCookies {
    id cookieStore = [self defaultCookieStore];
    SEL selector = NSSelectorFromString(@"getAllCookies:");
    if (cookieStore == nil || ![cookieStore respondsToSelector:selector]) {
        return NSHTTPCookieStorage.sharedHTTPCookieStorage.cookies ?: @[];
    }

    __block NSArray<NSHTTPCookie *> *cookies = nil;
    __block BOOL finished = NO;
    ((void (*)(id, SEL, id))objc_msgSend)(cookieStore, selector, ^(NSArray<NSHTTPCookie *> *fetchedCookies) {
        cookies = fetchedCookies;
        finished = YES;
    });
    if (!BrowserPumpRunLoopUntil(&finished)) {
        return NSHTTPCookieStorage.sharedHTTPCookieStorage.cookies ?: @[];
    }
    return cookies ?: @[];
}

+ (NSData *)cookieDataRepresentation {
    NSArray<NSHTTPCookie *> *cookies = [self allCookies];
    NSError *error = nil;
    NSData *cookieData = [NSKeyedArchiver archivedDataWithRootObject:cookies requiringSecureCoding:NO error:&error];
    return error == nil ? cookieData : nil;
}

+ (void)restoreCookiesFromData:(NSData *)cookieData {
    if (cookieData.length == 0) {
        return;
    }

    NSError *error = nil;
    NSSet *allowedClasses = [NSSet setWithObjects:[NSArray class], [NSHTTPCookie class], nil];
    NSArray<NSHTTPCookie *> *cookies = [NSKeyedUnarchiver unarchivedObjectOfClasses:allowedClasses fromData:cookieData error:&error];
    if (![cookies isKindOfClass:[NSArray class]]) {
        return;
    }

    id cookieStore = [self defaultCookieStore];
    SEL selector = NSSelectorFromString(@"setCookie:completionHandler:");
    if (cookieStore == nil || ![cookieStore respondsToSelector:selector]) {
        for (NSHTTPCookie *cookie in cookies) {
            [NSHTTPCookieStorage.sharedHTTPCookieStorage setCookie:cookie];
        }
        return;
    }

    __block NSInteger remainingCount = cookies.count;
    __block BOOL finished = cookies.count == 0;
    for (NSHTTPCookie *cookie in cookies) {
        ((void (*)(id, SEL, id, id))objc_msgSend)(cookieStore, selector, cookie, ^{
            remainingCount -= 1;
            finished = remainingCount == 0;
        });
    }
    BrowserPumpRunLoopUntil(&finished);
}

+ (NSSet<NSString *> *)allWebsiteDataTypes {
    Class dataStoreClass = NSClassFromString(kBrowserWebsiteDataStoreClassName);
    SEL selector = NSSelectorFromString(@"allWebsiteDataTypes");
    if (dataStoreClass == Nil || ![dataStoreClass respondsToSelector:selector]) {
        return [NSSet set];
    }
    return ((id (*)(id, SEL))objc_msgSend)((id)dataStoreClass, selector);
}

+ (void)removeWebsiteDataTypes:(NSSet<NSString *> *)websiteDataTypes completion:(void (^)(void))completion {
    id dataStore = [self defaultWebsiteDataStore];
    SEL selector = NSSelectorFromString(@"removeDataOfTypes:modifiedSince:completionHandler:");
    if (dataStore == nil || ![dataStore respondsToSelector:selector]) {
        if (completion != nil) {
            completion();
        }
        return;
    }

    NSDate *beginningOfTime = [NSDate dateWithTimeIntervalSince1970:0];
    ((void (*)(id, SEL, id, id, id))objc_msgSend)(dataStore, selector, websiteDataTypes, beginningOfTime, ^{
        if (completion != nil) {
            dispatch_async(dispatch_get_main_queue(), ^{
                completion();
            });
        }
    });
}

+ (void)clearCachedDataWithCompletion:(void (^)(void))completion {
    [[NSURLCache sharedURLCache] removeAllCachedResponses];

    NSMutableSet<NSString *> *websiteDataTypes = [NSMutableSet set];
    for (NSString *dataType in [self allWebsiteDataTypes]) {
        if ([dataType.lowercaseString containsString:@"cache"]) {
            [websiteDataTypes addObject:dataType];
        }
    }

    [self removeWebsiteDataTypes:websiteDataTypes completion:completion];
}

+ (void)clearCookiesWithCompletion:(void (^)(void))completion {
    id cookieStore = [self defaultCookieStore];
    SEL getAllCookiesSelector = NSSelectorFromString(@"getAllCookies:");
    SEL deleteCookieSelector = NSSelectorFromString(@"deleteCookie:completionHandler:");
    if (cookieStore == nil || ![cookieStore respondsToSelector:getAllCookiesSelector] || ![cookieStore respondsToSelector:deleteCookieSelector]) {
        NSHTTPCookieStorage *storage = NSHTTPCookieStorage.sharedHTTPCookieStorage;
        for (NSHTTPCookie *cookie in storage.cookies) {
            [storage deleteCookie:cookie];
        }
        if (completion != nil) {
            completion();
        }
        return;
    }

    ((void (*)(id, SEL, id))objc_msgSend)(cookieStore, getAllCookiesSelector, ^(NSArray<NSHTTPCookie *> *cookies) {
        if (cookies.count == 0) {
            if (completion != nil) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    completion();
                });
            }
            return;
        }

        __block NSInteger remainingCount = cookies.count;
        for (NSHTTPCookie *cookie in cookies) {
            ((void (*)(id, SEL, id, id))objc_msgSend)(cookieStore, deleteCookieSelector, cookie, ^{
                remainingCount -= 1;
                if (remainingCount == 0 && completion != nil) {
                    dispatch_async(dispatch_get_main_queue(), ^{
                        completion();
                    });
                }
            });
        }
    });
}

+ (void)resetWebsiteDataWithCompletion:(void (^)(void))completion {
    [[NSURLCache sharedURLCache] removeAllCachedResponses];
    [self removeWebsiteDataTypes:[self allWebsiteDataTypes] completion:completion];
}

@end
