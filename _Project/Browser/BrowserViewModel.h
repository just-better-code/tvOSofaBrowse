#import <Foundation/Foundation.h>

@class BrowserTabViewModel;

@interface BrowserViewModel : NSObject

@property (nonatomic, strong, readonly) NSMutableArray *tabs;
@property (nonatomic) NSInteger activeTabIndex;
@property (nonatomic) BOOL tabOverviewVisible;
@property (nonatomic) NSUInteger textFontSize;

- (BrowserTabViewModel *)activeTab;
- (BrowserTabViewModel *)addTab;
- (BrowserTabViewModel *)addStartPageTab;
- (BrowserTabViewModel *)ensureActiveTab;
- (BrowserTabViewModel *)removeTabAtIndex:(NSInteger)tabIndex;
- (void)restoreTabs:(NSArray<BrowserTabViewModel *> *)tabs activeTabIndex:(NSInteger)activeTabIndex;
- (void)switchToTabAtIndex:(NSInteger)tabIndex;

@end
