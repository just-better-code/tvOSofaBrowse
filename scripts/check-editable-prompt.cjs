/* Execute the production prompt target/body against changing DOM-node fixtures. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('_Project/Browser/BrowserPageActionCoordinator.m', 'utf8');
const strings = s => [...s.matchAll(/@?"((?:\\.|[^"\\])*)"/g)].map(m => JSON.parse('"' + m[1] + '"')).join('');
const helper = strings(source.slice(source.indexOf('return [NSString stringWithFormat:@"var session='), source.indexOf('@interface'))).replace('%@', 'fixture');
const done = source.slice(source.indexOf('UIAlertAction *doneAction'), source.indexOf('[alertController addAction:doneAction]'));
const body = strings(done.slice(done.indexOf('body:[NSString stringWithFormat:'), done.indexOf(', BrowserEditablePromptTargetJavaScript')))
    .replace('%@', helper).replaceAll('%@', 'edited');
function node() { return { isConnected: true, value: 'original', events: [], dispatchEvent(e) { this.events.push(e.type); } }; }
function run(name, fn) { fn(); console.log('PASS ' + name); }
function evaluate(target, identifier = 'fixture') {
    const window = { __browserEditablePromptTarget: { element: target, identifier } };
    const result = vm.runInNewContext('(function(){' + body + '})()', { window, Event });
    return { window, result };
}
run('Done updates original field and dispatches input/change', () => {
    const target = node(); const {window, result} = evaluate(target);
    assert.equal(result, 'true'); assert.equal(target.value, 'edited'); assert.deepEqual(target.events, ['input', 'change']);
    assert.equal(window.__browserEditablePromptTarget, null);
});
run('removed target cannot overwrite replacement field', () => {
    const target = node(), replacement = node(); target.isConnected = false;
    const window = { __browserEditablePromptTarget: { element: target, identifier: 'fixture' } };
    assert.equal(vm.runInNewContext('(function(){' + body + '})()', { window, Event, browserEditableTarget: () => replacement }), 'false');
    assert.equal(target.value, 'original'); assert.equal(replacement.value, 'original');
});
run('old prompt cannot write or clear a newer prompt', () => {
    const target = node(); const {window, result} = evaluate(target, 'newer');
    assert.equal(result, 'false'); assert.equal(target.value, 'original'); assert.equal(window.__browserEditablePromptTarget.identifier, 'newer');
});
run('contenteditable target receives text and change events', () => {
    const target = node(); delete target.value; target.textContent = 'original'; evaluate(target);
    assert.equal(target.textContent, 'edited'); assert.deepEqual(target.events, ['input', 'change']);
});
