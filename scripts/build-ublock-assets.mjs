// Regenerate pinned uBO assets using only Node.js; no external bundler is required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import redirectResources from '../_Project/Vendor/UBlock/src/js/redirect-resources.js';
import publicSuffixList from '../_Project/Vendor/UBlock/src/lib/publicsuffixlist/publicsuffixlist.js';
import punycode from '../_Project/Vendor/UBlock/src/lib/punycode.js';
import { builtinScriptlets } from '../_Project/Vendor/UBlock/src/js/resources/scriptlets.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_Project/Vendor/UBlock');
const modules = new Map();
function bundle(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).id;
    const record = { id: modules.size, code: '' }; modules.set(file, record);
    let code = fs.readFileSync(file, 'utf8');
    code = code.replace(/import\s+(\w+|\* as \w+|\{[^}]+\})\s+from\s+['"]([^'"]+)['"];?/g, (_, spec, rel) => {
        const id = bundle(path.resolve(path.dirname(file), rel));
        if (spec.startsWith('*')) return `const ${spec.slice(5)} = require(${id});`;
        if (!spec.startsWith('{')) return `const ${spec} = require(${id}).default;`;
        return `const ${spec.replace(/\bas\b/g, ':')} = require(${id});`;
    });
    code = code.replace(/import\s+['"]([^'"]+)['"];?/g, (_, rel) => `require(${bundle(path.resolve(path.dirname(file), rel))});`);
    // The extension module uses top-level await for host PSL discovery. Our host
    // always uses the pinned portable implementation; keep upstream source intact.
    if (file.endsWith('/src/js/publicsuffix.js')) code = `const publicSuffixList = require(${bundle(path.join(root, 'src/lib/publicsuffixlist/publicsuffixlist.js'))}).default; export default publicSuffixList;`;
    const exports = [];
    code = code.replace(/export\s+default\s+/g, () => { exports.push('default:__default'); return 'const __default = '; });
    code = code.replace(/export\s+(const|let|class|function)\s+(\w+)/g, (_, kind, name) => { exports.push(`${name}:${name}`); return `${kind} ${name}`; });
    code = code.replace(/export\s*\{([^}]+)\};?/g, (_, names) => {
        for (const name of names.split(',')) {
            if (!name.trim()) continue;
            const [local, alias] = name.trim().split(/\s+as\s+/); exports.push(`${alias || local}:${local}`);
        }
        return '';
    });
    record.code = `${code}\nreturn {${exports.join(',')}};`;
    return record.id;
}
const parserId = bundle(path.join(root, 'src/js/static-filtering-parser.js'));
const parser = `(function(){const modules={${[...modules.values()].map(m => `${m.id}:function(require){${m.code}\n}`).join(',')}};const cache={};function require(id){return cache[id]||(cache[id]=modules[id](require));}const {AstFilterParser,utils}=require(${parserId});\n`;
const adapter = fs.readFileSync(path.join(root, 'compile.js'), 'utf8');
fs.writeFileSync(path.join(root, 'UBlockParser.js'), parser + adapter + '\n})();\n');
const library = builtinScriptlets.map(d => ({ name:d.name, aliases:d.aliases || [], world:d.world || 'MAIN', trusted:d.requiresTrust === true, dependencies:d.dependencies || [], functionName:d.fn.name, code:d.fn.toString() }));
// Upstream text-injectable legacy resources are also valid +js tokens. Keep
// their pinned code/aliases/trust metadata, rather than silently rejecting them.
let surrogateIndex = 0;
for (const [name, details] of redirectResources) {
    if (!name.endsWith('.js') || details.data !== 'text') continue;
    const functionName = `browserSurrogate${surrogateIndex++}`;
    const aliases = details.alias ? (Array.isArray(details.alias) ? details.alias : [details.alias]) : [];
    library.push({name, aliases, world:'MAIN', trusted:details.requiresTrust === true,
        dependencies:[], functionName, code:`function ${functionName}(){\n${fs.readFileSync(path.join(root, 'src/web_accessible_resources', name), 'utf8')}\n}`});
}
const names = new Set(library.map(d => d.name));
if (names.size !== library.length) throw new Error('Duplicate scriptlet registration');
for (const entry of library) for (const dependency of entry.dependencies) {
    if (!names.has(dependency)) throw new Error(`${entry.name}: missing dependency ${dependency}`);
}
fs.writeFileSync(path.join(root, 'UBlockScriptlets.json'), JSON.stringify(library));
fs.writeFileSync(path.join(root, 'UBlockProcedural.js'), fs.readFileSync(path.join(root, 'src/js/contentscript-extra.js'), 'utf8'));
console.log(`Generated parser (${modules.size} modules), ${library.length} scriptlet/helper entries, full procedural engine.`);

modules.clear();
const networkId = bundle(path.join(root, 'src/js/static-net-filtering.js'));
const hostId = bundle(path.join(root, 'src/js/dynamic-net-filtering.js'));
const urlId = bundle(path.join(root, 'src/js/url-net-filtering.js'));
const contextId = bundle(path.join(root, 'src/js/filtering-context.js'));
const ioId = bundle(path.join(root, 'src/js/static-filtering-io.js'));
const sfpId = bundle(path.join(root, 'src/js/static-filtering-parser.js'));
const pslId = bundle(path.join(root, 'src/lib/publicsuffixlist/publicsuffixlist.js'));
const punycodeId = bundle(path.join(root, 'src/lib/punycode.js'));
const network = `(function(){const modules={${[...modules.values()].map(m => `${m.id}:function(require){${m.code}\n}`).join(',')}};const cache={};function require(id){return cache[id]||(cache[id]=modules[id](require));}const snfe=require(${networkId}).default;const HostEngine=require(${hostId}).default;const URLEngine=require(${urlId}).default;const {FilteringContext}=require(${contextId});const {CompiledListReader,CompiledListWriter}=require(${ioId});const {AstFilterParser,utils}=require(${sfpId});const psl=require(${pslId}).default;const punycode=require(${punycodeId}).default;\n`;
fs.writeFileSync(path.join(root, 'UBlockNetwork.js'), network + fs.readFileSync(path.join(root, 'network.js'), 'utf8') + '\n})();\n');
console.log(`Generated full static/dynamic network core (${modules.size} modules).`);

// Entity matching uses the same pinned PSL as the network core, precompiled at
// asset generation so every frame avoids parsing the text suffix corpus.
publicSuffixList.parse(fs.readFileSync(path.join(root, 'PublicSuffixList.dat'), 'utf8'), punycode.toASCII);
const selfie = publicSuffixList.toSelfie();
const suffixSource = fs.readFileSync(path.join(root, 'src/lib/publicsuffixlist/publicsuffixlist.js'), 'utf8').replace('export default', 'const browserSuffixes =');
fs.writeFileSync(path.join(root, 'UBlockDomains.js'), suffixSource + `\nbrowserSuffixes.fromSelfie({magic:${JSON.stringify(selfie.magic)},buf32:new Uint32Array(${JSON.stringify(Array.from(selfie.buf32))})});\n` + fs.readFileSync(path.join(root, 'domains.js'), 'utf8'));
