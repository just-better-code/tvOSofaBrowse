import assert from 'node:assert/strict';
import {delay, fixture, waitFor} from './fixture.mjs';

export default async function(lab) {
  const host = lab.native;
  if (!host) throw Error('Use --app');
  const media = await fixture();
  let system = [];
  const results = [];
  try {
    for (const mode of ['adapter-keep-fullscreen', 'adapter-exit-fullscreen', 'system', 'previous-unavailable']) {
      system = [];
      host.enabled = false;
      host.options.autoExit = mode !== 'adapter-keep-fullscreen';
      await lab.page.goto(media.origin + '/top');
      const leaf = lab.page.frames().find(frame => frame.url().endsWith('/leaf'));
      await leaf.waitForFunction(() => document.querySelector('video').readyState >= 2);
      await leaf.evaluate(() => document.querySelector('video').requestFullscreen());
      await lab.page.waitForFunction(() => !!document.fullscreenElement);
      await leaf.evaluate(adapter => {
        const video = document.querySelector('video');
        video.id = 'player';
        window.episodes = {calls: [], ends: 0, index: 1};
        video.addEventListener('ended', () => episodes.ends++);
        window.playEpisode = (index, play = true) => {
          episodes.index = index;
          video.src = index === 1 ? '/one.webm' : '/two.webm';
          if (play) video.play().catch(() => {});
        };
        if (adapter) {
          window.Playerjs = function() {
            this.api = command => {
              if (command === 'id') return 'player';
              if (command === 'playlist_length') return 2;
              if (command === 'playlist_id') return String(episodes.index);
              if (command === 'playing') return !video.paused;
              if (command === 'play') { episodes.calls.push(command); video.play().catch(() => {}); }
              if (command !== 'prev' && command !== 'next') return null;
              episodes.calls.push(command);
              if (command === 'next' && episodes.index === 1) playEpisode(2);
              if (command === 'prev' && episodes.index === 2) playEpisode(1, false);
            };
          };
        }
      }, mode.startsWith('adapter'));
      host.enabled = true;
      await host.configure();
      await leaf.waitForFunction(() => !!document.fullscreenElement);
      await delay(100);
      await leaf.evaluate(() => {
        if (window.Playerjs) window.player = new Playerjs();
        document.querySelector('video').play().catch(() => {});
      });
      await waitFor(() => host.phase === 'playing');
      host.options.systemTrack = async ({action}) => {
        system.push(action);
        if (mode !== 'system') return false;
        await leaf.evaluate(() => { playEpisode(2); });
        return true;
      };
      if (mode === 'previous-unavailable') {
        await host.previous();
        assert.deepEqual(system, ['previous']);
        await delay(400);
        assert.deepEqual(await leaf.evaluate(() => episodes), {calls: [], ends: 0, index: 1});
        assert(await leaf.evaluate(() => document.querySelector('video').paused));
      } else {
        await host.next();
        await waitFor(() => host.phase === 'playing' && host.session?.body.url.endsWith('/two.webm'));
        assert.equal(await leaf.evaluate(() => episodes.ends), 0);
        if (mode === 'system') assert.deepEqual(system, ['next']);
        else {
          assert.deepEqual(system, []);
          assert.equal(await lab.page.evaluate(() => !!document.fullscreenElement), mode === 'adapter-keep-fullscreen');
          await host.previous();
          await waitFor(() => host.phase === 'playing' && host.session?.body.url.endsWith('/one.webm'));
          assert.deepEqual(await leaf.evaluate(() => episodes), {calls: ['next','prev','play'], ends: 0, index: 1});
          assert.deepEqual(system, []);
        }
        await host.close('closed');
      }
      results.push(mode);
    }
    console.log(JSON.stringify({runDirectory:lab.runDirectory,results,actualLinuxLibVLC:true,systemMediaKeys:'modeled',UIKit:'modeled'}));
  } finally {
    await host.dispose();
    await lab.page.goto('about:blank');
    await media.close();
  }
}
