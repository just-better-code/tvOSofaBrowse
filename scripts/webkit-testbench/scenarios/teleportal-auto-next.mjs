import assert from 'node:assert/strict';
import {delay, waitFor} from './fixture.mjs';

// Real website, Starlight player and libVLC. Only the native UI is modeled.
export default async function(lab) {
  const host = lab.native;
  if (!host) throw Error('Use --app with the stand Firefox UA');
  const keep = process.env.KEEP_FULLSCREEN !== 'off';
  const url = 'https://teleportal.ua/ua/serials/stb/kod/2026/seriya-92';
  host.active = false;
  host.options.autoExit = !keep;
  let mediaKeys = 0;
  host.options.systemTrack = () => { mediaKeys++; return false; };
  const site = () => lab.page.evaluate(() => ({
    path: location.pathname, title: document.title, history: history.length,
    document: window.__webkitLabDocumentToken, fullscreen: !!document.fullscreenElement,
  }));
  try {
    await lab.page.goto(url, {waitUntil: 'domcontentloaded', timeout: 35000});
    let leaf;
    await waitFor(async () => {
      leaf = lab.page.frames().find(frame => /^https?:\/\/[^/]+\/vplayer\/(?:\?|$)/.test(frame.url()));
      return leaf && await leaf.locator('video').count();
    }, {timeout: 25000, describe: () => 'real Teleportal player'});
    const embed = await leaf.frameElement();
    await embed.scrollIntoViewIfNeeded();
    if (await leaf.evaluate(() => ![...document.querySelectorAll('video')].some(video => !video.paused))) {
      const bounds = await embed.boundingBox();
      await lab.page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
    await leaf.waitForFunction(() => {
      const video = document.querySelector('video');
      return video?.engine?.source?.id && video.duration > 300 && !video.paused && video.currentTime > 0.1;
    }, null, {timeout: 40000});
    await leaf.evaluate(() => {
      const video = document.querySelector('video');
      window.__autoNextObservation = {video, next: 0, ends: 0};
      document.addEventListener('click', event => {
        if (event.target.closest('.adt-kCdJnjy') && video.engine.placement.container.contains(event.target))
          window.__autoNextObservation.next++;
      }, true);
      video.addEventListener('ended', event => { if (event.isTrusted) window.__autoNextObservation.ends++; });
      video.requestFullscreen();
    });
    await waitFor(async () => (await site()).fullscreen);
    await host.setActive(true);
    const decoded = async () => host.phase === 'playing' && (await host.decoder.status()).displayedPictures > 0;
    await waitFor(decoded, {timeout: 40000, describe: () => 'decoded episode 92'});
    const before = await site();
    const first = host.session;
    const decoder = host.decoder;
    const length = (await decoder.status()).lengthMs;
    assert(length > 300000);
    assert.match(before.path, /\/seriya-92$/);
    let eofCount = 0;
    const onEnded = decoder.onEnded;
    decoder.onEnded = (...args) => { eofCount++; return onEnded(...args); };
    decoder.command('seek', {time: length / 1000 - 0.8});
    decoder.command('activate');
    await waitFor(() => eofCount === 1, {timeout: 20000, describe: () => 'first decoder EOF'});
    await waitFor(async () => host.session && host.session !== first &&
      host.session.body.url !== first.body.url && await decoded(),
    {timeout: 40000, describe: () => 'decoded episode 93 after natural EOF'});
    await waitFor(async () => (await site()).path.endsWith('/seriya-93'), {describe: () => 'episode URL'});
    await delay(400);
    const after = await site();
    const observed = await leaf.evaluate(() => {
      const observation = window.__autoNextObservation;
      return {next: observation.next, ends: observation.ends,
        sameVideo: observation.video === document.querySelector('video'),
        title: new DOMParser().parseFromString(observation.video.engine.source.title, 'text/html').body.textContent};
    });
    assert.equal(eofCount, 1);
    assert.equal(observed.next, 1);
    assert.equal(observed.ends, 0, 'Do not deliver website EOF after submitting Next');
    assert(observed.sameVideo);
    assert.match(observed.title, /\b93\b/);
    assert.match(after.title, /\b93\b/);
    assert.equal(after.history, before.history);
    assert.equal(after.document, before.document);
    assert.equal(after.fullscreen, keep);
    assert.equal(mediaKeys, 0);
    console.log(JSON.stringify({run: lab.runDirectory, episode: 93, eofCount, next: observed.next,
      originalWebsiteEOF: observed.ends, sameDocument: true, keepFullscreen: keep, actualLinuxLibVLC: true}));
  } finally {
    await host.dispose();
  }
}
