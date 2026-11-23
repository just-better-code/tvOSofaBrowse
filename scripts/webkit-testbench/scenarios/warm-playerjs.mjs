import assert from 'node:assert/strict';
import {fixture, delay, waitFor} from './fixture.mjs';

// Real Blob video/HTTP media and Linux decoding; PlayerJS loader capability and
// app tab ownership are controlled. Actual-site evidence is recorded separately.
export default async function(lab) {
  const host = lab.native;
  if (!host) throw Error('Use --app');
  const media = await fixture(), warm = lab.page;
  const initiallyEnabled = process.env.WARM_CAPTURE_START === 'on';
  let offers = 0;
  const receive = host.receive.bind(host);
  host.receive = async (frame, handler, body) => {
    if (!frame.parentFrame() && body?.vlcRequest) offers++;
    return receive(frame, handler, body);
  };
  try {
    host.enabled = initiallyEnabled;
    if (initiallyEnabled) host.active = false;
    await warm.goto(media.origin + '/top');
    const leaf = warm.frames().find(frame => frame.url().endsWith('/leaf'));
    await leaf.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await leaf.evaluate(async initiallyEnabled => {
      const video = document.querySelector('video');
      video.id = 'bound-player';
      const bytes = await (await fetch('/one.webm')).arrayBuffer();
      const hls = {url:new URL('/one.webm', location.href).href,media:video,config:{emeEnabled:false}};
      window.Playerjs = function() {
        this.api = command => command === 'id' ? 'bound-player' : command === 'hls' ? hls :
          command === 'playlist_id' ? 'one' : command === 'playlist_length' ? 2 : null;
      };
      // Observe the factory while capture is OFF, exactly the lifecycle that
      // used to miss already-created private instances.
      window.__browserTVSetIframeVLCExperiment(initiallyEnabled, false, true);
      new window.Playerjs();
      video.src = URL.createObjectURL(new Blob([bytes], {type:'video/webm'}));
      window.__warmVideo = video;
      video.play().catch(() => {});
    }, initiallyEnabled);
    await leaf.waitForFunction(() => window.__warmVideo.currentTime > 0.3);
    await leaf.evaluate(() => window.__warmVideo.pause());
    assert.equal(offers, 0);
    const documentToken = await warm.evaluate(() => window.__webkitLabDocumentToken);
    const other = await lab.context.newPage();
    await host.setPage(other);
    await host.setActive(true);
    host.enabled = true;
    await host.configure();
    await host.setPage(warm);
    await delay(150);
    assert(await leaf.evaluate(() => document.querySelector('video') === window.__warmVideo && window.__warmVideo.paused));
    await leaf.evaluate(() => { window.__warmVideo.play().catch(() => {}); });
    await waitFor(() => host.phase === 'playing', {timeout:8000});
    assert.equal(offers, 1);
    assert.equal(host.session.body.url, new URL('/one.webm', leaf.url()).href);
    assert(await leaf.evaluate(() => window.__warmVideo.paused && window.__warmVideo.currentSrc.startsWith('blob:')));
    assert.equal(await warm.evaluate(() => window.__webkitLabDocumentToken), documentToken);
    const stats = await host.decoder.status();
    assert(stats.displayedPictures > 0);
    console.log(JSON.stringify({runDirectory:lab.runDirectory,actualBlobVideo:true,actualLinuxLibVLC:true,
      captureEnabledAfterPlayerConstruction:!initiallyEnabled,sameDocumentAndVideo:true,offers,
      playerJSCapability:'controlled',UIKitAndTabOwnership:'modeled'}));
  } finally {
    host.receive = receive;
    await host.dispose();
    await warm.goto('about:blank');
    await media.close();
  }
}
