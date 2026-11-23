#import "BrowserHistoryViewController.h"
#import "BrowserHistoryStore.h"
#import "BrowserTVAppearance.h"

@interface BrowserHistoryButton : UIButton
@property (nonatomic, strong) UIColor *restingColor;
@property (nonatomic, strong) UIColor *restingTextColor;
@end

@implementation BrowserHistoryButton
- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{
        self.backgroundColor = BrowserTVSystemButtonSurfaceColor(self.isFocused ? BrowserTVFocusedSurfaceColor() : self.restingColor);
        [self setTitleColor:self.isFocused ? BrowserTVFocusedTextColor()
                                           : self.restingTextColor forState:UIControlStateNormal];
    } completion:nil];
}
@end

@interface BrowserHistoryCell : UITableViewCell
@property (nonatomic) BOOL checked;
- (void)refreshAppearance;
@end

@implementation BrowserHistoryCell

- (void)layoutSubviews {
    [super layoutSubviews];
    self.contentView.frame = CGRectInset(self.bounds, 0.0, 7.0);
}

- (void)refreshAppearance {
    BOOL focused = self.isFocused;
    self.contentView.backgroundColor = focused ? BrowserTVFocusedSurfaceColor()
                                               : BrowserTVRestingSurfaceColor();
    self.textLabel.textColor = focused ? BrowserTVFocusedTextColor() : UIColor.whiteColor;
    self.detailTextLabel.textColor = focused ? BrowserTVFocusedTextColor()
                                             : [UIColor colorWithWhite:1.0 alpha:0.68];
    self.imageView.tintColor = self.checked
        ? (focused ? [UIColor colorWithRed:0.13 green:0.34 blue:0.75 alpha:1.0]
                   : [UIColor colorWithRed:0.58 green:0.74 blue:1.0 alpha:1.0])
        : (focused ? [UIColor colorWithRed:0.32 green:0.38 blue:0.48 alpha:1.0]
                   : [UIColor colorWithWhite:1.0 alpha:0.65]);
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context
       withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    [coordinator addCoordinatedAnimations:^{ [self refreshAppearance]; } completion:nil];
}

@end

@interface BrowserHistoryViewController () <UITableViewDataSource, UITableViewDelegate>

@property (nonatomic, copy) NSArray<NSDictionary *> *entries;
@property (nonatomic, strong) NSMutableIndexSet *selectedIndexes;
@property (nonatomic, strong) NSIndexPath *focusedEntryIndexPath;
@property (nonatomic, strong) UITableView *tableView;
@property (nonatomic, strong) UIButton *selectAllButton;
@property (nonatomic, strong) UIButton *openButton;
@property (nonatomic, strong) UIButton *deleteButton;
@property (nonatomic, strong) UIButton *clearAllButton;
@property (nonatomic, strong) UIButton *doneButton;
@property (nonatomic, strong) UILabel *countLabel;
@property (nonatomic, strong) NSDateFormatter *visitDateFormatter;

@end

@implementation BrowserHistoryViewController

- (instancetype)init {
    self = [super initWithNibName:nil bundle:nil];
    if (self) {
        self.modalPresentationStyle = UIModalPresentationFullScreen;
        self.modalTransitionStyle = UIModalTransitionStyleCrossDissolve;
        _selectedIndexes = [NSMutableIndexSet indexSet];
    }
    return self;
}

- (UILabel *)label:(NSString *)text size:(CGFloat)size weight:(UIFontWeight)weight color:(UIColor *)color {
    UILabel *label = [UILabel new];
    label.translatesAutoresizingMaskIntoConstraints = NO;
    label.text = text;
    label.font = [UIFont systemFontOfSize:size weight:weight];
    label.textColor = color;
    return label;
}

- (UIButton *)button:(NSString *)title color:(UIColor *)color destructive:(BOOL)destructive selector:(SEL)selector {
    BrowserHistoryButton *button = [BrowserHistoryButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.restingColor = color;
    button.restingTextColor = destructive && BrowserTVUsesNativeButtonSurface() ? UIColor.systemRedColor : UIColor.whiteColor;
    BrowserTVConfigureSystemButtonSurface(button, color, 18.0);
    button.titleLabel.font = [UIFont systemFontOfSize:27.0 weight:UIFontWeightSemibold];
    [button setTitle:title forState:UIControlStateNormal];
    [button setTitleColor:button.restingTextColor forState:UIControlStateNormal];
    [button addTarget:self action:selector forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    BrowserTVInstallBackground(self.view);
    self.entries = [[BrowserHistoryStore sharedStore] allVisits];
    NSDateFormatter *dateFormatter = [NSDateFormatter new];
    dateFormatter.dateStyle = NSDateFormatterShortStyle;
    dateFormatter.timeStyle = NSDateFormatterShortStyle;
    self.visitDateFormatter = dateFormatter;

    UILabel *eyebrow = [self label:@"BROWSER" size:23.0 weight:UIFontWeightBold
                              color:[UIColor colorWithRed:0.58 green:0.72 blue:1.0 alpha:1.0]];
    UILabel *heading = [self label:@"All History" size:62.0 weight:UIFontWeightBold color:UIColor.whiteColor];
    UILabel *countLabel = [self label:@"" size:26.0 weight:UIFontWeightRegular
                                color:[UIColor colorWithWhite:1.0 alpha:0.58]];
    self.countLabel = countLabel;
    [self.view addSubview:eyebrow];
    [self.view addSubview:heading];
    [self.view addSubview:countLabel];

    Class glassClass = NSClassFromString(@"UIGlassEffect");
    UIVisualEffect *effect = BrowserTVPanelEffect();
    UIVisualEffectView *glassPanel = [[UIVisualEffectView alloc] initWithEffect:effect];
    glassPanel.translatesAutoresizingMaskIntoConstraints = NO;
    glassPanel.layer.cornerRadius = 30.0;
    glassPanel.layer.masksToBounds = YES;
    glassPanel.layer.borderWidth = glassClass != Nil ? 0.0 : 1.0;
    glassPanel.layer.borderColor = [UIColor colorWithWhite:1.0 alpha:0.25].CGColor;
    [self.view addSubview:glassPanel];

    UITableView *table = [[UITableView alloc] initWithFrame:CGRectZero style:UITableViewStylePlain];
    table.translatesAutoresizingMaskIntoConstraints = NO;
    table.dataSource = self;
    table.delegate = self;
    table.rowHeight = 112.0;
    table.backgroundColor = UIColor.clearColor;
    table.showsVerticalScrollIndicator = YES;
    UILabel *emptyLabel = [self label:@"No browsing history yet" size:32.0 weight:UIFontWeightMedium
                                   color:[UIColor colorWithWhite:1.0 alpha:0.72]];
    emptyLabel.translatesAutoresizingMaskIntoConstraints = YES;
    emptyLabel.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    emptyLabel.textAlignment = NSTextAlignmentCenter;
    table.backgroundView = emptyLabel;
    [self.view addSubview:table];
    self.tableView = table;
    UILongPressGestureRecognizer *contextPress = [[UILongPressGestureRecognizer alloc] initWithTarget:self
                                                                                               action:@selector(handleContextPress:)];
    contextPress.minimumPressDuration = 0.6;
    contextPress.allowedPressTypes = @[@(UIPressTypeSelect)];
    contextPress.cancelsTouchesInView = YES;
    [table addGestureRecognizer:contextPress];

    UIButton *selectAll = [self button:@"Select All" color:BrowserTVRestingSurfaceColor()
                              destructive:NO
                                 selector:@selector(selectAllPressed)];
    UIButton *open = [self button:@"Open" color:BrowserTVRestingSurfaceColor()
                          destructive:NO
                            selector:@selector(openPressed)];
    UIButton *remove = [self button:@"Delete" color:[UIColor colorWithRed:0.65 green:0.24 blue:0.33 alpha:0.72]
                            destructive:YES
                              selector:@selector(deletePressed)];
    UIButton *clearAll = [self button:@"Clear All" color:[UIColor colorWithRed:0.65 green:0.24 blue:0.33 alpha:0.72]
                              destructive:YES
                                selector:@selector(clearAllPressed)];
    UIButton *done = [self button:@"Done" color:BrowserTVRestingSurfaceColor()
                          destructive:NO
                            selector:@selector(donePressed)];
    [self.view addSubview:selectAll];
    [self.view addSubview:open];
    [self.view addSubview:remove];
    [self.view addSubview:clearAll];
    [self.view addSubview:done];
    self.selectAllButton = selectAll;
    self.openButton = open;
    self.deleteButton = remove;
    self.clearAllButton = clearAll;
    self.doneButton = done;

    [NSLayoutConstraint activateConstraints:@[
        [eyebrow.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:110.0],
        [eyebrow.topAnchor constraintEqualToAnchor:self.view.topAnchor constant:70.0],
        [heading.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [heading.topAnchor constraintEqualToAnchor:eyebrow.bottomAnchor constant:8.0],
        [countLabel.leadingAnchor constraintEqualToAnchor:eyebrow.leadingAnchor],
        [countLabel.topAnchor constraintEqualToAnchor:heading.bottomAnchor constant:6.0],
        [table.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:110.0],
        [table.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-110.0],
        [table.topAnchor constraintEqualToAnchor:selectAll.bottomAnchor constant:30.0],
        [table.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor constant:-70.0],
        [glassPanel.leadingAnchor constraintEqualToAnchor:table.leadingAnchor constant:-14.0],
        [glassPanel.trailingAnchor constraintEqualToAnchor:table.trailingAnchor constant:14.0],
        [glassPanel.topAnchor constraintEqualToAnchor:table.topAnchor constant:-14.0],
        [glassPanel.bottomAnchor constraintEqualToAnchor:table.bottomAnchor constant:14.0],
        [selectAll.leadingAnchor constraintEqualToAnchor:table.leadingAnchor],
        [selectAll.topAnchor constraintEqualToAnchor:countLabel.bottomAnchor constant:28.0],
        [selectAll.widthAnchor constraintEqualToConstant:220.0],
        [selectAll.heightAnchor constraintEqualToConstant:68.0],
        [open.leadingAnchor constraintEqualToAnchor:selectAll.trailingAnchor constant:16.0],
        [open.centerYAnchor constraintEqualToAnchor:selectAll.centerYAnchor],
        [open.widthAnchor constraintEqualToConstant:230.0],
        [open.heightAnchor constraintEqualToConstant:68.0],
        [remove.leadingAnchor constraintEqualToAnchor:open.trailingAnchor constant:16.0],
        [remove.centerYAnchor constraintEqualToAnchor:selectAll.centerYAnchor],
        [remove.widthAnchor constraintEqualToConstant:265.0],
        [remove.heightAnchor constraintEqualToConstant:68.0],
        [clearAll.leadingAnchor constraintEqualToAnchor:remove.trailingAnchor constant:16.0],
        [clearAll.centerYAnchor constraintEqualToAnchor:selectAll.centerYAnchor],
        [clearAll.widthAnchor constraintEqualToConstant:205.0],
        [clearAll.heightAnchor constraintEqualToConstant:68.0],
        [done.trailingAnchor constraintEqualToAnchor:table.trailingAnchor],
        [done.centerYAnchor constraintEqualToAnchor:selectAll.centerYAnchor],
        [done.widthAnchor constraintEqualToConstant:180.0],
        [done.heightAnchor constraintEqualToConstant:68.0],
    ]];
    [self updateActions];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    BrowserTVLayoutBackground(self.view);
}

- (void)updateActions {
    self.countLabel.text = [NSString stringWithFormat:@"%lu visits · %lu selected · Center opens · Play marks · Hold Center shows actions",
                            (unsigned long)self.entries.count, (unsigned long)self.selectedIndexes.count];
    self.openButton.enabled = self.selectedIndexes.count == 1;
    self.openButton.alpha = self.openButton.enabled ? 1.0 : 0.45;
    self.deleteButton.enabled = self.selectedIndexes.count > 0;
    self.deleteButton.alpha = self.deleteButton.enabled ? 1.0 : 0.45;
    self.clearAllButton.enabled = self.entries.count > 0;
    self.clearAllButton.alpha = self.clearAllButton.enabled ? 1.0 : 0.45;
    self.selectAllButton.enabled = self.entries.count > 0;
    self.selectAllButton.alpha = self.selectAllButton.enabled ? 1.0 : 0.45;
    [self.selectAllButton setTitle:self.selectedIndexes.count == self.entries.count && self.entries.count > 0
                                    ? @"Deselect" : @"Select All" forState:UIControlStateNormal];
    self.tableView.backgroundView.hidden = self.entries.count > 0;
}

- (NSInteger)tableView:(__unused UITableView *)tableView numberOfRowsInSection:(__unused NSInteger)section {
    return (NSInteger)self.entries.count;
}

- (UITableViewCell *)tableView:(UITableView *)tableView cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    BrowserHistoryCell *cell = [tableView dequeueReusableCellWithIdentifier:@"HistoryEntry"];
    if (cell == nil) {
        cell = [[BrowserHistoryCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:@"HistoryEntry"];
        cell.backgroundColor = UIColor.clearColor;
        cell.selectionStyle = UITableViewCellSelectionStyleNone;
        cell.focusStyle = UITableViewCellFocusStyleCustom;
        cell.contentView.layer.cornerRadius = 18.0;
        cell.contentView.layer.masksToBounds = YES;
        cell.textLabel.font = [UIFont systemFontOfSize:28.0 weight:UIFontWeightMedium];
        cell.textLabel.numberOfLines = 1;
        cell.textLabel.lineBreakMode = NSLineBreakByTruncatingTail;
        cell.detailTextLabel.font = [UIFont systemFontOfSize:20.0 weight:UIFontWeightRegular];
        cell.detailTextLabel.numberOfLines = 1;
        cell.detailTextLabel.lineBreakMode = NSLineBreakByTruncatingMiddle;
    }
    NSDictionary *entry = self.entries[(NSUInteger)indexPath.row];
    NSString *URLString = entry[@"url"] ?: @"";
    NSString *title = entry[@"title"] ?: @"";
    cell.textLabel.text = title.length > 0 ? title : URLString;
    NSNumber *visitedAt = entry[@"visitedAt"];
    NSString *visited = visitedAt != nil
        ? [self.visitDateFormatter stringFromDate:[NSDate dateWithTimeIntervalSince1970:visitedAt.doubleValue]] : @"";
    cell.detailTextLabel.text = visited.length > 0
        ? [NSString stringWithFormat:@"%@  ·  %@", visited, URLString] : URLString;
    UIImageSymbolConfiguration *symbolConfiguration = [UIImageSymbolConfiguration configurationWithPointSize:34.0
                                                                                                       weight:UIImageSymbolWeightMedium];
    cell.imageView.image = [UIImage systemImageNamed:
        [self.selectedIndexes containsIndex:(NSUInteger)indexPath.row] ? @"checkmark.circle.fill" : @"circle"
                          withConfiguration:symbolConfiguration];
    cell.checked = [self.selectedIndexes containsIndex:(NSUInteger)indexPath.row];
    [cell refreshAppearance];
    cell.accessibilityLabel = [NSString stringWithFormat:@"%@, %@", cell.textLabel.text, URLString];
    cell.accessibilityValue = [self.selectedIndexes containsIndex:(NSUInteger)indexPath.row] ? @"Selected" : @"Not selected";
    cell.accessibilityHint = @"Press Center to open, Play/Pause to mark, or hold Center for actions.";
    return cell;
}

- (void)tableView:(UITableView *)tableView didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];
    [self openEntryAtIndex:(NSUInteger)indexPath.row];
}

- (void)handleContextPress:(UILongPressGestureRecognizer *)recognizer {
    if (recognizer.state != UIGestureRecognizerStateBegan) return;
    NSIndexPath *path = [self.tableView indexPathForRowAtPoint:[recognizer locationInView:self.tableView]];
    if (!path) path = self.focusedEntryIndexPath;
    if (!path || path.row < 0 || (NSUInteger)path.row >= self.entries.count) return;
    NSDictionary *entry = self.entries[(NSUInteger)path.row];
    NSString *title = [entry[@"title"] length] ? entry[@"title"] : entry[@"url"];
    UIAlertController *actions = [UIAlertController alertControllerWithTitle:title
                                                                     message:entry[@"url"] preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [actions addAction:[UIAlertAction actionWithTitle:@"Open" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf openEntryAtIndex:(NSUInteger)path.row];
    }]];
    BOOL selected = [self.selectedIndexes containsIndex:(NSUInteger)path.row];
    [actions addAction:[UIAlertAction actionWithTitle:selected ? @"Deselect" : @"Select"
                                                style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [weakSelf toggleSelectionAtIndexPath:path];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Delete Visit" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action) {
        [[BrowserHistoryStore sharedStore] deleteVisitsWithIdentifiers:@[entry[@"id"]]];
        [weakSelf reloadAfterDeletion];
    }]];
    [actions addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:actions animated:YES completion:nil];
}

- (void)tableView:(UITableView *)tableView
didUpdateFocusInContext:(UITableViewFocusUpdateContext *)context
withAnimationCoordinator:(__unused UIFocusAnimationCoordinator *)coordinator {
    self.focusedEntryIndexPath = context.nextFocusedIndexPath;
}

- (void)toggleSelectionAtIndexPath:(NSIndexPath *)indexPath {
    if (indexPath == nil || indexPath.row < 0 || (NSUInteger)indexPath.row >= self.entries.count) return;
    NSUInteger index = (NSUInteger)indexPath.row;
    if ([self.selectedIndexes containsIndex:index]) {
        [self.selectedIndexes removeIndex:index];
    } else {
        [self.selectedIndexes addIndex:index];
    }
    [self.tableView reloadRowsAtIndexPaths:@[indexPath] withRowAnimation:UITableViewRowAnimationNone];
    [self updateActions];
}

- (void)openEntryAtIndex:(NSUInteger)index {
    if (index >= self.entries.count) return;
    NSString *URLString = self.entries[index][@"url"];
    NSURL *URL = [NSURL URLWithString:URLString];
    if (URL.host.length == 0 || ![@[@"http", @"https"] containsObject:URL.scheme.lowercaseString]) return;
    void (^openURLString)(NSString *) = self.openURLString;
    [self dismissViewControllerAnimated:YES completion:^{
        if (openURLString != nil) openURLString(URLString);
    }];
}

- (void)selectAllPressed {
    if (self.selectedIndexes.count == self.entries.count) {
        [self.selectedIndexes removeAllIndexes];
    } else {
        [self.selectedIndexes addIndexesInRange:NSMakeRange(0, self.entries.count)];
    }
    [self.tableView reloadData];
    [self updateActions];
}

- (void)openPressed {
    if (self.selectedIndexes.count != 1) return;
    [self openEntryAtIndex:self.selectedIndexes.firstIndex];
}

- (void)reloadAfterDeletion {
    self.entries = [[BrowserHistoryStore sharedStore] allVisits];
    [self.selectedIndexes removeAllIndexes];
    [self.tableView reloadData];
    [self updateActions];
    [self setNeedsFocusUpdate];
    [self updateFocusIfNeeded];
    if (self.historyDidChange != nil) self.historyDidChange();
}

- (void)deletePressed {
    if (self.selectedIndexes.count == 0) {
        return;
    }
    NSMutableArray<NSNumber *> *identifiers = [NSMutableArray array];
    [self.selectedIndexes enumerateIndexesUsingBlock:^(NSUInteger index, __unused BOOL *stop) {
        if (index < self.entries.count) [identifiers addObject:self.entries[index][@"id"]];
    }];
    [[BrowserHistoryStore sharedStore] deleteVisitsWithIdentifiers:identifiers];
    [self reloadAfterDeletion];
}

- (void)clearAllPressed {
    if (self.entries.count == 0) return;
    NSString *message = [NSString stringWithFormat:@"This removes all %lu saved visits. Favorites stay saved.",
                                                   (unsigned long)self.entries.count];
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Clear all history?"
                                                                   message:message
                                                            preferredStyle:UIAlertControllerStyleAlert];
    __weak typeof(self) weakSelf = self;
    [alert addAction:[UIAlertAction actionWithTitle:@"Clear All History"
                                              style:UIAlertActionStyleDestructive
                                            handler:^(__unused UIAlertAction *action) {
        [[BrowserHistoryStore sharedStore] deleteAllVisits];
        [weakSelf reloadAfterDeletion];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)donePressed {
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.entries.count > 0 ? @[self.tableView] : @[self.doneButton];
}

- (void)pressesEnded:(NSSet<UIPress *> *)presses withEvent:(UIPressesEvent *)event {
    for (UIPress *press in presses) {
        if (press.type == UIPressTypeMenu) {
            [self donePressed];
            return;
        }
        if (press.type == UIPressTypePlayPause) {
            if (self.focusedEntryIndexPath != nil) {
                [self toggleSelectionAtIndexPath:self.focusedEntryIndexPath];
                return;
            }
        }
    }
    [super pressesEnded:presses withEvent:event];
}

@end
