// Regenerate pinned uBO assets using only Node.js; no external bundler is required.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinScriptlets } from '../_Project/Vendor/UBlock/src/js/resources/scriptlets.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_Project/Vendor/UBlock');
const modules = new Map();
function bundle(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file).id;
    const record = { id: modules.size, code: '' }; modules.set(file, record);
    let code = fs.readFileSync(file, 'utf8');
    code = code.replace(/import\s+(\* as \w+|\{[^}]+\})\s+from\s+['"]([^'"]+)['"];?/g, (_, spec, rel) => {
        const id = bundle(path.resolve(path.dirname(file), rel));
        if (spec.startsWith('*')) return `const ${spec.slice(5)} = require(${id});`;
        return `const ${spec.replace(/\bas\b/g, ':')} = require(${id});`;
    });
    const exports = [];
    code = code.replace(/export\s+(const|let|class|function)\s+(\w+)/g, (_, kind, name) => { exports.push(`${name}:${name}`); return `${kind} ${name}`; });
    code = code.replace(/export\s*\{([^}]+)\};?/g, (_, names) => {
        for (const name of names.split(',')) {
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
const names = new Set(library.map(d => d.name));
if (names.size !== library.length) throw new Error('Duplicate scriptlet registration');
for (const entry of library) for (const dependency of entry.dependencies) {
    if (!names.has(dependency)) throw new Error(`${entry.name}: missing dependency ${dependency}`);
}
fs.writeFileSync(path.join(root, 'UBlockScriptlets.json'), JSON.stringify(library));
fs.writeFileSync(path.join(root, 'UBlockProcedural.js'), fs.readFileSync(path.join(root, 'src/js/contentscript-extra.js'), 'utf8'));
console.log(`Generated parser (${modules.size} modules), ${library.length} scriptlet/helper entries, full procedural engine.`);
