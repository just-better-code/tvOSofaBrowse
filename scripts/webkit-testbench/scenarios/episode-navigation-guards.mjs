import assert from 'node:assert/strict';
import {fixture, delay, waitFor} from './fixture.mjs';

export default async function(lab) {
  const host = lab.native;
  if (!host) throw Error('Use --app');
  const media = await fixture();
  const results = [];
  try {
    for (const mode of ['adapter-boundary', 'adapter-throws', 'stale-source', 'detached-frame', 'system-ambiguous', 'background-during-track']) {
      let system = 0, replies = [];
      host.enabled = false;
      await lab.page.goto(media.origin + '/top');
      const leaf = lab.page.frames().find(frame => frame.url().endsWith('/leaf'));
      await leaf.waitForFunction(() => document.querySelector('video').readyState >= 2);
      const adapter = mode === 'adapter-boundary' || mode === 'adapter-throws';
      await leaf.evaluate(adapter => {
        const video = document.querySelector('video');
        navigator.mediaSession.setActionHandler('nexttrack', null);
        video.id = 'player';
        window.guardCalls = 0;
        window.guardEnds = 0;
        video.addEventListener('ended', () => guardEnds++);
        if (adapter) window.Playerjs = function() {
          this.api = command => {
            if (command === 'id') return 'player';
            if (command === 'playlist_length') return 2;
            if (command === 'playlist_id') return 'last';
            if (command === 'next') {
              guardCalls++;
              if (window.guardThrows) throw Error('ambiguous player dispatch');
            }
          };
        };
      }, adapter);
      host.enabled = true;
      await host.configure();
      await delay(100);
      await leaf.evaluate(throws => {
        window.guardThrows = throws;
        if (window.Playerjs) window.player = new Playerjs();
        document.querySelector('video').play().catch(() => {});
      }, mode === 'adapter-throws');
      await waitFor(() => host.phase === 'playing');
      const session = host.session;
      const oldCheckpoint = host.checkpoint.bind(host);
      host.options.systemTrack = async () => { system++; return mode === 'system-ambiguous'; };
      host.checkpoint = async (...args) => {
        const result = await oldCheckpoint(...args);
        if (args[1] === 'track') {
          replies.push(result.track);
          if (mode === 'background-during-track') await host.setActive(false);
        }
        return result;
      };
      try {
        if (mode === 'stale-source') {
          await leaf.evaluate(() => { document.querySelector('video').src = '/two.webm'; });
        } else if (mode === 'detached-frame') {
          await lab.page.evaluate(() => document.querySelector('iframe').remove());
        }
        await host.next().catch(error => {
          if (mode !== 'detached-frame') throw error;
        });
        await delay(300);
        assert.equal(system, mode === 'system-ambiguous' ? 1 : 0);
        assert.equal(host.presented, false);
        const duplicate = await host.evaluate(session, 'window.__browserTVVLCResponse', [session.body.session, 'next']).catch(() => false);
        assert.equal(duplicate, false, 'A completed or detached track cannot be sent twice');
        if (mode !== 'detached-frame') {
          const state = await leaf.evaluate(() => ({
            calls: guardCalls, ends: guardEnds,
            paused: document.querySelector('video').paused,
            time: document.querySelector('video').currentTime,
          }));
          assert.equal(state.ends, 0);
          assert.equal(state.calls, adapter ? 1 : 0);
          assert(state.paused);
          assert(state.time < 3, 'No ambiguous or stale command may force website EOF');
        }
        results.push({mode, system, replies});
      } finally {
        host.checkpoint = oldCheckpoint;
        if (!host.active) await host.setActive(true);
      }
    }
    console.log(JSON.stringify({runDirectory:lab.runDirectory,results,actualLinuxLibVLC:true,systemMediaKeys:'modeled',UIKit:'modeled'}));
  } finally {
    await host.dispose();
    await lab.page.goto('about:blank');
    await media.close();
  }
}
