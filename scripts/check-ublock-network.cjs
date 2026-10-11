const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({URL, TextDecoder, performance, setTimeout, clearTimeout, console});
vm.runInContext(fs.readFileSync('_Project/Vendor/UBlock/UBlockNetwork.js', 'utf8'), context);
const list = [{id:'fixture', trusted:false, text:'||advert.example^\n@@||advert.example/allowed$xmlhttprequest\n||site.example^$removeparam=utm_source\n@@||site.example/keep$removeparam=utm_source\n'}];
const built = context.browserCompileNetwork(list, '', 'com\norg\nnet\nexample\n');
assert.equal(built.stats.fixture.accepted, 4);
const request = {url:'https://advert.example/ad',originURL:'https://site.example/',topURL:'https://site.example/',type:'xmlhttprequest',method:'GET'};
function match(host='', url='', details={}) {
    context.browserSetDynamicNetwork(host, url);
    return context.browserMatchNetwork({...request,...details});
}
assert.equal(match().action, 1);
assert.equal(match('', '', {url:'https://advert.example/allowed'}).action, 2);
assert.equal(match('site.example advert.example * allow').action, 2);
assert.equal(match('site.example advert.example * noop').action, 1);
assert.equal(match('site.example advert.example * block', 'site.example https://advert.example/ad xmlhttprequest allow').action, 2);
assert.equal(match('site.example advert.example * allow', 'site.example https://advert.example/ad xmlhttprequest noop').action, 1);
assert.equal(match().action, 1); // removal clears previous dynamic state
for(let i=0;i<100;i++) assert.equal(match('site.example advert.example * allow').action, 2);
context.browserCompileNetwork([], built.compiled, 'com\norg\nnet\nexample\n');
assert.equal(match().action, 1); // cache restoration preserves filtering
console.log('Full network core static/exception, dynamic URL/host precedence, noop/removal, repeat and compiled-cache checks passed.');

let pruned = match('', '', {url:'https://site.example/path?token=a%2Fb&utm_source=ad&tag=1&tag=2#section'});
assert.equal(pruned.modifiedURL, 'https://site.example/path?token=a%2Fb&tag=1&tag=2#section');
assert.equal(match('', '', {url:'https://site.example/keep?utm_source=ad'}).modifiedURL, undefined);
assert.equal(match('', '', {url:'https://site.example/path?utm_source=ad',method:'POST'}).modifiedURL, undefined);
assert.equal(match('', '', {url:'https://advert.example/ad?utm_source=ad'}).modifiedURL, undefined);
console.log('Upstream query pruning preserves encoded/duplicate parameters and fragments, honors exceptions and skips POST/blocked requests.');
