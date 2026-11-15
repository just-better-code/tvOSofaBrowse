"""Private stdio-only Linux libVLC decoder host. Never prints media URLs/cookies."""
import ctypes as c
import ctypes.util
import json
import os
import queue
import threading
import sys
import time
from email.utils import formatdate

def emit(event, **values):
    print(json.dumps(dict(event=event, **values)), flush=True)

configuration = json.loads(sys.stdin.readline())
log = os.open(configuration['logPath'], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.dup2(log, 2)
os.close(log)

class Stats(c.Structure):
    _fields_ = [(name, c.c_float if name.startswith('f_') else c.c_int) for name in [
        'i_read_bytes','f_input_bitrate','i_demux_read_bytes','f_demux_bitrate',
        'i_demux_corrupted','i_demux_discontinuity','i_decoded_video','i_decoded_audio',
        'i_displayed_pictures','i_lost_pictures','i_played_abuffers','i_lost_abuffers',
        'i_sent_packets','i_sent_bytes','f_send_bitrate']]

library = ctypes.util.find_library('vlc')
if not library:
    emit('failure', reason='libvlc-unavailable')
    sys.exit(1)
lib = c.CDLL(library)
ptr = c.c_void_p

def fn(name, result, args):
    value = getattr(lib, name)
    value.restype, value.argtypes = result, args
    return value

new = fn('libvlc_new', ptr, [c.c_int, c.POINTER(c.c_char_p)])
media_new = fn('libvlc_media_new_location', ptr, [ptr, c.c_char_p])
option = fn('libvlc_media_add_option', None, [ptr, c.c_char_p])
store_cookie = fn('libvlc_media_store_cookie', c.c_bool, [ptr,c.c_char_p,c.c_char_p,c.c_char_p]) if hasattr(lib,'libvlc_media_store_cookie') else None
if configuration.get('cookies') and store_cookie is None:
    emit('failure',reason='required-cookie-store-api-unavailable')
    sys.exit(1)
player_new = fn('libvlc_media_player_new_from_media', ptr, [ptr])
play = fn('libvlc_media_player_play', c.c_int, [ptr])
stop = fn('libvlc_media_player_stop', None, [ptr])
get_time = fn('libvlc_media_player_get_time', c.c_longlong, [ptr])
get_length = fn('libvlc_media_player_get_length',c.c_longlong,[ptr])
set_time = fn('libvlc_media_player_set_time', None, [ptr,c.c_longlong])
pause = fn('libvlc_media_player_set_pause', None, [ptr,c.c_int])
seekable = fn('libvlc_media_player_is_seekable', c.c_int, [ptr])
state = fn('libvlc_media_player_get_state', c.c_int, [ptr])
has_vout = fn('libvlc_media_player_has_vout', c.c_uint, [ptr])
get_size = fn('libvlc_video_get_size', c.c_int, [ptr,c.c_uint,c.POINTER(c.c_uint),c.POINTER(c.c_uint)])
stats_fn = fn('libvlc_media_get_stats', c.c_int, [ptr,c.POINTER(Stats)])
fullscreen = fn('libvlc_set_fullscreen',None,[ptr,c.c_int])
version = fn('libvlc_get_version', c.c_char_p, [])
release_player = fn('libvlc_media_player_release', None, [ptr])
release_media = fn('libvlc_media_release', None, [ptr])
release = fn('libvlc_release', None, [ptr])
arguments = [b'--intf=dummy', *([] if configuration.get('output')=='window' else [b'--vout=dummy']), b'--aout=dummy', b'--no-video-title-show', b'--no-osd', b'--stats', b'--avcodec-hw=none']
instance = new(len(arguments), (c.c_char_p * len(arguments))(*arguments))
media = media_new(instance, configuration['url'].encode())
for value in [':network-caching=2000', ':http-forward-cookies=1', ':start-time='+str(max(0,configuration.get('currentTime',0))),
              ':http-referrer='+configuration['referrer'], ':http-user-agent='+configuration['userAgent']]:
    option(media, value.encode())
stored = 0
for cookie in configuration.get('cookies', []):
    if cookie.get('expires', -1) > 0 and cookie['expires'] <= time.time():
        continue
    if any(ch in cookie['name'] for ch in '\r\n;= ') or any(ch in cookie['value'] for ch in '\r\n;') or any(ch in cookie['path'] for ch in '\r\n;'):
        continue
    value = cookie['name']+'='+cookie['value']+'; Path='+cookie['path']
    if cookie['domain'].startswith('.'):
        value += '; Domain='+cookie['domain']
    if cookie.get('secure'): value += '; Secure'
    if cookie.get('httpOnly'): value += '; HttpOnly'
    if cookie.get('expires', -1) > 0: value += '; Expires='+formatdate(cookie['expires'], usegmt=True)
    stored += bool(store_cookie(media,value.encode(),cookie['domain'].lstrip('.').encode(),cookie['path'].encode()))
player = player_new(media)
started = time.monotonic()
pending_seek = max(0, int(configuration.get('currentTime', 0)*1000))
last_time = -1
baseline_decoded = baseline_shown = 0
ready = False
width, height = c.c_uint(), c.c_uint()
stats = Stats()
last_state = None
commands=queue.Queue()
def read_commands():
    for line in sys.stdin:
        try: commands.put(json.loads(line))
        except ValueError: emit('command-error',reason='invalid-json')
    commands.put(None)
threading.Thread(target=read_commands,daemon=True).start()
try:
    if configuration.get('presentImmediately') and configuration.get('output')=='window': fullscreen(player,1)
    if play(player) != 0:
        emit('failure', reason='play-failed')
        sys.exit(1)
    emit('started', libVLC=version().decode(), cookiesStored=stored, cookieStoreAPI=store_cookie is not None, output=configuration.get('output','dummy'), networkCacheMs=2000, nativeTV=False)
    while True:
        try: command=commands.get(timeout=0.1)
        except queue.Empty: command={}
        if command is None: break
        if command:
            action = command.get('action')
            if action == 'stop':
                emit('stopped', timeMs=get_time(player))
                break
            if action == 'activate':
                pause(player, 0)
                if configuration.get('output')=='window': fullscreen(player,1)
            elif action == 'pause': pause(player, 1)
            elif action == 'seek': set_time(player, int(command['time']*1000))
            elif action == 'status':
                stats_fn(media, c.byref(stats))
                emit('status', timeMs=get_time(player), lengthMs=get_length(player), state=state(player), decodedVideo=stats.i_decoded_video,
                     displayedPictures=stats.i_displayed_pictures, decodedAudio=stats.i_decoded_audio, ready=ready)
        current_state = state(player)
        if current_state != last_state:
            emit('state', state=current_state, timeMs=get_time(player))
            last_state = current_state
        stats_fn(media, c.byref(stats))
        now = get_time(player)
        if not ready:
            if current_state == 7:
                emit('failure', reason='decoder-error'); break
            if time.monotonic()-started > 15:
                emit('failure', reason='preparation-timeout'); break
            if pending_seek and current_state == 3 and seekable(player):
                baseline_decoded, baseline_shown = stats.i_decoded_video, stats.i_displayed_pictures
                if abs(now-pending_seek)>1000:
                    set_time(player, pending_seek)
                    emit('seek', timeMs=pending_seek)
                pending_seek = 0
                last_time = -1
                continue
            get_size(player, 0, c.byref(width), c.byref(height))
            if not pending_seek and current_state == 3 and stats.i_decoded_video >= baseline_decoded+3 and stats.i_displayed_pictures > baseline_shown and has_vout(player) and width.value and height.value and last_time >= 0 and 0 < now-last_time < 5000:
                ready = True
                if configuration.get('pauseOnReady',False): pause(player, 1)
                emit('ready', timeMs=now, lengthMs=get_length(player), width=width.value, height=height.value,
                     decodedVideo=stats.i_decoded_video, displayedPictures=stats.i_displayed_pictures,
                     decodedAudio=stats.i_decoded_audio, elapsedMs=round((time.monotonic()-started)*1000))
            last_time = now
        elif current_state == 6:
            emit('ended', timeMs=now)
            break
finally:
    stop(player)
    release_player(player)
    release_media(media)
    release(instance)
