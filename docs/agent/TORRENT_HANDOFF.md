# Handoff: торенти у tvOSofaBrowse

Дата: 2026-09-29. Гілка: `codex/torrent-on-tvos`. Комітів і push немає — усе залишено в робочому дереві згідно з `AGENTS.md`. Користувач попросив зупинитися після цього handoff і продовжити завтра.

## Ціль користувача

1. На сайті натиснути magnet або «завантажити .torrent» і **відразу відкрити вбудований торент-клієнт**, без клієнта на ПК й без переходу в зовнішній VLC.
2. Бачити стан торента і вибирати, **які файли завантажувати, а які пропустити**.
3. Обрати медіафайл для відтворення у застосунку; вибраний файл і потрібні для програвання частини отримують найвищий пріоритет. Бажане відтворення до завершення завантаження.
4. Експериментальний перемикач **Keep Alive** із зацикленою тишею вже погоджений. Файли зберігаються в purgeable cache tvOS.
5. Ідея на останній етап: якщо на сторінці є magnet/.torrent посилання, показувати іконку в правому верхньому куті; вона відкриває список знайдених посилань для вибору без наведення курсора.

## Що було готове до сьогоднішнього аудиту

- `BrowserTorrentManager.h/.mm`: libtorrent 1.2.17, magnet і `.torrent`, сесія, дані в `Library/Caches/BrowserTorrents/Downloads`, джерела в `Metadata/sources.plist`, список файлів і прогрес, pause/resume/remove, пріоритет частин для програвання.
- `BrowserTorrentAssetLoader.h/.m`: `AVAssetResourceLoader` для `browsertorrent://`, опитування кожні 250 мс, читання тільки перевірених libtorrent частин. `BrowserNativeVideoPlayerViewController.m` використовує цей loader та AVPlayer.
- `BrowserTorrentLibraryViewController.h/.m`: модальне вікно бібліотеки, ручний ввід magnet/URL, список торентів і файлів, програвання MP4/M4V/MOV/MP3/M4A.
- `BrowserTorrentKeepAlive.h/.m`, `Info.plist`, `AppDelegate.m`: аудіорежим і перемикач зацикленої тиші.
- `BrowserMenuCoordinator.m`: **Torrents** у Quick Actions, **Keep Alive** у Settings.
- `ViewController.m`: interception magnet та URL із розширенням `.torrent`, але лише додавання + повідомлення «відкрий меню»; автоматичного відкриття клієнта ще немає.
- `scripts/bootstrap-torrent-deps.sh`: pinned завантаження libtorrent XCFramework і Boost headers у ігнорований `.deps/`; контроль SHA-256. `_Project/Browser.xcodeproj` лінкує бібліотеку. Деталі — `TORRENTS.md`.

Остання встановлена в симуляторі збірка **перед сьогоднішніми правками вибору файлів**. У дані симулятора додано magnet вільного фільму *Sintel* (hash `08ada5a7a6183aae1e09d831df6748d566095a10`) й застосунок перезапущено. Наявність у списку та завантаження не підтверджені через UI. Джерело magnet: https://github.com/webtorrent/webtorrent/blob/master/docs/get-started.md . Користувач зараз не може керувати симулятором.

## Правки, зроблені під час сьогоднішнього аудиту

Вони є в робочому дереві та **компілюються**, але не встановлені в симулятор:

- `BrowserTorrentManager.h/.mm`: додані API, які повертають hash/ідентифікатор після імпорту; повторне додавання того самого hash повертає наявний торент. Перевірка magnet більше не вимагає, щоб `xt` був першим параметром. Додані `downloadEnabled`/`padFile`, `setDownloadEnabled:forTorrent:fileIndex:`. Пропущені індекси записуються в `sources.plist` і відновлюються після появи metadata. Pad-файли не пропонуються до завантаження. `prioritizePlaybackForTorrent` увімкне файл для завантаження, якщо його раніше пропустили.
- `BrowserTorrentLibraryViewController.h/.m`: API `selectTorrent:` та `importTorrentRequest:`; натискання рядка файлу показує дії **Play Now (Priority)** (для підтримуваного медіа) і **Skip Download/Download File**. URL `.torrent` качається через `NSURLSession downloadTask`, з HTTP status check та межею 16 МБ перед читанням файла. Таймер оновлює видимі клітинки без `reloadData`, якщо набір рядків не змінився, щоб зменшити втрату фокусу. Ручне додавання вибирає доданий торент.

Команда перевірки:

```sh
xcodebuild -project _Project/Browser.xcodeproj -scheme Browser -configuration Debug -destination 'generic/platform=tvOS Simulator' -derivedDataPath /private/tmp/tvosbrowser-handoff-build CODE_SIGNING_ALLOWED=NO build -quiet
```

Вона завершилась з кодом `0` 2026-09-29. Вивід має численні попередження старого проєкту/локалі; компіляційних помилок немає. `git diff --check` пройшов. Після змін виконано `graphify update .`.

## Критично незавершене: шлях від кліку на сайті

`ViewController.m:774–860` ще використовує **старий** сценарій: `shouldStartLoadWithRequest` імпортує торент і показує alert, але не відкриває бібліотеку. Його треба замінити на спільний метод на кшталт `handleTorrentRequest:`:

1. Magnet: викликати `identifierForMagnetString:error:`, створити `BrowserTorrentLibraryViewController`, викликати `selectTorrent:`, одразу презентувати бібліотеку. Для дубліката відкрити вже наявний торент.
2. `.torrent` URL: одразу показати бібліотеку зі станом «Fetching .torrent file…», викликати `importTorrentRequest:`; після імпорту вона вибере торент або покаже помилку.
3. Перехопити **всі три маршрути**: звичайний `shouldStartLoadWithRequest:`, `shouldCreateNewTabWithRequest:` для `target="_blank"`, і `browserPageActionCoordinatorCreateNewTabWithRequest:`. Останній важливий: `BrowserPageActionCoordinator.m:40–58` обробляє `_blank` до стандартного WebKit navigation callback. Без нього клік на багатьох download/magnet кнопках просто створить вкладку.
4. `BrowserWebView.m:1455` викликає делегат для navigation action. Сайти часто віддають `.torrent` з URL на кшталт `/download?id=…`; додати обробку main-frame navigation **response** з MIME `application/x-bittorrent` або `Content-Disposition: attachment; filename=…torrent`. Не ловити звичайні підресурси й HTML. Для POST/form або авторизованого завантаження простий повторний GET через `NSURLSession` може не спрацювати — окремо опрацювати cookies, метод/body, redirects і помилку, не завантажувати довільні великі відповіді в пам’ять.

## Ризики й крайові випадки для наступного проходу

- **Вибір файлів до metadata.** Для magnet список з’явиться лише після отримання metadata. Зараз торент за замовчуванням починає качати все відразу; користувач зможе вимкнути файли лише після metadata. Обдумати паузу/початкові пріоритети, щоб небажані файли не встигли завантажитися.
- **Фокус tvOS.** Нові дії для рядка й оновлення таблиці не перевірені пультом. Перевірити переходи між кнопками, список, alert, повернення з AVPlayer. Автооновлення не повинно знімати фокус.
- **Пріоритет програвання.** `setDownloadEnabled:` викликає `file_priority`, що скидає спеціальні piece priorities у libtorrent; якщо змінювати вибір інших файлів під час програвання, пріоритет поточного файла може знизитися. Потрібно відстежувати active playback і повторно піднімати потрібні частини. `prioritizeTorrent` зараз піднімає 4 частини при очікуванні loader-а.
- **Asset loader.** `BrowserTorrentAssetLoader.m` кожні 250 мс робить `filesForTorrent`, який запитує прогрес усіх файлів. Це може бути дорого на торентах із тисячами файлів. URL file index береться через `integerValue` з `0.mp4` і не валідований строго; malformed path стає `0`. Перевірити requestsAllDataToEnd, seek, timeout, pause/remove під час відтворення, порожні й великі файли, content type, MP4 з `moov` наприкінці.
- **Збереження вибору.** `skipped` зберігається за індексами у `sources.plist`; перевірити відновлення після перезапуску та появи magnet metadata. Кеш tvOS може видалити metadata/index або завантажені частини. Наявність файла в кеші не гарантується.
- **Паралельність.** `NSURLSession` completion додає торент з фонового потоку, тоді як UI та loader одночасно читають manager; синхронізація `skippedFilesByHash` часткова, а читання/запис `sources.plist` не повністю серіалізовані. Варто звести операції manager на одну serial queue або чітко синхронізувати всі операції.
- **Помилки сесії.** Немає опрацювання libtorrent alerts: tracker/диск/відсутність місця, відсутність peerів, metadata timeout. UI показує лише загальний стан. Pause/resume зараз не зберігається після перезапуску.
- **Видалення й спільні частини.** `deleteFiles` асинхронний у libtorrent; перевірити повторне додавання того самого hash відразу після видалення. Файл зі статусом Skip може отримати байти через спільну piece з вибраним файлом; це нормальна особливість BitTorrent, прогрес і підпис мають бути зрозумілі.
- **Keep Alive.** Це експеримент; відтворення тиші не гарантує роботу у фоні на tvOS. `stop` деактивує спільну audio session і може зачепити активний AVPlayer — перевірити.
- **Формати.** Вбудований AVPlayer зараз допускає лише MP4/M4V/MOV/MP3/M4A. MKV/AVI не відтворюються. Не відкривати файл, позначений як padding.

## Порядок роботи завтра

1. Завершити три маршрути кліку та автоматичне відкриття бібліотеки; імпорт URL із response MIME/filename.
2. Перевірити й за потреби полагодити manager selection persistence, concurrency та active playback priority.
3. Перезібрати й встановити в симулятор; перевірити UI пультом на magnet *Sintel* і на реальному `.torrent` URL. Перевірити file toggle, playback, seek, pause/resume, restart, duplicate, remove, network failure.
4. Коли буде доступний Apple TV «test Apple TV», виконати фізичну збірку/встановлення за `AGENTS.md` і перевірити на пристрої. Наразі пристрій був `unavailable`.
5. Лише після працездатного основного шляху реалізувати праву верхню іконку для знайдених на сторінці torrent/magnet посилань.
6. Після будь-яких змін коду запускати `graphify update .`. Не створювати commits/push.

## Корисні шляхи й стан середовища

- Xcode: `_Project/Browser.xcodeproj`, схема `Browser`.
- Симулятор: Apple TV 4K (3rd generation), tvOS 18.2, ID `SIMULATOR_ID`.
- Залежності: ігнорований `.deps/libtorrent.xcframework` і `.deps/boost-1.69.0`; якщо відсутні, `scripts/bootstrap-torrent-deps.sh`.
- Індекс тестового *Sintel* у контейнері симулятора; контейнерний UUID змінюється після перевстановлення, тому знаходити через `xcrun simctl get_app_container <ID> org.example.tvosbrowser data`.
- `graphify-out/graph.json` існує; для питань про код спочатку `graphify query`, як вимагає `AGENTS.md`.
