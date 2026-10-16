#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@class BrowserWebView;

NS_ASSUME_NONNULL_BEGIN

@interface BrowserDOMInteractionService : NSObject

- (CGPoint)DOMPointForCursorOrigin:(CGPoint)cursorOrigin
                            inView:(UIView *)containerView
                           webView:(BrowserWebView *)webView;
- (void)evaluateResolvedElementJavaScriptAtPoint:(CGPoint)point
                                                webView:(BrowserWebView *)webView
                                                   body:(NSString *)body
                                             completion:(void (^ _Nullable)(NSString * _Nullable, NSError * _Nullable))completion;
- (void)evaluateEditableElementJavaScriptAtPoint:(CGPoint)point
                                                webView:(BrowserWebView *)webView
                                                   body:(NSString *)body
                                             completion:(void (^ _Nullable)(NSString * _Nullable, NSError * _Nullable))completion;
- (void)evaluateHoverStateAtCursorPoint:(CGPoint)point
                                 inView:(UIView *)containerView
                                webView:(BrowserWebView *)webView
                             completion:(void (^)(BOOL isInteractive))completion;
- (NSString *)javaScriptEscapedString:(NSString *)string;
- (void)linkInfoAtDOMPoint:(CGPoint)point
                              webView:(BrowserWebView *)webView
                   completion:(void (^)(NSDictionary * _Nullable, NSError * _Nullable))completion;

@end

NS_ASSUME_NONNULL_END
