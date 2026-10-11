#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class BrowserWebView;

NS_ASSUME_NONNULL_BEGIN

@interface BrowserDOMInteractionService : NSObject

- (CGPoint)DOMPointForCursorOrigin:(CGPoint)cursorOrigin
                            inView:(UIView *)containerView
                           webView:(BrowserWebView *)webView;
- (NSString *)evaluateResolvedElementJavaScriptAtPoint:(CGPoint)point
                                                webView:(BrowserWebView *)webView
                                                   body:(NSString *)body;
- (NSString *)evaluateEditableElementJavaScriptAtPoint:(CGPoint)point
                                                webView:(BrowserWebView *)webView
                                                   body:(NSString *)body;
- (void)evaluateHoverStateAtCursorPoint:(CGPoint)point
                                 inView:(UIView *)containerView
                                webView:(BrowserWebView *)webView
                             completion:(void (^)(BOOL isInteractive))completion;
- (NSString *)javaScriptEscapedString:(NSString *)string;
- (NSDictionary *)linkInfoAtDOMPoint:(CGPoint)point
                              webView:(BrowserWebView *)webView;

@end

NS_ASSUME_NONNULL_END
