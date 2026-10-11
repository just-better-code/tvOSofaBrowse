// Exercise shipped parser and frame applicability, including PSL exceptions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = '_Project/Vendor/UBlock/';
const parser = vm.createContext({browserNormalizeHostname: h => new URL('https://' + h).hostname});
vm.runInContext(fs.readFileSync(root + 'UBlockParser.js', 'utf8'), parser);
const library = JSON.parse(fs.readFileSync(root + 'UBlockScriptlets.json', 'utf8'));
const lines = ['example.*##+js(set, marker, true)', '/^news\\d+\\.example\\.com$/##+js(set, regex, true)', 'example.com>>##+js(set, ancestor, true)', 'example.com/path##.advert', '~example.*##.generic'];
const compiled = parser.browserCompileUBlock([{id:'fixture', trusted:false, text:lines.join('\n')}], library);
assert.equal(compiled.records.length, 5);
assert.equal(compiled.stats.fixture.unsupported, 0);
function applicable(hostname, path, ancestors = []) {
    const context = vm.createContext({hostname, URL, location:{href:'https://' + hostname + path, ancestorOrigins:ancestors}});
    vm.runInContext(fs.readFileSync(root + 'UBlockDomains.js', 'utf8') + '\nglobalThis.matches = rules => rules.map(applies);', context);
    return context;
}
let context = applicable('news.example.co.uk', '/path');
assert.equal(context.matches(compiled.records)[0], true);
assert.equal(context.matches(compiled.records)[4], false);
context = applicable('news3.example.com', '/path?q=1', ['https://www.example.com']);
assert.deepEqual(Array.from(context.matches(compiled.records)), [true,true,true,true,false]);
context = applicable('example.com.evil.net', '/path', []);
assert.deepEqual(Array.from(context.matches(compiled.records)), [false,false,false,false,true]);
context = applicable('child.other.net', '/', ['https://www.example.co.uk']);
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'example.*>>'}]}])[0], true);
assert.equal(context.matches([{kind:'cosmetic',domains:[{host:'example.*>>'}]}])[0], false);
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'other.net'},{host:'example.*>>',exclude:true}]}])[0], false);
context = applicable('foo.blogspot.com', '/');
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'foo.*'}]}])[0], true);
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'blogspot.*'}]}])[0], false);
context = applicable('www.city.kawasaki.jp', '/');
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'city.*'}]}])[0], true);
context = applicable('example.com', '/watch/episode?x=1');
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'/example\\.com\\/watch/'}]}])[0], true);
assert.equal(context.matches([{kind:'scriptlet',domains:[{host:'/example\\.com\\/other/'}]}])[0], false);
console.log('Extended-domain parser/runtime checks passed (entities, PSL private/exception suffixes, regex/path, ancestors and exclusions).');
