# Execute selected production Objective-C methods against deterministic runtime/store doubles.
# --simulator uses tvOS Foundation; neither mode opens the user's cookie store.
import argparse, os, platform, subprocess, tempfile
from pathlib import Path
s=Path('_Project/Browser/BrowserWebView.m').read_text()
def section(a,b):return s[s.index(a):s.index(b,s.index(a))]
methods=section('- (void)stopLoading {', '- (void)evaluateJavaScript:(NSString *)script completion:')+section('- (void)invalidatePendingJavaScript {', '- (void)evaluateJavaScript:(NSString *)script\n        completionHandler:')+section('- (void)evaluateJavaScript:(NSString *)script\n        completionHandler:', '- (void)pauseAllMediaPlayback')+section('- (void)observeValueForKeyPath:', '- (NSDictionary *)navigationHistorySnapshot')+section('+ (void)fetchCookiesWithResult:', '+ (NSSet<NSString *> *)allWebsiteDataTypes')
preamble='''#import <Foundation/Foundation.h>
#import <objc/message.h>
static char kBrowserNavigationURLObservationContext;
static dispatch_group_t BrowserCookieRestoreGroup;
#define BrowserLog(...) ((void)0)
static NSString *BrowserStringFromJavaScriptResult(id x){return x == NSNull.null ? nil : [x description];}
@interface NSObject (DelegateStub)
- (void)webViewDidChangeNavigationHistory:(id)view;
@end
@interface Runtime : NSObject
@property NSURLRequest *request;
@property NSMutableArray *replies;
@property NSUInteger navigationCalls;
- (id)goBack;
- (id)goForward;
- (void)stopLoading;
- (void)evaluateJavaScript:(NSString *)script completionHandler:(void (^)(id,NSError *))reply;
@end
@implementation Runtime
- (id)goBack{self.navigationCalls++;return nil;}
- (id)goForward{self.navigationCalls++;return nil;}
- (void)stopLoading{self.navigationCalls++;}
- (instancetype)init{if((self=[super init]))_replies=[NSMutableArray new];return self;}
- (void)evaluateJavaScript:(NSString *)script completionHandler:(void (^)(id,NSError *))reply{[self.replies addObject:[reply copy]];}
@end
@interface CookieStore : NSObject
@property NSMutableArray *reads;
@property NSMutableArray *writes;
- (void)getAllCookies:(void (^)(NSArray *))reply;
- (void)setCookie:(NSHTTPCookie *)cookie completionHandler:(void (^)(void))reply;
@end
@implementation CookieStore
- (instancetype)init{if((self=[super init])){_reads=[NSMutableArray new];_writes=[NSMutableArray new];}return self;}
- (void)getAllCookies:(void (^)(NSArray *))reply{[self.reads addObject:[reply copy]];}
- (void)setCookie:(NSHTTPCookie *)cookie completionHandler:(void (^)(void))reply{[self.writes addObject:[reply copy]];}
@end
static CookieStore *cookieStore;
@interface BrowserWebView : NSObject
@property Runtime *runtimeWebView;
@property NSUInteger documentGeneration;
@property NSUInteger javaScriptGeneration;
@property BOOL loading;
@property BOOL adBlockRefreshAfterNavigation;
@property NSUInteger adBlockPolicyGeneration;
@property id delegate;
- (NSURLRequest *)request;
- (void)goBack;
- (void)goForward;
- (void)stopLoading;
- (void)invalidatePendingJavaScript;
- (void)applyDomainZoomForURL:(NSURL *)url;
- (void)evaluateJavaScript:(NSString *)s completionHandler:(void (^)(NSString *,NSError *))reply;
+ (id)defaultCookieStore;
+ (void)fetchCookiesWithResult:(void (^)(NSArray *,NSError *))reply;
@end
@implementation BrowserWebView
- (NSURLRequest *)request{return self.runtimeWebView.request;}
- (void)applyDomainZoomForURL:(NSURL *)url{}
+ (id)defaultCookieStore{return cookieStore;}
'''
tests='''
@end
static void drain(double seconds){NSDate *until=[NSDate dateWithTimeIntervalSinceNow:seconds];while(until.timeIntervalSinceNow>0)[NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:until];}
static int failures;
static void check(BOOL ok,NSString *name){printf("%s %s\\n",ok?"PASS":"FAIL",name.UTF8String);fflush(stdout);if(!ok)failures++;}
static BrowserWebView *view(void){BrowserWebView *v=[BrowserWebView new];v.runtimeWebView=[Runtime new];v.runtimeWebView.request=[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://example.org/a"]];return v;}
static void reply(BrowserWebView *v){void(^r)(id,NSError *)=v.runtimeWebView.replies.lastObject;r(@"old",nil);drain(.02);}
int main(){@autoreleasepool{
 BrowserWebView *v=view();__block NSError *error;__block int count=0;
 [v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;count++;}];reply(v);reply(v);check(count==1&&!error,@"normal reply delivered exactly once");
 v=view();[v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;}];v.documentGeneration++;reply(v);check(error.code==NSURLErrorCancelled,@"late result after navigation cancels");
 v=view();error=nil;[v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;}];
 v.runtimeWebView.request=[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://example.org/b"]];[v observeValueForKeyPath:@"URL" ofObject:v.runtimeWebView change:@{} context:&kBrowserNavigationURLObservationContext];
 v.runtimeWebView.request=[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://example.org/a"]];[v observeValueForKeyPath:@"URL" ofObject:v.runtimeWebView change:@{} context:&kBrowserNavigationURLObservationContext];reply(v);check(error.code==NSURLErrorCancelled,@"same-document URL A to B to A cancels old reply");
 v=view();error=nil;[v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;}];[v invalidatePendingJavaScript];[v invalidatePendingJavaScript];reply(v);check(error.code==NSURLErrorCancelled,@"tab A to B to A cancels old reply");
 for(NSString *action in @[@"goBack",@"goForward",@"stopLoading"]){v=view();error=nil;[v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;}];((void(*)(id,SEL))objc_msgSend)(v,NSSelectorFromString(action));reply(v);check(error.code==NSURLErrorCancelled&&v.runtimeWebView.navigationCalls==1,[action stringByAppendingString:@" cancels old reply"]);}
 v=view();count=0;[v evaluateJavaScript:@"1" completionHandler:^(NSString *r,NSError *e){error=e;count++;}];drain(2.1);check(count==1&&error.code==NSURLErrorTimedOut,@"missing JS reply times out");reply(v);check(count==1,@"late reply after timeout is ignored");
 if(!getenv("JS_ONLY")){cookieStore=[CookieStore new];__block int saves=0;[BrowserWebView cookieDataRepresentationWithCompletion:^(NSData *data){if(data)saves++;}];drain(2.1);check(saves==0,@"cookie read timeout does not replace archive");void(^read)(NSArray *)=cookieStore.reads.lastObject;read(@[]);drain(.02);check(saves==0,@"late cookie snapshot after timeout is ignored");
 cookieStore=[CookieStore new];__block int reads=0;[BrowserWebView fetchCookiesWithResult:^(NSArray *data,NSError *e){if(data&&!e)reads++;}];read=cookieStore.reads.lastObject;read(@[]);read(@[]);drain(.02);check(reads==1,@"cookie read completes once");
 NSHTTPCookie *cookie=[NSHTTPCookie cookieWithProperties:@{NSHTTPCookieDomain:@"example.org",NSHTTPCookiePath:@"/",NSHTTPCookieName:@"test",NSHTTPCookieValue:@"fixture"}];NSError *archiveError=nil;NSData *archive=[NSKeyedArchiver archivedDataWithRootObject:@[cookie] requiringSecureCoding:NO error:&archiveError];check(archive.length>0&&!archiveError,@"synthetic cookie archive encodes");
 __block int restores=0;[BrowserWebView restoreCookiesFromData:archive completion:^{restores++;}];check(BrowserCookieRestoreGroup && dispatch_group_wait(BrowserCookieRestoreGroup,DISPATCH_TIME_NOW)!=0,@"navigation gate waits for cookie writes");void(^write)(void)=cookieStore.writes.lastObject;if(write)write();drain(.02);check(restores==1&&BrowserCookieRestoreGroup&&dispatch_group_wait(BrowserCookieRestoreGroup,DISPATCH_TIME_NOW)==0,@"restore opens navigation gate after write");
 }}return failures?1:0;}
'''
parser=argparse.ArgumentParser()
parser.add_argument('--simulator',action='store_true')
parser.add_argument('--js-only',action='store_true')
args=parser.parse_args()
with tempfile.TemporaryDirectory(prefix='browser-lifecycle-') as folder:
    source=Path(folder)/'lifecycle.m'; binary=Path(folder)/'lifecycle'
    source.write_text(preamble+methods+tests)
    command=['xcrun']
    if args.simulator: command+=['--sdk','appletvsimulator']
    command+=['clang','-fobjc-arc','-fblocks','-Wno-mismatched-parameter-types','-Wno-incompatible-pointer-types','-framework','Foundation']
    if args.simulator: command+=['-target',platform.machine()+'-apple-tvos13.0-simulator']
    subprocess.run(command+[str(source),'-o',str(binary)],check=True)
    environment=dict(os.environ)
    if args.js_only: environment['SIMCTL_CHILD_JS_ONLY' if args.simulator else 'JS_ONLY']='1'
    run=['xcrun','simctl','spawn','booted',str(binary)] if args.simulator else [str(binary)]
    raise SystemExit(subprocess.run(run,env=environment).returncode)
