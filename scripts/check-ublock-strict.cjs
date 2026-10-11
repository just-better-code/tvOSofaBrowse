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
console.log('Strict-document hostname/path/token validation and 16 generic/explicit/important/exception precedence combinations pass.');
