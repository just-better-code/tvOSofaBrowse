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
function mediaState() {
    var v = mediaVideo();
    var current = v && Number.isFinite(v.currentTime) ? v.currentTime : 0;
    var duration = v && Number.isFinite(v.duration) ? v.duration : 0;
    var seekable = !!(v && v.seekable.length);
    return {available: !!v || !!mediaHandlers.play || !!mediaHandlers.pause,
        paused: v ? v.paused : !(navigator.mediaSession && navigator.mediaSession.playbackState === 'playing'),
        currentTime: current, duration: duration,
        canSeekBack: seekable || !!mediaHandlers.seekbackward,
        canSeekForward: seekable || !!mediaHandlers.seekforward,
        canPrevious: !!mediaHandlers.previoustrack || (current > 5 && (seekable || !!mediaHandlers.seekto)),
        canNext: !!mediaHandlers.nexttrack,
        canRestart: seekable || !!mediaHandlers.seekto,
        canEnd: duration > 0 && (seekable || !!mediaHandlers.seekto)};
}
function publishNativeMedia(state) {
    if (window !== window.top) return;
    try {
        window.webkit.messageHandlers.browserFullscreenMedia.postMessage(
            Object.assign({token: nativeToken, session: mediaSessionID, active: mediaActive}, state || {}));
    } catch (error) {}
}
function requestMediaState(request) {
    var frame = mediaFrame();
    if (frame && frame.isConnected && frame.contentWindow) {
        frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'media', command: 'status', request: request}, '*');
    } else if (window !== window.top) {
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
    mediaFrameState = null; mediaFrameStateTime = 0;
    mediaSessionID = active ? secret + ':' + Date.now() + ':' + (++mediaRequestSerial) : '';
    mediaAcceptedSerial = mediaRequestSerial;
    publishNativeMedia();
    if (!active) return;
    function tick() {
        if (!frame.isConnected) {
            window.__browserTVExitFullscreen();
            mediaActive = false; mediaObservedFrame = null;
            clearInterval(mediaTimer); mediaTimer = null; publishNativeMedia(); return;
        }
        if (mediaFrameState && Date.now() - mediaFrameStateTime > 2000) {
            mediaFrameState = null; publishNativeMedia();
        }
        requestMediaState(++mediaRequestSerial);
    }
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
        publishNativeMedia(data.state);
    }
}
function performMediaCommand(command, value, request) {
    if (command === 'status') { requestMediaState(request); return true; }
    // Hardware media actions may belong to the embedding page, not the video frame.
    var trackAction = command === 'previous' ? 'previoustrack' : command === 'next' ? 'nexttrack' : null;
    if (trackAction && mediaHandlers[trackAction]) {
        try { mediaHandlers[trackAction]({action: trackAction}); return true; } catch (error) {}
    }
    var frame = mediaFrame();
    if (frame && frame.isConnected && frame.contentWindow) {
        frame.contentWindow.postMessage({browserTVFullscreenCommand: secret, action: 'media', command: command, value: value}, '*');
        return true;
    }
    var v = mediaVideo();
    var state = mediaState();
    var action, details = {};
    if (command === 'toggle') action = state.paused ? 'play' : 'pause';
    else if (command === 'seek' && Number.isFinite(value) && Math.abs(value) <= 120) {
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
window.__browserTVSendFullscreenMediaCommand = function(command, value, session) {
    if (window !== window.top || mediaSuspended || !mediaActive || session !== mediaSessionID) return false;
    if (command === 'exit') return window.__browserTVExitFullscreen();
    return performMediaCommand(command, value);
};
window.addEventListener('pagehide', function() {
    clearInterval(mediaTimer); mediaTimer = null;
    mediaActive = false; publishNativeMedia();
    if (fullscreenTarget || fullscreenFrame) sendFullscreenToParent('exit');
});
