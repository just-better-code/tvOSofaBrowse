#!/usr/bin/env node
// Refresh the bundled official uAssets snapshot from an immutable commit.
// Downloaded filter text remains data; trusted scriptlet code stays app-pinned.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const usage = 'Usage: node scripts/update-uassets-snapshot.mjs --revision <40-character-commit> --date YYYY-MM-DD (--checkout <uAssets-repository> | --download)';
const options = {};
for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (flag === '--help') { console.log(usage); process.exit(0); }
    if (flag === '--download') { options.download = true; continue; }
    if (!['--revision', '--date', '--checkout'].includes(flag) || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new Error(usage);
    if (options[flag.slice(2)] !== undefined) throw new Error('Duplicate option');
    options[flag.slice(2)] = process.argv[++i];
}
if (!/^[a-f0-9]{40}$/.test(options.revision || '') || !/^\d{4}-\d{2}-\d{2}$/.test(options.date || '') ||
    (Boolean(options.checkout) === Boolean(options.download))) throw new Error(usage);
const parsedDate = new Date(options.date + 'T00:00:00Z');
if (!Number.isFinite(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== options.date) throw new Error('Invalid retrieval date');
const source = 'https://github.com/uBlockOrigin/uAssets';
const git = args => execFileSync('git', ['-C', path.resolve(options.checkout), ...args], { maxBuffer: 32 * 1024 * 1024 });
if (options.checkout) {
    const remote = git(['remote', 'get-url', 'origin']).toString().trim();
    if (!/^(?:https:\/\/github\.com\/|git@github\.com:)uBlockOrigin\/uAssets(?:\.git)?\/?$/i.test(remote)) throw new Error('Checkout must identify the official uAssets origin');
    if (git(['cat-file', '-t', options.revision]).toString().trim() !== 'commit') throw new Error('Revision must be a commit');
}
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const cache = new Map();
async function read(relative) {
    if (cache.has(relative)) return cache.get(relative);
    let bytes;
    if (options.checkout) bytes = git(['show', `${options.revision}:${relative}`]);
    else {
        const response = await fetch(`https://raw.githubusercontent.com/uBlockOrigin/uAssets/${options.revision}/${relative}`, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`Failed to retrieve ${relative}: HTTP ${response.status}`);
        bytes = Buffer.from(await response.arrayBuffer());
    }
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error(`Invalid source size: ${relative}`);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const entry = { bytes, text }; cache.set(relative, entry); return entry;
}
const files = {};
async function flatten(name, ancestors = []) {
    if (!/^[a-z0-9._-]+\.txt$/i.test(name) || ancestors.includes(name)) throw new Error(`Unsupported or cyclic include: ${name}`);
    const { bytes, text } = await read(`filters/${name}`);
    files[name] = digest(bytes);
    const result = [];
    for (const line of text.split(/\r?\n/)) {
        const include = /^!#include\s+(\S+)\s*$/.exec(line);
        if (!include) {
            if (/^!#include\b/.test(line)) throw new Error(`Unsupported include directive in ${name}`);
            result.push(line); continue;
        }
        result.push(`! Included ${include[1]}`, await flatten(include[1], [...ancestors, name]), `! End included ${include[1]}`);
    }
    return result.join('\n');
}
const filters = await flatten('filters.txt');
if (!filters.includes('||') || !filters.includes('##')) throw new Error('Snapshot lacks expected network/cosmetic filters');
const license = await read('LICENSE');
const output = Buffer.from(filters.endsWith('\n') ? filters : filters + '\n');
const manifest = {
    retrieved: options.date, source, commit: options.revision, entry: 'filters/filters.txt',
    files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    outputSHA256: digest(output), licenseSHA256: digest(license.bytes)
};
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../_Project/Vendor/UBlock');
const outputs = new Map([
    ['UBlockFilters.txt', output], ['UAssets-LICENSE', license.bytes],
    ['uassets-pin.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]
]);
const staged = [];
try {
    // All includes, digests and the license are complete before replacing files.
    for (const [name, data] of outputs) {
        const temporary = path.join(directory, `.${name}.${process.pid}.tmp`);
        fs.writeFileSync(temporary, data, { flag: 'wx' }); staged.push([temporary, path.join(directory, name)]);
    }
    for (const [temporary, destination] of staged) fs.renameSync(temporary, destination);
} finally {
    for (const [temporary] of staged) if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
console.log(`Pinned uAssets ${options.revision}: ${Object.keys(files).length} input files, ${output.length} bytes, SHA-256 ${manifest.outputSHA256}`);
