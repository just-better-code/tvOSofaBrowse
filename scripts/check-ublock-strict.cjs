const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const box=vm.createContext({URL,TextDecoder,performance,setTimeout,clearTimeout,console});
vm.runInContext(fs.readFileSync('_Project/Vendor/UBlock/UBlockNetwork.js','utf8'),box);
const details={url:'https://blocked.example/path',originURL:'https://blocked.example/',topURL:'https://blocked.example/',type:'main_frame',method:'GET'};
function match(text,changes={},hostRules='') {
 box.browserCompileNetwork([{id:'fixture',text,trusted:false}],'','example\ncom\n');
 box.browserSetDynamicNetwork(hostRules,'');
 return box.browserMatchNetwork({...details,...changes});
}
assert.equal(match('||blocked.example^').action,1);
assert.equal(match('||blocked.example^',{type:'sub_frame',originURL:'https://other.example/'}).action,1);
assert.equal(match('||blocked.example/path').action,0); // generic path rule must not block whole website
assert.equal(match('||blocked.example/path$document').action,1);
assert.equal(match('||blocked.example/path',{type:'xmlhttprequest'}).action,1);
assert.equal(match('*').action,0); // tokenless broad generic filter is not a strict block
const generic=['','||blocked.example^','||blocked.example^$important','@@||blocked.example^'];
const explicit=['','||blocked.example^$document','||blocked.example^$document,important','@@||blocked.example^$document'];
const expected=[[0,1,1,2],[1,1,1,2],[1,1,1,1],[2,2,1,2]];
for(let g=0;g<4;g++) for(let d=0;d<4;d++) assert.equal(match([generic[g],explicit[d]].join('\n')).action,expected[g][d],`generic=${g}, document=${d}`);
assert.equal(match('||blocked.example^',{url:'https://blocked.example./path'}).action,1);
assert.equal(match('||blocked.example^',{url:'https://safe.example/path/blocked.example'}).action,0);
assert.equal(match('||blocked.example^',{},'blocked.example blocked.example * allow').action,2);
// The winning explicit filter must survive the subsequent generic probe.
// These opposing results catch reporting the engine's last match instead.
assert.equal(match('||blocked.example/path$document\n||blocked.example^').rule,'||blocked.example/path$document');
assert.equal(match('@@||blocked.example^$document\n||blocked.example^').rule,'@@||blocked.example^$document');
assert.equal(match('@@||blocked.example^$document\n||blocked.example^$important').rule,'||blocked.example^$important');
assert.equal(match('||blocked.example/path').rule,undefined); // rejected strict probe is not a decision
assert.equal(match('||blocked.example^',{},'blocked.example blocked.example * block').rule,'blocked.example blocked.example * block');
assert.equal(match('||blocked.example^',{},'blocked.example blocked.example * noop').rule,'||blocked.example^');
assert.equal(match('||blocked.example^',{type:'xmlhttprequest'}).rule,undefined); // no per-resource reconstruction overhead
box.browserCompileNetwork([{id:'fixture',text:'||blocked.example/path$document\n||blocked.example^',trusted:false}],'','example\ncom\n');
const cached = box.browserSerializeNetwork();
box.browserRestoreNetwork(cached,'example\ncom\n');
box.browserSetDynamicNetwork('','blocked.example https://blocked.example/ * block');
assert.equal(box.browserMatchNetwork(details).rule.replace(/\s+/g,' '),'blocked.example https://blocked.example/ * block');
box.browserSetDynamicNetwork('','');
assert.equal(box.browserMatchNetwork(details).rule,'||blocked.example/path$document');
console.log('Strict-document hostname/path/token validation and 16 generic/explicit/important/exception precedence combinations pass.');
console.log('Winning static/dynamic rule explanations survive noop fallback and snapshot restoration without leaking a losing strict probe.');
