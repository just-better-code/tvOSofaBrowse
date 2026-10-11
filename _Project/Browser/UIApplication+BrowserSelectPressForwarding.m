#import "BrowserPreferencesStore.h"
#import <UIKit/UIKit.h>
#import <objc/message.h>
#import <objc/runtime.h>

NSString * const BrowserGlobalSelectPressEndedNotification = @"BrowserGlobalSelectPressEndedNotification";
NSString * const BrowserGlobalDirectionalPressBeganNotification = @"BrowserGlobalDirectionalPressBeganNotification";
static BOOL sBrowserSwallowTabOverviewMenuUntilEnd = NO;
static BOOL sBrowserSwallowMainMenuPressUntilEnd = NO;

static UIViewController *BrowserFindViewControllerOfClass(UIViewController *viewController, Class targetClass) {
    if (viewController == nil || targetClass == Nil) {
        return nil;
    }

    if ([viewController isKindOfClass:targetClass]) {
        return viewController;
    }

    if (viewController.presentedViewController != nil) {
        UIViewController *match = BrowserFindViewControllerOfClass(viewController.presentedViewController, targetClass);
        if (match != nil) {
            return match;
        }
    }

    for (UIViewController *childViewController in viewController.childViewControllers) {
        UIViewController *match = BrowserFindViewControllerOfClass(childViewController, targetClass);
        if (match != nil) {
            return match;
        }
    }

    if ([viewController isKindOfClass:[UINavigationController class]]) {
        UINavigationController *navigationController = (UINavigationController *)viewController;
        UIViewController *match = BrowserFindViewControllerOfClass(navigationController.visibleViewController, targetClass);
        if (match != nil) {
            return match;
        }
    }

    if ([viewController isKindOfClass:[UITabBarController class]]) {
        UITabBarController *tabBarController = (UITabBarController *)viewController;
        UIViewController *match = BrowserFindViewControllerOfClass(tabBarController.selectedViewController, targetClass);
        if (match != nil) {
            return match;
        }
    }

    return nil;
}

static UIViewController *BrowserFindPresentedViewControllerOfClass(UIApplication *application, Class targetClass) {
    for (UIWindow *window in application.windows) {
        if (window.hidden || window.rootViewController == nil) {
            continue;
        }

        UIViewController *match = BrowserFindViewControllerOfClass(window.rootViewController, targetClass);
        if (match != nil) {
            return match;
        }
    }
    return nil;
}

@interface UIApplication (BrowserSelectPressForwarding)

- (void)browser_sendEvent:(UIEvent *)event;

@end

@implementation UIApplication (BrowserSelectPressForwarding)

+ (void)load {
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Method originalMethod = class_getInstanceMethod(self, @selector(sendEvent:));
        Method replacementMethod = class_getInstanceMethod(self, @selector(browser_sendEvent:));
        if (originalMethod != NULL && replacementMethod != NULL) {
            method_exchangeImplementations(originalMethod, replacementMethod);
        }
    });
}

- (void)browser_sendEvent:(UIEvent *)event {
    if (event.type != UIEventTypePresses) {
        [self browser_sendEvent:event];
        return;
    }

    SEL allPressesSelector = NSSelectorFromString(@"allPresses");
    if (![event respondsToSelector:allPressesSelector]) {
        [self browser_sendEvent:event];
        return;
    }

    NSSet<UIPress *> *presses = ((id (*)(id, SEL))objc_msgSend)(event, allPressesSelector);
    for (UIPress *press in presses) {
        if (press.phase == UIPressPhaseBegan &&
            (press.type == UIPressTypeUpArrow || press.type == UIPressTypeDownArrow ||
             press.type == UIPressTypeLeftArrow || press.type == UIPressTypeRightArrow)) {
            [[NSNotificationCenter defaultCenter] postNotificationName:BrowserGlobalDirectionalPressBeganNotification object:nil];
        }
        if (press.type == UIPressTypeMenu) {
            if (sBrowserSwallowMainMenuPressUntilEnd) {
                if (press.phase == UIPressPhaseEnded || press.phase == UIPressPhaseCancelled) {
                    sBrowserSwallowMainMenuPressUntilEnd = NO;
                }
                return;
            }
            if (sBrowserSwallowTabOverviewMenuUntilEnd) {
                if (press.phase != UIPressPhaseBegan) {
                    if (press.phase == UIPressPhaseEnded || press.phase == UIPressPhaseCancelled) {
                        sBrowserSwallowTabOverviewMenuUntilEnd = NO;
                    }
                    return;
                }
                sBrowserSwallowTabOverviewMenuUntilEnd = NO;
            }
            if (press.phase == UIPressPhaseBegan) {
                UIViewController *overview = BrowserFindPresentedViewControllerOfClass(
                    self, NSClassFromString(@"BrowserTabOverviewViewController"));
                SEL dismissSelector = NSSelectorFromString(@"browserDismissForBackPress");
                if (overview != nil && [overview respondsToSelector:dismissSelector]) {
                    sBrowserSwallowTabOverviewMenuUntilEnd = YES;
                    dispatch_async(dispatch_get_main_queue(), ^{
                        ((void (*)(id, SEL))objc_msgSend)(overview, dismissSelector);
                    });
                    return;
                }

                UIViewController *browser = BrowserFindPresentedViewControllerOfClass(
                    self, NSClassFromString(@"ViewController"));
                SEL handleMenuSelector = NSSelectorFromString(@"browserRemoteInputControllerHandleMenuPress");
                if (browser != nil && browser.presentedViewController == nil &&
                    [browser respondsToSelector:handleMenuSelector]) {
                    sBrowserSwallowMainMenuPressUntilEnd = YES;
                    dispatch_async(dispatch_get_main_queue(), ^{
                        ((void (*)(id, SEL))objc_msgSend)(browser, handleMenuSelector);
                    });
                    return;
                }
            }
        }
    }

    [self browser_sendEvent:event];

    for (UIPress *press in presses) {
        if (press.type == UIPressTypeSelect && press.phase == UIPressPhaseEnded) {
            BrowserLog(@"[InputTrace][App] post BrowserGlobalSelectPressEndedNotification");
            dispatch_async(dispatch_get_main_queue(), ^{
                [[NSNotificationCenter defaultCenter] postNotificationName:BrowserGlobalSelectPressEndedNotification object:nil];
            });
            break;
        }
    }
}

@end
