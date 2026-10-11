const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = '_Project/Vendor/UBlock/';
const library = JSON.parse(fs.readFileSync(root+'UBlockScriptlets.json','utf8'));
for (const entry of library) new vm.Script('const '+entry.functionName+'=('+entry.code+');');
const parser = vm.createContext({browserNormalizeHostname:h=>new URL('https://'+h).hostname});
vm.runInContext(fs.readFileSync(root+'UBlockParser.js','utf8'),parser);
function compile(text,trusted=false) {return parser.browserCompileUBlock([{id:'fixture',text,trusted}],library);}
for(const name of ['noeval','nofab','popads.net','popads-dummy','google-ima','google-ima3']) {
    const result=compile('example.com##+js('+name+')');
    assert.equal(result.records.length,1,name); assert.equal(result.stats.fixture.unsupported,0,name);
}
assert.equal(compile('example.com##+js(google-ima3-dai)').rejected['untrusted-scriptlet'],1);
assert.equal(compile('example.com##+js(google-ima3-dai)',true).records.length,1);
assert.equal(compile('example.com#@#+js(google-ima3-dai)').records[0].exception,true);
const box=vm.createContext({console:{log(){}}, eval:()=>{throw Error('native eval must not run');}});
vm.runInContext('globalThis.window=globalThis;',box);
for(const name of ['nofab.js','noeval.js','popads-dummy.js']) {
 const entry=library.find(e=>e.name===name);
 vm.runInContext('('+entry.code+')()',box);
}
assert.equal(vm.runInContext('typeof FuckAdBlock',box),'function');
assert.equal(vm.runInContext('typeof PopAds',box),'object');
assert.equal(vm.runInContext('eval("fixture")',box),undefined);
assert.equal(vm.runInContext('let invoked=false;fuckAdBlock.onNotDetected(()=>invoked=true);invoked',box),true);
const bundled=compile(fs.readFileSync(root+'UBlockFilters.txt','utf8'),true);
assert.equal(bundled.rejected['scriptlet-name'],undefined);
console.log('All pinned scriptlet code parses; legacy names/aliases, trust gates, anti-adblock stubs and bundled name coverage pass.');
