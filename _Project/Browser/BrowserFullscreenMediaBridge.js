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
// Configuration comes from native at document start and follows the real frame tree.
var mediaVLCIframeCapture = false;
var mediaVLCCaptureActive = false;
var mediaVLCFrameVisible = false;
var mediaVLCWatched = new Map();
var mediaVLCWatchTimer = null;
var mediaVLCResourceObserver = null;
var mediaVLCNextOfferAt = 0;
var mediaVLCWebsiteEnds = new WeakMap();
var mediaVLCPlayerJSInstances = [];
var mediaVLCPlayerJSFactories = new WeakSet();
var mediaAcceptedEpisode = null;
// PlayerJS documents api('hls'), api('id') and playlist commands. Keep the
// constructed API objects without probing unrelated globals or network traffic.
function observePlayerJSFactory() {
    if (typeof window.Playerjs !== 'function') return;
    var original = window.Playerjs;
    if (mediaVLCPlayerJSFactories.has(original)) return;
    function remember(player) {
        try {
            if (player && typeof player.api === 'function' && mediaVLCPlayerJSInstances.indexOf(player) < 0) {
                mediaVLCPlayerJSInstances.push(player);
                if (mediaVLCPlayerJSInstances.length > 16) mediaVLCPlayerJSInstances.shift();
            }
        } catch (error) {}
        return player;
    }
    try {
        var wrapped = new Proxy(original, {
            construct: function(target, args, newTarget) { return remember(Reflect.construct(target, args, newTarget)); },
            apply: function(target, receiver, args) { return remember(Reflect.apply(target, receiver, args)); }
        });
        window.Playerjs = wrapped;
        mediaVLCPlayerJSFactories.add(original);
        mediaVLCPlayerJSFactories.add(wrapped);
    } catch (error) {}
}
// A library's load event runs before the following script creates its players.
document.addEventListener('load', function(event) {
    if (event.target && event.target.tagName === 'SCRIPT') observePlayerJSFactory();
}, true);
document.addEventListener('DOMContentLoaded', observePlayerJSFactory);
function playerJSVideoBinding(video) {
    if (!video) return null;
    for (var i = mediaVLCPlayerJSInstances.length - 1; i >= 0; i--) {
        try {
            var player = mediaVLCPlayerJSInstances[i];
            var id = player.api('id');
            var container = typeof id === 'string' && id.length <= 256 && document.getElementById(id);
            if (container && container.isConnected && container.contains(video))
                return {player:player, hls:player.api('hls')};
        } catch (error) {}
    }
    return null;
}
window.__browserTVSetIframeVLCExperiment = function(enabled, active, visible) {
    mediaVLCIframeCapture = enabled === true;
    mediaVLCCaptureActive = active !== false;
    mediaVLCFrameVisible = visible !== false;
    function notify(root) {
        Array.prototype.forEach.call(root.querySelectorAll('*'), function(element) {
            if ((element.tagName === 'IFRAME' || element.tagName === 'FRAME') && element.contentWindow)
                element.contentWindow.postMessage({browserTVVLCConfiguration:secret, enabled:mediaVLCIframeCapture, active:mediaVLCCaptureActive, visible:mediaVLCFrameVisible && visibleVLCCandidate(element)}, '*');
            if (element.shadowRoot) notify(element.shadowRoot);
        });
    }
    notify(document);
    observePlayerJSFactory();
    if (!mediaVLCIframeCapture || !mediaVLCCaptureActive || !mediaVLCFrameVisible) {
        stopVLCWatch();
        discardUnacceptedVLCRequests();
    }
    observeVLCResources();
    resumeAbortedVLCVideos();
    if (mediaVLCIframeCapture) scanAutomaticVLCVideos();
};
window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;
    if (window !== window.top && event.source === window.parent && data.browserTVVLCConfiguration === secret)
        window.__browserTVSetIframeVLCExperiment(data.enabled === true, data.active !== false, data.visible !== false);
    else if (data.browserTVVLCConfigurationRequest === secret) {
        var frame = frameForSource(event.source);
        if (frame && frame.isConnected) event.source.postMessage({browserTVVLCConfiguration:secret, enabled:mediaVLCIframeCapture, active:mediaVLCCaptureActive, visible:mediaVLCFrameVisible && visibleVLCCandidate(frame)}, '*');
    }
});
var mediaVLCVisibilityTimer = null;
function refreshVLCCaptureVisibility() {
    if (!mediaVLCIframeCapture || mediaVLCVisibilityTimer) return;
    mediaVLCVisibilityTimer = setTimeout(function() {
        mediaVLCVisibilityTimer = null;
        window.__browserTVSetIframeVLCExperiment(mediaVLCIframeCapture, mediaVLCCaptureActive, mediaVLCFrameVisible);
        if (window !== window.top) window.parent.postMessage({browserTVVLCConfigurationRequest:secret}, '*');
    }, 100);
}
window.addEventListener('scroll', refreshVLCCaptureVisibility, {passive:true});
window.addEventListener('resize', refreshVLCCaptureVisibility);
if (window !== window.top) window.parent.postMessage({browserTVVLCConfigurationRequest:secret}, '*');
else try { window.webkit.messageHandlers.browserFullscreenMedia.postMessage({token:nativeToken,session:'vlc-config',vlcConfigRequest:true}); } catch(error) {}

// Existing Starlight capability adapter: bind to this actual video's engine,
// never to the embedding domain or a recently observed network URL.
function starlightVideoEngine(video) {
    if (!video || !window.adt || typeof adt.player !== 'function') return null;
    var engine = video.engine;
    return engine && engine.video === video && engine.source && engine.source.id &&
        Array.isArray(engine.source.sources) && engine.group && Array.isArray(engine.group.playlist) ? engine : null;
}
function vlcVideoSource(video) {
    var source = video.currentSrc || video.src;
    if (!source) {
        var sources = Array.prototype.slice.call(video.querySelectorAll('source[src]'));
        var candidate = sources.find(function(item) { return !item.type || video.canPlayType(item.type); }) || sources[0];
        source = candidate && candidate.src;
    }
    if (!source || video.mediaKeys) return null;
    var engine = starlightVideoEngine(video);
    if (engine) {
        try {
            var adapter = engine.attachedAdapter;
            // Ads temporarily borrow the same video, while the content adapter
            // retains/detaches its own source. Never offer that unrelated media.
            if (!adapter || !adapter.mediaSource || adapter.mediaSource !== source) return null;
            if (/^blob:/.test(source)) {
                if (!mediaVLCIframeCapture || !adapter.isSoftwareHLSAdapter || !adapter.hls ||
                    adapter.hls.media !== video || adapter.hls.config.emeEnabled) return null;
                source = adapter.currentUrl;
                if (source !== adapter.hls.url || !engine.source.sources.some(function(stream) {
                    return stream.type === 'HLS' && Array.isArray(stream.source) && stream.source.some(function(item) {
                        return item && item.url === source;
                    });
                })) return null;
            }
        } catch (error) { return null; }
    } else {
        var binding = playerJSVideoBinding(video);
        if (binding && binding.hls) {
            try {
                // The documented HLS plugin must own this actual Blob video.
                // Its ad video, detached loader or EME source is not eligible.
                // Ignore an uninitialized HLS plugin for ordinary HTTP video.
                // Only a loader with a source owns this decision.
                var hlsURL = binding.hls.url;
                if (typeof hlsURL === 'string' && hlsURL) {
                    if (!mediaVLCIframeCapture) {
                        if (/^blob:/.test(source)) return null;
                    } else {
                        if (!/^blob:/.test(source) || binding.hls.media !== video || binding.hls.config.emeEnabled) return null;
                        source = hlsURL;
                    }
                }
            } catch (error) { return null; }
        }
    }
    if (typeof source !== 'string' || !source) return null;
    try { source = new URL(source, document.baseURI); } catch (error) { return null; }
    return /^https?:$/.test(source.protocol) && source.hostname && !source.username && !source.password && source.href.length <= 8192 ? source.href : null;
}
window.__browserTVOpenControlledVideo = function(element) {
    if ((window !== window.top && !mediaVLCIframeCapture) || !element || element.tagName !== 'VIDEO' ||
        !element.controls || element.mediaKeys || !vlcVideoSource(element)) return false;
    enterFullscreen(element);
    return true;
};
function publishVLCRequest(id, info) {
    if (window !== window.top) {
        window.parent.postMessage({browserTVVLCRequest:secret, id:id, info:info}, '*');
        return;
    }
    try { window.webkit.messageHandlers.browserFullscreenMedia.postMessage(
        Object.assign({token:nativeToken,session:id,vlcRequest:true},info)); } catch(error) {}
}
function visibleVLCCandidate(element) {
    if (!element || !element.isConnected) return false;
    var rect = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    return rect.width >= 40 && rect.height >= 30 && rect.right > 0 && rect.bottom > 0 &&
        rect.left < innerWidth && rect.top < innerHeight && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
}
function hasPendingVLCOffer() {
    return Object.keys(mediaVLCRequests).some(function(id) {
        var request = mediaVLCRequests[id];
        return !!request.video && !request.trackCommand && !request.resumeWhenVisible;
    });
}
function saveVLCOffer(id, request) {
    mediaVLCRequests[id] = request;
    // Only an unanswered offer expires. Once pause is submitted, native must
    // explicitly return or abort this source; never expire VLC ownership.
    setTimeout(function() {
        if (mediaVLCRequests[id] === request && !request.handoff && !request.resumeWhenVisible)
            delete mediaVLCRequests[id];
    }, 6000);
}
function requestVLCVideo(video, automatic) {
    if ((window !== window.top && !mediaVLCIframeCapture) || !video) return false;
    if (hasPendingVLCOffer() || (automatic &&
        (!canWatchVLCVideo(video) || performance.now() < mediaVLCNextOfferAt))) return false;
    var source = vlcVideoSource(video);
    if (!source) return false;
    var playerBinding = playerJSVideoBinding(video), playlistID;
    if (playerBinding) { try { playlistID = playerBinding.player.api('playlist_id'); } catch (error) { return false; } }
    var engine = starlightVideoEngine(video);
    if (automatic) mediaVLCNextOfferAt = performance.now() + 1000;
    var id = secret + ':' + Date.now() + ':vlc:' + (++mediaVLCSerial);
    saveVLCOffer(id, {video:video, url:source, automatic:!!automatic,
        engineSource:engine && engine.source, player:playerBinding && playerBinding.player,
        hls:playerBinding && playerBinding.hls, playlistID:playlistID});
    publishVLCRequest(id, {url:source, title:document.title.slice(0,512), automatic:!!automatic,
        currentTime:Number.isFinite(video.currentTime) ? video.currentTime : 0,
        volume:video.volume, muted:video.muted, documentURL:location.href,
        referrerPolicy:video.referrerPolicy || document.referrerPolicy ||
            ((document.querySelector('meta[name="referrer"]') || {}).content) || 'strict-origin-when-cross-origin',
        crossOrigin:video.crossOrigin || ''});
    return true;
}
function stopVLCWatch(video) {
    if (video) mediaVLCWatched.delete(video);
    else mediaVLCWatched.clear();
    if (!mediaVLCWatched.size && mediaVLCWatchTimer) { clearInterval(mediaVLCWatchTimer); mediaVLCWatchTimer = null; }
}
function discardUnacceptedVLCRequests() {
    Object.keys(mediaVLCRequests).forEach(function(id) {
        var request = mediaVLCRequests[id];
        // Keep the final transfer, not an offer that hasn't paused anything.
        if (!request.automatic || request.handoff || request.resumeWhenVisible) return;
        delete mediaVLCRequests[id];
    });
}
function ownsVLCVideo(video) {
    return Object.keys(mediaVLCRequests).some(function(id) {
        var request = mediaVLCRequests[id];
        return request.video === video && request.accepted && vlcRequestSourceIsCurrent(request);
    });
}
function completingVLCWebsiteEnd(video) {
    var ending = mediaVLCWebsiteEnds.get(video);
    if (!ending) return false;
    if (performance.now() < ending.until && vlcRequestSourceIsCurrent(ending.request)) return true;
    mediaVLCWebsiteEnds.delete(video);
    return false;
}
function canWatchVLCVideo(video) {
    return mediaVLCIframeCapture && mediaVLCCaptureActive && mediaVLCFrameVisible &&
        document.visibilityState !== 'hidden' && video && video.isConnected && !video.paused && !video.ended &&
        !video.error && !video.mediaKeys && visibleVLCCandidate(video);
}
function automaticVLCVideo(video) {
    // Only the final handoff may hold website playback, even if capture was
    // disabled or the app went inactive while VLC was already using this source.
    if (ownsVLCVideo(video)) {
        if (!video.paused) video.pause();
        stopVLCWatch(video);
        return;
    }
    if (!canWatchVLCVideo(video) || hasPendingVLCOffer() ||
        performance.now() < mediaVLCNextOfferAt || completingVLCWebsiteEnd(video)) { stopVLCWatch(video); return; }
    var source = vlcVideoSource(video);
    if (!source) { stopVLCWatch(video); return; }
    if (!mediaVLCWatched.has(video))
        mediaVLCWatched.set(video, {url:source, time:video.currentTime, wall:performance.now(), played:0});
    if (mediaVLCWatchTimer) return;
    mediaVLCWatchTimer = setInterval(function() {
        mediaVLCWatched.forEach(function(sample, current) {
            if (!canWatchVLCVideo(current) || hasPendingVLCOffer() ||
                completingVLCWebsiteEnd(current)) { stopVLCWatch(current); return; }
            var url = vlcVideoSource(current), now = performance.now();
            if (!url) { stopVLCWatch(current); return; }
            var wall = (now - sample.wall) / 1000, advance = current.currentTime - sample.time;
            if (url !== sample.url || wall > 1.5 || advance < 0 || advance > wall + 0.5) sample.played = 0;
            else if (current.readyState >= 2) sample.played += Math.min(advance, wall);
            sample.url = url; sample.wall = now; sample.time = current.currentTime;
            if (sample.played >= 0.1 && requestVLCVideo(current, true)) stopVLCWatch(current);
        });
        if (!mediaVLCWatched.size) stopVLCWatch();
    }, 50);
}
function scanAutomaticVLCVideos() {
    function scan(root) {
        Array.prototype.forEach.call(root.querySelectorAll('video'), automaticVLCVideo);
        Array.prototype.forEach.call(root.querySelectorAll('*'), function(e) { if (e.shadowRoot) scan(e.shadowRoot); });
    }
    if (mediaVLCIframeCapture) scan(document);
}
function observeVLCResources() {
    if (!mediaVLCIframeCapture || !mediaVLCCaptureActive) {
        if (mediaVLCResourceObserver) mediaVLCResourceObserver.disconnect();
        mediaVLCResourceObserver = null;
        return;
    }
    if (mediaVLCResourceObserver || typeof PerformanceObserver !== 'function') return;
    try {
        mediaVLCResourceObserver = new PerformanceObserver(function(list) {
            if (list.getEntries().some(function(entry) {
                return entry.initiatorType === 'video' || /\.(m3u8|mpd|mp4|m4v|webm|m4s|ts)(?:[?#]|$)/i.test(entry.name);
            })) scanAutomaticVLCVideos();
        });
        mediaVLCResourceObserver.observe({entryTypes:['resource']});
    } catch (error) { mediaVLCResourceObserver = null; }
}
function requestVLCFullscreen(element) {
    if (mediaVLCIframeCapture) {
        var candidate = element.tagName === 'VIDEO' ? element : element.querySelector('video');
        if (candidate) automaticVLCVideo(candidate);
        return;
    }
    var videos = element.tagName === 'VIDEO' ? [element] : Array.prototype.slice.call(element.querySelectorAll('video'));
    var video = videos.find(function(v) { return !v.paused && !v.ended; }) || videos[0];
    requestVLCVideo(video, false);
}
document.addEventListener('play', function(event) {
    if (event.target && event.target.tagName === 'VIDEO') automaticVLCVideo(event.target);
}, true);
document.addEventListener('playing', function(event) {
    if (event.target && event.target.tagName === 'VIDEO') automaticVLCVideo(event.target);
}, true);
// Real progress re-arms a refused/expired offer or a source that became
// eligible after Play. No source is remembered as tried or unsupported.
document.addEventListener('timeupdate', function(event) {
    var video = event.target;
    if (video && video.tagName === 'VIDEO' && !mediaVLCWatched.has(video)) automaticVLCVideo(video);
}, true);
document.addEventListener('pause', function(event) {
    var video = event.target;
    if (!video || video.tagName !== 'VIDEO') return;
    stopVLCWatch(video);
}, true);
document.addEventListener('ended', function(event) {
    if (!event.target || event.target.tagName !== 'VIDEO') return;
    mediaVLCWebsiteEnds.delete(event.target);
    stopVLCWatch(event.target);
}, true);
document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') stopVLCWatch();
    else { resumeAbortedVLCVideos(); scanAutomaticVLCVideos(); }
});
window.__browserTVVLCRequestTime = function(id) {
    var request = mediaVLCRequests[id];
    return request && request.video && Number.isFinite(request.video.currentTime) ? request.video.currentTime : 0;
};
function vlcRequestSourceIsCurrent(request) {
    if (request && request.player) {
        try {
            if (request.player.api('playlist_id') !== request.playlistID || request.player.api('hls') !== request.hls) return false;
        } catch (error) { return false; }
    }
    return !!request && !!request.video && request.video.isConnected && !request.video.mediaKeys &&
        (!request.engineSource || (request.video.engine && request.video.engine.source === request.engineSource)) &&
        vlcVideoSource(request.video) === request.url;
}
window.__browserTVVLCRequestIsCurrent = function(id) {
    var request = mediaVLCRequests[id];
    if (request && request.frame) return mediaVLCIframeCapture && request.frame.isConnected &&
        request.frame.contentWindow === request.source && (request.automatic
            ? mediaVLCCaptureActive && mediaVLCFrameVisible && visibleVLCCandidate(request.frame) : mediaFrame() === request.frame);
    return vlcRequestSourceIsCurrent(request) && (request.automatic
        ? canWatchVLCVideo(request.video)
        : !!(fullscreenTarget || fullscreenFrame));
};

// Adapters are ordered by player capability, not by the embedding hostname.
// Return null to defer, {boundary:true} at a known boundary, or {run:...}.
function playerJSTrackRoute(request, direction) {
    var player = request.player;
    if (!player || request.playlistID === '' || request.playlistID == null) return null;
    try {
        if (!(player.api('playlist_length') > 1)) return null;
    } catch (error) { return null; }
    // PlayerJS owns its order and its first/last-item behavior. Even a
    // no-op at its boundary consumes this route rather than sending another.
    return {run:function() {
        player.api(direction === 'previous' ? 'prev' : 'next');
        if (direction !== 'previous') return;
        // Some PlayerJS Previous paths select the item without starting it.
        // Don't play the old episode if the command hit a playlist boundary.
        var selected = player.api('playlist_id');
        if (selected != null && selected !== '' && selected !== request.playlistID && !player.api('playing'))
            player.api('play');
    }};
}
function starlightNextTrackRoute(request, direction) {
    if (direction !== 'next' || !request.engineSource) return null;
    var engine = starlightVideoEngine(request.video);
    if (!engine || engine.source !== request.engineSource) return null;
    var container = engine.placement && engine.placement.container;
    if (!container || !container.contains(request.video)) return null;
    // The site's SkipNext control uses its resolved fetch_next source.
    // Calling engine.next() directly would skip that step at the end of the loaded list.
    var button = Array.prototype.find.call(container.querySelectorAll('.adt-kCdJnjy'), function(item) {
        return item.isConnected && !item.hidden && !item.disabled &&
            item.getAttribute('aria-disabled') !== 'true' && getComputedStyle(item).display !== 'none';
    });
    return button ? {run:function() { button.click(); }} : null;
}
function webStarlightPreviousRoute(request, direction) {
    if (direction !== 'previous' || request.renderer !== 'webkit') return null;
    var engine = starlightPlayer();
    if (!engine || engine.video !== request.video || engine.source !== request.engineSource) return null;
    var previous = starlightPredecessor();
    if (starlightCatalog && !previous) return {boundary:true};
    if (previous) {
        var loaded = engine.group.playlist.some(function(item) { return item.id === previous.hash; });
        if (loaded || (window.starlight && typeof starlight.fetchVideo === 'function'))
            return {run:function() { requestStarlightPrevious(); }};
    }
    var button = playerTrackControl(true);
    return button ? {run:function() { button.click(); }} : null;
}
function mediaSessionTrackRoute(request, direction) {
    var action = direction === 'previous' ? 'previoustrack' : 'nexttrack';
    var handler = mediaHandlers[action];
    return handler ? {run:function() { handler({action:action}); }} : null;
}
var mediaEpisodeAdapters = [starlightNextTrackRoute, webStarlightPreviousRoute, playerJSTrackRoute, mediaSessionTrackRoute];
function episodeBinding(video, renderer) {
    var binding = playerJSVideoBinding(video), engine = video && video.engine, playlistID;
    try { if (binding) playlistID = binding.player.api('playlist_id'); } catch (error) {}
    return {video:video, renderer:renderer, engineSource:engine && engine.source,
        player:binding && binding.player, playlistID:playlistID};
}
function episodeTrackRoute(request, direction) {
    for (var i = 0; i < mediaEpisodeAdapters.length; i++) {
        var route = mediaEpisodeAdapters[i](request, direction);
        if (route) return route;
    }
    return null;
}
function submitEpisodeRoute(route, beforeSubmit) {
    if (!route) return 'unavailable';
    if (route.boundary) return 'boundary';
    if (beforeSubmit) beforeSubmit();
    try { route.run(); } catch (error) {} // A throwing action may already have dispatched.
    return 'submitted';
}
function exitVLCWebsiteFullscreen(video) {
    if (!window.__browserTVExitFullscreen()) sendFullscreenToParent('vlcExit');
    if (video.webkitDisplayingFullscreen && typeof video.webkitExitFullscreen === 'function') {
        try { video.webkitExitFullscreen(); } catch (error) {}
    }
}
function restoreVLCVideo(request, time, volume, muted) {
    var video = request.video, duration = video.duration;
    try {
        video.pause();
        if (Number.isFinite(time)) video.currentTime = Math.max(0, Number.isFinite(duration) && duration > 0 ? Math.min(time, duration - 0.1) : time);
        if (Number.isFinite(volume)) video.volume = Math.max(0, Math.min(1, volume));
        video.muted = !!muted;
    } catch (error) {}
}
function playVLCWebsiteEnd(request) {
    var video = request.video;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    // The return transaction gets a short window to deliver a genuine EOF.
    // A new source on the same element is not part of that transaction.
    var ending = {request:request, until:performance.now() + 5000};
    mediaVLCWebsiteEnds.set(video, ending);
    function clearEnding() {
        if (mediaVLCWebsiteEnds.get(video) === ending) mediaVLCWebsiteEnds.delete(video);
    }
    try {
        video.currentTime = Math.max(0, video.duration - 0.1);
        var play = video.play();
        if (play && play.catch) play.catch(clearEnding);
    } catch (error) { clearEnding(); }
}
function setVLCTrackCommand(id, request, action) {
    if (request.trackCommand) return false;
    request.trackCommand = action;
    setTimeout(function() {
        if (mediaVLCRequests[id] === request) delete mediaVLCRequests[id];
    }, 5000);
    return true;
}
window.__browserTVVLCResponse = function(id, action, time, volume, muted, exitFullscreen) {
    var request = mediaVLCRequests[id];
    var track = action === 'next' || action === 'previous';
    var trackRelease = action === 'trackDone' || action === 'trackEnd';
    if (!request || (!track && !trackRelease &&
        ['accepted','closed','ended','rejected','cancelled','deferred','aborted','released'].indexOf(action) < 0)) return false;
    if (action === 'accepted' && request.accepted) return true;
    if (action === 'accepted' && !window.__browserTVVLCRequestIsCurrent(id)) return false;
    if (track && !setVLCTrackCommand(id, request, action)) return false;
    if (trackRelease && !request.trackCommand) return false;
    if (request.frame) {
        if (!request.frame.isConnected || request.frame.contentWindow !== request.source) return false;
        if (action === 'accepted' || track) request.handoff = {pending:true};
        request.source.postMessage({browserTVVLCResponse:secret, id:id, action:action,
            time:time, volume:volume, muted:muted, exitFullscreen:exitFullscreen === true}, '*');
        if (action !== 'accepted' && !track) delete mediaVLCRequests[id];
        return true;
    }
    var video = request.video;
    if (track) {
        var valid = request.accepted && mediaVLCCaptureActive && mediaVLCFrameVisible &&
            document.visibilityState !== 'hidden' && vlcRequestSourceIsCurrent(request);
        request.accepted = false;
        request.handoff = {track:'stale'};
        if (!valid) return true;
        request.renderer = 'vlc';
        var route = episodeTrackRoute(request, action);
        if (route && route.run) {
            try {
                if (Number.isFinite(volume)) video.volume = Math.max(0, Math.min(1, volume));
                video.muted = !!muted;
            } catch (error) {}
            if (exitFullscreen === true) exitVLCWebsiteFullscreen(video);
            request.handoff = {track:submitEpisodeRoute(route)};
        } else {
            restoreVLCVideo(request, time, volume, muted);
            request.handoff = {track:route && route.boundary ? 'boundary' : 'unavailable'};
        }
        return true;
    }
    if (trackRelease) {
        delete mediaVLCRequests[id];
        if (action === 'trackEnd' && request.trackCommand === 'next' && request.handoff.track === 'unavailable' &&
            mediaVLCCaptureActive && mediaVLCFrameVisible && document.visibilityState !== 'hidden' &&
            video.paused && vlcRequestSourceIsCurrent(request) && !ownsVLCVideo(video)) {
            if (exitFullscreen === true) exitVLCWebsiteFullscreen(video);
            playVLCWebsiteEnd(request);
        } else if (action === 'trackDone' && exitFullscreen === true && request.handoff.track === 'unavailable' && video.isConnected) {
            exitVLCWebsiteFullscreen(video);
        }
        return true;
    }
    if (action === 'accepted') {
        stopVLCWatch(video);
        video.pause();
        if (!video.paused) return false;
        request.accepted = true;
        request.handoff = {accepted:true, time:window.__browserTVVLCRequestTime(id), episode:episodeMetadata(video)};
        if (window === window.top) acceptEpisodeMetadata(id, request.handoff.episode);
        if (window === window.top && !request.automatic) window.__browserTVExitFullscreen();
        return true;
    }
    var rollback = action === 'aborted' || action === 'cancelled' || action === 'rejected';
    if (rollback && request.automatic && (request.accepted || request.resumeWhenVisible)) {
        // Only this transaction paused the video. Never resume another source,
        // or resume this one behind Home or in a parked tab.
        request.accepted = false;
        request.resumeWhenVisible = true;
        resumeAbortedVLCVideos();
        return true;
    }
    if ((action === 'closed' || action === 'ended') && request.accepted && vlcRequestSourceIsCurrent(request)) {
        var duration = video.duration;
        var experimental = request.automatic || window !== window.top;
        var finish = experimental && Number.isFinite(duration) && duration > 0 &&
            (action === 'ended' || (Number.isFinite(time) && duration - time <= 2));
        restoreVLCVideo(request, finish ? duration - 0.1 : time, volume, muted);
        // Remove ownership before Play; its real ended event owns episode advance.
        delete mediaVLCRequests[id];
        if (experimental && ((!finish && action === 'closed') || exitFullscreen === true)) exitVLCWebsiteFullscreen(video);
        if (finish && mediaVLCCaptureActive) playVLCWebsiteEnd(request);
    }
    delete mediaVLCRequests[id];
    return true;
};
function resumeAbortedVLCVideos() {
    Object.keys(mediaVLCRequests).forEach(function(id) {
        var request = mediaVLCRequests[id];
        if (!request.resumeWhenVisible) return;
        var video = request.video;
        if (!video.paused || video.ended || video.error || !vlcRequestSourceIsCurrent(request) || ownsVLCVideo(video)) {
            delete mediaVLCRequests[id];
            return;
        }
        if (!mediaVLCCaptureActive || !mediaVLCFrameVisible || document.visibilityState === 'hidden' ||
            !visibleVLCCandidate(video)) return;
        delete mediaVLCRequests[id];
        // Rate-limit a persistent pause/abort cycle; do not blacklist this video.
        mediaVLCNextOfferAt = performance.now() + 2000;
        try {
            var play = video.play();
            if (play && play.catch) play.catch(function() {});
        } catch (error) {}
    });
}
// Native always talks to the main document. Replies follow the selected frame
// chain and acceptance is acknowledged only after the original video is paused.
window.__browserTVVLCHandoffResult = function(id) {
    var request = mediaVLCRequests[id];
    return JSON.stringify(request && request.handoff || {accepted:false});
};
window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;
    if (data.browserTVVLCRequest === secret) {
        var info = data.info;
        var automatic = !!(info && info.automatic);
        var frame = automatic ? frameForSource(event.source) : mediaFrame();
        if (!frame || !frame.isConnected || event.source !== frame.contentWindow ||
            typeof data.id !== 'string' || data.id.length > 128 || !info || typeof info !== 'object') return;
        // The first parent checks the leaf context against the browser-supplied
        // message origin; each subsequent parent accepts only its selected child.
        try {
            var context = new URL(info.documentURL);
            var source = new URL(info.url);
            if (!/^https?:$/.test(context.protocol) || !context.hostname || context.username || context.password ||
                context.href.length > 8192 || !/^https?:$/.test(source.protocol) || !source.hostname ||
                source.username || source.password || source.href.length > 8192 ||
                (!info.iframeRelay && context.origin !== event.origin)) return;
        } catch (error) { return; }
        if (!mediaVLCIframeCapture || (automatic && (!mediaVLCCaptureActive || !mediaVLCFrameVisible || !visibleVLCCandidate(frame)))) {
            event.source.postMessage({browserTVVLCResponse:secret, id:data.id, action:'deferred'}, '*');
            return;
        }
        if (mediaVLCRequests[data.id]) return;
        saveVLCOffer(data.id, {frame:frame, source:event.source, automatic:automatic});
        publishVLCRequest(data.id, Object.assign({}, info, {iframeRelay:true}));
    } else if (data.browserTVVLCResponse === secret && window !== window.top && event.source === window.parent) {
        var track = data.action === 'next' || data.action === 'previous';
        var ok = window.__browserTVVLCResponse(data.id, data.action, data.time, data.volume, data.muted, data.exitFullscreen);
        var request = mediaVLCRequests[data.id];
        if ((data.action === 'accepted' || track) && (!ok || !request || !request.frame))
            window.parent.postMessage({browserTVVLCAcknowledgement:secret, id:data.id,
                result:ok && request ? request.handoff : track ? {track:'stale'} : {accepted:false}}, '*');
    } else if (data.browserTVVLCAcknowledgement === secret) {
        var pending = mediaVLCRequests[data.id];
        if (!pending || !pending.frame || !pending.handoff || !pending.handoff.pending ||
            !pending.frame.isConnected || pending.frame.contentWindow !== pending.source || event.source !== pending.source) return;
        if (pending.trackCommand) {
            var status = data.result && data.result.track;
            if (['submitted','boundary','unavailable','stale'].indexOf(status) < 0) return;
            pending.handoff = {track:status};
        } else {
            if (!window.__browserTVVLCRequestIsCurrent(data.id)) return;
            pending.handoff = {accepted:!!(data.result && data.result.accepted),
                time:data.result && Number.isFinite(data.result.time) ? data.result.time : 0,
                episode:validatedEpisodeMetadata(data.result && data.result.episode)};
            if (window === window.top && pending.handoff.accepted) acceptEpisodeMetadata(data.id, pending.handoff.episode);
        }
        if (window !== window.top) window.parent.postMessage({browserTVVLCAcknowledgement:secret,
            id:data.id, result:pending.handoff}, '*');
    }
});
document.addEventListener('loadedmetadata', function(event) {
    if (event.target && event.target.tagName === 'VIDEO') {
        mediaVolumeVideos.delete(event.target);
        if (fullscreenTarget) requestVLCFullscreen(fullscreenTarget);
        automaticVLCVideo(event.target);
    }
}, true);
function restoreMediaVideoVolume(preference) {
    if (preference && preference.episodes && typeof preference.episodes.scope === 'string' && Array.isArray(preference.episodes.episodes))
        starlightCatalog = preference.episodes;
    else if (preference && preference.episodes === null) starlightCatalog = null;
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
    if (!window.adt || typeof adt.player !== 'function') return null;
    var video = mediaVideo();
    // adt.player() returns a public API projection, not the internal core.
    // Starlight attaches that core to its HTML video in the constructor.
    var engine = video && video.engine;
    return engine && engine.video === video && engine.source && engine.source.id &&
        engine.group && Array.isArray(engine.group.playlist) ? engine : null;
}
function starlightSourceTitle() {
    var p = starlightPlayer();
    if (!p || typeof p.source.title !== 'string') return '';
    var parsed = new DOMParser().parseFromString(p.source.title.slice(0, 4096), 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 512);
}
function episodeMetadata(video) {
    var engine = starlightVideoEngine(video);
    if (!engine) return null;
    var parsed = new DOMParser().parseFromString(String(engine.source.title || '').slice(0,4096), 'text/html');
    return validatedEpisodeMetadata({starlightSourceID:engine.source.id,
        adapterTitle:(parsed.body.textContent || '').replace(/\s+/g,' ').trim().slice(0,512)});
}
function validatedEpisodeMetadata(state) {
    return state && typeof state.starlightSourceID === 'string' && /^[a-f0-9]{64}$/.test(state.starlightSourceID) &&
        typeof state.adapterTitle === 'string' && state.adapterTitle.length <= 512
        ? {starlightSourceID:state.starlightSourceID, adapterTitle:state.adapterTitle} : null;
}
function acceptedEpisodeIsCurrent(id) {
    var request = mediaVLCRequests[id];
    if (!request || request.trackCommand) return false;
    return request.frame ? request.frame.isConnected && request.frame.contentWindow === request.source &&
        !!(request.handoff && request.handoff.accepted) : request.accepted && vlcRequestSourceIsCurrent(request);
}
function acceptEpisodeMetadata(id, state) {
    state = validatedEpisodeMetadata(state);
    if (window !== window.top || !state || !acceptedEpisodeIsCurrent(id)) return;
    mediaAcceptedEpisode = {session:id, state:state};
    prepareStarlightCatalog();
    synchronizeStarlightPage(state, id);
    // Metadata has no playback clock. Native must not recreate WebKit controls
    // or copy paused HTML transport state over the VLC transport.
    try { window.webkit.messageHandlers.browserFullscreenMedia.postMessage(
        {token:nativeToken,session:id,episodeMetadata:true,pageTitle:state.adapterTitle}); } catch (error) {}
}
function starlightPredecessor() {
    var p = starlightPlayer();
    if (!p) return null;
    // Teleportal's season catalog is newest-first. Never parse display labels.
    if (starlightCatalog) {
        var episodes = starlightCatalog.episodes;
        var index = episodes.findIndex(function(item) { return item.hash === p.source.id; });
        if (index >= 0) {
            var previous = episodes[index + 1];
            return previous && previous.hash && previous.hash !== p.source.id ? previous : null;
        }
    }
    // Next appends its resolved source to the player's chronological playlist.
    // This also covers newly available episodes absent from the host catalog.
    var loaded = p.group.playlist, current = loaded.indexOf(p.source);
    var predecessor = current > 0 ? loaded[current - 1] : null;
    return predecessor && predecessor.id && predecessor.id !== p.source.id ? {hash:predecessor.id} : null;
}
function requestStarlightPrevious() {
    var p = starlightPlayer(), previous = starlightPredecessor();
    if (!p || !previous) return false;
    if (starlightPreviousRequest) return true;
    var source = p.source, group = p.group, scope = fullscreenTarget, request = {};
    var loaded = group.playlist.find(function(item) { return item.id === previous.hash; });
    if (!loaded && (!window.starlight || typeof starlight.fetchVideo !== 'function')) return false;
    starlightPreviousRequest = request;
    // fetchPrevious/get/prev is 404 on the observed server. Resolve the actual
    // preceding hash from the host's published season index and use fetchVideo.
    Promise.resolve().then(function() {
        return loaded || starlight.fetchVideo(previous.hash, window.PAGE_REFERER, window.sld_locale || 'ua');
    }).then(function(resolved) {
        if (starlightPreviousRequest !== request || starlightPlayer() !== p || p.source !== source || p.group !== group ||
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
    var path = location.pathname.replace(/\/[^/]+\/?$/, '');
    if (starlightCatalogPath !== path) { starlightCatalogPath = path; starlightCatalogRequest = null; starlightCatalog = null; }
    if (starlightCatalogRequest) return;
    if (!/^\/(ua|ru)\/(serials|show)\/[^/]+\/[^/]+\/[^/]+$/.test(path)) return;
    starlightCatalogRequest = fetch('https://tp-back.starlight.digital' + path).then(function(response) {
        if (!response.ok) throw new Error('metadata');
        return response.json();
    }).then(function(data) {
        if (location.pathname.replace(/\/[^/]+\/?$/, '') !== path || !data.seasonGallery || !Array.isArray(data.seasonGallery.items)) return;
        // Keep slots in order: an invalid neighbor must not skip another episode.
        var episodes = data.seasonGallery.items.slice(0, 2000).map(function(item) {
            var hash = item && typeof item.hash === 'string' && /^[a-f0-9]{64}$/.test(item.hash) ? item.hash : null;
            var slug = item && item.videoSlug;
            var pagePath = typeof slug === 'string' && slug.length <= 512 && /^[^/\\?#\s]+$/.test(slug) ? path + '/' + encodeURIComponent(slug) : null;
            return {hash:hash,pagePath:pagePath};
        });
        starlightCatalog = {scope:path,episodes:episodes};
        if (mediaAcceptedEpisode && acceptedEpisodeIsCurrent(mediaAcceptedEpisode.session))
            synchronizeStarlightPage(mediaAcceptedEpisode.state, mediaAcceptedEpisode.session);
        else if (mediaActive && mediaFrameState) synchronizeStarlightPage(mediaFrameState);
    }).catch(function() {});
}
function synchronizeStarlightPage(state, captureSession) {
    if (window !== window.top || location.hostname !== 'teleportal.ua' ||
        !(captureSession ? acceptedEpisodeIsCurrent(captureSession) : mediaActive) || !starlightCatalog ||
        starlightCatalog.scope !== location.pathname.replace(/\/[^/]+\/?$/, '') ||
        !state || typeof state.starlightSourceID !== 'string' || !/^[a-f0-9]{64}$/.test(state.starlightSourceID)) return;
    // Resolve only against host metadata, never against a child-supplied URL.
    var entry = starlightCatalog.episodes.find(function(item) { return item.hash === state.starlightSourceID; });
    if (!entry || !entry.pagePath || !entry.pagePath.startsWith(starlightCatalog.scope + '/')) return;
    var target = new URL(entry.pagePath, location.origin);
    if (target.origin !== location.origin) return;
    try {
        if (target.pathname !== location.pathname)
            history.replaceState(history.state, '', target.pathname + location.search + location.hash);
        if (typeof state.adapterTitle === 'string' && state.adapterTitle) document.title = state.adapterTitle.slice(0, 512);
    } catch (error) {}
}
function mediaState() {
    var v = mediaVideo();
    var current = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    var duration = v && Number.isFinite(v.duration) ? v.duration : 0;
    var seekable = !!(v && v.seekable.length);
    var binding = episodeBinding(v, 'webkit');
    var previousRoute = episodeTrackRoute(binding, 'previous'), nextRoute = episodeTrackRoute(binding, 'next');
    return {available: !!v || !!mediaHandlers.play || !!mediaHandlers.pause,
        paused: v ? v.paused : !(navigator.mediaSession && navigator.mediaSession.playbackState === 'playing'),
        currentTime: current, duration: duration, muted: !!(v && v.muted), canMute: !!v,
        volume: v && Number.isFinite(v.volume) ? v.volume : 0, canVolume: !!v,
        canSeekBack: seekable || !!mediaHandlers.seekbackward,
        canSeekForward: seekable || !!mediaHandlers.seekforward,
        seekAtStart: seekable ? current <= v.seekable.start(0) : !!v && current <= 0,
        seekAtEnd: seekable ? current >= v.seekable.end(v.seekable.length - 1) : duration > 0 && current >= duration,
        canPrevious: !!previousRoute || (current > 5 && (seekable || !!mediaHandlers.seekto)),
        canNext: !!nextRoute,
        routesNext: !!nextRoute,
        routesPrevious: !!previousRoute,
        adapterTitle: starlightSourceTitle(),
        starlightSourceID: starlightPlayer() ? starlightPlayer().source.id : '',
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
        synchronizeStarlightPage(data.state);
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
    var trackAction = command === 'previous' ? 'previoustrack' : command === 'next' ? 'nexttrack' : null;
    if (trackAction) {
        var route = episodeTrackRoute(episodeBinding(mediaVideo(), 'webkit'), command);
        if (submitEpisodeRoute(route) !== 'unavailable') return true;
    }
    var frame = mediaFrame();
    if (trackAction && window === window.top && frame && (!mediaFrameState ||
        !mediaFrameState[command === 'next' ? 'routesNext' : 'routesPrevious'])) return false;
    if (frame && frame.isConnected && frame.contentWindow) {
        frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'media', command: command, value: value, request: request}, '*');
        return true;
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
window.addEventListener('pagehide', function(event) {
    stopVLCWatch();
    if (mediaVLCResourceObserver) mediaVLCResourceObserver.disconnect();
    mediaVLCResourceObserver = null;
    if (!event.persisted) mediaVLCPlayerJSInstances = [];
    mediaVLCRequests = Object.create(null);
    mediaAcceptedEpisode = null;
    clearInterval(mediaTimer); mediaTimer = null;
    mediaActive = false; publishNativeMedia();
    if (fullscreenTarget || fullscreenFrame) sendFullscreenToParent('exit');
});

window.addEventListener('pageshow', observeVLCResources);
