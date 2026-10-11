// Isolated tvOS Simulator research fixture; never register this protocol in Browser.
// Synthetic HTTPS responses require no server or Internet. Request type is deliberately
// "other": production frame/type attribution and cookie/redirect fidelity remain pending.
#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>
#import <objc/message.h>
#import <dlfcn.h>
#import <JavaScriptCore/JavaScriptCore.h>
static JSContext *probeEngine;
static dispatch_queue_t probeQueue;
static NSUInteger probeBlocks;
static NSMutableDictionary *probeRequests;
static NSUInteger probeStops;
static NSUInteger probeEarlyStops;
@interface ProbeProtocol : NSURLProtocol
@property (atomic) BOOL stopped;
@property (atomic) BOOL deliveredResponse;
@end
@implementation ProbeProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request { return [request.URL.host isEqual:@"workerprobe.invalid"]; }
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)stopLoading { BOOL early; @synchronized(self) { self.stopped=YES; early=!self.deliveredResponse; } dispatch_async(probeQueue, ^{ if([self.request.URL.path isEqual:@"/slow"]) { probeStops++; if(early) probeEarlyStops++; } }); }
- (void)startLoading {
 dispatch_async(probeQueue, ^{ @synchronized(self) { if(!self.stopped) { if([self.request.URL.path isEqual:@"/slow"]) dispatch_after(dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),probeQueue,^{ @synchronized(self) { if(!self.stopped) [self serveRequest]; } }); else [self serveRequest]; } } });
}
- (void)serveRequest {
 NSString *path=self.request.URL.path; NSLog(@"[WorkerHostProbe] protocol path=%@ mainDocument=%d cookie=%d",path,[self.request.mainDocumentURL.host isEqual:@"workerprobe.invalid"],[[self.request valueForHTTPHeaderField:@"Cookie"] containsString:@"worker_probe=1"]);
 probeRequests[path]=@{@"handleCookies":@(self.request.HTTPShouldHandleCookies),@"documentCookieHeader":@([[self.request valueForHTTPHeaderField:@"Cookie"] containsString:@"worker_probe=1"]),@"mainDocumentMatches":@([self.request.mainDocumentURL.host isEqual:@"workerprobe.invalid"])};
 NSDictionary *result=[[probeEngine objectForKeyedSubscript:@"browserMatchNetwork"] callWithArguments:@[@{@"url":self.request.URL.absoluteString,@"topURL":self.request.mainDocumentURL.absoluteString ?: self.request.URL.absoluteString,@"originURL":self.request.mainDocumentURL.absoluteString ?: self.request.URL.absoluteString,@"type":@"other",@"method":self.request.HTTPMethod ?: @"GET"}]].toDictionary;
 if([result[@"action"] integerValue]==1) { probeBlocks++; NSLog(@"[WorkerHostProbe] full-core-block=1"); [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:NSURLErrorDomain code:NSURLErrorCancelled userInfo:nil]]; return; }
 if([path isEqual:@"/redirect"] || [path isEqual:@"/redirect-blocked"]) {
 NSMutableURLRequest *next=[self.request mutableCopy]; next.URL=[NSURL URLWithString:([path isEqual:@"/redirect-blocked"] ? @"https://workerprobe.invalid/blocked" : @"https://workerprobe.invalid/redirect-target")];
 NSHTTPURLResponse *redirect=[[NSHTTPURLResponse alloc] initWithURL:self.request.URL statusCode:302 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Location":next.URL.absoluteString}];
 [self.client URLProtocol:self wasRedirectedToRequest:next redirectResponse:redirect]; return;
 }
 NSString *body=@"allowed", *type=@"text/plain";
 if([path isEqual:@"/index.html"]) { type=@"text/html"; body=@"<!doctype html><script>document.cookie='worker_probe=1;path=/;SameSite=Lax';webkit.messageHandlers.probe.postMessage({documentCookie:document.cookie.includes('worker_probe=1'),responseCookie:document.cookie.includes('worker_response=1')});const w=new Worker('./worker.js');w.onmessage=e=>webkit.messageHandlers.probe.postMessage(e.data);w.onerror=e=>webkit.messageHandlers.probe.postMessage({workerError:e.message});for(const [url,opts] of [['./module.js',{type:'module'}],['./csp.js',{}]]){const child=new Worker(url,opts);child.onmessage=e=>webkit.messageHandlers.probe.postMessage(e.data);child.onerror=e=>webkit.messageHandlers.probe.postMessage({[url]:e.message});}</script>"; }
 if([path isEqual:@"/worker.js"]) { type=@"application/javascript"; body=@"postMessage({identity:location.href});importScripts('./import.js');fetch('./allowed').then(r=>r.text()).then(t=>postMessage({fetch:t}),e=>postMessage({fetchError:e.name}));fetch('./blocked').then(()=>postMessage({blockFailed:true}),e=>postMessage({blocked:e.name}));const x=new XMLHttpRequest();x.open('GET','./allowed');x.onload=()=>postMessage({xhr:x.responseText});x.onerror=()=>postMessage({xhrError:true});x.send();for(const mode of ['omit','same-origin','include'])fetch('./cookie-'+mode,{credentials:mode}).then(r=>r.text()).then(t=>postMessage({['credentials-'+mode]:t}));fetch('./redirect').then(r=>r.text()).then(t=>postMessage({redirect:t}));fetch('./redirect-blocked').then(()=>postMessage({redirectBlockFailed:true}),e=>postMessage({redirectBlocked:e.name}));const a=new AbortController();fetch('./slow',{signal:a.signal}).catch(e=>postMessage({abort:e.name}));setTimeout(()=>a.abort(),100);const n=new Worker('./nested.js');n.onmessage=e=>postMessage(e.data);"; }
 if([path isEqual:@"/module.js"]) { type=@"application/javascript"; body=@"import {value} from './dependency.js';postMessage({moduleIdentity:import.meta.url,moduleImport:value});fetch('./allowed').then(r=>r.text()).then(t=>postMessage({moduleFetch:t}));"; }
 if([path isEqual:@"/dependency.js"]) { type=@"application/javascript"; body=@"export const value='imported';"; }
 if([path isEqual:@"/nested.js"]) { type=@"application/javascript"; body=@"postMessage({nestedIdentity:location.href});fetch('./allowed').then(r=>r.text()).then(t=>postMessage({nestedFetch:t}));"; }
 if([path isEqual:@"/csp.js"]) { type=@"application/javascript"; body=@"fetch('./csp-denied').then(()=>postMessage({cspFailed:true}),e=>postMessage({csp:e.name}));"; }
 if([path isEqual:@"/import.js"]) { type=@"application/javascript"; body=@"postMessage({imported:true});"; }
 NSHTTPURLResponse *response=[[NSHTTPURLResponse alloc] initWithURL:self.request.URL statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type":type,@"Set-Cookie":@"worker_response=1; Path=/; SameSite=Lax",@"Content-Security-Policy":([path isEqual:@"/csp.js"] ? @"default-src 'self'; connect-src 'none'" : @"default-src 'self'; script-src 'self' 'unsafe-inline'; worker-src 'self'; connect-src 'self'")}];
 self.deliveredResponse=YES;
 [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
 [self.client URLProtocol:self didLoadData:[body dataUsingEncoding:NSUTF8StringEncoding]];
 [self.client URLProtocolDidFinishLoading:self];
}
@end
@interface ProbeApp : UIResponder <UIApplicationDelegate>
@property (nonatomic, strong) UIWindow *window;
@property (nonatomic, strong) id webView;
@property (nonatomic, strong) NSMutableDictionary *results;
@property (nonatomic, strong) id store;
@end
@implementation ProbeApp
- (BOOL)application:(UIApplication *)app didFinishLaunchingWithOptions:(NSDictionary *)options {
 setbuf(stdout,NULL);
 self.results=[NSMutableDictionary dictionary];
 self.results[@"persistentStore"]=@(getenv("WORKER_PROBE_PERSISTENT")!=NULL);
 dlopen("/System/Library/Frameworks/WebKit.framework/WebKit",RTLD_NOW|RTLD_GLOBAL);
 if(!NSClassFromString(@"WKWebView")) dlopen("/System/Library/PrivateFrameworks/WebKit.framework/WebKit",RTLD_NOW|RTLD_GLOBAL);
 Class context=NSClassFromString(@"WKBrowsingContextController");
 [NSURLProtocol registerClass:ProbeProtocol.class];
 ((void(*)(id,SEL,id))objc_msgSend)(context,NSSelectorFromString(@"registerSchemeForCustomProtocol:"),@"https");
 id config=[NSClassFromString(@"WKWebViewConfiguration") new];
 id store=((id(*)(id,SEL))objc_msgSend)(NSClassFromString(@"WKWebsiteDataStore"),NSSelectorFromString(getenv("WORKER_PROBE_PERSISTENT") ? @"defaultDataStore" : @"nonPersistentDataStore"));
 self.store=store;
 [config setValue:store forKey:@"websiteDataStore"];
 id controller=[config valueForKey:@"userContentController"];
 ((void(*)(id,SEL,id,id))objc_msgSend)(controller,NSSelectorFromString(@"addScriptMessageHandler:name:"),self,@"probe");
 self.window=[[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds]; self.window.rootViewController=[UIViewController new];
 self.webView=((id(*)(id,SEL,CGRect,id))objc_msgSend)([NSClassFromString(@"WKWebView") alloc],NSSelectorFromString(@"initWithFrame:configuration:"),self.window.bounds,config);
 [self.webView setValue:self forKey:@"navigationDelegate"];
 [self.window.rootViewController.view addSubview:self.webView]; [self.window makeKeyAndVisible];
 probeQueue=dispatch_queue_create("org.tvosofabrowse.workerhostprobe.matcher",DISPATCH_QUEUE_SERIAL);
 dispatch_async(probeQueue, ^{
  probeRequests=[NSMutableDictionary dictionary];
  probeEngine=[JSContext new];
  [probeEngine setObject:^NSString *(NSString *host){return [NSURL URLWithString:[NSString stringWithFormat:@"https://%@/",host]].host ?: @"";} forKeyedSubscript:@"browserNormalizeHostname"];
  [probeEngine setObject:^NSString *(NSArray *bytes){NSMutableData *data=[NSMutableData data];for(NSNumber *byte in bytes){uint8_t value=byte.unsignedCharValue;[data appendBytes:&value length:1];}return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";} forKeyedSubscript:@"browserDecodeBytes"];
  [probeEngine evaluateScript:@"globalThis.performance={now:()=>Date.now()};globalThis.TextDecoder=class{decode(bytes){return browserDecodeBytes(Array.from(bytes||[]));}};globalThis.URL=class{constructor(){this._hostname='';}get hostname(){return this._hostname;}set hostname(value){this._hostname=browserNormalizeHostname(value);}};globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};"];
  [probeEngine evaluateScript:[NSString stringWithContentsOfFile:[NSBundle.mainBundle pathForResource:@"UBlockNetwork" ofType:@"js"] encoding:NSUTF8StringEncoding error:nil]];
  [[probeEngine objectForKeyedSubscript:@"browserCompileNetwork"] callWithArguments:@[@[@{@"id":@"fixture",@"trusted":@NO,@"text":@"||workerprobe.invalid/blocked"}],@"",@"invalid\n"]];
  if(probeEngine.exception){NSLog(@"[WorkerHostProbe] matcher-bootstrap-failed");exit(1);}
  dispatch_async(dispatch_get_main_queue(),^{ ((id(*)(id,SEL,id))objc_msgSend)(self.webView,NSSelectorFromString(@"loadRequest:"),[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://workerprobe.invalid/index.html"]]); });
 });
 NSLog(@"[WorkerHostProbe] started");
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,20*NSEC_PER_SEC),dispatch_get_main_queue(),^{
 // Snapshot queue-owned results before reading them on the UI queue.
 dispatch_async(probeQueue, ^{
 NSUInteger blocks=probeBlocks, stops=probeStops, earlyStops=probeEarlyStops; NSDictionary *requests=[probeRequests copy];
 dispatch_async(dispatch_get_main_queue(), ^{
 self.results[@"transportCancellation"]=@(earlyStops>0 && requests[@"/slow"]==nil); self.results[@"slowStops"]=@(stops); self.results[@"coreBlocks"]=@(blocks); self.results[@"requests"]=requests;
 id cookieStore=[self.store valueForKey:@"httpCookieStore"];
 ((void(*)(id,SEL,id))objc_msgSend)(cookieStore,NSSelectorFromString(@"getAllCookies:"),^(NSArray<NSHTTPCookie *> *cookies){
 BOOL documentCookie=NO,responseCookie=NO;
 for(NSHTTPCookie *cookie in cookies) { if([cookie.name isEqual:@"worker_probe"]) documentCookie=YES; if([cookie.name isEqual:@"worker_response"]) responseCookie=YES; }
 self.results[@"storeDocumentCookie"]=@(documentCookie); self.results[@"storeResponseCookie"]=@(responseCookie);
 BOOL passed=[self.results[@"identity"] isEqual:@"https://workerprobe.invalid/worker.js"] && [self.results[@"imported"] boolValue] && [self.results[@"fetch"] isEqual:@"allowed"] && [self.results[@"xhr"] isEqual:@"allowed"] && [self.results[@"blocked"] isEqual:@"TypeError"] && blocks>0;
 for(NSString *mode in @[@"omit",@"same-origin",@"include"]) passed=passed && [self.results[[@"credentials-" stringByAppendingString:mode]] isEqual:@"allowed"];
 passed=passed && [self.results[@"moduleIdentity"] isEqual:@"https://workerprobe.invalid/module.js"] && [self.results[@"moduleImport"] isEqual:@"imported"] && [self.results[@"moduleFetch"] isEqual:@"allowed"] && [self.results[@"nestedIdentity"] isEqual:@"https://workerprobe.invalid/nested.js"] && [self.results[@"nestedFetch"] isEqual:@"allowed"];
 passed=passed && [self.results[@"redirect"] isEqual:@"allowed"] && [self.results[@"abort"] isEqual:@"AbortError"] && [self.results[@"redirectBlocked"] isEqual:@"TypeError"];
 passed=passed && [self.results[@"csp"] isEqual:@"TypeError"] && requests[@"/csp-denied"]==nil;
 passed=passed && ![requests[@"/cookie-omit"][@"handleCookies"] boolValue] && [requests[@"/cookie-include"][@"handleCookies"] boolValue] && [requests[@"/cookie-same-origin"][@"handleCookies"] boolValue];
 self.results[@"passed"]=@(passed);
 NSString *summary=[[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:self.results options:NSJSONWritingSortedKeys error:nil] encoding:NSUTF8StringEncoding];
 NSLog(@"[WorkerHostProbe] summary=%@",summary);exit(passed?0:1);
 });
 });
 });
});
 return YES;
}
- (void)userContentController:(id)controller didReceiveScriptMessage:(id)message { NSDictionary *body=[message valueForKey:@"body"]; [self.results addEntriesFromDictionary:body]; NSLog(@"[WorkerHostProbe] result=%@",body); }
- (void)webView:(id)view didFailProvisionalNavigation:(id)navigation withError:(NSError *)error { NSLog(@"[WorkerHostProbe] navigation error=%ld",(long)error.code); }
@end
int main(int argc,char **argv) { @autoreleasepool {return UIApplicationMain(argc,argv,nil,NSStringFromClass(ProbeApp.class));} }
