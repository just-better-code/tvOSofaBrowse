import assert from 'node:assert/strict';
import {fixture, waitFor} from './fixture.mjs';

export default async function(lab) {
  const host = lab.native;
  if (!host) throw Error('Use --app');
  const media = await fixture();
  const root = 'http://teleportal.ua/ua/serials/stb/kod/2026/';
  let releaseCatalog;
  const catalogReady = new Promise(resolve => { releaseCatalog = resolve; });
  try {
    await lab.context.route(root + '**', route => route.fulfill({
      contentType:'text/html', body:`<title>Original</title><iframe width="650" height="350" src="${media.origin}/leaf"></iframe>`,
    }));
    await lab.context.route('https://tp-back.starlight.digital/ua/serials/stb/kod/2026', async route => {
      await catalogReady;
      await route.fulfill({json:{seasonGallery:{items:[
        {hash:'a'.repeat(64),videoSlug:'seriya-1'}, {hash:'b'.repeat(64),videoSlug:'seriya-2'},
      ]}}});
    });
    await lab.page.goto(root + 'seriya-0?keep=yes#chapter');
    await lab.page.evaluate(() => history.replaceState({fixture:'preserve'}, '', location.href));
    const before = await lab.page.evaluate(() => ({length:history.length,token:window.__webkitLabDocumentToken}));
    const leaf = lab.page.frames().find(frame => frame.url().endsWith('/leaf'));
    await leaf.waitForFunction(() => document.querySelector('video').readyState >= 2);
    await leaf.evaluate(() => {
      navigator.mediaSession.setActionHandler('nexttrack', null);
      const video = document.querySelector('video');
      const sources = ['a','b','c'].map((key,index) => ({
        id:key.repeat(64), title:index === 2 ? 'Unknown episode' : `Episode ${index+1}`, sources:[],
      }));
      window.adt = {player:function() {}};
      const engine = {video, source:sources[0], group:{playlist:sources}, placement:{container:document.body},
        attachedAdapter:{get mediaSource() { return video.currentSrc; }}};
      video.engine = engine;
      let index = 0;
      const button = document.createElement('button');
      button.className = 'adt-kCdJnjy';
      button.onclick = () => {
        engine.source = sources[++index];
        video.src = index === 1 ? '/two.webm' : '/three.webm';
        video.play().catch(() => {});
      };
      document.body.append(button);
      video.play().catch(() => {});
    });
    await waitFor(() => host.phase === 'playing');
    const originalSession = host.session.body.session;
    assert.equal(new URL(lab.page.url()).pathname, '/ua/serials/stb/kod/2026/seriya-0');
    releaseCatalog();
    await lab.page.waitForFunction(() => location.pathname.endsWith('/seriya-1') && document.title === 'Episode 1');
    assert.equal(host.session.body.session, originalSession, 'Metadata must not replace the playback session');
    assert(host.presented, 'Metadata must not dismiss VLC');
    await host.next();
    await waitFor(() => host.phase === 'playing' && host.session?.body.url.endsWith('/two.webm'));
    await lab.page.waitForFunction(() => location.pathname.endsWith('/seriya-2') && document.title === 'Episode 2');
    const known = await lab.page.evaluate(() => ({
      search:location.search,hash:location.hash,state:history.state,length:history.length,token:window.__webkitLabDocumentToken,
    }));
    assert.equal(known.search,'?keep=yes');
    assert.equal(known.hash,'#chapter');
    assert.deepEqual(known.state,{fixture:'preserve'});
    assert.equal(known.length,before.length);
    assert.equal(known.token,before.token);
    await host.next();
    await waitFor(() => host.phase === 'playing' && host.session?.body.url.endsWith('/three.webm'));
    const unknown = await lab.page.evaluate(() => ({
      path:location.pathname,title:document.title,
      playerTitle:window.__webkitLabMessages.filter(message => message.body?.episodeMetadata).at(-1).body.pageTitle,
    }));
    assert(unknown.path.endsWith('/seriya-2'), 'An unknown catalog entry must not invent a URL');
    assert.equal(unknown.title,'Episode 2');
    assert.equal(unknown.playerTitle,'Unknown episode');
    console.log(JSON.stringify({runDirectory:lab.runDirectory,actualLinuxLibVLC:true,
      catalogAndPlayer:'controlled fixture',delayedCatalog:true,sourceTitleIndependentOfPanel:true,
      samePlaybackSession:true,preserveHistoryQueryFragment:true,unknownURLUnchanged:true}));
  } finally {
    releaseCatalog();
    await host.dispose();
    await lab.page.goto('about:blank');
    await media.close();
  }
}
