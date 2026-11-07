// Runs inside the all-frame click bridge, sharing its fullscreen scope and secret.
var mediaHandlers = Object.create(null);
var mediaSessionID = '';
var mediaTimer = null;
var mediaFrameState = null;
var mediaFrameStateTime = 0;
var mediaObservedFrame = null;
var mediaRequestSerial = 0;
var mediaAcceptedSerial = 0;
var mediaActive = false;
var mediaSuspended = false;
var mediaSavedVolume = null;
var mediaVolumeReady = false;
var mediaVolumeVideos = new WeakMap();
var mediaVLCRequests = Object.create(null);
var mediaVLCSerial = 0;
function directVideoSource(video) {
    var source = video.currentSrc || video.src;
    if (!source) {
        var sources = Array.prototype.slice.call(video.querySelectorAll('source[src]'));
        var candidate = sources.find(function(item) { return !item.type || video.canPlayType(item.type); }) || sources[0];
        source = candidate && candidate.src;
    }
    if (!source) return null;
    try { source = new URL(source, document.baseURI); } catch (error) { return null; }
    return /^https?:$/.test(source.protocol) && source.hostname && source.href.length <= 8192 ? source.href : null;
}
window.__browserTVOpenControlledVideo = function(element) {
    if (window !== window.top || !element || element.tagName !== 'VIDEO' || !element.controls || !directVideoSource(element)) return false;
    enterFullscreen(element);
    return true;
};
function publishVLCRequest(id, info) {
    if (window !== window.top) return;
    try { window.webkit.messageHandlers.browserFullscreenMedia.postMessage(
        Object.assign({token:nativeToken,session:id,vlcRequest:true},info)); } catch(error) {}
}
function requestVLCFullscreen(element) {
    if (window !== window.top) return;
    var videos = element.tagName === 'VIDEO' ? [element] : Array.prototype.slice.call(element.querySelectorAll('video'));
    var video = videos.find(function(v) { return !v.paused && !v.ended; }) || videos[0];
    if (!video) return;
    var source = directVideoSource(video);
    if (!source) return;
    var id = secret + ':' + Date.now() + ':vlc:' + (++mediaVLCSerial);
    mediaVLCRequests[id] = {video: video, url: source};
    publishVLCRequest(id, {url: source, title: document.title.slice(0, 512),
        currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        volume: video.volume, muted: video.muted, documentURL: location.href,
        referrerPolicy: video.referrerPolicy || document.referrerPolicy ||
            ((document.querySelector('meta[name="referrer"]') || {}).content) || 'strict-origin-when-cross-origin',
        crossOrigin: video.crossOrigin || ''});
}
window.__browserTVVLCRequestIsCurrent = function(id) {
    return !!mediaVLCRequests[id] && !!(fullscreenTarget || fullscreenFrame);
};
window.__browserTVVLCResponse = function(id, action, time, volume, muted) {
    var request = mediaVLCRequests[id];
    if (!request) return false;
    if (request.video && request.video.isConnected) {
        var video = request.video;
        if (action === 'accepted') video.pause();
        if (action === 'closed' && (video.currentSrc || video.src) === request.url) {
            try {
                if (Number.isFinite(time)) video.currentTime = Math.max(0, time);
                if (Number.isFinite(volume)) video.volume = Math.max(0, Math.min(1, volume));
                video.muted = !!muted;
            } catch (error) {}
        }
    }
    if (action === 'accepted') window.__browserTVExitFullscreen();
    else delete mediaVLCRequests[id];
    return true;
};
document.addEventListener('loadedmetadata', function(event) {
    if (event.target && event.target.tagName === 'VIDEO') mediaVolumeVideos.delete(event.target);
}, true);
function restoreMediaVideoVolume(preference) {
    if (preference && preference.episodes && typeof preference.episodes.project === 'string' && Array.isArray(preference.episodes.episodes)) {
        var incoming = preference.episodes;
        if (starlightCatalog && starlightCatalog.project === incoming.project && starlightCatalog.season === incoming.season) {
            var known = new Set(incoming.episodes.map(function(item) { return item.hash; }));
            incoming.episodes = incoming.episodes.concat(starlightCatalog.episodes.filter(function(item) { return !known.has(item.hash); })).slice(0, 2000);
        }
        starlightCatalog = incoming;
    } else if (preference && preference.episodes === null) starlightCatalog = null;
    var v = mediaVideo();
    var value = preference && preference.volume;
    if (!v || !Number.isFinite(value) || value < 0 || value > 1) return;
    var source = v.currentSrc || v.src || '';
    var restored = mediaVolumeVideos.get(v);
    if (restored && restored.source === source && restored.session === preference.session) return;
    try {
        v.volume = value;
        mediaVolumeVideos.set(v, {source: source, session: preference.session});
    } catch (error) {}
}
function mediaFrame() {
    return fullscreenFrame || (fullscreenTarget && fullscreenTarget.tagName === 'IFRAME' ? fullscreenTarget : null);
}
function mediaVideo() {
    var root = fullscreenTarget && fullscreenTarget.tagName !== 'IFRAME' ? fullscreenTarget : document;
    if (root.tagName === 'VIDEO') return root;
    var videos = Array.prototype.slice.call(root.querySelectorAll('video'));
    return videos.find(function(v) { return !v.paused && !v.ended; }) || videos.find(function(v) {
        var r = v.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    }) || null;
}
try {
    if (navigator.mediaSession) {
        var originalSetActionHandler = navigator.mediaSession.setActionHandler;
        navigator.mediaSession.setActionHandler = function(action, handler) {
            originalSetActionHandler.call(this, action, handler);
            if (handler) mediaHandlers[action] = handler;
            else delete mediaHandlers[action];
        };
    }
} catch (error) {}
// Capability-based fallback: use the player's own control, including fetch_next.
function playerTrackControl(previous) {
    if (!window.adt || !adt.player || !window.player || typeof window.player[previous ? 'previous' : 'next'] !== 'function') return null;
    var button = document.querySelector(previous ? '.adt-w_4nLvJ' : '.adt-kCdJnjy');
    return button && button.isConnected && !button.hidden && button.getAttribute('aria-disabled') !== 'true' &&
        getComputedStyle(button).display !== 'none' ? button : null;
}
// Starlight adapter. Keep the working Next control route unchanged.
var starlightCatalog = null;
var starlightCatalogRequest = null;
var starlightCatalogPath = null;
var starlightPreviousRequest = null;
function starlightPlayer() {
    var p = window.player;
    return window.adt && adt.player && window.starlight && typeof starlight.fetchVideo === 'function' &&
        p && p.source && p.source.id && p.group && Array.isArray(p.group.playlist) ? p : null;
}
function starlightSourceTitle() {
    var p = starlightPlayer();
    if (!p || typeof p.source.title !== 'string') return '';
    var parsed = new DOMParser().parseFromString(p.source.title.slice(0, 4096), 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 512);
}
function starlightEpisodeNumber(name) {
    var match = typeof name === 'string' && /^(?:Серія|Серия|Episode)\s+(\d+)$/i.exec(name.trim());
    return match ? Number(match[1]) : null;
}
function starlightPredecessor() {
    var p = starlightPlayer();
    if (!p || !starlightCatalog) return null;
    var number = starlightEpisodeNumber(p.source.name);
    var title = starlightSourceTitle();
    if (!number || !title.startsWith(starlightCatalog.project + ' | ' + starlightCatalog.season + ' ')) return null;
    if (!starlightCatalog.episodes.some(function(item) { return item.hash === p.source.id; }))
        starlightCatalog.episodes.push({hash:p.source.id,number:number});
    return starlightCatalog.episodes.find(function(item) { return item.number === number - 1; }) || null;
}
function requestStarlightPrevious() {
    var p = starlightPlayer(), previous = starlightPredecessor();
    if (!p || !previous) return false;
    if (starlightPreviousRequest) return true;
    var source = p.source, group = p.group, scope = fullscreenTarget, request = {};
    starlightPreviousRequest = request;
    // fetchPrevious/get/prev is 404 on the observed server. Resolve the actual
    // preceding hash from the host's published season index and use fetchVideo.
    Promise.resolve().then(function() {
        return starlight.fetchVideo(previous.hash, window.PAGE_REFERER, window.sld_locale || 'ua');
    }).then(function(resolved) {
        if (starlightPreviousRequest !== request || window.player !== p || p.source !== source || p.group !== group ||
            (scope && fullscreenTarget !== scope) || !resolved || resolved.id !== previous.hash) return;
        var existing = group.playlist.find(function(item) { return item.id === resolved.id; });
        var index = group.playlist.indexOf(source);
        if (index < 0) return;
        if (!existing) { group.playlist.splice(index, 0, resolved); existing = resolved; }
        p.source = existing;
    }).catch(function() {}).then(function() {
        if (starlightPreviousRequest === request) starlightPreviousRequest = null;
    });
    return true;
}
function prepareStarlightCatalog() {
    // Teleportal host metadata adapter, separate from the Starlight player API.
    if (window !== window.top || location.hostname !== 'teleportal.ua') return;
    var path = location.pathname;
    if (starlightCatalogPath !== path) { starlightCatalogPath = path; starlightCatalogRequest = null; starlightCatalog = null; }
    if (starlightCatalogRequest) return;
    if (!/^\/(ua|ru)\/(serials|show)\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/?$/.test(path)) return;
    starlightCatalogRequest = fetch('https://tp-back.starlight.digital' + path).then(function(response) {
        if (!response.ok) throw new Error('metadata');
        return response.json();
    }).then(function(data) {
        if (location.pathname !== path || !data.seasonGallery || !Array.isArray(data.seasonGallery.items) ||
            typeof data.projectTitle !== 'string' || typeof data.seasonSlug !== 'string' || typeof data.hash !== 'string') return;
        var episodes = data.seasonGallery.items.concat([{hash:data.hash,seriesTitle:data.seriesTitle}]).map(function(item) {
            return {hash:item.hash,number:Number(item.seriesTitle)};
        }).filter(function(item) { return typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash) && Number.isInteger(item.number) && item.number > 0; });
        starlightCatalog = {project:data.projectTitle.slice(0,512),season:data.seasonSlug.slice(0,128),episodes:episodes.slice(0,2000)};
    }).catch(function() {});
}
function mediaState() {
    var v = mediaVideo();
    var current = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    var duration = v && Number.isFinite(v.duration) ? v.duration : 0;
    var seekable = !!(v && v.seekable.length);
    return {available: !!v || !!mediaHandlers.play || !!mediaHandlers.pause,
        paused: v ? v.paused : !(navigator.mediaSession && navigator.mediaSession.playbackState === 'playing'),
        currentTime: current, duration: duration, muted: !!(v && v.muted), canMute: !!v,
        volume: v && Number.isFinite(v.volume) ? v.volume : 0, canVolume: !!v,
        canSeekBack: seekable || !!mediaHandlers.seekbackward,
        canSeekForward: seekable || !!mediaHandlers.seekforward,
        seekAtStart: seekable ? current <= v.seekable.start(0) : !!v && current <= 0,
        seekAtEnd: seekable ? current >= v.seekable.end(v.seekable.length - 1) : duration > 0 && current >= duration,
        canPrevious: !!mediaHandlers.previoustrack || !!starlightPredecessor() || !!playerTrackControl(true) || (current > 5 && (seekable || !!mediaHandlers.seekto)),
        canNext: !!mediaHandlers.nexttrack || !!playerTrackControl(false),
        routesNext: !!mediaHandlers.nexttrack || !!playerTrackControl(false),
        routesPrevious: !!mediaHandlers.previoustrack || !!starlightPredecessor() || !!playerTrackControl(true),
        adapterTitle: starlightSourceTitle(),
        canRestart: seekable || !!mediaHandlers.seekto,
        canEnd: duration > 0 && (seekable || !!mediaHandlers.seekto)};
}
function publishNativeMedia(state) {
    if (window !== window.top) return;
    try {
        window.webkit.messageHandlers.browserFullscreenMedia.postMessage(
            Object.assign({token: nativeToken, session: mediaSessionID, active: mediaActive}, state || {}, {pageTitle: state && typeof state.adapterTitle === 'string' && state.adapterTitle ? state.adapterTitle.slice(0,512) : document.title.slice(0, 512)}));
    } catch (error) {}
}
function requestMediaState(request, volume) {
    var frame = mediaFrame();
    if (frame && frame.isConnected && frame.contentWindow) {
        frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'media', command: 'status', value: volume, request: request}, '*');
    } else if (window !== window.top) {
        restoreMediaVideoVolume(volume);
        window.parent.postMessage({browserTVMediaState: secret, request: request, state: mediaState()}, '*');
    }
}
function refreshFullscreenMedia() {
    if (window !== window.top) return;
    var frame = mediaFrame();
    var active = !mediaSuspended && !!(frame && frame.isConnected);
    if (active && frame === mediaObservedFrame) return;
    clearInterval(mediaTimer); mediaTimer = null;
    mediaObservedFrame = active ? frame : null;
    mediaActive = active;
    mediaVolumeReady = false;
    mediaFrameState = null; mediaFrameStateTime = 0;
    mediaSessionID = active ? secret + ':' + Date.now() + ':' + (++mediaRequestSerial) : '';
    mediaAcceptedSerial = mediaRequestSerial;
    publishNativeMedia();
    if (!active) return;
    publishNativeMedia({loadVolume: true});
    function tick() {
        if (!frame.isConnected) {
            window.__browserTVExitFullscreen();
            mediaActive = false; mediaObservedFrame = null;
            clearInterval(mediaTimer); mediaTimer = null; publishNativeMedia(); return;
        }
        if (mediaFrameState && Date.now() - mediaFrameStateTime > 2000) {
            mediaFrameState = null; publishNativeMedia();
        }
        prepareStarlightCatalog();
        if (mediaVolumeReady) requestMediaState(++mediaRequestSerial, {volume: mediaSavedVolume, session: mediaSessionID, episodes:starlightCatalog});
        else publishNativeMedia({loadVolume: true});
    }
    prepareStarlightCatalog();
    tick(); mediaTimer = setInterval(tick, 500);
}
function receiveMediaState(event, data) {
    var frame = mediaFrame();
    if (!frame || event.source !== frame.contentWindow || !data.state || typeof data.state !== 'object') return;
    if (window !== window.top) {
        window.parent.postMessage({browserTVMediaState: secret, request: data.request, state: data.state}, '*');
    } else if (mediaActive && Number.isInteger(data.request) && data.request > mediaAcceptedSerial && data.request <= mediaRequestSerial) {
        mediaAcceptedSerial = data.request;
        mediaFrameState = data.state; mediaFrameStateTime = Date.now();
        if (data.state.canVolume && Number.isFinite(data.state.volume)) mediaSavedVolume = data.state.volume;
        publishNativeMedia(data.state);
    }
}
function performMediaCommand(command, value, request) {
    if (command === 'status') { requestMediaState(request, value); return true; }
    if (command === 'next' || command === 'exit') starlightPreviousRequest = null;
    if (command === 'endNext') {
        performMediaCommand('end', 0, request);
        return performMediaCommand('next', 0, request);
    }
    // Hardware media actions may belong to the embedding page, not the video frame.
    var trackAction = command === 'previous' ? 'previoustrack' : command === 'next' ? 'nexttrack' : null;
    if (trackAction && mediaHandlers[trackAction]) {
        try { mediaHandlers[trackAction]({action: trackAction}); } catch (error) {}
        return true; // A throwing handler may already have submitted the action.
    }
    var frame = mediaFrame();
    if (trackAction && window === window.top && frame && (!mediaFrameState ||
        !mediaFrameState[command === 'next' ? 'routesNext' : 'routesPrevious'])) return false;
    if (frame && frame.isConnected && frame.contentWindow) {
        frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'media', command: command, value: value, request: request}, '*');
        return true;
    }
    if (command === 'previous' && requestStarlightPrevious()) return true;
    if (command === 'next' || command === 'previous') {
        var trackControl = playerTrackControl(command === 'previous');
        if (trackControl) { trackControl.click(); return true; }
    }
    var v = mediaVideo();
    var state = mediaState();
    var action, details = {};
    if (command === 'volume' && Number.isFinite(value) && Math.abs(value) <= 1) {
        if (!v) return false;
        try {
            v.volume = Math.max(0, Math.min(1, Math.round((v.volume + value) * 100) / 100));
            requestMediaState(request);
            return true;
        }
        catch (error) { return false; }
    }
    if (command === 'mute') {
        if (!v) return false;
        v.muted = !v.muted;
        return true;
    }
    // Resolve percentages in the actual video frame, independently of native polling.
    var percentSeek = command === 'seekPercent';
    if (percentSeek) {
        if (!Number.isFinite(value) || Math.abs(value) !== 0.1 || !(state.duration > 0)) return false;
        value *= state.duration;
    }
    if (command === 'toggle') action = state.paused ? 'play' : 'pause';
    else if ((command === 'seek' || percentSeek) && Number.isFinite(value) && (percentSeek || Math.abs(value) <= 120)) {
        action = value < 0 ? 'seekbackward' : 'seekforward'; details.seekOffset = Math.abs(value);
    } else if (command === 'previous') {
        action = 'previoustrack';
    } else if (command === 'next') action = 'nexttrack';
    else if (command === 'restart') { action = 'seekto'; details.seekTime = 0; }
    else if (command === 'end' && state.canEnd) { action = 'seekto'; details.seekTime = Math.max(0, state.duration - 2); }
    if (!action) return false;
    details.action = action;
    try {
        if (mediaHandlers[action] && !trackAction) { mediaHandlers[action](details); return true; }
        if (action === 'nexttrack' || action === 'previoustrack') return false;
        if (!v) return false;
        if (action === 'play') { var p = v.play(); if (p && p.catch) p.catch(function() {}); }
        else if (action === 'pause') v.pause();
        else if ((action === 'seekbackward' || action === 'seekforward' || action === 'seekto') && v.seekable.length) {
            var start = v.seekable.start(0), end = v.seekable.end(v.seekable.length - 1);
            var target = action === 'seekto' ? (command === 'restart' ? start : details.seekTime) : v.currentTime + value;
            // Clamp to a real seekable range, including live windows and gaps.
            target = Math.max(start, Math.min(end, target));
            for (var i = 0; i < v.seekable.length; i++) {
                if (target <= v.seekable.end(i)) { target = Math.max(target, v.seekable.start(i)); break; }
            }
            v.currentTime = target;
        } else return false;
        return true;
    } catch (error) { return false; }
}
window.__browserTVSetFullscreenMediaSuspended = function(suspended) {
    if (mediaSuspended === !!suspended) return;
    mediaSuspended = !!suspended; refreshFullscreenMedia();
};
window.__browserTVResetMediaVolume = function() {
    mediaSavedVolume = 1;
    mediaVolumeVideos = new WeakMap();
    mediaFrameState = null;
    mediaAcceptedSerial = ++mediaRequestSerial;
    function reset(root) {
        Array.prototype.forEach.call(root.querySelectorAll('video'), function(video) {
            try { video.volume = 1; } catch (error) {}
        });
        Array.prototype.forEach.call(root.querySelectorAll('*'), function(element) {
            if (element.tagName === 'IFRAME' && element.contentWindow) {
                element.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'resetVolume'}, '*');
            }
            if (element.shadowRoot) reset(element.shadowRoot);
        });
    }
    reset(document);
};
window.__browserTVRestoreFullscreenVolume = function(session, volume) {
    if (window !== window.top || !mediaActive || session !== mediaSessionID || mediaVolumeReady) return;
    mediaSavedVolume = Number.isFinite(volume) ? volume : null;
    mediaVolumeReady = true;
    requestMediaState(++mediaRequestSerial, {volume: mediaSavedVolume, session: mediaSessionID, episodes:starlightCatalog});
};
window.__browserTVSendFullscreenMediaCommand = function(command, value, session) {
    if (window !== window.top || mediaSuspended || !mediaActive || session !== mediaSessionID) return false;
    if (command === 'exit') return window.__browserTVExitFullscreen();
    if (command === 'volume' && !mediaVolumeReady) return false;
    return performMediaCommand(command, value, ++mediaRequestSerial);
};
window.addEventListener('pagehide', function() {
    mediaVLCRequests = Object.create(null);
    clearInterval(mediaTimer); mediaTimer = null;
    mediaActive = false; publishNativeMedia();
    if (fullscreenTarget || fullscreenFrame) sendFullscreenToParent('exit');
});
