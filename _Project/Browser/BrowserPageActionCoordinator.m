#import "BrowserPageActionCoordinator.h"

#import "BrowserDOMInteractionService.h"
#import "BrowserNavigationService.h"
#import "BrowserWebView.h"

static UIColor *BrowserPageActionTextColor(void) {
    if (@available(tvOS 13, *)) {
        return UIColor.labelColor;
    } else {
        return UIColor.blackColor;
    }
}

// A prompt owns one DOM node; never fall back to another focused field on Done.
static NSString *BrowserEditablePromptTargetJavaScript(NSString *identifier) {
    return [NSString stringWithFormat:@"var session=window.__browserEditablePromptTarget;"
        "if(!session||session.identifier!=='%@')return 'false';"
        "var target=session.element;window.__browserEditablePromptTarget=null;"
        "if(!target||!target.isConnected)return 'false';", identifier];
}

@interface BrowserPageActionCoordinator ()

@property (nonatomic) NSUInteger selectionGeneration;
@property (nonatomic, weak) id<BrowserPageActionCoordinatorHost> host;
@property (nonatomic) BrowserDOMInteractionService *domInteractionService;
@property (nonatomic) BrowserNavigationService *navigationService;

@end

@implementation BrowserPageActionCoordinator

- (instancetype)initWithHost:(id<BrowserPageActionCoordinatorHost>)host
       domInteractionService:(BrowserDOMInteractionService *)domInteractionService
           navigationService:(BrowserNavigationService *)navigationService {
    self = [super init];
    if (self) {
        _host = host;
        _domInteractionService = domInteractionService;
        _navigationService = navigationService;
    }
    return self;
}

- (void)presentEditableFieldPromptForFieldType:(NSString *)fieldType
                                         point:(CGPoint)point
                                       webView:(BrowserWebView *)webView {
    NSUInteger selection = self.selectionGeneration;
    NSString *identifier = NSUUID.UUID.UUIDString;
    [self.domInteractionService evaluateEditableElementJavaScriptAtPoint:point webView:webView
        body:[NSString stringWithFormat:@"var target=browserEditableTarget();if(!target)return '';window.__browserEditablePromptTarget={identifier:'%@',element:target};return JSON.stringify({title:target.title||target.getAttribute('aria-label')||target.name||target.placeholder||'',placeholder:target.placeholder||target.getAttribute('aria-label')||'',value:typeof target.value!=='undefined'?target.value:(target.textContent||''),submit:!!(target.form&&target.form.hasAttribute('onsubmit'))});", identifier]
        completion:^(NSString *result, NSError *error) {
        if (selection != self.selectionGeneration || error || ![self.host browserPageActionCoordinatorCanSelectInWebView:webView]) return;
        NSDictionary *metadata = result ? [NSJSONSerialization JSONObjectWithData:[result dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil] : nil;
        if (![metadata isKindOfClass:NSDictionary.class]) return;
        NSString *fieldTitle = [metadata[@"title"] length] ? metadata[@"title"] : fieldType;
        NSString *placeholder = [metadata[@"placeholder"] length] ? metadata[@"placeholder"] : ([fieldTitle isEqualToString:fieldType] ? @"Text Input" : [NSString stringWithFormat:@"%@ Input",fieldTitle]);
        UIAlertController *alertController = [UIAlertController alertControllerWithTitle:@"Input Text"
                                                                                 message:[fieldTitle capitalizedString]
                                                                          preferredStyle:UIAlertControllerStyleAlert];

        NSUInteger generation = webView.documentGeneration;
        NSUInteger javaScriptGeneration = webView.javaScriptGeneration;
        __weak typeof(self) weakSelf = self;
        [alertController addTextFieldWithConfigurationHandler:^(UITextField *textField) {
            if ([fieldType isEqualToString:@"url"]) {
                textField.keyboardType = UIKeyboardTypeURL;
            } else if ([fieldType isEqualToString:@"email"]) {
                textField.keyboardType = UIKeyboardTypeEmailAddress;
            } else if ([fieldType isEqualToString:@"tel"] ||
                       [fieldType isEqualToString:@"number"] ||
                       [fieldType isEqualToString:@"date"] ||
                       [fieldType isEqualToString:@"datetime"] ||
                       [fieldType isEqualToString:@"datetime-local"]) {
                textField.keyboardType = UIKeyboardTypeNumbersAndPunctuation;
            } else {
                textField.keyboardType = UIKeyboardTypeDefault;
            }
            textField.placeholder = [placeholder capitalizedString];
            if ([fieldType isEqualToString:@"password"]) {
                textField.secureTextEntry = YES;
            }
            textField.text = metadata[@"value"];
            textField.textColor = BrowserPageActionTextColor();
            [textField setReturnKeyType:UIReturnKeyDone];
    }];

    UIAlertAction *submitAction = [UIAlertAction actionWithTitle:@"Submit"
                                                           style:UIAlertActionStyleDefault
                                                         handler:^(__unused UIAlertAction *action) {
        if (![weakSelf.host browserPageActionCoordinatorIsActiveWebView:webView] || webView.documentGeneration != generation || webView.javaScriptGeneration != javaScriptGeneration || selection != weakSelf.selectionGeneration) return;
        UITextField *inputTextField = alertController.textFields.firstObject;
        NSString *escapedText = [weakSelf.domInteractionService javaScriptEscapedString:inputTextField.text];
        [weakSelf.domInteractionService evaluateEditableElementJavaScriptAtPoint:point
                                                                         webView:webView
                                                                            body:[NSString stringWithFormat:@"%@"
                                                                                  "if (typeof target.value !== 'undefined') { target.value = '%@'; }"
                                                                                  "else { target.textContent = '%@'; }"
                                                                                  "if (target.dispatchEvent) {"
                                                                                      "target.dispatchEvent(new Event('input', { bubbles: true }));"
                                                                                      "target.dispatchEvent(new Event('change', { bubbles: true }));"
                                                                                  "}"
                                                                                  "if (target.form) { target.form.submit(); }"
                                                                                  "return 'true';", BrowserEditablePromptTargetJavaScript(identifier), escapedText, escapedText] completion:nil];
    }];
    UIAlertAction *doneAction = [UIAlertAction actionWithTitle:@"Done"
                                                         style:UIAlertActionStyleDefault
                                                       handler:^(__unused UIAlertAction *action) {
        if (![weakSelf.host browserPageActionCoordinatorIsActiveWebView:webView] || webView.documentGeneration != generation || webView.javaScriptGeneration != javaScriptGeneration || selection != weakSelf.selectionGeneration) return;
        UITextField *inputTextField = alertController.textFields.firstObject;
        NSString *escapedText = [weakSelf.domInteractionService javaScriptEscapedString:inputTextField.text];
        [weakSelf.domInteractionService evaluateEditableElementJavaScriptAtPoint:point
                                                                         webView:webView
                                                                            body:[NSString stringWithFormat:@"%@"
                                                                                  "if (typeof target.value !== 'undefined') { target.value = '%@'; }"
                                                                                  "else { target.textContent = '%@'; }"
                                                                                  "if (target.dispatchEvent) {"
                                                                                      "target.dispatchEvent(new Event('input', { bubbles: true }));"
                                                                                      "target.dispatchEvent(new Event('change', { bubbles: true }));"
                                                                                  "}"
                                                                                  "return 'true';", BrowserEditablePromptTargetJavaScript(identifier), escapedText, escapedText] completion:nil];
    }];
    [alertController addAction:doneAction];
    if ([metadata[@"submit"] boolValue]) {
        [alertController addAction:submitAction];
    }
    [alertController addAction:[UIAlertAction actionWithTitle:nil style:UIAlertActionStyleCancel handler:^(__unused UIAlertAction *action) {
        if (![weakSelf.host browserPageActionCoordinatorIsActiveWebView:webView] || webView.documentGeneration != generation || webView.javaScriptGeneration != javaScriptGeneration) return;
        [webView evaluateJavaScript:[NSString stringWithFormat:@"(function(){%@})()", BrowserEditablePromptTargetJavaScript(identifier)] completion:nil];
    }]];
    [self.host browserPageActionCoordinatorPresentViewController:alertController];

    UITextField *inputTextField = alertController.textFields.firstObject;
    if ([[inputTextField.text stringByReplacingOccurrencesOfString:@" " withString:@""] isEqualToString:@""]) {
        [inputTextField becomeFirstResponder];
    }
    }];
}

- (BOOL)handlePageSelectionAtDOMPoint:(CGPoint)point webView:(BrowserWebView *)webView {
    NSUInteger selection = ++self.selectionGeneration;
    [self.domInteractionService linkInfoAtDOMPoint:point webView:webView completion:^(NSDictionary *linkInfo, NSError *error) {
    if (selection != self.selectionGeneration || error || ![self.host browserPageActionCoordinatorCanSelectInWebView:webView]) return;
    NSString *href = linkInfo[@"href"], *target = linkInfo[@"target"];
    if ([target isEqualToString:@"_blank"] && href.length) {
        NSURLRequest *request = [self.navigationService requestForURLString:href];
        if (request && [self.host browserPageActionCoordinatorCreateNewTabWithRequest:request]) return;
    }
    [self.domInteractionService evaluateResolvedElementJavaScriptAtPoint:point
                                                                                        webView:webView
                                                                                           body:@"function browserEditableTargetAtPoint() {"
                                                                                                "var candidate = editableElement;"
                                                                                                "if (!candidate && resolvedElement && resolvedElement.matches) {"
                                                                                                    "if (resolvedElement.matches(editableSelector) || resolvedElement.matches('textarea, select')) {"
                                                                                                        "candidate = resolvedElement;"
                                                                                                    "}"
                                                                                                "}"
                                                                                                "if (!candidate) { return null; }"
                                                                                                "window.__browserLastEditableElement = candidate;"
                                                                                                "return candidate;"
                                                                                                "}"
                                                                                                "var target = browserEditableTargetAtPoint();"
                                                                                                "if (!target) { return ''; }"
                                                                                                "var tagName = target.tagName ? target.tagName.toLowerCase() : '';"
                                                                                                "var type = (target.type || '').toLowerCase();"
                                                                                                "if (tagName === 'textarea' || target.isContentEditable) { return 'text'; }"
                                                                                                "if (tagName === 'input' && !type) { return 'text'; }"
                                                                                                "return type;" completion:^(NSString *fieldType, NSError *error) {
    if (selection != self.selectionGeneration || error || ![self.host browserPageActionCoordinatorCanSelectInWebView:webView]) return;
    [self.domInteractionService evaluateResolvedElementJavaScriptAtPoint:point
                                                                 webView:webView
                                                                    body:@"if (typeof window.__browserTVFrameAtPoint === 'function' && window.__browserTVFrameAtPoint(x, y) && typeof window.__browserTVFrameClick === 'function') {"
                                                                             "return window.__browserTVFrameClick(x, y) ? 'true' : 'false';"
                                                                         "}"
                                                                         "var target = editableElement || interactiveElement || resolvedElement;"
                                                                         "if (window.__browserTVOpenControlledVideo && window.__browserTVOpenControlledVideo(target)) { return 'true'; }"
                                                                         "if (!target) { return 'false'; }"
                                                                         "try { if (target.focus) { target.focus(); } } catch (error) {}"
                                                                         "function dispatchPointerLikeEvent(type, constructorName) {"
                                                                             "try {"
                                                                                 "var Constructor = window[constructorName];"
                                                                                 "if (Constructor) {"
                                                                                     "var event = new Constructor(type, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y, button: 0, buttons: 1, pointerType: 'mouse' });"
                                                                                     "return target.dispatchEvent(event);"
                                                                                 "}"
                                                                             "} catch (error) {}"
                                                                             "var mouseEvent = document.createEvent('MouseEvents');"
                                                                             "mouseEvent.initMouseEvent(type, true, true, window, 1, x, y, x, y, false, false, false, false, 0, null);"
                                                                             "return target.dispatchEvent(mouseEvent);"
                                                                         "}"
                                                                         "dispatchPointerLikeEvent('pointerdown', 'PointerEvent');"
                                                                         "dispatchPointerLikeEvent('mousedown', 'MouseEvent');"
                                                                         "dispatchPointerLikeEvent('pointerup', 'PointerEvent');"
                                                                         "dispatchPointerLikeEvent('mouseup', 'MouseEvent');"
                                                                         "if (typeof target.click === 'function') { target.click(); }"
                                                                         "else { dispatchPointerLikeEvent('click', 'MouseEvent'); }"
                                                                         "return 'true';" completion:^(NSString *clickResult, NSError *clickError) {
    if (selection != self.selectionGeneration || clickError || ![self.host browserPageActionCoordinatorCanSelectInWebView:webView]) return;
    NSString *type = fieldType.lowercaseString;
    if ([type isEqualToString:@"date"] ||
        [type isEqualToString:@"datetime"] ||
        [type isEqualToString:@"datetime-local"] ||
        [type isEqualToString:@"email"] ||
        [type isEqualToString:@"month"] ||
        [type isEqualToString:@"number"] ||
        [type isEqualToString:@"password"] ||
        [type isEqualToString:@"search"] ||
        [type isEqualToString:@"tel"] ||
        [type isEqualToString:@"text"] ||
        [type isEqualToString:@"time"] ||
        [type isEqualToString:@"url"] ||
        [type isEqualToString:@"week"]) {
        [self presentEditableFieldPromptForFieldType:type point:point webView:webView];
    }
    }];
    }];
    }];
    return YES;
}

@end
