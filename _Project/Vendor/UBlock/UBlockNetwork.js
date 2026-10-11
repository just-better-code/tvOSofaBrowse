(function(){const modules={0:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

require(16);

const sfp = require(1);

const { dropTask, queueTask } = require(5);
const { isRE2, toHeaderPattern, tokenizableStrFromRegex } = require(6);

const BidiTrieContainer = require(7).default;
const { CompiledListReader } = require(8);
const { FilteringContext } = require(9);
const HNTrieContainer = require(14).default;
const { domainFromHostname } = require(10);
const { urlSkip } = require(15);

/******************************************************************************/

// Access to a key-val store is optional and useful only for optimal
// initialization at module load time. Probably could re-arrange code
// to export an init() function with optimization parameters which would
// need to be called by module clients. For now, I want modularizing with
// minimal amount of changes.

const keyvalStore = typeof vAPI !== 'undefined'
    ? vAPI.localStorage
    : { getItem() { return null; }, setItem() {}, removeItem() {} };

/******************************************************************************/

// 10fedcba9876543210
// ||||||||    | || |
// ||||||||    | || |
// ||||||||    | || |
// ||||||||    | || |
// ||||||||    | || +---- bit  0- 1: block=0, allow=1, block important=2
// ||||||||    | |+------ bit     2: unused
// ||||||||    | +------- bit  3- 4: party [0-3]
// ||||||||    +--------- bit  5- 9: type [0-31]
// |||||||+-------------- bit    10: headers-based filters
// ||||||+--------------- bit 13-11: modify type

const BLOCK_REALM          = 0b0000_0000_0000_0000_0000;
const ALLOW_REALM          = 0b0000_0000_0000_0000_0001;
const IMPORTANT_REALM      = 0b0000_0000_0000_0000_0010;
const BLOCKALLOW_REALM     = BLOCK_REALM | ALLOW_REALM | IMPORTANT_REALM;
const BLOCKIMPORTANT_REALM = BLOCK_REALM | IMPORTANT_REALM;
const ANYPARTY_REALM       = 0b0000_0000_0000_0000_0000;
const FIRSTPARTY_REALM     = 0b0000_0000_0000_0000_1000;
const THIRDPARTY_REALM     = 0b0000_0000_0000_0001_0000;
const ALLPARTIES_REALM     = FIRSTPARTY_REALM | THIRDPARTY_REALM;
const TYPE_REALM           = 0b0000_0000_0011_1110_0000;
const HEADERS_REALM        = 0b0000_0000_0100_0000_0000;
const REDIRECT_REALM       = 0b0000_0000_1000_0000_0000;
const REMOVEPARAM_REALM    = 0b0000_0001_0000_0000_0000;
const CSP_REALM            = 0b0000_0001_1000_0000_0000;
const PERMISSIONS_REALM    = 0b0000_0010_0000_0000_0000;
const URLTRANSFORM_REALM   = 0b0000_0010_1000_0000_0000;
const REPLACE_REALM        = 0b0000_0011_0000_0000_0000;
const URLSKIP_REALM        = 0b0000_0011_1000_0000_0000;
const MODIFY_REALMS        = 0b0000_0011_1000_0000_0000;

const TYPE_REALM_OFFSET = 5;

const typeNameToTypeValue = {
           'no_type':  0 << TYPE_REALM_OFFSET,
        'stylesheet':  1 << TYPE_REALM_OFFSET,
             'image':  2 << TYPE_REALM_OFFSET,
            'object':  3 << TYPE_REALM_OFFSET,
 'object_subrequest':  3 << TYPE_REALM_OFFSET,
            'script':  4 << TYPE_REALM_OFFSET,
             'fetch':  5 << TYPE_REALM_OFFSET,
    'xmlhttprequest':  5 << TYPE_REALM_OFFSET,
         'sub_frame':  6 << TYPE_REALM_OFFSET,
              'font':  7 << TYPE_REALM_OFFSET,
             'media':  8 << TYPE_REALM_OFFSET,
         'websocket':  9 << TYPE_REALM_OFFSET,
            'beacon': 10 << TYPE_REALM_OFFSET,
              'ping': 10 << TYPE_REALM_OFFSET,
             'other': 11 << TYPE_REALM_OFFSET,
             'popup': 12 << TYPE_REALM_OFFSET, // start of behavioral filtering
          'popunder': 13 << TYPE_REALM_OFFSET,
        'main_frame': 14 << TYPE_REALM_OFFSET, // start of 1p behavioral filtering
       'generichide': 15 << TYPE_REALM_OFFSET,
      'specifichide': 16 << TYPE_REALM_OFFSET,
       'inline-font': 17 << TYPE_REALM_OFFSET,
     'inline-script': 18 << TYPE_REALM_OFFSET,
             'cname': 19 << TYPE_REALM_OFFSET,
            'webrtc': 20 << TYPE_REALM_OFFSET,
       'unsupported': 21 << TYPE_REALM_OFFSET,
};

const otherTypeBitValue = typeNameToTypeValue.other;

const bitFromType = type =>
    1 << ((typeNameToTypeValue[type] >>> TYPE_REALM_OFFSET) - 1);

// All network request types to bitmap
//   bring origin to 0 (from TYPE_REALM_OFFSET -- see typeNameToTypeValue)
//   left-shift 1 by the above-calculated value
//   subtract 1 to set all type bits
const allNetworkTypesBits =
    (1 << (otherTypeBitValue >>> TYPE_REALM_OFFSET)) - 1;

const allTypesBits =
    allNetworkTypesBits |
    1 << (typeNameToTypeValue['popup'] >>> TYPE_REALM_OFFSET) - 1 |
    1 << (typeNameToTypeValue['main_frame'] >>> TYPE_REALM_OFFSET) - 1 |
    1 << (typeNameToTypeValue['inline-font'] >>> TYPE_REALM_OFFSET) - 1 |
    1 << (typeNameToTypeValue['inline-script'] >>> TYPE_REALM_OFFSET) - 1;
const unsupportedTypeBit =
    1 << (typeNameToTypeValue['unsupported'] >>> TYPE_REALM_OFFSET) - 1;

const typeValueToTypeName = [
    '',
    'stylesheet',
    'image',
    'object',
    'script',
    'xhr',
    'frame',
    'font',
    'media',
    'websocket',
    'ping',
    'other',
    'popup',
    'popunder',
    'document',
    'generichide',
    'specifichide',
    'inline-font',
    'inline-script',
    'cname',
    '',
    '',
    'webrtc',
    'unsupported',
];

const typeValueToDNRTypeName = [
    '',
    'stylesheet',
    'image',
    'object',
    'script',
    'xmlhttprequest',
    'sub_frame',
    'font',
    'media',
    'websocket',
    'ping',
    'other',
];

// Do not change order. Compiled filter lists rely on this order being
// consistent across sessions.
const MODIFIER_TYPE_REDIRECT = 1;
const MODIFIER_TYPE_REDIRECTRULE = 2;
const MODIFIER_TYPE_REMOVEPARAM = 3;
const MODIFIER_TYPE_CSP = 4;
const MODIFIER_TYPE_PERMISSIONS = 5;
const MODIFIER_TYPE_URLTRANSFORM = 6;
const MODIFIER_TYPE_REPLACE = 7;
const MODIFIER_TYPE_URLSKIP = 8;

const modifierBitsFromType = new Map([
    [ MODIFIER_TYPE_REDIRECT, REDIRECT_REALM ],
    [ MODIFIER_TYPE_REDIRECTRULE, REDIRECT_REALM ],
    [ MODIFIER_TYPE_REMOVEPARAM, REMOVEPARAM_REALM ],
    [ MODIFIER_TYPE_CSP, CSP_REALM ],
    [ MODIFIER_TYPE_PERMISSIONS, PERMISSIONS_REALM ],
    [ MODIFIER_TYPE_URLTRANSFORM, URLTRANSFORM_REALM ],
    [ MODIFIER_TYPE_REPLACE, REPLACE_REALM ],
    [ MODIFIER_TYPE_URLSKIP, URLSKIP_REALM ],
]);

const modifierTypeFromName = new Map([
    [ 'redirect', MODIFIER_TYPE_REDIRECT ],
    [ 'redirect-rule', MODIFIER_TYPE_REDIRECTRULE ],
    [ 'removeparam', MODIFIER_TYPE_REMOVEPARAM ],
    [ 'csp', MODIFIER_TYPE_CSP ],
    [ 'permissions', MODIFIER_TYPE_PERMISSIONS ],
    [ 'uritransform', MODIFIER_TYPE_URLTRANSFORM ],
    [ 'replace', MODIFIER_TYPE_REPLACE ],
    [ 'urlskip', MODIFIER_TYPE_URLSKIP ],
]);

const modifierNameFromType = new Map([
    [ MODIFIER_TYPE_REDIRECT, 'redirect' ],
    [ MODIFIER_TYPE_REDIRECTRULE, 'redirect-rule' ],
    [ MODIFIER_TYPE_REMOVEPARAM, 'removeparam' ],
    [ MODIFIER_TYPE_CSP, 'csp' ],
    [ MODIFIER_TYPE_PERMISSIONS, 'permissions' ],
    [ MODIFIER_TYPE_URLTRANSFORM, 'uritransform' ],
    [ MODIFIER_TYPE_REPLACE, 'replace' ],
    [ MODIFIER_TYPE_URLSKIP, 'urlskip' ],
]);

//const typeValueFromCatBits = catBits => (catBits >>> TYPE_REALM_OFFSET) & 0b11111;

const MAX_TOKEN_LENGTH = 7;

// Four upper bits of token hash are reserved for built-in predefined
// token hashes, which should never end up being used when tokenizing
// any arbitrary string.
const        NO_TOKEN_HASH = 0x5000_0000;
const       DOT_TOKEN_HASH = 0x1000_0000;
const       ANY_TOKEN_HASH = 0x2000_0000;
const ANY_HTTPS_TOKEN_HASH = 0x3000_0000;
const  ANY_HTTP_TOKEN_HASH = 0x4000_0000;
const     EMPTY_TOKEN_HASH = 0xF000_0000;
const   INVALID_TOKEN_HASH = 0xFFFF_FFFF;

/******************************************************************************/

// See the following as short-lived registers, used during evaluation. They are
// valid until the next evaluation.

let $requestMethodBit = 0;
let $requestTypeValue = 0;
let $requestURL = '';
let $requestURLRaw = '';
let $requestHostname = '';
let $requestAddress = '';
let $docHostname = '';
let $topHostname = '';
let $tokenBeg = 0;
let $patternMatchLeft = 0;
let $patternMatchRight = 0;
let $isBlockImportant = false;

class HostnameDetails {
    #cache = new Map();
    #mru = [];
    #lookup(hostname) {
        const details = this.#cache.get(hostname) ?? { hostname };
        if ( details.domain === undefined ) {
            if ( this.#cache.size === 8 ) {
                this.#cache.delete(this.#mru.pop());
            }
            this.#mru.unshift(hostname);
            this.#cache.set(hostname, details);
        } else if ( this.#mru[0] !== hostname ) {
            const pos = this.#mru.indexOf(hostname);
            this.#mru.splice(pos, 1);
            this.#mru.unshift(hostname);
        }
        return details;
    }
    get hostname() { return ''; }
    get domain() {
        const details = this.#lookup(this.hostname);
        if ( details.domain === undefined ) {
            details.domain = domainFromHostname(details.hostname);
        }
        return details.domain;
    }
    get entity() {
        const details = this.#lookup(this.hostname);
        if ( details.entity === undefined ) {
            if ( details.domain === undefined ) {
                details.domain = domainFromHostname(details.hostname);
            }
            const pos = details.domain.indexOf('.');
            details.entity = pos !== -1
                ? `${details.hostname.slice(0, pos - details.domain.length)}.*`
                : '';
        }
        return details.entity;
    }
}

class DocDetails extends HostnameDetails {
    get hostname() { return $docHostname; }
}
const $docDetails = new DocDetails();

class RequestDetails extends HostnameDetails {
    get hostname() { return $requestHostname; }
}
const $requestDetails = new RequestDetails();

class TopDetails extends HostnameDetails {
    get hostname() { return $topHostname; }
}
const $topDetails = new TopDetails();

const $httpHeaders = {
    init(...headers) {
        this.headers = headers.flat();
        this.parsed.clear();
    },
    reset() {
        this.headers = [];
        this.parsed.clear();
    },
    lookup(name) {
        let value = this.parsed.get(name);
        if ( value === undefined ) {
            const headers = this.headers;
            const i = headers.findIndex(a => name === a.name.toLowerCase());
            value = i !== -1 ? headers[i].value : null;
            this.parsed.set(name, value);
        }
        return value ?? undefined;
    },
    headers: [],
    parsed: new Map(),
};

const resetRegisters = (fctxt, typeBits) => {
    $requestURL = urlTokenizer.setURL(fctxt.url);
    $requestURLRaw = fctxt.url;
    $requestHostname = fctxt.getHostname();
    $requestMethodBit = fctxt.method || 0;
    $requestTypeValue = (typeBits & TYPE_REALM) >>> TYPE_REALM_OFFSET;
    $requestAddress = fctxt.getIPAddress();
    $docHostname = fctxt.getDocHostname();
    $topHostname = fctxt.getTabHostname();
    $isBlockImportant = false;
};

/******************************************************************************/

// Local helpers

const restrSeparator = '(?:[^%.0-9a-z_-]|$)';

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
const reEscape = /[.*+?^${}()|[\]\\]/g;

// Convert a plain string (devoid of special characters) into a regex.
const restrFromPlainPattern = s => s.replace(reEscape, '\\$&');

const restrFromGenericPattern = function(s, anchor = 0) {
    let reStr = s.replace(restrFromGenericPattern.rePlainChars, '\\$&')
                 .replace(restrFromGenericPattern.reSeparators, restrSeparator)
                 .replace(restrFromGenericPattern.reDanglingAsterisks, '')
                 .replace(restrFromGenericPattern.reAsterisks, '.*?');
    if ( anchor & 0b100 ) {
        reStr = (
            reStr.startsWith('\\.') ?
                restrFromGenericPattern.restrHostnameAnchor2 :
                restrFromGenericPattern.restrHostnameAnchor1
        ) + reStr;
    } else if ( anchor & 0b010 ) {
        reStr = '^' + reStr;
    }
    if ( anchor & 0b001 ) {
        reStr += '$';
    }
    return reStr;
};
restrFromGenericPattern.rePlainChars = /[.+?${}()|[\]\\]/g;
restrFromGenericPattern.reSeparators = /\^/g;
restrFromGenericPattern.reDanglingAsterisks = /^\*+|\*+$/g;
restrFromGenericPattern.reAsterisks = /\*+/g;
restrFromGenericPattern.restrHostnameAnchor1 = '^[^:]+://(?:[^/]+\\.)?';
restrFromGenericPattern.restrHostnameAnchor2 = '^[^:]+://(?:[^/]+)?';

/******************************************************************************/

class LogData {
    constructor(categoryBits, tokenHash, iunit) {
        this.result = 0;
        this.source = 'static';
        this.tokenHash = tokenHash;
        if ( iunit === 0 ) {
            this.raw = this.regex = '';
            return;
        }
        this.result = (categoryBits & ALLOW_REALM) === 0 ? 1 : 2;
        const pattern = [];
        const regex = [];
        const options = [];
        const denyallow = [];
        const fromDomains = [];
        const toDomains = [];
        const topDomains = [];
        const logData = {
            pattern,
            regex,
            denyallow,
            fromDomains,
            toDomains,
            topDomains,
            options,
            isRegex: false,
        };
        filterLogData(iunit, logData);
        if ( (categoryBits & THIRDPARTY_REALM) !== 0 ) {
            logData.options.unshift('3p');
        } else if ( (categoryBits & FIRSTPARTY_REALM) !== 0 ) {
            logData.options.unshift('1p');
        }
        const type = categoryBits & TYPE_REALM;
        if ( type !== 0 ) {
            logData.options.unshift(typeValueToTypeName[type >>> TYPE_REALM_OFFSET]);
        }
        let raw = logData.pattern.join('');
        if (
            logData.isRegex === false &&
            raw.charCodeAt(0) === 0x2F /* '/' */ &&
            raw.charCodeAt(raw.length - 1) === 0x2F /* '/' */
        ) {
            raw += '*';
        }
        if ( (categoryBits & ALLOW_REALM) !== 0 ) {
            raw = '@@' + raw;
        }
        if ( denyallow.length !== 0 ) {
            options.push(`denyallow=${denyallow.join('|')}`);
        }
        if ( fromDomains.length !== 0 ) {
            options.push(`from=${fromDomains.join('|')}`);
        }
        if ( toDomains.length !== 0 ) {
            options.push(`to=${toDomains.join('|')}`);
        }
        if ( topDomains.length !== 0 ) {
            options.push(`top=${topDomains.join('|')}`);
        }
        if ( options.length !== 0 ) {
            raw += '$' + options.join(',');
        }
        this.raw = raw;
        this.regex = logData.regex.join('');
        if ( logData.reason ) {
            this.reason = logData.reason;
        }
    }
    isUntokenized() {
        return this.tokenHash === NO_TOKEN_HASH;
    }
    isPureHostname() {
        return this.tokenHash === DOT_TOKEN_HASH;
    }

    static requote(s) {
        if ( /^\$|^(["'`]).*\1$|,/.test(s) === false ) { return s; }
        if ( s.includes("'") === false ) { return `'${s}'`; }
        if ( s.includes('"') === false ) { return `"${s}"`; }
        if ( s.includes('`') === false ) { return `\`${s}\``; }
        return `'${s.replace(/'/g, "\\'")}'`;
    }
}

/******************************************************************************/

const charClassMap = new Uint32Array(128);
const CHAR_CLASS_SEPARATOR = 0b00000001;

{
    const reSeparators = /[^\w%.-]/;
    for ( let i = 0; i < 128; i++ ) {
        if ( reSeparators.test(String.fromCharCode(i)) ) {
            charClassMap[i] |= CHAR_CLASS_SEPARATOR;
        }
    }
}

const isSeparatorChar = c => (charClassMap[c] & CHAR_CLASS_SEPARATOR) !== 0;

/******************************************************************************/

const FILTER_DATA_PAGE_SIZE = 65536;

const roundToFilterDataPageSize =
    len => (len + FILTER_DATA_PAGE_SIZE-1) & ~(FILTER_DATA_PAGE_SIZE-1);

let filterData = new Int32Array(FILTER_DATA_PAGE_SIZE * 5);
let filterDataWritePtr = 2;
const filterDataGrow = len => {
    if ( len <= filterData.length ) { return; }
    const newLen = roundToFilterDataPageSize(len);
    const newBuf = new Int32Array(newLen);
    newBuf.set(filterData);
    filterData = newBuf;
};
const filterDataShrink = ( ) => {
    const newLen = Math.max(
        roundToFilterDataPageSize(filterDataWritePtr),
        FILTER_DATA_PAGE_SIZE
    );
    if ( newLen >= filterData.length ) { return; }
    const newBuf = new Int32Array(newLen);
    newBuf.set(filterData.subarray(0, filterDataWritePtr));
    filterData = newBuf;
};
const filterDataAlloc = (...args) => {
    const len = args.length;
    const idata = filterDataAllocLen(len);
    for ( let i = 0; i < len; i++ ) {
        filterData[idata+i] = args[i];
    }
    return idata;
};
const filterDataAllocLen = len => {
    const idata = filterDataWritePtr;
    filterDataWritePtr += len;
    if ( filterDataWritePtr > filterData.length ) {
        filterDataGrow(filterDataWritePtr);
    }
    return idata;
};
const filterSequenceAdd = (a, b) => {
    const iseq = filterDataAllocLen(2);
    filterData[iseq+0] = a;
    filterData[iseq+1] = b;
    return iseq;
};
const filterDataReset = ( ) => {
    filterData.fill(0);
    filterDataWritePtr = 2;
};
const filterDataToSelfie = ( ) =>
    filterData.subarray(0, filterDataWritePtr);

const filterDataFromSelfie = selfie => {
    if ( selfie instanceof Int32Array === false ) { return false; }
    filterData = selfie;
    filterDataWritePtr = selfie.length;
    return true;
};

const filterRefs = [ null ];
let filterRefsWritePtr = 1;
const filterRefAdd = ref => {
    const i = filterRefsWritePtr;
    filterRefs[i] = ref;
    filterRefsWritePtr += 1;
    return i;
};
const filterRefsReset = ( ) => {
    filterRefs.fill(null);
    filterRefsWritePtr = 1;
};
const filterRefsToSelfie = ( ) =>
    filterRefs.slice(0, filterRefsWritePtr);

const filterRefsFromSelfie = selfie => {
    if ( Array.isArray(selfie) === false ) { return false; }
    for ( let i = 0, n = selfie.length; i < n; i++ ) {
        filterRefs[i] = selfie[i];
    }
    filterRefsWritePtr = selfie.length;
    return true;
};

/******************************************************************************/

const origHNTrieContainer = new HNTrieContainer();
const destHNTrieContainer = new HNTrieContainer();

/******************************************************************************/

const bidiTrieMatchExtra = (l, r, ix) => {
    for (;;) {
        $patternMatchLeft = l;
        $patternMatchRight = r;
        const iu = filterData[ix+0];
        if ( filterMatch(iu) ) { return iu; }
        ix = filterData[ix+1];
        if ( ix === 0 ) { break; }
    }
    return 0;
};

const bidiTrie = new BidiTrieContainer(bidiTrieMatchExtra);

/*******************************************************************************

    Each filter class will register itself in the map.

    IMPORTANT: any change which modifies the mapping will have to be
    reflected with µBlock.systemSettings.compiledMagic.

*/

const filterClasses = [];
const filterArgsToUnit = new Map();
let   filterClassIdGenerator = 0;

const registerFilterClass = fc => {
    const fid = filterClassIdGenerator++;
    fc.fid = fid;
    fc.fidstr = `${fid}`;
    filterClasses[fid] = fc;
};

const filterFromCompiled = args => {
    const fc = filterClasses[args[0]];
    const keygen = fc.keyFromArgs;
    if ( keygen === undefined ) {
        return fc.fromCompiled(args);
    }
    const key = `${fc.fidstr} ${(keygen(args) || '')}`;
    let idata = filterArgsToUnit.get(key);
    if ( idata !== undefined ) { return idata; }
    idata = fc.fromCompiled(args);
    filterArgsToUnit.set(key, idata);
    return idata;
};

const filterGetClass = idata => {
    return filterClasses[filterData[idata+0]];
};

const filterMatch = idata => filterClasses[filterData[idata+0]].match(idata);

const filterHasOriginHit = idata => {
    const fc = filterClasses[filterData[idata+0]];
    return fc.hasOriginHit !== undefined && fc.hasOriginHit(idata);
};

const filterGetDomainOpt = (idata, out) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.getDomainOpt === undefined ) { return; }
    const fromOpt = fc.getDomainOpt(idata);
    if ( out === undefined ) { return fromOpt; }
    out.push(fromOpt);
};

const filterGetRegexPattern = (idata, out) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.hasRegexPattern === undefined ) { return; }
    const reStr = fc.getRegexPattern(idata);
    if ( out === undefined ) { return reStr; }
    out.push(reStr);
};

const filterIsBidiTrieable = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.isBidiTrieable === undefined ) { return false; }
    return fc.isBidiTrieable(idata) === true;
};

const filterToBidiTrie = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.toBidiTrie === undefined ) { return; }
    return fc.toBidiTrie(idata);
};

const filterMatchAndFetchModifiers = (idata, env) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.matchAndFetchModifiers === undefined ) { return; }
    return fc.matchAndFetchModifiers(idata, env);
};

const filterGetModifierType = idata => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.getModifierType === undefined ) { return; }
    return fc.getModifierType(idata);
};

const filterLogData = (idata, details) => {
    const fc = filterClasses[filterData[idata+0]];
    if ( fc.logData === undefined ) { return; }
    fc.logData(idata, details);
};

const filterDumpInfo = (idata) => {
    const fc = filterGetClass(idata);
    if ( fc.dumpInfo === undefined ) { return; }
    return fc.dumpInfo(idata);
};

const dnrRuleFromCompiled = (args, rule) => {
    const fc = filterClasses[args[0]];
    if ( fc.dnrFromCompiled === undefined ) { return false; }
    fc.dnrFromCompiled(args, rule);
    return true;
};

const dnrAddRuleError = (rule, msg) => {
    rule._error = rule._error || [];
    rule._error.push(msg);
};

const dnrAddRuleWarning = (rule, msg) => {
    rule._warning = rule._warning || [];
    rule._warning.push(msg);
};

/*******************************************************************************

    Filter classes

    Pattern:
        FilterPatternAny
        FilterPatternPlain
            FilterPatternPlain1
            FilterPatternPlainX
        FilterPatternGeneric
        FilterRegex
        FilterPlainTrie
        FilterHostnameDict

    Pattern modifiers:
        FilterAnchorHnLeft
            FilterAnchorHn
        FilterAnchorRight
        FilterAnchorLeft
        FilterTrailingSeparator

    Context, immediate:
        FilterOriginHit
            FilterOriginMiss
                FilterOriginEntityMiss
            FilterOriginEntityHit
        FilterOriginHitSet
            FilterOriginMissSet
            FilterJustOrigin
                FilterHTTPJustOrigin
                FilterHTTPSJustOrigin

    Other options:
        FilterDenyAllow
        FilterImportant
        FilterNotType
        FilterStrictParty
        FilterModifier
        FilterOnHeaders
        FilterIPAddress

    Collection:
        FilterCollection
            FilterCompositeAll
            FilterBucket
                FilterBucketIf
                    FilterBucketIfOriginHits
                    FilterBucketIfRegexHits
            FilterDomainHitAny

    A single filter can be made of many parts, in which case FilterCompositeAll
    is used to hold all the parts, and where all the parts must be a match in
    order for the filter to be a match.

**/

/******************************************************************************/

class FilterPatternAny {
    static match() {
        return true;
    }

    static compile() {
        return [ FilterPatternAny.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('*');
        details.regex.push('^');
    }
}

registerFilterClass(FilterPatternAny);

/******************************************************************************/

class FilterImportant {
    static match() {
        return ($isBlockImportant = true);
    }

    static compile() {
        return [ FilterImportant.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static dnrFromCompiled(args, rule) {
        rule.__important = true;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.options.unshift('important');
    }
}

registerFilterClass(FilterImportant);

/******************************************************************************/

class FilterPatternPlain {
    static isBidiTrieable(idata) {
        return filterData[idata+2] <= 255;
    }

    static toBidiTrie(idata) {
        return {
            i: filterData[idata+1],
            n: filterData[idata+2],
            itok: filterData[idata+3],
        };
    }

    static match(idata) {
        const left = $tokenBeg;
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.getHaystackLen(),
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }

    static compile(details) {
        const { tokenBeg } = details;
        if ( tokenBeg === 0 ) {
            return [ FilterPatternPlain.fid, details.pattern, 0 ];
        }
        if ( tokenBeg === 1 ) {
            return [ FilterPatternPlain1.fid, details.pattern, 1 ];
        }
        return [ FilterPatternPlainX.fid, details.pattern, tokenBeg ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n   
        filterData[idata+3] = args[2];                          // tokenBeg
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        if ( rule.condition === undefined ) {
            rule.condition = {};
        } else if ( rule.condition.urlFilter !== undefined ) {
            dnrAddRuleError(rule, `urlFilter already defined: ${rule.condition.urlFilter}`);
        }
        rule.condition.urlFilter = args[1];
    }

    static logData(idata, details) {
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
        // https://github.com/gorhill/uBlock/issues/3037
        //   Make sure the logger reflects accurately internal match, taking
        //   into account MAX_TOKEN_LENGTH.
        if ( /^[0-9a-z%]{1,6}$/i.exec(s.slice(filterData[idata+3])) !== null ) {
            details.regex.push('(?![0-9A-Za-z%])');
        }
    }

    static dumpInfo(idata) {
        const pattern = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        return `${pattern} ${filterData[idata+3]}`;
    }
}

FilterPatternPlain.isPatternPlain = true;

registerFilterClass(FilterPatternPlain);


class FilterPatternPlain1 extends FilterPatternPlain {
    static match(idata) {
        const left = $tokenBeg - 1;
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.getHaystackLen(),
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }
}

registerFilterClass(FilterPatternPlain1);


class FilterPatternPlainX extends FilterPatternPlain {
    static match(idata) {
        const left = $tokenBeg - filterData[idata+3];
        const n = filterData[idata+2];
        if (
            bidiTrie.startsWith(
                left,
                bidiTrie.getHaystackLen(),
                filterData[idata+1],
                n
            ) === 0
        ) {
            return false;
        }
        $patternMatchLeft = left;
        $patternMatchRight = left + n;
        return true;
    }
}

registerFilterClass(FilterPatternPlainX);

/******************************************************************************/

class FilterPatternGeneric {
    static hasRegexPattern() {
        return true;
    }

    static getRegexPattern(idata) {
        return restrFromGenericPattern(
            bidiTrie.extractString(
                filterData[idata+1],
                filterData[idata+2]
            ),
            filterData[idata+3]
        );
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+4]];
        if ( refs.$re === null ) {
            refs.$re = new RegExp(this.getRegexPattern(idata));
        }
        return refs.$re.test($requestURL);
    }

    static compile(details) {
        const out = [
            FilterPatternGeneric.fid,
            details.pattern,
            details.anchor,
        ];
        details.anchor = 0;
        return out;
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(5);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n
        filterData[idata+3] = args[2];                          // anchor
        filterData[idata+4] = filterRefAdd({ $re: null });
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        if ( rule.condition === undefined ) {
            rule.condition = {};
        } else if ( rule.condition.urlFilter !== undefined ) {
            dnrAddRuleError(rule, `urlFilter already defined: ${rule.condition.urlFilter}`);
        }
        let pattern = args[1];
        if ( args[2] & 0b100 ) {
            if ( pattern.startsWith('.') ) {
                pattern = `*${pattern}`;
            }
            pattern = `||${pattern}`;
        } else if ( args[2] & 0b010 ) {
            pattern = `|${pattern}`;
        }
        if ( args[2] & 0b001 ) {
            pattern += '|';
        }
        rule.condition.urlFilter = pattern;
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }

    static logData(idata, details) {
        details.pattern.length = 0;
        const anchor = filterData[idata+3];
        if ( (anchor & 0b100) !== 0 ) {
            details.pattern.push('||');
        } else if ( (anchor & 0b010) !== 0 ) {
            details.pattern.push('|');
        }
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push(s);
        if ( (anchor & 0b001) !== 0 ) {
            details.pattern.push('|');
        }
        details.regex.length = 0;
        details.regex.push(restrFromGenericPattern(s, anchor & ~0b100));
    }

    static dumpInfo(idata) {
        return bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
    }
}

FilterPatternGeneric.isSlow = true;

registerFilterClass(FilterPatternGeneric);

/******************************************************************************/

class FilterAnchorHnLeft {
    static match(idata) {
        const len = $requestHostname.length;
        const haystackCodes = bidiTrie.haystack;
        let lastBeg = filterData[idata+2];
        let lastEnd = filterData[idata+3];
        if (
            len !== filterData[idata+1] ||
            lastBeg === -1 ||
            haystackCodes[lastBeg-3] !== 0x3A /* ':' */ ||
            haystackCodes[lastBeg-2] !== 0x2F /* '/' */ ||
            haystackCodes[lastBeg-1] !== 0x2F /* '/' */
        ) {
            lastBeg = len !== 0 ? haystackCodes.indexOf(0x3A) : -1;
            if ( lastBeg !== -1 ) {
                if (
                    lastBeg >= bidiTrie.getHaystackLen() ||
                    haystackCodes[lastBeg+1] !== 0x2F ||
                    haystackCodes[lastBeg+2] !== 0x2F
                ) {
                    lastBeg = -1;
                }
            }
            if ( lastBeg !== -1 ) {
                lastBeg += 3;
                lastEnd = lastBeg + len;
            } else {
                lastEnd = -1;
            }
            filterData[idata+1] = len;
            filterData[idata+2] = lastBeg;
            filterData[idata+3] = lastEnd;
        }
        const left = $patternMatchLeft;
        return left < lastEnd && (
            left === lastBeg ||
            left > lastBeg && haystackCodes[left-1] === 0x2E /* '.' */
        );
    }

    static compile() {
        return [ FilterAnchorHnLeft.fid ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = 0;        // lastLen
        filterData[idata+2] = -1;       // lastBeg
        filterData[idata+3] = -1;       // lastEnd
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition.urlFilter = `||${rule.condition.urlFilter}`;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.unshift('||');
    }
}

registerFilterClass(FilterAnchorHnLeft);

/******************************************************************************/

class FilterAnchorHn extends FilterAnchorHnLeft {
    static match(idata) {
        return super.match(idata) && filterData[idata+3] === $patternMatchRight;
    }

    static compile() {
        return [ FilterAnchorHn.fid ];
    }

    static dnrFromCompiled(args, rule) {
        rule.condition.requestDomains = [ rule.condition.urlFilter ];
        rule.condition.urlFilter = undefined;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        super.logData(idata, details);
        details.pattern.push('^');
        details.regex.push('\\.?', restrSeparator);
    }
}

registerFilterClass(FilterAnchorHn);

/******************************************************************************/

class FilterAnchorLeft {
    static match() {
        return $patternMatchLeft === 0;
    }

    static compile() {
        return [ FilterAnchorLeft.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static dnrFromCompiled(args, rule) {
        rule.condition.urlFilter = `|${rule.condition.urlFilter}`;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.unshift('|');
        details.regex.unshift('^');
    }
}

registerFilterClass(FilterAnchorLeft);

/******************************************************************************/

class FilterAnchorRight {
    static match() {
        return $patternMatchRight === $requestURL.length;
    }

    static compile() {
        return [ FilterAnchorRight.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static dnrFromCompiled(args, rule) {
        rule.condition.urlFilter = `${rule.condition.urlFilter}|`;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('|');
        details.regex.push('$');
    }
}

registerFilterClass(FilterAnchorRight);

/******************************************************************************/

class FilterTrailingSeparator {
    static match() {
        if ( $patternMatchRight === $requestURL.length ) { return true; }
        if ( isSeparatorChar(bidiTrie.haystack[$patternMatchRight]) ) {
            $patternMatchRight += 1;
            return true;
        }
        return false;
    }

    static compile() {
        return [ FilterTrailingSeparator.fid ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(args[0]);
    }

    static dnrFromCompiled(args, rule) {
        rule.condition.urlFilter = `${rule.condition.urlFilter}^`;
    }

    static keyFromArgs() {
    }

    static logData(idata, details) {
        details.pattern.push('^');
        details.regex.push(restrSeparator);
    }
}

registerFilterClass(FilterTrailingSeparator);

/******************************************************************************/

class FilterRegex {
    static hasRegexPattern() {
        return true;
    }

    static getRegexPattern(idata) {
        return bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+4]];
        if ( refs.$re === null ) {
            refs.$re = new RegExp(
                this.getRegexPattern(idata),
                filterData[idata+3] === 0 ? 'i' : ''
            );
        }
        if ( refs.$re.test($requestURLRaw) === false ) { return false; }
        return true;
    }

    static compile(details) {
        return [
            FilterRegex.fid,
            details.pattern,
            details.optionValues.has('match-case') ? 1 : 0,
        ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(5);
        filterData[idata+0] = args[0];                          // fid
        filterData[idata+1] = bidiTrie.storeString(args[1]);    // i
        filterData[idata+2] = args[1].length;                   // n
        filterData[idata+3] = args[2];                          // match-case
        filterData[idata+4] = filterRefAdd({ $re: null });
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        if ( rule.condition === undefined ) {
            rule.condition = {};
        }
        if ( isRE2(args[1]) === false ) {
            dnrAddRuleError(rule, `regexFilter is not RE2-compatible: ${args[1]}`);
        }
        rule.condition.regexFilter = args[1];
        if ( args[2] === 1 ) {
            rule.condition.isUrlFilterCaseSensitive = true;
        }
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}`;
    }

    static logData(idata, details) {
        const s = bidiTrie.extractString(
            filterData[idata+1],
            filterData[idata+2]
        );
        details.pattern.push('/', s, '/');
        details.regex.push(s);
        details.isRegex = true;
        if ( filterData[idata+3] !== 0 ) {
            details.options.push('match-case');
        }
    }

    static dumpInfo(idata) {
        return [
            '/',
            bidiTrie.extractString(
                filterData[idata+1],
                filterData[idata+2]
            ),
            '/',
            filterData[idata+3] !== 0 ? ' (match-case)' : '',
        ].join('');
    }
}

FilterRegex.isSlow = true;

registerFilterClass(FilterRegex);

/******************************************************************************/

class FilterMethod {
    static match(idata) {
        if ( $requestMethodBit === 0 ) { return false; }
        const methodBits = filterData[idata+1];
        const notMethodBits = filterData[idata+2];
        return (methodBits !== 0 && ($requestMethodBit & methodBits) !== 0) ||
               (notMethodBits !== 0 && ($requestMethodBit & notMethodBits) === 0);
    }

    static compile(details) {
        return [ FilterMethod.fid, details.methodBits, details.notMethodBits ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = args[1];  // methodBits
        filterData[idata+2] = args[2];  // notMethodBits
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition = rule.condition || {};
        const rc = rule.condition;
        let methodBits = args[1];
        let notMethodBits = args[2];
        if ( methodBits !== 0 && rc.requestMethods === undefined ) {
            rc.requestMethods = [];
        }
        if ( notMethodBits !== 0 && rc.excludedRequestMethods === undefined ) {
            rc.excludedRequestMethods = [];
        }
        for ( let i = 1; methodBits !== 0 || notMethodBits !== 0; i++ ) {
            const bit = 1 << i;
            const methodName = FilteringContext.getMethodName(bit);
            if ( (methodBits & bit) !== 0 ) {
                methodBits &= ~bit;
                rc.requestMethods.push(methodName);
            } else if ( (notMethodBits & bit) !== 0 ) {
                notMethodBits &= ~bit;
                rc.excludedRequestMethods.push(methodName);
            }
        }
    }

    static keyFromArgs(args) {
        return `${args[1]} ${args[2]}`;
    }

    static logData(idata, details) {
        const methods = [];
        let methodBits = filterData[idata+1];
        let notMethodBits = filterData[idata+2];
        for ( let i = 0; methodBits !== 0 || notMethodBits !== 0; i++ ) {
            const bit = 1 << i;
            const methodName = FilteringContext.getMethodName(bit);
            if ( (methodBits & bit) !== 0 ) {
                methodBits &= ~bit;
                methods.push(methodName);
            } else if ( (notMethodBits & bit) !== 0 ) {
                notMethodBits &= ~bit;
                methods.push(`~${methodName}`);
            }
        }
        details.options.push(`method=${methods.join('|')}`);
    }

    static dumpInfo(idata) {
        return `0b${filterData[idata+1].toString(2)} 0b${filterData[idata+2].toString(2)}`;
    }
}

registerFilterClass(FilterMethod);

/******************************************************************************/

// stylesheet: 1 => bit 0
// image: 2 => bit 1
// object: 3 => bit 2
// script: 4 => bit 3
// ...

class FilterNotType {
    static match(idata) {
        return $requestTypeValue !== 0 &&
            (filterData[idata+1] & (1 << ($requestTypeValue - 1))) === 0;
    }

    static compile(details) {
        return [ FilterNotType.fid, details.notTypeBits ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(2);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = args[1];  // notTypeBits
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition = rule.condition || {};
        const rc = rule.condition;
        rc.excludedResourceTypes ??= [];
        let bits = args[1];
        for ( let i = 1; bits !== 0 && i < typeValueToDNRTypeName.length; i++ ) {
            const bit = 1 << (i - 1);
            if ( (bits & bit) === 0 ) { continue; }
            bits &= ~bit;
            const type = typeValueToDNRTypeName[i];
            if ( Boolean(type) === false ) { continue; }
            if ( rc.excludedResourceTypes.includes(type) ) { continue; }
            rc.excludedResourceTypes.push(type);
        }
        if ( rc.excludedResourceTypes.length ) {
            if ( rc.resourceTypes?.includes('main_frame') ) {
                rc.resourceTypes = rc.resourceTypes.filter(a => a !== 'main_frame');
            } else {
                rc.excludedResourceTypes.push('main_frame');
            }
        }
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }

    static logData(idata, details) {
        let bits = filterData[idata+1];
        for ( let i = 1; bits !== 0 && i < typeValueToTypeName.length; i++ ) {
            const bit = 1 << (i - 1);
            if ( (bits & bit) === 0 ) { continue; }
            bits &= ~bit;
            details.options.push(`~${typeValueToTypeName[i]}`);
        }
    }

    static dumpInfo(idata) {
        return `0b${filterData[idata+1].toString(2)}`;
    }
}

registerFilterClass(FilterNotType);

/******************************************************************************/

// A helper class to parse `domain=` option.

class DomainOptIterator {
    constructor(domainOpt) {
        this.reset(domainOpt);
    }
    reset(domainOpt) {
        this.domainOpt = domainOpt;
        this.i = 0;
        this.value = undefined;
        this.done = false;
        return this;
    }
    next() {
        if ( this.i === -1 ) {
            this.domainOpt = '';
            this.value = undefined;
            this.done = true;
            return this;
        }
        const pos = this.domainOpt.indexOf('|', this.i);
        if ( pos !== -1 ) {
            this.value = this.domainOpt.slice(this.i, pos);
            this.i = pos + 1;
        } else {
            this.value = this.domainOpt.slice(this.i);
            this.i = -1;
        }
        return this;
    }
    [Symbol.iterator]() {
        return this;
    }
}

// A helper instance to reuse throughout
const domainOptIterator = new DomainOptIterator('');

/******************************************************************************/

// The optimal class is picked according to the content of the `from=`
// filter option.
const compileDomainOpt = (ctors, iterable, prepend, units) => {
    const hostnameHits = [];
    const hostnameMisses = [];
    const entityHits = [];
    const entityMisses = [];
    const regexHits = [];
    const regexMisses = [];
    for ( const s of iterable ) {
        const len = s.length;
        const beg = len > 1 && s.charCodeAt(0) === 0x7E /* '~' */ ? 1 : 0;
        if ( len <= beg ) {  continue; }
        if ( s.charCodeAt(beg) === 0x2F /* / */ ) {
            if ( beg === 0 ) { regexHits.push(s); continue; }
            regexMisses.push(s.slice(1)); continue;
        }
        if ( s.endsWith('.*') === false ) {
            if ( beg === 0 ) { hostnameHits.push(s); continue; }
            hostnameMisses.push(s.slice(1)); continue;
        }
        if ( beg === 0 ) { entityHits.push(s); continue; }
        entityMisses.push(s.slice(1)); continue;
    }
    const toTrie = [];
    let trieWhich = 0b00;
    if ( hostnameHits.length > 1 ) {
        toTrie.push(...hostnameHits);
        hostnameHits.length = 0;
        trieWhich |= 0b01;
    }
    if ( entityHits.length > 1 ) {
        toTrie.push(...entityHits);
        entityHits.length = 0;
        trieWhich |= 0b10;
    }
    const compiledHit = [];
    if ( toTrie.length !== 0 ) {
        compiledHit.push(
            ctors[2].compile(toTrie.sort(), trieWhich)
        );
    }
    for ( const hn of hostnameHits ) {
        compiledHit.push(ctors[0].compile(hn));
    }
    for ( const hn of entityHits ) {
        compiledHit.push(ctors[1].compile(hn));
    }
    for ( const hn of regexHits ) {
        compiledHit.push(ctors[3].compile(hn));
    }
    if ( compiledHit.length > 1 ) {
        compiledHit[0] = FilterDomainHitAny.compile(compiledHit.slice());
        compiledHit.length = 1;
    }
    toTrie.length = trieWhich = 0;
    if ( hostnameMisses.length > 1 ) {
        toTrie.push(...hostnameMisses);
        hostnameMisses.length = 0;
        trieWhich |= 0b01;
    }
    if ( entityMisses.length > 1 ) {
        toTrie.push(...entityMisses);
        entityMisses.length = 0;
        trieWhich |= 0b10;
    }
    const compiledMiss = [];
    if ( toTrie.length !== 0 ) {
        compiledMiss.push(
            ctors[6].compile(toTrie.sort(), trieWhich)
        );
    }
    for ( const hn of hostnameMisses ) {
        compiledMiss.push(ctors[4].compile(hn));
    }
    for ( const hn of entityMisses ) {
        compiledMiss.push(ctors[5].compile(hn));
    }
    for ( const hn of regexMisses ) {
        compiledMiss.push(ctors[7].compile(hn));
    }
    if ( prepend ) {
        if ( compiledHit.length !== 0 ) {
            units.unshift(compiledHit[0]);
        }
        if ( compiledMiss.length !== 0 ) {
            units.unshift(...compiledMiss);
        }
    } else {
        if ( compiledMiss.length !== 0 ) {
            units.push(...compiledMiss);
        }
        if ( compiledHit.length !== 0 ) {
            units.push(compiledHit[0]);
        }
    }
};

/******************************************************************************/

class FilterDomainHit {
    static getDomainOpt(idata) {
        return this.hntrieContainer.extractHostname(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static match(idata) {
        return this.hntrieContainer.matchesHostname(
            this.getMatchTarget(),
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static compile(hostname) {
        return [ this.fid, hostname ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = args[0];                                     // fid
        filterData[idata+1] = this.hntrieContainer.storeHostname(args[1]); // i
        filterData[idata+2] = args[1].length;                              // n
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition = rule.condition || {};
        const prop = this.dnrConditionName;
        if ( rule.condition[prop] === undefined ) {
            rule.condition[prop] = [];
        }
        rule.condition[prop].push(args[1]);
    }

    static dumpInfo(idata) {
        return this.getDomainOpt(idata);
    }
}

/******************************************************************************/

class FilterDomainHitSet {
    static getDomainOpt(idata) {
        return this.hntrieContainer.extractDomainOpt(
            filterData[idata+1],
            filterData[idata+2]
        );
    }

    static getTrieCount(idata) {
        const itrie = filterData[idata+4];
        if ( itrie === 0 ) { return 0; }
        return Array.from(
            this.hntrieContainer.trieIterator(filterData[idata+4])
        ).length;
    }

    static getLastResult(idata) {
        return filterData[idata+5];
    }

    static getMatchedHostname(idata) {
        const lastResult = filterData[idata+5];
        if ( lastResult === -1 ) { return ''; }
        return this.getMatchTarget(lastResult >>> 8).slice(lastResult & 0xFF);
    }

    static match(idata) {
        const refs = filterRefs[filterData[idata+6]];
        const docHostname = this.getMatchTarget(0b01);
        if ( docHostname === refs.$last ) {
            return filterData[idata+5] !== -1;
        }
        refs.$last = docHostname;
        const which = filterData[idata+3];
        const itrie = filterData[idata+4] || this.toTrie(idata);
        if ( itrie === 0 ) { return false; }
        if ( (which & 0b01) !== 0 ) {
            const pos = this.hntrieContainer
                .setNeedle(docHostname)
                .matches(itrie);
            if ( pos !== -1 ) {
                filterData[idata+5] = 0b01 << 8 | pos;
                return true;
            }
        }
        if ( (which & 0b10) !== 0 ) {
            const pos = this.hntrieContainer
                .setNeedle(this.getMatchTarget(0b10))
                .matches(itrie);
            if ( pos !== -1 ) {
                filterData[idata+5] = 0b10 << 8 | pos;
                return true;
            }
        }
        filterData[idata+5] = -1;
        return false;
    }

    static add(idata, hn) {
        this.hntrieContainer.setNeedle(hn).add(filterData[idata+4]);
        filterData[idata+3] |= hn.charCodeAt(hn.length - 1) !== 0x2A /* '*' */
            ? 0b01
            : 0b10;
        filterData[idata+5] = -1;
        filterRefs[filterData[idata+6]].$last = '';
    }

    static create(fid = -1) {
        const idata = filterDataAllocLen(7);
        filterData[idata+0] = fid !== -1 ? fid : this.fid;
        filterData[idata+1] = 0;
        filterData[idata+2] = 0;
        filterData[idata+3] = 0;
        filterData[idata+4] = this.hntrieContainer.createTrie();
        filterData[idata+5] = -1;           // $lastResult
        filterData[idata+6] = filterRefAdd({ $last: '' });
        return idata;
    }

    static compile(hostnames, which) {
        const stringified = Array.isArray(hostnames)
            ? hostnames.join('|')
            : hostnames;
        return [ this.fid, stringified, which ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(7);
        filterData[idata+0] = args[0];      // fid
        filterData[idata+1] = this.hntrieContainer.storeDomainOpt(args[1]);
        filterData[idata+2] = args[1].length;
        filterData[idata+3] = args[2];      // which
        filterData[idata+4] = 0;            // itrie
        filterData[idata+5] = -1;           // $lastResult
        filterData[idata+6] = filterRefAdd({ $last: '' });
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition = rule.condition || {};
        const prop = this.dnrConditionName;
        if ( rule.condition[prop] === undefined ) {
            rule.condition[prop] = [];
        }
        rule.condition[prop].push(...args[1].split('|'));
    }

    static toTrie(idata) {
        if ( filterData[idata+2] === 0 ) { return 0; }
        const itrie = filterData[idata+4] =
            this.hntrieContainer.createTrieFromStoredDomainOpt(
                filterData[idata+1],
                filterData[idata+2]
            );
        return itrie;
    }

    static keyFromArgs(args) {
        return args[1];
    }

    static dumpInfo(idata) {
        return `0b${filterData[idata+3].toString(2)} ${this.getDomainOpt(idata)}`;
    }
}

/******************************************************************************/

class FilterDomainRegexHit {
    static getDomainOpt(idata) {
        const ref = filterRefs[filterData[idata+1]];
        return ref.restr;
    }

    static match(idata) {
        const ref = filterRefs[filterData[idata+1]];
        if ( ref.$re === null ) {
            ref.$re = new RegExp(ref.restr.slice(1,-1));
        }
        return ref.$re.test(this.getMatchTarget());
    }

    static compile(restr) {
        return [ this.fid, restr ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(2);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = filterRefAdd({ restr: args[1], $re: null });
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.condition = rule.condition || {};
        const prop = this.dnrConditionName;
        if ( rule.condition[prop] === undefined ) {
            rule.condition[prop] = [];
        }
        rule.condition[prop].push(args[1]);
    }

    static dumpInfo(idata) {
        return this.getDomainOpt(idata);
    }
}

/******************************************************************************/

// Implements the following filter option:
// - domain=
// - from=

class FilterFromDomainHit extends FilterDomainHit {
    static hasOriginHit() {
        return true;
    }

    static getMatchTarget() {
        return $docHostname;
    }

    static get dnrConditionName() {
        return 'initiatorDomains';
    }

    static logData(idata, details) {
        details.fromDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterFromDomainHit, 'hntrieContainer', {
    value: origHNTrieContainer
});

class FilterFromDomainMiss extends FilterFromDomainHit {
    static hasOriginHit() {
        return false;
    }

    static get dnrConditionName() {
        return 'excludedInitiatorDomains';
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static logData(idata, details) {
        details.fromDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

class FilterFromEntityHit extends FilterFromDomainHit {
    static getMatchTarget() {
        return $docDetails.entity;
    }
}

class FilterFromEntityMiss extends FilterFromDomainMiss {
    static getMatchTarget() {
        return $docDetails.entity;
    }
}

class FilterFromDomainHitSet extends FilterDomainHitSet {
    static hasOriginHit() {
        return true;
    }

    static getMatchTarget(which) {
        return (which & 0b01) !== 0
            ? $docHostname
            : $docDetails.entity;
    }

    static get dnrConditionName() {
        return 'initiatorDomains';
    }

    static logData(idata, details) {
        details.fromDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterFromDomainHitSet, 'hntrieContainer', {
    value: origHNTrieContainer
});

class FilterFromDomainMissSet extends FilterFromDomainHitSet {
    static hasOriginHit() {
        return false;
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedInitiatorDomains';
    }

    static logData(idata, details) {
        details.fromDomains.push('~' + this.getDomainOpt(idata).replace(/\|/g, '|~'));
    }
}

class FilterFromRegexHit extends FilterDomainRegexHit {
    static getMatchTarget() {
        return $docHostname;
    }

    static get dnrConditionName() {
        return 'initiatorDomains';
    }

    static logData(idata, details) {
        details.fromDomains.push(`${this.getDomainOpt(idata)}`);
    }
}

class FilterFromRegexMiss extends FilterFromRegexHit {
    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedInitiatorDomains';
    }

    static logData(idata, details) {
        details.fromDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

registerFilterClass(FilterFromDomainHit);
registerFilterClass(FilterFromDomainMiss);
registerFilterClass(FilterFromEntityHit);
registerFilterClass(FilterFromEntityMiss);
registerFilterClass(FilterFromDomainHitSet);
registerFilterClass(FilterFromDomainMissSet);
registerFilterClass(FilterFromRegexHit);
registerFilterClass(FilterFromRegexMiss);

const fromOptClasses = [
    FilterFromDomainHit,
    FilterFromEntityHit,
    FilterFromDomainHitSet,
    FilterFromRegexHit,
    FilterFromDomainMiss,
    FilterFromEntityMiss,
    FilterFromDomainMissSet,
    FilterFromRegexMiss,
];

const compileFromDomainOpt = (...args) => {
    return compileDomainOpt(fromOptClasses, ...args);
};

/******************************************************************************/

// Implements the following filter option:
// - to=

class FilterToDomainHit extends FilterDomainHit {
    static getMatchTarget() {
        return $requestHostname;
    }

    static get dnrConditionName() {
        return 'requestDomains';
    }

    static logData(idata, details) {
        details.toDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterToDomainHit, 'hntrieContainer', {
    value: destHNTrieContainer
});

class FilterToDomainMiss extends FilterToDomainHit {
    static get dnrConditionName() {
        return 'excludedRequestDomains';
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static logData(idata, details) {
        details.toDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

class FilterToEntityHit extends FilterToDomainHit {
    static getMatchTarget() {
        return $requestDetails.entity;
    }
}

class FilterToEntityMiss extends FilterToDomainMiss {
    static getMatchTarget() {
        return $requestDetails.entity;
    }
}

class FilterToDomainHitSet extends FilterDomainHitSet {
    static getMatchTarget(which) {
        return (which & 0b01) !== 0
            ? $requestHostname
            : $requestDetails.entity;
    }

    static get dnrConditionName() {
        return 'requestDomains';
    }

    static logData(idata, details) {
        details.toDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterToDomainHitSet, 'hntrieContainer', {
    value: destHNTrieContainer
});

class FilterToDomainMissSet extends FilterToDomainHitSet {
    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedRequestDomains';
    }

    static logData(idata, details) {
        details.toDomains.push('~' + this.getDomainOpt(idata).replace(/\|/g, '|~'));
    }
}

class FilterToRegexHit extends FilterDomainRegexHit {
    static getMatchTarget() {
        return $requestHostname;
    }

    static get dnrConditionName() {
        return 'requestDomains';
    }

    static logData(idata, details) {
        details.toDomains.push(`${this.getDomainOpt(idata)}`);
    }
}

class FilterToRegexMiss extends FilterToRegexHit {
    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedRequestDomains';
    }

    static logData(idata, details) {
        details.toDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

registerFilterClass(FilterToDomainHit);
registerFilterClass(FilterToDomainMiss);
registerFilterClass(FilterToEntityHit);
registerFilterClass(FilterToEntityMiss);
registerFilterClass(FilterToDomainHitSet);
registerFilterClass(FilterToDomainMissSet);
registerFilterClass(FilterToRegexHit);
registerFilterClass(FilterToRegexMiss);

const toOptClasses = [
    FilterToDomainHit,
    FilterToEntityHit,
    FilterToDomainHitSet,
    FilterToRegexHit,
    FilterToDomainMiss,
    FilterToEntityMiss,
    FilterToDomainMissSet,
    FilterToRegexMiss,
];

const compileToDomainOpt = (...args) => {
    return compileDomainOpt(toOptClasses, ...args);
};

/******************************************************************************/

// Implements the following filter option:
// - top=
// https://github.com/uBlockOrigin/uBlock-issues/issues/3151
// https://github.com/uBlockOrigin/uAssets/issues/17807#issuecomment-1806971916

class FilterTopDomainHit extends FilterDomainHit {
    static getMatchTarget() {
        return $topHostname;
    }

    static get dnrConditionName() {
        return 'topDomains';
    }

    static logData(idata, details) {
        details.topDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterTopDomainHit, 'hntrieContainer', {
    value: origHNTrieContainer
});

class FilterTopDomainMiss extends FilterTopDomainHit {
    static get dnrConditionName() {
        return 'excludedTopDomains';
    }

    static match(idata) {
        return super.match(idata) === false;
    }

    static logData(idata, details) {
        details.topDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

class FilterTopEntityHit extends FilterTopDomainHit {
    static getMatchTarget() {
        return $topDetails.entity;
    }
}

class FilterTopEntityMiss extends FilterTopDomainMiss {
    static getMatchTarget() {
        return $topDetails.entity;
    }
}

class FilterTopDomainHitSet extends FilterDomainHitSet {
    static getMatchTarget(which) {
        return (which & 0b01) !== 0
            ? $topHostname
            : $topDetails.entity;
    }

    static get dnrConditionName() {
        return 'topDomains';
    }

    static logData(idata, details) {
        details.topDomains.push(this.getDomainOpt(idata));
    }
}
Object.defineProperty(FilterTopDomainHitSet, 'hntrieContainer', {
    value: origHNTrieContainer
});

class FilterTopDomainMissSet extends FilterTopDomainHitSet {
    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedTopDomains';
    }

    static logData(idata, details) {
        details.topDomains.push('~' + this.getDomainOpt(idata).replace(/\|/g, '|~'));
    }
}

class FilterTopRegexHit extends FilterDomainRegexHit {
    static getMatchTarget() {
        return $topHostname;
    }

    static get dnrConditionName() {
        return 'topDomains';
    }

    static logData(idata, details) {
        details.topDomains.push(`${this.getDomainOpt(idata)}`);
    }
}

class FilterTopRegexMiss extends FilterTopRegexHit {
    static match(idata) {
        return super.match(idata) === false;
    }

    static get dnrConditionName() {
        return 'excludedTopDomains';
    }

    static logData(idata, details) {
        details.topDomains.push(`~${this.getDomainOpt(idata)}`);
    }
}

registerFilterClass(FilterTopDomainHit);
registerFilterClass(FilterTopDomainMiss);
registerFilterClass(FilterTopEntityHit);
registerFilterClass(FilterTopEntityMiss);
registerFilterClass(FilterTopDomainHitSet);
registerFilterClass(FilterTopDomainMissSet);
registerFilterClass(FilterTopRegexHit);
registerFilterClass(FilterTopRegexMiss);

const topOptClasses = [
    FilterTopDomainHit,
    FilterTopEntityHit,
    FilterTopDomainHitSet,
    FilterTopRegexHit,
    FilterTopDomainMiss,
    FilterTopEntityMiss,
    FilterTopDomainMissSet,
    FilterTopRegexMiss,
];

const compileTopDomainOpt = (...args) => {
    return compileDomainOpt(topOptClasses, ...args);
};

/******************************************************************************/

class FilterDenyAllow extends FilterToDomainMissSet {
    static compile(details) {
        return super.compile(details.optionValues.get('denyallow'), 0b01);
    }

    static logData(idata, details) {
        details.denyallow.push(this.getDomainOpt(idata));
    }
}

registerFilterClass(FilterDenyAllow);

/******************************************************************************/

class FilterModifier {
    static getModifierType(idata) {
        return filterData[idata+2];
    }

    static match() {
        return true;
    }

    static matchAndFetchModifiers(idata, env) {
        if ( this.getModifierType(idata) !== env.type ) { return; }
        env.results.push(new FilterModifierResult(idata, env));
    }

    static compile(details) {
        return [
            FilterModifier.fid,
            details.action,
            details.modifyType,
            details.modifyValue || '',
        ];
    }

    static fromCompiled(args) {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = args[0];          // fid
        filterData[idata+1] = args[1];          // actionBits
        filterData[idata+2] = args[2];          // type
        filterData[idata+3] = filterRefAdd({
            value: args[3],
            $cache: null,
        });
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        rule.__modifierAction = args[1];
        rule.__modifierType = modifierNameFromType.get(args[2]);
        rule.__modifierValue = args[3];
    }

    static keyFromArgs(args) {
        return `${args[1]}\t${args[2]}\t${args[3]}`;
    }

    static logData(idata, details) {
        let opt = modifierNameFromType.get(filterData[idata+2]);
        const refs = filterRefs[filterData[idata+3]];
        if ( refs.value !== '' ) {
            opt += `=${LogData.requote(refs.value)}`;
        }
        details.options.push(opt);
    }

    static dumpInfo(idata) {
        const s = modifierNameFromType.get(filterData[idata+2]);
        const refs = filterRefs[filterData[idata+3]];
        if ( refs.value === '' ) { return s; }
        return `${s}=${refs.value}`;
    }
}

registerFilterClass(FilterModifier);

// Helper class for storing instances of FilterModifier which were found to
// be a match.

class FilterModifierResult {
    constructor(imodifierunit, env) {
        this.imodifierunit = imodifierunit;
        this.refs = filterRefs[filterData[imodifierunit+3]];
        this.ireportedunit = env.iunit;
        this.th = env.th;
        this.bits = (env.bits & ~BLOCKALLOW_REALM) | filterData[imodifierunit+1];
    }

    get result() {
        return (this.bits & ALLOW_REALM) === 0 ? 1 : 2;
    }

    get value() {
        return this.refs.value;
    }

    get cache() {
        return this.refs.$cache;
    }

    set cache(a) {
        this.refs.$cache = a;
    }

    logData() {
        const r = new LogData(this.bits, this.th, this.ireportedunit);
        r.result = this.result;
        r.modifier = true;
        return r;
    }
}

/******************************************************************************/

class FilterCollection {
    static getCount(idata) {
        let n = 0;
        this.forEach(idata, ( ) => { n += 1; });
        return n;
    }

    static forEach(idata, fn) {
        let i = filterData[idata+1];
        if ( i === 0 ) { return; }
        do {
            const iunit = filterData[i+0];
            const r = fn(iunit);
            if ( r !== undefined ) { return r; }
            i = filterData[i+1];
        } while ( i !== 0 );
    }

    static unshift(idata, iunit) {
        filterData[idata+1] = filterSequenceAdd(iunit, filterData[idata+1]);
    }

    static shift(idata) {
        filterData[idata+1] = filterData[filterData[idata+1]+1];
    }

    static create(fid = -1) {
        return filterDataAlloc(
            fid !== -1 ? fid : FilterCollection.fid,
            0
        );
    }

    static compile(fc, fdata) {
        return [ fc.fid, fdata ];
    }

    static fromCompiled(args) {
        const units = args[1];
        const n = units.length;
        let iunit, inext = 0;
        let i = n;
        while ( i-- ) {
            iunit = filterFromCompiled(units[i]);
            inext = filterSequenceAdd(iunit, inext);
        }
        const idata = filterDataAllocLen(2);
        filterData[idata+0] = args[0];  // fid
        filterData[idata+1] = inext;    // i
        return idata;
    }

    static dnrFromCompiled(args, rule) {
        for ( const unit of args[1] ) {
            dnrRuleFromCompiled(unit, rule);
        }
    }

    static logData(idata, details) {
        this.forEach(idata, iunit => {
            filterLogData(iunit, details);
        });
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
}

registerFilterClass(FilterCollection);

/******************************************************************************/

class FilterDomainHitAny extends FilterCollection {
    static getDomainOpt(idata) {
        const domainOpts = [];
        this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) !== true ) { return; }
            filterGetDomainOpt(iunit, domainOpts);
        });
        return domainOpts.join('|');
    }

    static hasOriginHit(idata) {
        this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) ) { return true; }
        });
        return false;
    }

    static match(idata) {
        let i = filterData[idata+1];
        while ( i !== 0 ) {
            if ( filterMatch(filterData[i+0]) ) { return true; }
            i = filterData[i+1];
        }
        return false;
    }

    static compile(fdata) {
        return super.compile(FilterDomainHitAny, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args);
    }
}

registerFilterClass(FilterDomainHitAny);

/******************************************************************************/

class FilterCompositeAll extends FilterCollection {
    // FilterPatternPlain is assumed to be first filter in sequence. This can
    // be revisited if needed.
    static isBidiTrieable(idata) {
        return filterIsBidiTrieable(filterData[filterData[idata+1]+0]);
    }

    static toBidiTrie(idata) {
        const iseq = filterData[idata+1];
        const details = filterToBidiTrie(filterData[iseq+0]);
        this.shift(idata);
        return details;
    }

    static getDomainOpt(idata) {
        return this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) !== true ) { return; }
            return filterGetDomainOpt(iunit);
        });
    }

    static hasOriginHit(idata) {
        return this.forEach(idata, iunit => {
            if ( filterHasOriginHit(iunit) === true ) { return true; }
        }) || false;
    }

    static hasRegexPattern(idata) {
        return this.forEach(idata, iunit => {
            const fc = filterGetClass(iunit);
            if ( fc.hasRegexPattern === undefined ) { return; }
            if ( fc.hasRegexPattern(iunit) === true ) { return true; }
        }) || false;
    }

    static getRegexPattern(idata) {
        return this.forEach(idata, iunit => {
            const fc = filterGetClass(iunit);
            if ( fc.getRegexPattern === undefined ) { return; }
            return fc.getRegexPattern(iunit);
        });
    }

    static match(idata) {
        let i = filterData[idata+1];
        while ( i !== 0 ) {
            if ( filterMatch(filterData[i+0]) !== true ) {
                return false;
            }
            i = filterData[i+1];
        }
        return true;
    }

    // IMPORTANT: the modifier filter unit is assumed to be ALWAYS the
    // first unit in the sequence. This requirement ensures that we do
    // not have to traverse the sequence to find the modifier filter
    // unit.
    static getModifierType(idata) {
        const iseq = filterData[idata+1];
        const iunit = filterData[iseq+0];
        return filterGetModifierType(iunit);
    }

    static matchAndFetchModifiers(idata, env) {
        const iseq = filterData[idata+1];
        const iunit = filterData[iseq+0];
        if (
            filterGetModifierType(iunit) === env.type &&
            this.match(idata)
        ) {
            filterMatchAndFetchModifiers(iunit, env);
        }
    }

    static compile(fdata) {
        return super.compile(FilterCompositeAll, fdata);
    }

    static fromCompiled(args) {
        return super.fromCompiled(args);
    }
}

registerFilterClass(FilterCompositeAll);

/******************************************************************************/

// Dictionary of hostnames

class FilterHostnameDict {
    static getCount(idata) {
        const itrie = filterData[idata+1];
        if ( itrie !== 0 ) {
            return Array.from(destHNTrieContainer.trieIterator(itrie)).length;
        }
        return filterRefs[filterData[idata+3]].length;
    }

    static match(idata) {
        const itrie = filterData[idata+1] || this.optimize(idata);
        return (
            filterData[idata+2] = destHNTrieContainer
                .setNeedle($requestHostname)
                .matches(itrie)
        ) !== -1;
    }

    static add(idata, hn) {
        const itrie = filterData[idata+1];
        if ( itrie === 0 ) {
            filterRefs[filterData[idata+3]].push(hn);
        } else {
            destHNTrieContainer.setNeedle(hn).add(itrie);
        }
    }

    static optimize(idata) {
        const itrie = filterData[idata+1];
        if ( itrie !== 0 ) { return itrie; }
        const hostnames = filterRefs[filterData[idata+3]];
        filterData[idata+1] = destHNTrieContainer.createTrieFromIterable(hostnames);
        filterRefs[filterData[idata+3]] = null;
        return filterData[idata+1];
    }

    static create() {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = FilterHostnameDict.fid;   // fid
        filterData[idata+1] = 0;                        // itrie
        filterData[idata+2] = -1;                       // lastResult
        filterData[idata+3] = filterRefAdd([]);         // []: hostnames
        return idata;
    }

    static logData(idata, details) {
        const hostname = $requestHostname.slice(filterData[idata+2]);
        details.pattern.push('||', hostname, '^');
        details.regex.push(
            restrFromPlainPattern(hostname),
            '\\.?',
            restrSeparator
        );
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
}

registerFilterClass(FilterHostnameDict);

/******************************************************************************/

// Dictionary of hostnames for filters which only purpose is to match
// the document origin.

class FilterJustOrigin extends FilterFromDomainHitSet {
    static create(fid = -1) {
        return super.create(fid !== -1 ? fid : FilterJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('*');
        details.regex.push('^');
    }

    static logData(idata, details) {
        this.logPattern(idata, details);
        details.fromDomains.push(this.getMatchedHostname(idata));
    }

    static dumpInfo(idata) {
        return this.getTrieCount(idata);
    }
}

registerFilterClass(FilterJustOrigin);

/******************************************************************************/

class FilterHTTPSJustOrigin extends FilterJustOrigin {
    static match(idata) {
        return $requestURL.startsWith('https://') && super.match(idata);
    }

    static create() {
        return super.create(FilterHTTPSJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('|https://');
        details.regex.push('^https://');
    }
}

registerFilterClass(FilterHTTPSJustOrigin);

/******************************************************************************/

class FilterHTTPJustOrigin extends FilterJustOrigin {
    static match(idata) {
        return $requestURL.startsWith('http://') && super.match(idata);
    }

    static create() {
        return super.create(FilterHTTPJustOrigin.fid);
    }

    static logPattern(idata, details) {
        details.pattern.push('|http://');
        details.regex.push('^http://');
    }
}

registerFilterClass(FilterHTTPJustOrigin);

/******************************************************************************/

class FilterPlainTrie {
    static match(idata) {
        if ( bidiTrie.matches(filterData[idata+1], $tokenBeg) !== 0 ) {
            filterData[idata+2] = bidiTrie.$iu;
            return true;
        }
        return false;
    }

    static create() {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = FilterPlainTrie.fid;      // fid
        filterData[idata+1] = bidiTrie.createTrie();    // itrie
        filterData[idata+2] = 0;                        // matchedUnit
        return idata;
    }

    static addUnitToTrie(idata, iunit) {
        const trieDetails = filterToBidiTrie(iunit);
        const itrie = filterData[idata+1];
        const id = bidiTrie.add(
            itrie,
            trieDetails.i,
            trieDetails.n,
            trieDetails.itok
        );
        // No point storing a pattern with conditions if the bidi-trie already
        // contain a pattern with no conditions.
        const ix = bidiTrie.getExtra(id);
        if ( ix === 1 ) { return; }
        // If the newly stored pattern has no condition, short-circuit existing
        // ones since they will always be short-circuited by the condition-less
        // pattern.
        const fc = filterGetClass(iunit);
        if ( fc.isPatternPlain ) {
            bidiTrie.setExtra(id, 1);
            return;
        }
        // FilterCompositeAll is assumed here, i.e. with conditions.
        if ( fc === FilterCompositeAll && fc.getCount(iunit) === 1 ) {
            iunit = filterData[filterData[iunit+1]+0];
        }
        bidiTrie.setExtra(id, filterSequenceAdd(iunit, ix));
    }

    static logData(idata, details) {
        const s = $requestURL.slice(bidiTrie.$l, bidiTrie.$r);
        details.pattern.push(s);
        details.regex.push(restrFromPlainPattern(s));
        if ( filterData[idata+2] !== -1 ) {
            filterLogData(filterData[idata+2], details);
        }
    }

    static dumpInfo(idata) {
        return `${Array.from(bidiTrie.trieIterator(filterData[idata+1])).length}`;
    }
}

registerFilterClass(FilterPlainTrie);

/******************************************************************************/

class FilterBucket extends FilterCollection {
    static getCount(idata) {
        return filterData[idata+2];
    }

    static forEach(idata, fn) {
        return super.forEach(filterData[idata+1], fn);
    }

    static match(idata) {
        const icollection = filterData[idata+1];
        let iseq = filterData[icollection+1];
        while ( iseq !== 0 ) {
            const iunit = filterData[iseq+0];
            if ( filterMatch(iunit) ) {
                filterData[idata+3] = iunit;
                return true;
            }
            iseq = filterData[iseq+1];
        }
        return false;
    }

    static matchAndFetchModifiers(idata, env) {
        const icollection = filterData[idata+1];
        let iseq = filterData[icollection+1];
        while ( iseq !== 0 ) {
            const iunit = filterData[iseq+0];
            env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
            iseq = filterData[iseq+1];
        }
    }

    static unshift(idata, iunit) {
        super.unshift(filterData[idata+1], iunit);
        filterData[idata+2] += 1;
    }

    static shift(idata) {
        super.shift(filterData[idata+1]);
        filterData[idata+2] -= 1;
    }

    static create() {
        const idata = filterDataAllocLen(4);
        filterData[idata+0] = FilterBucket.fid;             // fid
        filterData[idata+1] = FilterCollection.create();    // icollection
        filterData[idata+2] = 0;                            // n
        filterData[idata+3] = 0;                            // $matchedUnit
        return idata;
    }

    static logData(idata, details) {
        filterLogData(filterData[idata+3], details);
    }

    static optimize(idata, optimizeBits = 0b11) {
        if ( (optimizeBits & 0b01) !== 0 ) {
            if ( filterData[idata+2] >= 3 ) {
                const iplaintrie = this.optimizePatternTests(idata);
                if ( iplaintrie !== 0 ) {
                    const icollection = filterData[idata+1];
                    const i = filterData[icollection+1];
                    if ( i === 0 ) { return iplaintrie; }
                    this.unshift(idata, iplaintrie);
                }
            }
        }
        if ( (optimizeBits & 0b10) !== 0 ) {
            if ( filterData[idata+2] >= 5 ) {
                const ioptimized = this.optimizeMatch(
                    idata,
                    FilterBucketIfOriginHits,
                    5
                );
                if ( ioptimized !== 0 ) {
                    const icollection = filterData[idata+1];
                    const i = filterData[icollection+1];
                    if ( i === 0 ) { return ioptimized; }
                    this.unshift(idata, ioptimized);
                }
            }
            if ( filterData[idata+2] >= 5 ) {
                const ioptimized = this.optimizeMatch(
                    idata,
                    FilterBucketIfRegexHits,
                    5
                );
                if ( ioptimized !== 0 ) {
                    const icollection = filterData[idata+1];
                    const i = filterData[icollection+1];
                    if ( i === 0 ) { return ioptimized; }
                    this.unshift(idata, ioptimized);
                }
            }
        }
        return 0;
    }

    static optimizePatternTests(idata) {
        const isrccollection = filterData[idata+1];
        let n = 0;
        let iseq = filterData[isrccollection+1];
        do {
            if ( filterIsBidiTrieable(filterData[iseq+0]) ) { n += 1; }
            iseq = filterData[iseq+1];
        } while ( iseq !== 0 && n < 3 );
        if ( n < 3 ) { return 0; }
        const iplaintrie = FilterPlainTrie.create();
        iseq = filterData[isrccollection+1];
        let iprev = 0;
        for (;;) {
            const iunit = filterData[iseq+0];
            const inext = filterData[iseq+1];
            if ( filterIsBidiTrieable(iunit) ) {
                FilterPlainTrie.addUnitToTrie(iplaintrie, iunit);
                if ( iprev !== 0 ) {
                    filterData[iprev+1] = inext;
                } else {
                    filterData[isrccollection+1] = inext;
                }
                filterData[idata+2] -= 1;
            } else {
                iprev = iseq;
            }
            if ( inext === 0 ) { break; }
            iseq = inext;
        }
        return iplaintrie;
    }

    static optimizeMatch(idata, fc, min) {
        const isrccollection = filterData[idata+1];
        const candidates = [];
        this.forEach(idata, iunit => {
            if ( fc.canCoalesce(iunit) === false ) { return; }
            candidates.push(iunit);
        });
        if ( candidates.length < min ) { return 0; }
        const idesbucket = FilterBucket.create();
        const idescollection = filterData[idesbucket+1];
        let coalesced;
        let isrcseq = filterData[isrccollection+1];
        let iprev = 0;
        for (;;) {
            const iunit = filterData[isrcseq+0];
            const inext = filterData[isrcseq+1];
            if ( candidates.includes(iunit) ) {
                coalesced = fc.coalesce(iunit, coalesced);
                // move the sequence slot to new bucket
                filterData[isrcseq+1] = filterData[idescollection+1];
                filterData[idescollection+1] = isrcseq;
                filterData[idesbucket+2] += 1;
                if ( iprev !== 0 ) {
                    filterData[iprev+1] = inext;
                } else {
                    filterData[isrccollection+1] = inext;
                }
                filterData[idata+2] -= 1;
            } else {
                iprev = isrcseq;
            }
            if ( inext === 0 ) { break; }
            isrcseq = inext;
        }
        return fc.create(coalesced, idesbucket);
    }

    static dumpInfo(idata) {
        return this.getCount(idata);
    }
}

registerFilterClass(FilterBucket);

/******************************************************************************/

// Filter bucket objects which have a pre-test method before being treated
// as a plain filter bucket -- the pre-test method should be fast as it is
// used to avoid having to iterate through the content of the filter bucket.

class FilterBucketIf extends FilterBucket {
    static getCount(idata) {
        return super.getCount(filterData[idata+1]);
    }

    static forEach(idata, fn) {
        return super.forEach(filterData[idata+1], fn);
    }

    static match(idata) {
        return this.preTest(idata) && super.match(filterData[idata+1]);
    }

    static matchAndFetchModifiers(idata, env) {
        if ( this.preTest(idata) ) {
            super.matchAndFetchModifiers(filterData[idata+1], env);
        }
    }

    static create(fid, ibucket, itest) {
        const idata = filterDataAllocLen(3);
        filterData[idata+0] = fid;
        filterData[idata+1] = ibucket;
        filterData[idata+2] = itest;
        return idata;
    }

    static logData(idata, details) {
        filterLogData(filterData[idata+1], details);
    }
}

registerFilterClass(FilterBucketIf);

/******************************************************************************/

class FilterBucketIfOriginHits extends FilterBucketIf {
    static preTest(idata) {
        return filterMatch(filterData[idata+2]);
    }

    static canCoalesce(iunit) {
        return filterHasOriginHit(iunit);
    }

    static coalesce(iunit, coalesced) {
        if ( coalesced === undefined ) {
            coalesced = new Set();
        }
        const domainOpt = filterGetDomainOpt(iunit);
        if ( domainOpt.includes('|') ) {
            for ( const hn of domainOptIterator.reset(domainOpt) ) {
                coalesced.add(hn);
            }
        } else {
            coalesced.add(domainOpt);
        }
        return coalesced;
    }

    static create(coalesced, ibucket) {
        const units = [];
        compileFromDomainOpt(coalesced, false, units);
        const ihittest = filterFromCompiled(units[0]);
        const ipretest = super.create(
            FilterBucketIfOriginHits.fid,
            ibucket,
            ihittest
        );
        return ipretest;
    }
}

registerFilterClass(FilterBucketIfOriginHits);

/******************************************************************************/

class FilterBucketIfRegexHits extends FilterBucketIf {
    static preTest(idata) {
        return filterRefs[filterData[idata+2]].test($requestURLRaw);
    }

    static canCoalesce(iunit) {
        const fc = filterGetClass(iunit);
        if ( fc.hasRegexPattern === undefined ) { return false; }
        if ( fc.hasRegexPattern(iunit) !== true ) { return false; }
        return true;
    }

    static coalesce(iunit, coalesced) {
        if ( coalesced === undefined ) {
            coalesced = new Set();
        }
        coalesced.add(filterGetRegexPattern(iunit));
        return coalesced;
    }

    static create(coalesced, ibucket) {
        const reString = Array.from(coalesced).join('|');
        return super.create(
            FilterBucketIfRegexHits.fid,
            ibucket,
            filterRefAdd(new RegExp(reString, 'i'))
        );
    }

    static dumpInfo(idata) {
        return filterRefs[filterData[idata+2]].source;
    }
}

registerFilterClass(FilterBucketIfRegexHits);

/******************************************************************************/

class FilterStrictParty {
    static match(idata) {
        return ($requestHostname === $docHostname) === (filterData[idata+1] === 0);
    }

    static compile(details) {
        return [
            FilterStrictParty.fid,
            details.strictParty > 0 ? 0 : 1
        ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(
            args[0],    // fid
            args[1]
        );
    }

    static dnrFromCompiled(args, rule) {
        const partyness = args[1] === 0 ? 1 : 3;
        dnrAddRuleError(rule, `strict${partyness}p not supported`);
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }

    static logData(idata, details) {
        details.options.push(
            filterData[idata+1] === 0 ? 'strict1p' : 'strict3p'
        );
    }
}

registerFilterClass(FilterStrictParty);

/******************************************************************************/

class FilterOnHeaders {
    static match(idata) {
        const refs = filterRefs[filterData[idata+1]];
        if ( refs.$parsed === null ) {
            refs.$parsed = sfp.parseHeaderValue(refs.headerOpt);
        }
        const { bad, name, not, value } = refs.$parsed;
        if ( bad ) { return false; }
        const headerValue = $httpHeaders.lookup(name);
        if ( headerValue === undefined ) { return not; }
        if ( value === '' ) { return true; }
        let { re } = refs.$parsed;
        if ( re === undefined ) {
            re = new RegExp(refs.$parsed.reStr, refs.$parsed.reFlags);
            refs.$parsed.re = re;
        }
        return re.test(headerValue) !== not;
    }

    static compile(fid, details) {
        const fc = filterClasses[fid];
        const parsed = sfp.parseHeaderValue(details.optionValues.get(`${fc.headerRealm}header`));
        let normalized = parsed.name;
        if ( parsed.value !== '' ) {
            normalized += `:${parsed.value}`;
        }
        return [ fid, normalized ];
    }

    static fromCompiled(args) {
        return filterDataAlloc(
            args[0], // fid
            filterRefAdd({
                headerOpt: args[1],
                $parsed: null,
            })
        );
    }

    static dnrFromCompiled(fid, args, rule) {
        const fc = filterClasses[fid];
        rule.condition ||= {};
        const parsed = sfp.parseHeaderValue(args[1]);
        if ( parsed.bad !== true ) {
            const value = parsed.isRegex
                ? toHeaderPattern(parsed.reStr)
                : parsed.value;
            if ( value !== undefined ) {
                const prop = parsed.not
                    ? `excludedR${fc.headerRealm.slice(1)}Headers`
                    : `${fc.headerRealm}Headers`;
                rule.condition[prop] ||= [];
                const details = {
                    header: parsed.name,
                };
                if ( value !== '' ) {
                    details.values = [ value ];
                }
                rule.condition[prop].push(details);
                return;
            }
        }
        dnrAddRuleError(rule, `${fc.headerRealm}header="${args[1]}" not supported`);
    }

    static logData(fid, idata, details) {
        const fc = filterClasses[fid];
        const irefs = filterData[idata+1];
        const headerOpt = filterRefs[irefs].headerOpt;
        let opt = `${fc.headerRealm}header`;
        if ( headerOpt !== '' ) {
            opt += `=${LogData.requote(headerOpt)}`;
        }
        details.options.push(opt);
    }
}

class FilterOnResponseHeaders extends FilterOnHeaders {
    static headerRealm = 'response';
    static compile(details) {
        return super.compile(FilterOnResponseHeaders.fid, details);
    }

    static dnrFromCompiled(args, rule) {
        super.dnrFromCompiled(FilterOnResponseHeaders.fid, args, rule);
    }

    static logData(idata, details) {
        super.logData(FilterOnResponseHeaders.fid, idata, details);
    }
}
registerFilterClass(FilterOnResponseHeaders);

class FilterOnRequestHeaders extends FilterOnHeaders {
    static headerRealm = 'request';
    static compile(details) {
        return super.compile(FilterOnRequestHeaders.fid, details);
    }

    static dnrFromCompiled(args, rule) {
        dnrAddRuleError(rule, `requestheader="${args[1]}" not supported`);
    }

    static logData(idata, details) {
        super.logData(FilterOnRequestHeaders.fid, idata, details);
    }
}
registerFilterClass(FilterOnRequestHeaders);

/******************************************************************************/

class FilterIPAddress {
    static TYPE_UNKNOWN = 0;
    static TYPE_EQUAL = 1;
    static TYPE_STARTSWITH = 2;
    static TYPE_LAN = 3;
    static TYPE_LOOPBACK = 4;
    static TYPE_RE = 5;
    static reIPv6IPv4lan = /^::ffff:(7f\w{2}|a\w{2}|a9fe|c0a8):\w+$/;
    static reIPv6local = /^f[cd]\w{2}:/;

    static match(idata) {
        const ipaddr = $requestAddress;
        if ( ipaddr === '' ) { return false; }
        const details = filterRefs[filterData[idata+1]];
        switch ( details.$type || this.TYPE_UNKNOWN ) {
        case this.TYPE_LAN:
            return this.isLAN(ipaddr);
        case this.TYPE_LOOPBACK:
            return this.isLoopback(ipaddr);
        case this.TYPE_EQUAL:
        case this.TYPE_STARTSWITH:
        case this.TYPE_RE:
            return details.$pattern.test(ipaddr);
        default:
            break;
        }
        const { pattern } = details;
        if ( pattern === 'lan' ) {
            details.$type = this.TYPE_LAN;
        } else if ( pattern === 'loopback' ) {
            details.$type = this.TYPE_LOOPBACK;
        } else if ( pattern.startsWith('/') && pattern.endsWith('/') ) {
            details.$type = this.TYPE_RE;
            details.$pattern = new RegExp(pattern.slice(1, -1), 'm');
        } else if ( pattern.endsWith('*') ) {
            details.$type = this.TYPE_STARTSWITH;
            details.$pattern = new RegExp(`^${restrFromPlainPattern(pattern.slice(0, -1))}`, 'm');
        } else {
            details.$type = this.TYPE_EQUAL;
            details.$pattern = new RegExp(`^${restrFromPlainPattern(pattern)}$`, 'm');
        }
        return this.match(idata);
    }

    // https://github.com/uBlockOrigin/uAssets/blob/master/filters/lan-block.txt
    // https://en.wikipedia.org/wiki/Reserved_IP_addresses
    // `ipaddr` is assumed well-formed
    static isLAN(ipaddr) {
        const c0 = ipaddr.charCodeAt(0);
        // ipv4
        if ( c0 === 0x30 /* 0 */ ) {
            return ipaddr.startsWith('0.');
        }
        if ( c0 === 0x31 /* 1 */ ) {
            if ( ipaddr.startsWith('10.') ) { return true; }
            if ( ipaddr.startsWith('127.') ) { return true; }
            if ( ipaddr.startsWith('169.254.') ) { return true; }
            if ( ipaddr.startsWith('172.') ) {
                const v = parseInt(ipaddr.slice(4), 10);
                return v >= 16 && v <= 31;
            }
            return ipaddr.startsWith('192.168.');
        }
        // ipv6
        if ( c0 === 0x3A /* : */ ) {
            if ( ipaddr.startsWith('::') === false ) { return false; }
            if ( ipaddr === '::' || ipaddr === '::1' ) { return true; }
            if ( ipaddr.startsWith('::ffff:') === false ) { return false; }
            return this.reIPv6IPv4lan.test(ipaddr);
        }
        if ( c0 === 0x66 /* f */ ) {
            return this.reIPv6local.test(ipaddr);
        }
        return false;
    }

    static isLoopback(ipaddr) {
        return ipaddr === '127.0.0.1' || ipaddr === '::1';
    }

    static compile(details) {
        return [ FilterIPAddress.fid, details.optionValues.get('ipaddress') ];
    }

    static fromCompiled(args) {
        const pattern = args[1];
        const details = { pattern };
        return filterDataAlloc(args[0], filterRefAdd(details));
    }

    static dnrFromCompiled(args, rule) {
        dnrAddRuleError(rule, `"ipaddress=${args[1]}" not supported`);
    }

    static logData(idata, details) {
        const irefs = filterData[idata+1];
        details.options.push(`ipaddress=${LogData.requote(filterRefs[irefs].pattern)}`);
    }
}

registerFilterClass(FilterIPAddress);

/******************************************************************************/

class FilterMessage {
    static match() {
        return true;
    }

    static compile(details) {
        return [
            FilterMessage.fid,
            encodeURIComponent(details.optionValues.get('reason')),
        ];
    }

    static fromCompiled(args) {
        const msg = args[1];
        return filterDataAlloc(args[0], bidiTrie.storeString(msg), msg.length);
    }

    static keyFromArgs(args) {
        return `${args[1]}`;
    }

    static logData(idata, details) {
        const reason = decodeURIComponent(
            bidiTrie.extractString(filterData[idata+1], filterData[idata+2])
        );
        details.reason = reason;
        details.options.push(`reason=${reason}`);
    }
}

registerFilterClass(FilterMessage);

/******************************************************************************/
/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/2630
// Slice input URL into a list of safe-integer token values, instead of a list
// of substrings. The assumption is that with dealing only with numeric
// values, less underlying memory allocations, and also as a consequence
// less work for the garbage collector down the road.
// Another assumption is that using a numeric-based key value for Map() is
// more efficient than string-based key value (but that is something I would
// have to benchmark).
// Benchmark for string-based tokens vs. safe-integer token values:
//   https://gorhill.github.io/obj-vs-set-vs-map/tokenize-to-str-vs-to-int.html

// http://www.cse.yorku.ca/~oz/hash.html#djb2
//   Use above algorithm to generate token hash.

const urlTokenizer = new (class {
    constructor() {
        this._chars = '0123456789%abcdefghijklmnopqrstuvwxyz';
        this._validTokenChars = new Uint8Array(128);
        for ( let i = 0, n = this._chars.length; i < n; i++ ) {
            this._validTokenChars[this._chars.charCodeAt(i)] = i + 1;
        }

        this._urlIn = '';
        this._urlOut = '';
        this._tokenized = false;
        this._hasQuery = 0;
        // https://www.reddit.com/r/uBlockOrigin/comments/dzw57l/
        //   Remember: 1 token needs two slots
        this._tokens = new Uint32Array(bidiTrie.haystack.length + 16);

        this.knownTokens = new Uint8Array(65536);
        this.resetKnownTokens();
    }

    setURL(url) {
        if ( url !== this._urlIn ) {
            this._urlIn = url;
            this._urlOut = url.toLowerCase();
            this._hasQuery = 0;
            this._tokenized = false;
        }
        return this._urlOut;
    }

    resetKnownTokens() {
        this.knownTokens.fill(0);
        this.addKnownToken(DOT_TOKEN_HASH);
        this.addKnownToken(ANY_TOKEN_HASH);
        this.addKnownToken(ANY_HTTPS_TOKEN_HASH);
        this.addKnownToken(ANY_HTTP_TOKEN_HASH);
        this.addKnownToken(NO_TOKEN_HASH);
    }

    addKnownToken(th) {
        this.knownTokens[th & 0xFFFF] = 1;
    }

    // Tokenize on demand.
    getTokens() {
        if ( this._tokenized ) { return this._tokens; }
        let i = this._tokenize();
        this._tokens[i+0] = ANY_TOKEN_HASH;
        this._tokens[i+1] = 0;
        i += 2;
        if ( this._urlOut.startsWith('https://') ) {
            this._tokens[i+0] = ANY_HTTPS_TOKEN_HASH;
            this._tokens[i+1] = 0;
            i += 2;
        } else if ( this._urlOut.startsWith('http://') ) {
            this._tokens[i+0] = ANY_HTTP_TOKEN_HASH;
            this._tokens[i+1] = 0;
            i += 2;
        }
        this._tokens[i+0] = NO_TOKEN_HASH;
        this._tokens[i+1] = 0;
        this._tokens[i+2] = INVALID_TOKEN_HASH;
        this._tokenized = true;
        return this._tokens;
    }

    hasQuery() {
        if ( this._hasQuery === 0 ) {
            const i = this._urlOut.indexOf('?');
            this._hasQuery = i !== -1 ? i + 1 : -1;
        }
        return this._hasQuery > 0;
    }

    // http://www.cse.yorku.ca/~oz/hash.html#djb2

    tokenHashFromString(s) {
        const l = s.length;
        if ( l === 0 ) { return EMPTY_TOKEN_HASH; }
        const vtc = this._validTokenChars;
        let th = vtc[s.charCodeAt(0)];
        for ( let i = 1; i !== 7 /* MAX_TOKEN_LENGTH */ && i !== l; i++ ) {
            th = (th << 5) + th ^ vtc[s.charCodeAt(i)];
        }
        return th & 0xFFFFFFF;
    }

    stringFromTokenHash(th) {
        if ( th === 0 ) { return ''; }
        return th.toString(16);
    }

    toSelfie() {
        return this.knownTokens;
    }

    fromSelfie(selfie) {
        this.knownTokens = selfie;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/1118
    // We limit to a maximum number of tokens.

    _tokenize() {
        const tokens = this._tokens;
        const url = this._urlOut;
        const l = bidiTrie.setHaystackLen(url.length);
        if ( l === 0 ) { return 0; }
        let j = 0;
        let hasq = -1;
        mainLoop: {
            const knownTokens = this.knownTokens;
            const vtc = this._validTokenChars;
            const charCodes = bidiTrie.haystack;
            let i = 0, n = 0, ti = 0, th = 0;
            for (;;) {
                for (;;) {
                    if ( i === l ) { break mainLoop; }
                    const cc = url.charCodeAt(i);
                    charCodes[i] = cc;
                    i += 1;
                    th = vtc[cc];
                    if ( th !== 0 ) { break; }
                    if ( cc === 0x3F /* '?' */ ) { hasq = i; }
                }
                ti = i - 1; n = 1;
                for (;;) {
                    if ( i === l ) { break; }
                    const cc = url.charCodeAt(i);
                    charCodes[i] = cc;
                    i += 1;
                    const v = vtc[cc];
                    if ( v === 0 ) {
                        if ( cc === 0x3F /* '?' */ ) { hasq = i; }
                        break;
                    }
                    if ( n === 7 /* MAX_TOKEN_LENGTH */ ) { continue; }
                    th = (th << 5) + th ^ v;
                    n += 1;
                }
                if ( knownTokens[th & 0xFFFF] !== 0 ) {
                    tokens[j+0] = th & 0xFFFFFFF;
                    tokens[j+1] = ti;
                    j += 2;
                }
            }
        }
        this._hasQuery = hasq;
        return j;
    }
})();

/******************************************************************************/
/******************************************************************************/

class FilterCompiler {
    constructor(other = undefined) {
        if ( other !== undefined ) {
            return Object.assign(this, other);
        }
        this.reTokens = /[%0-9A-Za-z]+/g;
        this.optionValues = new Map();
        this.tokenIdToNormalizedType = new Map([
            [ sfp.NODE_TYPE_NET_OPTION_NAME_CNAME, bitFromType('cname') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_CSS, bitFromType('stylesheet') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_DOC, bitFromType('main_frame') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_FONT, bitFromType('font') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_FRAME, bitFromType('sub_frame') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK, bitFromType('unsupported') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_GHIDE, bitFromType('generichide') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_IMAGE, bitFromType('image') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_INLINEFONT, bitFromType('inline-font') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT, bitFromType('inline-script') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_MEDIA, bitFromType('media') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_OBJECT, bitFromType('object') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_OTHER, bitFromType('other') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_PING, bitFromType('ping') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_POPUNDER, bitFromType('popunder') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_POPUP, bitFromType('popup') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_SCRIPT, bitFromType('script') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_SHIDE, bitFromType('specifichide') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_XHR, bitFromType('xmlhttprequest') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_WEBRTC, bitFromType('unsupported') ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_WEBSOCKET, bitFromType('websocket') ],
        ]);
        this.modifierIdToNormalizedId = new Map([
            [ sfp.NODE_TYPE_NET_OPTION_NAME_CSP, MODIFIER_TYPE_CSP ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_PERMISSIONS, MODIFIER_TYPE_PERMISSIONS ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT, MODIFIER_TYPE_REDIRECT ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE, MODIFIER_TYPE_REDIRECTRULE ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM, MODIFIER_TYPE_REMOVEPARAM ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM, MODIFIER_TYPE_URLTRANSFORM ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_REPLACE, MODIFIER_TYPE_REPLACE ],
            [ sfp.NODE_TYPE_NET_OPTION_NAME_URLSKIP, MODIFIER_TYPE_URLSKIP ],
        ]);
        // These top 100 "bad tokens" are collated using the "miss" histogram
        // from tokenHistograms(). The "score" is their occurrence among the
        // 200K+ URLs used in the benchmark and executed against default
        // filter lists.
        this.badTokens = new Map([
            [ 'https',123617 ],
            [ 'com',76987 ],
            [ 'js',43620 ],
            [ 'www',33129 ],
            [ 'jpg',32221 ],
            [ 'images',31812 ],
            [ 'css',19715 ],
            [ 'png',19140 ],
            [ 'static',15724 ],
            [ 'net',15239 ],
            [ 'de',13155 ],
            [ 'img',11109 ],
            [ 'assets',10746 ],
            [ 'min',7807 ],
            [ 'cdn',7568 ],
            [ 'content',6900 ],
            [ 'wp',6444 ],
            [ 'fonts',6095 ],
            [ 'svg',5976 ],
            [ 'http',5813 ],
            [ 'ssl',5735 ],
            [ 'amazon',5440 ],
            [ 'ru',5427 ],
            [ 'fr',5199 ],
            [ 'facebook',5178 ],
            [ 'en',5146 ],
            [ 'image',5028 ],
            [ 'html',4837 ],
            [ 'media',4833 ],
            [ 'co',4783 ],
            [ 'php',3972 ],
            [ '2019',3943 ],
            [ 'org',3924 ],
            [ 'jquery',3531 ],
            [ '02',3438 ],
            [ 'api',3382 ],
            [ 'gif',3350 ],
            [ 'eu',3322 ],
            [ 'prod',3289 ],
            [ 'woff2',3200 ],
            [ 'logo',3194 ],
            [ 'themes',3107 ],
            [ 'icon',3048 ],
            [ 'google',3026 ],
            [ 'v1',3019 ],
            [ 'uploads',2963 ],
            [ 'googleapis',2860 ],
            [ 'v3',2816 ],
            [ 'tv',2762 ],
            [ 'icons',2748 ],
            [ 'core',2601 ],
            [ 'gstatic',2581 ],
            [ 'ac',2509 ],
            [ 'utag',2466 ],
            [ 'id',2459 ],
            [ 'ver',2448 ],
            [ 'rsrc',2387 ],
            [ 'files',2361 ],
            [ 'uk',2357 ],
            [ 'us',2271 ],
            [ 'pl',2262 ],
            [ 'common',2205 ],
            [ 'public',2076 ],
            [ '01',2016 ],
            [ 'na',1957 ],
            [ 'v2',1954 ],
            [ '12',1914 ],
            [ 'thumb',1895 ],
            [ 'web',1853 ],
            [ 'ui',1841 ],
            [ 'default',1825 ],
            [ 'main',1737 ],
            [ 'false',1715 ],
            [ '2018',1697 ],
            [ 'embed',1639 ],
            [ 'player',1634 ],
            [ 'dist',1599 ],
            [ 'woff',1593 ],
            [ 'global',1593 ],
            [ 'json',1572 ],
            [ '11',1566 ],
            [ '600',1559 ],
            [ 'app',1556 ],
            [ 'styles',1533 ],
            [ 'plugins',1526 ],
            [ '274',1512 ],
            [ 'random',1505 ],
            [ 'sites',1505 ],
            [ 'imasdk',1501 ],
            [ 'bridge3',1501 ],
            [ 'news',1496 ],
            [ 'width',1494 ],
            [ 'thumbs',1485 ],
            [ 'ttf',1470 ],
            [ 'ajax',1463 ],
            [ 'user',1454 ],
            [ 'scripts',1446 ],
            [ 'twitter',1440 ],
            [ 'crop',1431 ],
            [ 'new',1412],
        ]);
        this.reset();
    }

    reset() {
        this.action = BLOCK_REALM;
        // anchor: bit vector
        //   0000 (0x0): no anchoring
        //   0001 (0x1): anchored to the end of the URL.
        //   0010 (0x2): anchored to the start of the URL.
        //   0011 (0x3): anchored to the start and end of the URL.
        //   0100 (0x4): anchored to the hostname of the URL.
        //   0101 (0x5): anchored to the hostname and end of the URL.
        this.anchor = 0;
        this.badFilter = false;
        this.error = undefined;
        this.modifyType = undefined;
        this.modifyValue = undefined;
        this.pattern = '';
        this.party = ANYPARTY_REALM;
        this.optionUnitBits = 0;
        this.optionValues.clear();
        this.isPureHostname = false;
        this.isGeneric = false;
        this.isRegex = false;
        this.strictParty = 0;
        this.token = '*';
        this.tokenHash = NO_TOKEN_HASH;
        this.tokenBeg = 0;
        this.typeBits = 0;
        this.notTypeBits = 0;
        this.methodBits = 0;
        this.notMethodBits = 0;
        return this;
    }

    start(/* writer */) {
    }

    finish(/* writer */) {
    }

    clone() {
        return new FilterCompiler(this);
    }

    normalizeRegexSource(s) {
        try {
            const re = new RegExp(s);
            return re.source;
        } catch {
        }
        return '';
    }

    processMethodOption(value) {
        for ( const method of value.split('|') ) {
            if ( method.charCodeAt(0) === 0x7E /* '~' */ ) {
                const bit = FilteringContext.getMethod(method.slice(1)) || 0;
                if ( bit === 0 ) { continue; }
                this.notMethodBits |= bit;
            } else {
                const bit = FilteringContext.getMethod(method) || 0;
                if ( bit === 0 ) { continue; }
                this.methodBits |= bit;
            }
        }
        this.methodBits &= ~this.notMethodBits;
    }

    // https://github.com/chrisaljoudi/uBlock/issues/589
    // Be ready to handle multiple negated types

    processTypeOption(id, not) {
        if ( id !== -1 ) {
            const typeBit = this.tokenIdToNormalizedType.get(id);
            if ( not ) {
                this.notTypeBits |= typeBit;
            } else {
                this.typeBits |= typeBit;
            }
            return;
        }
        // `all` option
        if ( not ) {
            this.notTypeBits |= allTypesBits;
        } else {
            this.typeBits |= allTypesBits;
        }
    }

    processPartyOption(firstParty, not) {
        if ( not ) {
            firstParty = !firstParty;
        }
        this.party |= firstParty ? FIRSTPARTY_REALM : THIRDPARTY_REALM;
    }

    processHostnameList(iter, out = []) {
        let i = 0;
        for ( const { hn, not, bad } of iter ) {
            if ( bad ) { return ''; }
            out[i] = not ? `~${hn}` : hn;
            i += 1;
        }
        out.length = i;
        return i === 1 ? out[0] : out.join('|');
    }

    processModifierOption(modifier, value) {
        if ( this.modifyType !== undefined ) { return false; }
        const normalized = this.modifierIdToNormalizedId.get(modifier);
        if ( normalized === undefined ) { return false; }
        this.modifyType = normalized;
        this.modifyValue = value || '';
        return true;
    }

    processCspOption(value) {
        this.modifyType = MODIFIER_TYPE_CSP;
        this.modifyValue = value || '';
        this.optionUnitBits |= MODIFY_BIT;
        return true;
    }

    processOptionWithValue(parser, id) {
        switch ( id ) {
        case sfp.NODE_TYPE_NET_OPTION_NAME_CSP:
            if ( this.processCspOption(parser.getNetOptionValue(id)) === false ) { return false; }
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_DENYALLOW: {
            const value = this.processHostnameList(
                parser.getNetFilterDenyallowOptionIterator()
            );
            if ( value === '' ) { return false; }
            this.optionValues.set('denyallow', value);
            this.optionUnitBits |= DENYALLOW_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_FROM: {
            const iter = parser.getNetFilterFromOptionIterator();
            const list = [];
            const value = this.processHostnameList(iter, list);
            if ( value === '' ) { return false; }
            this.optionValues.set('from', value);
            this.optionValues.set('fromList', list);
            this.optionUnitBits |= FROM_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_IPADDRESS:
            this.optionValues.set('ipaddress', parser.getNetOptionValue(id) || '');
            this.optionUnitBits |= IPADDRESS_BIT;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_METHOD:
            this.processMethodOption(parser.getNetOptionValue(id));
            this.optionUnitBits |= METHOD_BIT;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:
        case sfp.NODE_TYPE_NET_OPTION_NAME_REPLACE:
        case sfp.NODE_TYPE_NET_OPTION_NAME_URLSKIP:
        case sfp.NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:
            if ( this.processModifierOption(id, parser.getNetOptionValue(id)) === false ) {
                return false;
            }
            this.optionUnitBits |= MODIFY_BIT;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_REASON:
            this.optionValues.set('reason', parser.getNetOptionValue(id));
            this.optionUnitBits |= MESSAGE_BIT;
            break;
        case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT: {
            const actualId = this.action === ALLOW_REALM
                ? sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE
                : id;
            if ( this.processModifierOption(actualId, parser.getNetOptionValue(id)) === false ) {
                return false;
            }
            this.optionUnitBits |= MODIFY_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER: {
            this.optionValues.set('requestheader', parser.getNetOptionValue(id) || '');
            this.optionUnitBits |= HEADER_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER: {
            this.optionValues.set('responseheader', parser.getNetOptionValue(id) || '');
            this.optionUnitBits |= HEADER_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_TO: {
            const iter = parser.getNetFilterToOptionIterator();
            const list = [];
            const value = this.processHostnameList(iter, list);
            if ( value === '' ) { return false; }
            this.optionValues.set('to', value);
            this.optionValues.set('toList', list);
            this.optionUnitBits |= TO_BIT;
            break;
        }
        case sfp.NODE_TYPE_NET_OPTION_NAME_TOP: {
            const iter = parser.getNetFilterTopOptionIterator();
            const list = [];
            const value = this.processHostnameList(iter, list);
            if ( value === '' ) { return false; }
            this.optionValues.set('top', value);
            this.optionValues.set('topList', list);
            this.optionUnitBits |= TOP_BIT;
            break;
        }
        default:
            break;
        }
        return true;
    }

    process(parser) {
        // important!
        this.reset();

        if ( parser.hasError() ) {
            return this.FILTER_INVALID;
        }

        if ( parser.isException() ) {
            this.action = ALLOW_REALM;
        }

        if ( parser.isLeftHnAnchored() ) {
            this.anchor |= 0b100;
        } else if ( parser.isLeftAnchored() ) {
            this.anchor |= 0b010;
        }
        if ( parser.isRightAnchored() ) {
            this.anchor |= 0b001;
        }

        this.pattern = parser.getNetPattern();
        if ( parser.isHostnamePattern() ) {
            this.isPureHostname = true;
        } else if ( parser.isGenericPattern() ) {
            this.isGeneric = true;
        } else if ( parser.isRegexPattern() ) {
            this.isRegex = true;
        }

        for ( const type of parser.getNodeTypes() ) {
            switch ( type ) {
            case sfp.NODE_TYPE_NET_OPTION_NAME_1P:
                this.processPartyOption(true, parser.isNegatedOption(type));
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT1P:
                this.strictParty = this.strictParty === -1 ? 0 : 1;
                this.optionUnitBits |= STRICT_PARTY_BIT;
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_3P:
                this.processPartyOption(false, parser.isNegatedOption(type));
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_STRICT3P:
                this.strictParty = this.strictParty === 1 ? 0 : -1;
                this.optionUnitBits |= STRICT_PARTY_BIT;
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_ALL:
                this.processTypeOption(-1);
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_BADFILTER:
                this.badFilter = true;
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_CNAME:
            case sfp.NODE_TYPE_NET_OPTION_NAME_CSS:
            case sfp.NODE_TYPE_NET_OPTION_NAME_DOC:
            case sfp.NODE_TYPE_NET_OPTION_NAME_FONT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_FRAME:
            case sfp.NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK:
            case sfp.NODE_TYPE_NET_OPTION_NAME_GHIDE:
            case sfp.NODE_TYPE_NET_OPTION_NAME_IMAGE:
            case sfp.NODE_TYPE_NET_OPTION_NAME_INLINEFONT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_MEDIA:
            case sfp.NODE_TYPE_NET_OPTION_NAME_OBJECT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_OTHER:
            case sfp.NODE_TYPE_NET_OPTION_NAME_PING:
            case sfp.NODE_TYPE_NET_OPTION_NAME_POPUNDER:
            case sfp.NODE_TYPE_NET_OPTION_NAME_POPUP:
            case sfp.NODE_TYPE_NET_OPTION_NAME_SCRIPT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_SHIDE:
            case sfp.NODE_TYPE_NET_OPTION_NAME_XHR:
            case sfp.NODE_TYPE_NET_OPTION_NAME_WEBRTC:
            case sfp.NODE_TYPE_NET_OPTION_NAME_WEBSOCKET:
                this.processTypeOption(type, parser.isNegatedOption(type));
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_CSP:
            case sfp.NODE_TYPE_NET_OPTION_NAME_DENYALLOW:
            case sfp.NODE_TYPE_NET_OPTION_NAME_FROM:
            case sfp.NODE_TYPE_NET_OPTION_NAME_IPADDRESS:
            case sfp.NODE_TYPE_NET_OPTION_NAME_METHOD:
            case sfp.NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REASON:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REPLACE:
            case sfp.NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER:
            case sfp.NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER:
            case sfp.NODE_TYPE_NET_OPTION_NAME_TO:
            case sfp.NODE_TYPE_NET_OPTION_NAME_TOP:
            case sfp.NODE_TYPE_NET_OPTION_NAME_URLSKIP:
            case sfp.NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:
                if ( this.processOptionWithValue(parser, type) === false ) {
                    return this.FILTER_INVALID;
                }
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_EHIDE: {
                const not = parser.isNegatedOption(type);
                this.processTypeOption(sfp.NODE_TYPE_NET_OPTION_NAME_SHIDE, not);
                this.processTypeOption(sfp.NODE_TYPE_NET_OPTION_NAME_GHIDE, not);
                break;
            }
            case sfp.NODE_TYPE_NET_OPTION_NAME_EMPTY: {
                const id = this.action === ALLOW_REALM
                    ? sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE
                    : sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT;
                if ( this.processModifierOption(id, 'empty') === false ) {
                    return this.FILTER_INVALID;
                }
                this.optionUnitBits |= MODIFY_BIT;
                break;
            }
            case sfp.NODE_TYPE_NET_OPTION_NAME_IMPORTANT:
                this.optionUnitBits |= IMPORTANT_BIT;
                this.action = BLOCKIMPORTANT_REALM;
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_MATCHCASE:
                this.optionValues.set('match-case', true);
                break;
            case sfp.NODE_TYPE_NET_OPTION_NAME_MP4: {
                const id = this.action === ALLOW_REALM
                    ? sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE
                    : sfp.NODE_TYPE_NET_OPTION_NAME_REDIRECT;
                if ( this.processModifierOption(id, 'noopmp4-1s') === false ) {
                    return this.FILTER_INVALID;
                }
                this.processTypeOption(sfp.NODE_TYPE_NET_OPTION_NAME_MEDIA, false);
                this.optionUnitBits |= MODIFY_BIT;
                break;
            }
            default:
                break;
            }
        }

        if ( this.party === ALLPARTIES_REALM ) {
            this.party = ANYPARTY_REALM;
        }

        // Negated network types? Toggle on all network type bits.
        // Negated non-network types can only toggle themselves.
        //
        // https://github.com/gorhill/uBlock/issues/2385
        //   Toggle on all network types if:
        //   - at least one network type is negated; or
        //   - no network type is present -- i.e. all network types are
        //     implicitly toggled on
        if ( this.notTypeBits !== 0 ) {
            if ( (this.typeBits && allNetworkTypesBits) === allNetworkTypesBits ) {
                this.typeBits &= ~this.notTypeBits | allNetworkTypesBits;
            } else {
                this.typeBits &= ~this.notTypeBits;
            }
            this.optionUnitBits |= NOT_TYPE_BIT;
        }

        // CSP/permissions options implicitly apply only to
        // document/subdocument.
        if (
            this.modifyType === MODIFIER_TYPE_CSP ||
            this.modifyType === MODIFIER_TYPE_PERMISSIONS
        ) {
            if ( this.typeBits === 0 ) {
                this.processTypeOption(sfp.NODE_TYPE_NET_OPTION_NAME_DOC, false);
                this.processTypeOption(sfp.NODE_TYPE_NET_OPTION_NAME_FRAME, false);
            }
        }

        // https://github.com/gorhill/uBlock/issues/2283
        //   Abort if type is only for unsupported types, otherwise
        //   toggle off `unsupported` bit.
        if ( this.typeBits & unsupportedTypeBit ) {
            this.typeBits &= ~unsupportedTypeBit;
            if ( this.typeBits === 0 ) { return this.FILTER_UNSUPPORTED; }
        }

        // Plain hostname? (from HOSTS file)
        if ( this.isPureHostname && parser.hasOptions() === false ) {
            this.anchor |= 0b100;
            return this.FILTER_OK;
        }

        // regex?
        if ( this.isRegex ) {
            return this.FILTER_OK;
        }

        if ( this.pattern.length > 1024 ) {
            return this.FILTER_UNSUPPORTED;
        }

        return this.FILTER_OK;
    }

    // Given a string, find a good token. Tokens which are too generic,
    // i.e. very common with a high probability of ending up as a miss,
    // are not good. Avoid if possible. This has a significant positive
    // impact on performance.
    //
    // For pattern-less removeparam filters, try to derive a pattern from
    // the removeparam value.

    makeToken() {
        if ( this.pattern === '*' ) {
            if ( this.modifyType !== MODIFIER_TYPE_REMOVEPARAM ) { return; }
            return this.extractTokenFromQuerypruneValue();
        }
        if ( this.isRegex ) {
            return this.extractTokenFromRegex(this.pattern);
        }
        this.extractTokenFromPattern(this.pattern);
    }

    // Note: a one-char token is better than a documented bad token.
    extractTokenFromPattern(pattern) {
        this.reTokens.lastIndex = 0;
        let bestMatch = null;
        let bestBadness = 0x7FFFFFFF;
        for (;;) {
            const match = this.reTokens.exec(pattern);
            if ( match === null ) { break; }
            const token = match[0];
            const badness = token.length > 1 ? this.badTokens.get(token) || 0 : 1;
            if ( badness >= bestBadness ) { continue; }
            if ( match.index > 0 ) {
                const c = pattern.charCodeAt(match.index - 1);
                if ( c === 0x2A /* '*' */ ) { continue; }
            }
            if ( token.length < MAX_TOKEN_LENGTH ) {
                const lastIndex = this.reTokens.lastIndex;
                if ( lastIndex < pattern.length ) {
                    const c = pattern.charCodeAt(lastIndex);
                    if ( c === 0x2A /* '*' */ ) { continue; }
                }
            }
            bestMatch = match;
            if ( badness === 0 ) { break; }
            bestBadness = badness;
        }
        if ( bestMatch !== null ) {
            this.token = bestMatch[0];
            this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
            this.tokenBeg = bestMatch.index;
        }
    }

    // https://github.com/gorhill/uBlock/issues/2781
    //   For efficiency purpose, try to extract a token from a regex-based
    //   filter.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1145#issuecomment-657036902
    //   Mind `\b` directives: `/\bads\b/` should result in token being `ads`,
    //   not `bads`.
    extractTokenFromRegex(pattern) {
        pattern = tokenizableStrFromRegex(pattern);
        this.reTokens.lastIndex = 0;
        let bestToken;
        let bestBadness = 0x7FFFFFFF;
        for (;;) {
            const matches = this.reTokens.exec(pattern);
            if ( matches === null ) { break; }
            const { 0: token, index } = matches;
            if ( index === 0 || pattern.charAt(index - 1) === '\x01' ) {
                continue;
            }
            const { lastIndex } = this.reTokens;
            if (
                token.length < MAX_TOKEN_LENGTH && (
                    lastIndex === pattern.length ||
                    pattern.charAt(lastIndex) === '\x01'
                )
            ) {
                continue;
            }
            const badness = token.length > 1
                ? this.badTokens.get(token) || 0
                : 1;
            if ( badness < bestBadness ) {
                bestToken = token;
                if ( badness === 0 ) { break; }
                bestBadness = badness;
            }
        }
        if ( bestToken !== undefined ) {
            this.token = bestToken.toLowerCase();
            this.tokenHash = urlTokenizer.tokenHashFromString(this.token);
        }
    }

    // https://github.com/uBlockOrigin/uAssets/discussions/14683#discussioncomment-3559284
    //   If the removeparam value is a regex, unescape escaped commas
    extractTokenFromQuerypruneValue() {
        const pattern = this.modifyValue;
        if ( pattern === '*' || pattern.charCodeAt(0) === 0x7E /* '~' */ ) {
            return;
        }
        const match = /^\/(.+)\/i?$/.exec(pattern);
        if ( match !== null ) {
            return this.extractTokenFromRegex(
                match[1].replace(/(\{\d*)\\,/, '$1,')
            );
        }
        if ( pattern.startsWith('|') ) {
            return this.extractTokenFromRegex('\\b' + pattern.slice(1));
        }
        this.extractTokenFromPattern(pattern.toLowerCase());
    }

    hasNoOptionUnits() {
        return this.optionUnitBits === 0;
    }

    isJustOrigin() {
        if ( this.optionUnitBits !== FROM_BIT ) { return false; }
        if ( this.isRegex ) { return false; }
        if ( /[/~]/.test(this.optionValues.get('from')) ) { return false; }
        if ( this.pattern === '*' ) { return true; }
        if ( this.anchor !== 0b010 ) { return false; }
        if ( /^(?:http[s*]?:(?:\/\/)?)$/.test(this.pattern) ) { return true; }
        return false;
    }

    domainIsEntity(s) {
        const l = s.length;
        return l > 2 &&
               s.charCodeAt(l-1) === 0x2A /* '*' */ &&
               s.charCodeAt(l-2) === 0x2E /* '.' */;
    }

    compile(parser, writer) {
        const r = this.process(parser);

        // Ignore non-static network filters
        if ( r === this.FILTER_INVALID ) { return false; }

        // Ignore filters with unsupported options
        if ( r === this.FILTER_UNSUPPORTED ) {
            const who = writer.properties.get('name') || '?';
            this.error = `Invalid network filter in ${who}: ${parser.raw}`;
            return false;
        }

        writer.select(
            this.badFilter
                ? 'NETWORK_FILTERS:BAD'
                : 'NETWORK_FILTERS:GOOD'
        );

        // Reminder:
        //   `redirect=` is a combination of a `redirect-rule` filter and a
        //   block filter.
        if ( this.modifyType === MODIFIER_TYPE_REDIRECT ) {
            this.modifyType = MODIFIER_TYPE_REDIRECTRULE;
            // Do not generate block rule when compiling to DNR ruleset
            if ( parser.options.toDNR !== true ) {
                const parsedBlock = this.clone();
                parsedBlock.modifyType = undefined;
                parsedBlock.optionUnitBits &= ~MODIFY_BIT;
                parsedBlock.compileToFilter(writer);
            }
        }

        this.compileToFilter(writer);

        return true;
    }

    compileToFilter(writer) {
        // Pure hostnames, use more efficient dictionary lookup
        if ( this.isPureHostname && this.hasNoOptionUnits() ) {
            this.tokenHash = DOT_TOKEN_HASH;
            this.compileToAtomicFilter(this.pattern, writer);
            return;
        }

        this.makeToken();

        // Special pattern/option cases:
        // - `*$domain=...`
        // - `|http://$domain=...`
        // - `|https://$domain=...`
        // The semantic of "just-origin" filters is that contrary to normal
        // filters, the original filter is split into as many filters as there
        // are entries in the `domain=` option.
        if ( this.isJustOrigin() ) {
            if ( this.pattern === '*' || this.pattern.startsWith('http*') ) {
                this.tokenHash = ANY_TOKEN_HASH;
            } else if /* 'https:' */ ( this.pattern.startsWith('https') ) {
                this.tokenHash = ANY_HTTPS_TOKEN_HASH;
            } else /* 'http:' */ {
                this.tokenHash = ANY_HTTP_TOKEN_HASH;
            }
            for ( const hn of this.optionValues.get('fromList') ) {
                this.compileToAtomicFilter(hn, writer);
            }
            return;
        }

        const units = [];

        // Pattern
        const patternClass = this.compilePattern(units);

        // Anchor: must never appear before pattern unit
        if ( (this.anchor & 0b100) !== 0 ) {
            if ( this.isPureHostname ) {
                units.push(FilterAnchorHn.compile());
            } else {
                units.push(FilterAnchorHnLeft.compile());
            }
        } else if ( (this.anchor & 0b010) !== 0 ) {
            units.push(FilterAnchorLeft.compile());
        }
        if ( (this.anchor & 0b001) !== 0 ) {
            units.push(FilterAnchorRight.compile());
        }

        // Method(s)
        if ( this.methodBits !== 0 || this.notMethodBits !== 0 ) {
            units.push(FilterMethod.compile(this));
        }

        // Not types
        if ( this.notTypeBits !== 0 ) {
            units.push(FilterNotType.compile(this));
        }

        // Strict partiness
        if ( this.strictParty !== 0 ) {
            units.push(FilterStrictParty.compile(this));
        }

        // Origin
        if ( (this.optionUnitBits & FROM_BIT) !== 0 ) {
            compileFromDomainOpt(
                this.optionValues.get('fromList'),
                units.length !== 0 && patternClass.isSlow === true,
                units
            );
        }

        // Destination
        if ( (this.optionUnitBits & TO_BIT) !== 0 ) {
            compileToDomainOpt(
                this.optionValues.get('toList'),
                units.length !== 0 && patternClass.isSlow === true,
                units
            );
        }

        // Top origin
        if ( (this.optionUnitBits & TOP_BIT) !== 0 ) {
            compileTopDomainOpt(
                this.optionValues.get('topList'),
                units.length !== 0 && patternClass.isSlow === true,
                units
            );
        }

        // Deny-allow
        if ( (this.optionUnitBits & DENYALLOW_BIT) !== 0 ) {
            units.push(FilterDenyAllow.compile(this));
        }

        // IP address
        if ( (this.optionUnitBits & IPADDRESS_BIT) !== 0 ) {
            units.push(FilterIPAddress.compile(this));
        }

        // Header
        if ( (this.optionUnitBits & HEADER_BIT) !== 0 ) {
            if ( this.optionValues.has('requestheader') ) {
                units.push(FilterOnRequestHeaders.compile(this));
            }
            if ( this.optionValues.has('responseheader') ) {
                units.push(FilterOnResponseHeaders.compile(this));
            }
            this.action |= HEADERS_REALM;
        }

        // Message
        if ( (this.optionUnitBits & MESSAGE_BIT) !== 0 ) {
            units.push(FilterMessage.compile(this));
        }

        // Important
        //
        // IMPORTANT: must always appear at the end of the sequence, so as to
        // ensure $isBlockImportant is set only for matching filters.
        if ( (this.optionUnitBits & IMPORTANT_BIT) !== 0 ) {
            units.push(FilterImportant.compile());
        }

        // Modifier
        //
        // IMPORTANT: the modifier unit MUST always appear first in a sequence
        if ( this.modifyType !== undefined ) {
            units.unshift(FilterModifier.compile(this));
            this.action = (this.action & ~BLOCKALLOW_REALM) |
                modifierBitsFromType.get(this.modifyType);
        }

        const fdata = units.length === 1
            ? units[0]
            : FilterCompositeAll.compile(units);

        this.compileToAtomicFilter(fdata, writer);

        if ( (this.optionUnitBits & IPADDRESS_BIT) !== 0 ) {
            if ( (this.action & HEADERS_REALM) !== 0 ) { return; }
            this.action |= HEADERS_REALM;
            this.compileToAtomicFilter(fdata, writer);
        }
    }

    compilePattern(units) {
        if ( this.isRegex ) {
            units.push(FilterRegex.compile(this));
            return FilterRegex;
        }
        if ( this.pattern === '*' ) {
            units.push(FilterPatternAny.compile());
            return FilterPatternAny;
        }
        if ( this.tokenHash === NO_TOKEN_HASH ) {
            units.push(FilterPatternGeneric.compile(this));
            return FilterPatternGeneric;
        }
        if ( this.pattern.includes('*') === false ) {
            const caretPos = this.pattern.indexOf('^');
            if ( caretPos === -1 ) {
                units.push(FilterPatternPlain.compile(this));
                return FilterPatternPlain;
            }
            if ( caretPos === (this.pattern.length - 1) ) {
                this.pattern = this.pattern.slice(0, -1);
                units.push(FilterPatternPlain.compile(this));
                units.push(FilterTrailingSeparator.compile());
                return FilterPatternPlain;
            }
        }
        units.push(FilterPatternGeneric.compile(this));
        return FilterPatternGeneric;
    }

    compileToAtomicFilter(fdata, writer) {
        const catBits = this.action | this.party;
        let { typeBits } = this;

        // Typeless
        if ( typeBits === 0 ) {
            writer.push([ catBits, this.tokenHash, fdata ]);
            return;
        }
        // If all network types are set, create a typeless filter. Excluded
        // network types are tested at match time, se we act as if they are
        // set.
        if ( (typeBits & allNetworkTypesBits) === allNetworkTypesBits ) {
            writer.push([ catBits, this.tokenHash, fdata ]);
            typeBits &= ~allNetworkTypesBits;
            if ( typeBits === 0 ) { return; }
        }
        // One filter per specific types
        let bitOffset = 1;
        do {
            if ( typeBits & 1 ) {
                writer.push([
                    catBits | (bitOffset << TYPE_REALM_OFFSET),
                    this.tokenHash,
                    fdata
                ]);
            }
            bitOffset += 1;
            typeBits >>>= 1;
        } while ( typeBits !== 0 );
    }
}

// These are to quickly test whether a filter is composite
const FROM_BIT         = 0b0_0000_0000_0001;
const TO_BIT           = 0b0_0000_0000_0010;
const TOP_BIT          = 0b0_0000_0000_0100;
const DENYALLOW_BIT    = 0b0_0000_0000_1000;
const HEADER_BIT       = 0b0_0000_0001_0000;
const STRICT_PARTY_BIT = 0b0_0000_0010_0000;
const MODIFY_BIT       = 0b0_0000_0100_0000;
const NOT_TYPE_BIT     = 0b0_0000_1000_0000;
const IMPORTANT_BIT    = 0b0_0001_0000_0000;
const METHOD_BIT       = 0b0_0010_0000_0000;
const IPADDRESS_BIT    = 0b0_0100_0000_0000;
const MESSAGE_BIT      = 0b0_1000_0000_0000;

FilterCompiler.prototype.FILTER_OK          = 0;
FilterCompiler.prototype.FILTER_INVALID     = 1;
FilterCompiler.prototype.FILTER_UNSUPPORTED = 2;

/******************************************************************************/
/******************************************************************************/

const StaticNetFilteringEngine = function() {
    this.compilerVersion = '10';
    this.selfieVersion = '10';

    this.MAX_TOKEN_LENGTH = MAX_TOKEN_LENGTH;
    this.optimizeTaskId = undefined;
    // As long as CategoryCount is reasonably low, we will use an array to
    // store buckets using category bits as index. If ever CategoryCount
    // becomes too large, we can just go back to using a Map.
    this.bitsToBucket = new Map();
    this.goodFilters = new Set();
    this.badFilters = new Set();
    this.unitsToOptimize = [];
    this.reset();
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.prime = function() {
    origHNTrieContainer.reset(
        keyvalStore.getItem('SNFE.origHNTrieContainer.trieDetails')
    );
    destHNTrieContainer.reset(
        keyvalStore.getItem('SNFE.destHNTrieContainer.trieDetails')
    );
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.reset = function() {
    this.processedFilterCount = 0;
    this.acceptedCount = 0;
    this.discardedCount = 0;
    this.goodFilters.clear();
    this.badFilters.clear();
    this.unitsToOptimize.length = 0;
    this.bitsToBucket.clear();

    urlTokenizer.resetKnownTokens();

    filterDataReset();
    filterRefsReset();
    origHNTrieContainer.reset();
    destHNTrieContainer.reset();
    bidiTrie.reset();
    filterArgsToUnit.clear();

    // Cancel potentially pending optimization run.
    if ( this.optimizeTaskId !== undefined ) {
        dropTask(this.optimizeTaskId);
        this.optimizeTaskId = undefined;
    }

    this.notReady = false;

    // Runtime registers
    this.$catBits = 0;
    this.$tokenHash = 0;
    this.$filterUnit = 0;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.freeze = function() {
    const unserialize = CompiledListReader.unserialize;

    for ( const line of this.goodFilters ) {
        if ( this.badFilters.has(line) ) {
            this.discardedCount += 1;
            continue;
        }

        const args = unserialize(line);

        const bits = args[0];
        const bucket = this.bitsToBucket.get(bits) || (new Map());
        if ( bucket.size === 0 ) {
            this.bitsToBucket.set(bits, bucket);
        }

        const tokenHash = args[1];
        const fdata = args[2];

        let iunit = bucket.get(tokenHash) || 0;

        if ( tokenHash === DOT_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHostnameDict.create();
                bucket.set(DOT_TOKEN_HASH, iunit);
                this.unitsToOptimize.push({ bits, tokenHash });
            }
            FilterHostnameDict.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterJustOrigin.create();
                bucket.set(ANY_TOKEN_HASH, iunit);
            }
            FilterJustOrigin.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_HTTPS_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHTTPSJustOrigin.create();
                bucket.set(ANY_HTTPS_TOKEN_HASH, iunit);
            }
            FilterHTTPSJustOrigin.add(iunit, fdata);
            continue;
        }

        if ( tokenHash === ANY_HTTP_TOKEN_HASH ) {
            if ( iunit === 0 ) {
                iunit = FilterHTTPJustOrigin.create();
                bucket.set(ANY_HTTP_TOKEN_HASH, iunit);
            }
            FilterHTTPJustOrigin.add(iunit, fdata);
            continue;
        }

        urlTokenizer.addKnownToken(tokenHash);

        this.addFilterUnit(bits, tokenHash, filterFromCompiled(fdata));

        // Add block-important filters to the block realm, so as to avoid
        // to unconditionally match against the block-important realm for
        // every network request. Block-important filters are quite rare so
        // the block-important realm should be checked when and only when
        // there is a matched exception filter, which important filters are
        // meant to override.
        if ( (bits & BLOCKALLOW_REALM) === BLOCKIMPORTANT_REALM ) {
            this.addFilterUnit(
                bits & ~IMPORTANT_REALM,
                tokenHash,
                filterFromCompiled(fdata)
            );
        }
    }

    this.badFilters.clear();
    this.goodFilters.clear();
    filterArgsToUnit.clear();

    this.notReady = false;

    // Optimizing is not critical for the static network filtering engine to
    // work properly, so defer this until later to allow for reduced delay to
    // readiness when no valid selfie is available.
    if ( this.optimizeTaskId !== undefined ) { return; }

    this.optimizeTaskId = queueTask(( ) => {
        this.optimizeTaskId = undefined;
        this.optimize(30);
    }, 2000);
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.dnrFromCompiled = function(op, context, ...args) {
    if ( op === 'begin' ) {
        Object.assign(context, {
            good: new Set(),
            bad: new Set(context.bad),
            invalid: new Set(),
            filterCount: 0,
            acceptedFilterCount: 0,
            rejectedFilterCount: 0,
        });
        return;
    }

    if ( op === 'add' ) {
        const reader = args[0];
        reader.select('NETWORK_FILTERS:GOOD');
        while ( reader.next() ) {
            context.filterCount += 1;
            if ( context.good.has(reader.line) === false ) {
                context.good.add(reader.line);
            }
        }
        reader.select('NETWORK_FILTERS:BAD');
        while ( reader.next() ) {
            context.bad.add(reader.line);
        }
        return;
    }

    if ( op !== 'end' ) { return; }

    const { good, bad } = context;
    const unserialize = CompiledListReader.unserialize;
    const buckets = new Map();

    for ( const line of good ) {
        if ( bad.has(line) ) {
            context.rejectedFilterCount += 1;
            continue;
        }
        context.acceptedFilterCount += 1;

        const args = unserialize(line);
        const bits = args[0];
        const tokenHash = args[1];
        const fdata = args[2];

        if ( buckets.has(bits) === false ) {
            buckets.set(bits, new Map());
        }
        const bucket = buckets.get(bits);

        switch ( tokenHash ) {
        case DOT_TOKEN_HASH: {
            if ( bucket.has(DOT_TOKEN_HASH) === false ) {
                bucket.set(DOT_TOKEN_HASH, [{
                    condition: {
                        requestDomains: []
                    }
                }]);
            }
            const rule = bucket.get(DOT_TOKEN_HASH)[0];
            rule.condition.requestDomains.push(fdata);
            break;
        }
        case ANY_TOKEN_HASH: {
            if ( bucket.has(ANY_TOKEN_HASH) === false ) {
                bucket.set(ANY_TOKEN_HASH, [{
                    condition: {
                        initiatorDomains: []
                    }
                }]);
            }
            const rule = bucket.get(ANY_TOKEN_HASH)[0];
            rule.condition.initiatorDomains.push(fdata);
            break;
        }
        case ANY_HTTPS_TOKEN_HASH: {
            if ( bucket.has(ANY_HTTPS_TOKEN_HASH) === false ) {
                bucket.set(ANY_HTTPS_TOKEN_HASH, [{
                    condition: {
                        urlFilter: '|https://',
                        initiatorDomains: []
                    }
                }]);
            }
            const rule = bucket.get(ANY_HTTPS_TOKEN_HASH)[0];
            rule.condition.initiatorDomains.push(fdata);
            break;
        }
        case ANY_HTTP_TOKEN_HASH: {
            if ( bucket.has(ANY_HTTP_TOKEN_HASH) === false ) {
                bucket.set(ANY_HTTP_TOKEN_HASH, [{
                    condition: {
                        urlFilter: '|http://',
                        initiatorDomains: []
                    }
                }]);
            }
            const rule = bucket.get(ANY_HTTP_TOKEN_HASH)[0];
            rule.condition.initiatorDomains.push(fdata);
            break;
        }
        default: {
            if ( bucket.has(EMPTY_TOKEN_HASH) === false ) {
                bucket.set(EMPTY_TOKEN_HASH, []);
            }
            const rule = {};
            dnrRuleFromCompiled(fdata, rule);
            bucket.get(EMPTY_TOKEN_HASH).push(rule);
            break;
        }
        }
    }

    // Priority:
    //   Removeparam: 1-4
    //   Block: 10 (default priority)
    //   Redirect: 11-19
    //   Excepted redirect: 21-29
    //   Allow: 30
    //   Block important: 40
    //   Redirect important: 41-49

    const realms = new Map([
        [ BLOCK_REALM, { type: 'block', priority: 10 } ],
        [ ALLOW_REALM, { type: 'allow', priority: 30 } ],
        [ BLOCK_REALM | IMPORTANT_REALM, { type: 'block', priority: 10 } ],
        [ REDIRECT_REALM, { type: 'redirect', priority: 11 } ],
        [ REMOVEPARAM_REALM, { type: 'removeparam', priority: 1 } ],
        [ CSP_REALM, { type: 'csp', priority: 1 } ],
        [ PERMISSIONS_REALM, { type: 'permissions', priority: 1 } ],
        [ URLTRANSFORM_REALM, { type: 'uritransform', priority: 1 } ],
        [ HEADERS_REALM, { type: 'block', priority: 10 } ],
        [ HEADERS_REALM | ALLOW_REALM, { type: 'allow', priority: 30 } ],
        [ HEADERS_REALM | IMPORTANT_REALM, { type: 'allow', priority: 10 } ],
        [ URLSKIP_REALM, { type: 'urlskip', priority: 1 } ],
    ]);
    const partyness = new Map([
        [ ANYPARTY_REALM, '' ],
        [ FIRSTPARTY_REALM, 'firstParty' ],
        [ THIRDPARTY_REALM, 'thirdParty' ],
    ]);
    const types = new Set([
        'no_type',
        'stylesheet',
        'image',
        'object',
        'script',
        'xmlhttprequest',
        'sub_frame',
        'main_frame',
        'font',
        'media',
        'websocket',
        'ping',
        'other',
        'popup',
    ]);
    const ruleset = [];
    const seen = new Set();
    for ( const [ realmBits, realmDetails ] of realms ) {
        for ( const [ partyBits, partyName ] of partyness ) {
            for ( const typeName in typeNameToTypeValue ) {
                if ( types.has(typeName) === false ) { continue; }
                const typeBits = typeNameToTypeValue[typeName];
                const bits = realmBits | partyBits | typeBits;
                const bucket = buckets.get(bits);
                if ( bucket === undefined ) { continue; }
                for ( const rules of bucket.values() ) {
                    for ( const rule of rules ) {
                        rule.action = rule.action || {};
                        rule.action.type = realmDetails.type;
                        if ( realmDetails.priority !== 0 ) {
                            rule.priority = (rule.priority || 0) + realmDetails.priority;
                        }
                        if ( partyName !== '' ) {
                            rule.condition = rule.condition || {};
                            rule.condition.domainType = partyName;
                        }
                        if ( typeName !== 'no_type' ) {
                            rule.condition = rule.condition || {};
                            rule.condition.resourceTypes = [ typeName ];
                        }
                        const hash = JSON.stringify(rule);
                        if ( seen.has(hash) ) { continue; }
                        seen.add(hash);
                        ruleset.push(rule);
                    }
                }
            }
        }
    }
    seen.clear();

    // Adjust `important` priority
    // Mind:
    // - https://github.com/uBlockOrigin/uAssets/issues/29451#issuecomment-3150181993
    for ( const rule of ruleset ) {
        if ( rule.__important !== true ) { continue; }
        rule.priority ??= 0;
        rule.priority += 30;
    }

    // Collect generichide filters
    const generichideExclusions = [];
    const generichideInclusions = [];
    {
        const bucket = buckets.get(ALLOW_REALM | typeNameToTypeValue['generichide']);
        if ( bucket ) {
            for ( const rules of bucket.values() ) {
                for ( const rule of rules ) {
                    if ( rule.condition === undefined ) { continue; }
                    if ( rule.condition.initiatorDomains ) {
                        generichideExclusions.push(...rule.condition.initiatorDomains);
                    } else if ( rule.condition.requestDomains ) {
                        generichideExclusions.push(...rule.condition.requestDomains);
                    }
                    if ( rule.condition.excludedInitiatorDomains ) {
                        generichideInclusions.push(...rule.condition.excludedInitiatorDomains);
                    } else if ( rule.condition.excludedRequestDomains ) {
                        generichideInclusions.push(...rule.condition.excludedRequestDomains);
                    }
                }
            }
        }
    }
    {
        const bucket = buckets.get(BLOCKIMPORTANT_REALM | typeNameToTypeValue['generichide']);
        if ( bucket ) {
            for ( const rules of bucket.values() ) {
                for ( const rule of rules ) {
                    if ( rule.condition === undefined ) { continue; }
                    if ( rule.condition.initiatorDomains ) {
                        generichideInclusions.push(...rule.condition.initiatorDomains);
                    } else if ( rule.condition.requestDomains ) {
                        generichideInclusions.push(...rule.condition.requestDomains);
                    }
                }
            }
        }
    }

    // Detect and attempt salvage of rules with entity-based hostnames and/or
    // regex-based domains.
    const isUnsupportedDomain = hn => hn.endsWith('.*') || hn.startsWith('/');
    for ( const rule of ruleset ) {
        if ( rule.condition === undefined ) { continue; }
        for ( const prop of [ 'Initiator', 'Request', 'Top' ] ) {
            const hitProp = `${prop.toLowerCase()}Domains`;
            if ( Array.isArray(rule.condition[hitProp]) ) {
                if ( rule.condition[hitProp].some(hn => isUnsupportedDomain(hn)) ) {
                    const domains = rule.condition[hitProp].filter(
                        hn => isUnsupportedDomain(hn) === false 
                    );
                    if ( domains.length === 0 ) {
                        dnrAddRuleError(rule, `Can't salvage rule with unsupported domain= option: ${rule.condition[hitProp].join('|')}`);
                    } else {
                        dnrAddRuleWarning(rule, `Salvaged rule by ignoring ${rule.condition[hitProp].length - domains.length} unsupported domain= option: ${rule.condition[hitProp].join('|')}`);
                        rule.condition[hitProp] = domains;
                    }
                }
            }
            const missProp = `excluded${prop}Domains`;
            if ( Array.isArray(rule.condition[missProp]) ) {
                if ( rule.condition[missProp].some(hn => isUnsupportedDomain(hn)) ) {
                    const domains = rule.condition[missProp].filter(
                        hn => isUnsupportedDomain(hn) === false
                    );
                    rule.condition[missProp] =
                        domains.length !== 0
                            ? domains
                            : undefined;
                }
            }
        }
    }

    // Patch modifier filters
    for ( const rule of ruleset ) {
        if ( rule.__modifierType === undefined ) { continue; }
        let patchDomainOption = false;
        switch ( rule.__modifierType ) {
        case 'csp':
            rule.action.type = 'modifyHeaders';
            rule.action.responseHeaders = [{
                header: 'content-security-policy',
                operation: 'append',
                value: rule.__modifierValue,
            }];
            if ( rule.__modifierAction !== ALLOW_REALM ) { break; }
            // Use low-priority "allow" to implement csp allow filter
            rule.action.type = 'allow';
            rule.action.responseHeaders = undefined;
            break;
        case 'permissions':
            rule.action.type = 'modifyHeaders';
            rule.action.responseHeaders = [{
                header: 'permissions-policy',
                operation: 'append',
                value: rule.__modifierValue.split('|').join(', '),
            }];
            patchDomainOption = true;
            if ( rule.__modifierAction !== ALLOW_REALM ) { break; }
            // Use low-priority "allow" to implement permissions allow filter
            rule.action.type = 'allow';
            rule.action.responseHeaders = undefined;
            break;
        case 'redirect-rule': {
            let token = rule.__modifierValue;
            if ( token !== '' ) {
                const match = /:(\d+)$/.exec(token);
                if ( match !== null ) {
                    rule.priority += Math.min(parseInt(match[1], 10), 8);
                    token = token.slice(0, match.index);
                }
            }
            const resource = context.extensionPaths.get(token);
            if ( rule.__modifierValue !== '' && resource === undefined ) {
                dnrAddRuleError(rule, `Unpatchable redirect filter: ${rule.__modifierValue}`);
            }
            if ( rule.__modifierAction !== ALLOW_REALM ) {
                const extensionPath = resource || token;
                rule.action.type = 'redirect';
                rule.action.redirect = { extensionPath };
            } else {
                rule.action.type = 'block';
                rule.priority += 10;
            }
            break;
        }
        case 'removeparam': {
            rule.action.type = 'redirect';
            let paramName = rule.__modifierValue;
            if ( paramName === '|' ) {
                paramName = '';
            }
            if ( paramName !== '' ) {
                rule.action.redirect = {
                    transform: {
                        queryTransform: {
                            removeParams: [ paramName ]
                        }
                    }
                };
                if ( /^~?\/.+\/$/.test(paramName) ) {
                    dnrAddRuleError(rule, `Unsupported regex-based removeParam: ${paramName}`);
                }
            } else {
                rule.action.redirect = {
                    transform: {
                        query: ''
                    }
                };
            }
            rule.condition ||= {};
            const { condition } = rule;
            if ( condition.resourceTypes === undefined ) {
                if ( condition.excludedResourceTypes === undefined ) {
                    condition.resourceTypes = [
                        'image',
                        'main_frame',
                        'sub_frame',
                        'xmlhttprequest',
                    ];
                }
            }
            // https://github.com/uBlockOrigin/uBOL-home/discussions/575
            const { urlFilter } = condition;
            if ( urlFilter === undefined ) {
                if ( condition.regexFilter === undefined ) {
                    if ( paramName !== '' ) {
                        condition.urlFilter = `^${paramName}=`;
                    }
                }
            } else if ( urlFilter.startsWith('||') ) {
                if ( urlFilter.toLowerCase().includes(paramName.toLowerCase()) === false ) {
                    condition.urlFilter = `${condition.urlFilter}*^${paramName}=`;
                }
            }
            if ( rule.__modifierAction !== ALLOW_REALM ) { break; }
            // Use low-priority "allow" to implement removeparam allow filter
            rule.action.type = 'allow';
            rule.action.redirect = undefined;
            break;
        }
        case 'uritransform': {
            const parsed = sfp.parseReplaceByRegexValue(rule.__modifierValue);
            if ( parsed.re !== undefined ) {
                dnrAddRuleError(rule, `Incompatible with DNR: uritransform=${rule.__modifierValue}`);
                break;
            }
            if ( rule.condition.regexFilter === undefined ) {
                dnrAddRuleError(rule, `Incompatible with DNR (need regexFilter): uritransform=${rule.__modifierValue}`);
                break;
            }
            rule.action.type = 'redirect';
            rule.action.redirect = {
                regexSubstitution: parsed.replacement.replace(/\$(\d+)/g, '\\$1')
            };
            break;
        }
        case 'urlskip': {
            let urlFilter = rule.condition?.urlFilter;
            if ( urlFilter === undefined ) { break; }
            let anchor = 0b000;
            if ( urlFilter.startsWith('||') ) {
                anchor |= 0b100;
                urlFilter = urlFilter.slice(2);
            } else if ( urlFilter.startsWith('|') ) {
                anchor |= 0b10;
                urlFilter = urlFilter.slice(1);
            }
            if ( urlFilter.endsWith('|') ) {
                anchor |= 0b001;
                urlFilter = urlFilter.slice(0, -1);
            }
            rule.condition.urlFilter = undefined;
            rule.condition.regexFilter = restrFromGenericPattern(urlFilter, anchor);
            break;
        }
        default:
            dnrAddRuleError(rule, `Unsupported modifier ${rule.__modifierType}`);
            break;
        }

        // Some modifiers only work on document resources
        // Related issue: https://github.com/uBlockOrigin/uBOL-home/issues/156
        if ( patchDomainOption ) {
            const domains = rule.condition.initiatorDomains;
            if ( Array.isArray(domains) && domains.length !== 0 ) {
                rule.condition.requestDomains ||= [];
                rule.condition.requestDomains.push(...domains);
                rule.condition.initiatorDomains = undefined;
            }
            const notDomains = rule.condition.excludedInitiatorDomains;
            if ( Array.isArray(notDomains) && notDomains.length !== 0 ) {
                rule.condition.excludedRequestDomains ||= [];
                rule.condition.excludedRequestDomains.push(...notDomains);
                rule.condition.excludedInitiatorDomains = undefined;
            }
        }
    }

    // Default priority is 1, remove priority if 1 or less.
    for ( const rule of ruleset ) {
        if ( rule.priority > 1 ) { continue; }
        rule.priority = undefined;
    }

    return {
        ruleset,
        filterCount: context.filterCount,
        acceptedFilterCount: context.acceptedFilterCount,
        rejectedFilterCount: context.rejectedFilterCount,
        generichideExclusions: Array.from(new Set(generichideExclusions)),
        generichideInclusions: Array.from(new Set(generichideInclusions)),
    };
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.addFilterUnit = function(
    bits,
    tokenHash,
    inewunit
) {
    const bucket = this.bitsToBucket.get(bits) || (new Map());
    if ( bucket.size === 0 ) {
        this.bitsToBucket.set(bits, bucket);
    }
    const istoredunit = bucket.get(tokenHash) || 0;
    if ( istoredunit === 0 ) {
        bucket.set(tokenHash, inewunit);
        return;
    }
    if ( filterData[istoredunit+0] === FilterBucket.fid ) {
        FilterBucket.unshift(istoredunit, inewunit);
        return;
    }
    const ibucketunit = FilterBucket.create();
    FilterBucket.unshift(ibucketunit, istoredunit);
    FilterBucket.unshift(ibucketunit, inewunit);
    bucket.set(tokenHash, ibucketunit);
    this.unitsToOptimize.push({ bits, tokenHash });
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.optimize = function(throttle = 0) {
    if ( this.optimizeTaskId !== undefined ) {
        dropTask(this.optimizeTaskId);
        this.optimizeTaskId = undefined;
    }

    const later = throttle => {
        this.optimizeTaskId = queueTask(( ) => {
            this.optimizeTaskId = undefined;
            this.optimize(throttle);
        }, 1000);
    };

    const t0 = Date.now();
    while ( this.unitsToOptimize.length !== 0 ) {
        const { bits, tokenHash } = this.unitsToOptimize.pop();
        const bucket = this.bitsToBucket.get(bits);
        const iunit = bucket.get(tokenHash);
        const fc = filterGetClass(iunit);
        switch ( fc ) {
        case FilterHostnameDict:
            FilterHostnameDict.optimize(iunit);
            break;
        case FilterBucket: {
            const optimizeBits =
                (tokenHash === NO_TOKEN_HASH) || (bits & MODIFY_REALMS) !== 0
                    ? 0b10
                    : 0b01;
            const inewunit = FilterBucket.optimize(iunit, optimizeBits);
            if ( inewunit !== 0 ) {
                bucket.set(tokenHash, inewunit);
            }
            break;
        }
        default:
            break;
        }
        if ( throttle > 0 && (Date.now() - t0) > 40 ) {
            return later(throttle - 1);
        }
    }

    filterArgsToUnit.clear();

    // Here we do not optimize origHNTrieContainer because many origin-related
    // tries are instantiated on demand.
    keyvalStore.setItem(
        'SNFE.destHNTrieContainer.trieDetails',
        destHNTrieContainer.optimize()
    );
    filterDataShrink();
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.toSelfie = function() {
    this.optimize(0);
    bidiTrie.optimize();
    keyvalStore.setItem('SNFE.origHNTrieContainer.trieDetails',
        origHNTrieContainer.optimize()
    );
    return {
        version: this.selfieVersion,
        processedFilterCount: this.processedFilterCount,
        acceptedCount: this.acceptedCount,
        discardedCount: this.discardedCount,
        bitsToBucket: this.bitsToBucket,
        urlTokenizer: urlTokenizer.toSelfie(),
        destHNTrieContainer: destHNTrieContainer.toSelfie(),
        origHNTrieContainer: origHNTrieContainer.toSelfie(),
        bidiTrie: bidiTrie.toSelfie(),
        filterData: filterDataToSelfie(),
        filterRefs: filterRefsToSelfie(),
    };
};

StaticNetFilteringEngine.prototype.serialize = function() {
    return this.toSelfie();
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.fromSelfie = function(selfie) {
    if ( typeof selfie !== 'object' || selfie === null ) { return; }

    this.reset();

    this.notReady = true;

    const results = [
        destHNTrieContainer.fromSelfie(selfie.destHNTrieContainer),
        origHNTrieContainer.fromSelfie(selfie.origHNTrieContainer),
        bidiTrie.fromSelfie(selfie.bidiTrie),
        filterDataFromSelfie(selfie.filterData),
        filterRefsFromSelfie(selfie.filterRefs),
    ];
    if ( results.slice(1).every(v => v === true) === false ) { return false; }

    if ( selfie.version !== this.selfieVersion ) { return false; }
    this.processedFilterCount = selfie.processedFilterCount;
    this.acceptedCount = selfie.acceptedCount;
    this.discardedCount = selfie.discardedCount;
    this.bitsToBucket = selfie.bitsToBucket;
    urlTokenizer.fromSelfie(selfie.urlTokenizer);

    // If this point is never reached, it means the internal state is
    // unreliable, and the caller is then responsible for resetting the
    // engine and populate properly, in which case the `notReady` barrier
    // will be properly reset.

    this.notReady = false;

    return true;
};

StaticNetFilteringEngine.prototype.unserialize = function(selfie) {
    return this.fromSelfie(selfie);
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.createCompiler = function() {
    return new FilterCompiler();
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.fromCompiled = function(reader) {
    reader.select('NETWORK_FILTERS:GOOD');
    while ( reader.next() ) {
        this.acceptedCount += 1;
        if ( this.goodFilters.has(reader.line) ) {
            this.discardedCount += 1;
        } else {
            this.goodFilters.add(reader.line);
        }
    }

    reader.select('NETWORK_FILTERS:BAD');
    while ( reader.next() ) {
        this.badFilters.add(reader.line);
    }
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.matchAndFetchModifiers = function(
    fctxt,
    modifierName
) {
    if ( this.notReady ) { return; }

    const typeBits = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;

    resetRegisters(fctxt, typeBits);

    const modifierType = modifierTypeFromName.get(modifierName);
    const modifierBits = modifierBitsFromType.get(modifierType);

    const partyBits = fctxt.is3rdPartyToDoc() ? THIRDPARTY_REALM : FIRSTPARTY_REALM;

    const catBits00 = modifierBits;
    const catBits01 = modifierBits | typeBits;
    const catBits10 = modifierBits | partyBits;
    const catBits11 = modifierBits | typeBits | partyBits;

    const bucket00 = this.bitsToBucket.get(catBits00);
    const bucket01 = typeBits !== 0
        ? this.bitsToBucket.get(catBits01)
        : undefined;
    const bucket10 = partyBits !== 0
        ? this.bitsToBucket.get(catBits10)
        : undefined;
    const bucket11 = typeBits !== 0 && partyBits !== 0
        ? this.bitsToBucket.get(catBits11)
        : undefined;

    if (
        bucket00 === undefined && bucket01 === undefined &&
        bucket10 === undefined && bucket11 === undefined
    ) {
        return;
    }

    const results = [];
    const env = {
        type: modifierType || 0,
        bits: 0,
        th: 0,
        iunit: 0,
        results,
    };

    const tokenHashes = urlTokenizer.getTokens();
    let i = 0;
    let th = 0, iunit = 0;
    for (;;) {
        th = tokenHashes[i];
        if ( th === INVALID_TOKEN_HASH ) { break; }
        env.th = th;
        $tokenBeg = tokenHashes[i+1];
        if (
            (bucket00 !== undefined) &&
            (iunit = bucket00.get(th) || 0) !== 0
        ) {
            env.bits = catBits00; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (bucket01 !== undefined) &&
            (iunit = bucket01.get(th) || 0) !== 0
        ) {
            env.bits = catBits01; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (bucket10 !== undefined) &&
            (iunit = bucket10.get(th) || 0) !== 0
        ) {
            env.bits = catBits10; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        if (
            (bucket11 !== undefined) &&
            (iunit = bucket11.get(th) || 0) !== 0
        ) {
            env.bits = catBits11; env.iunit = iunit;
            filterMatchAndFetchModifiers(iunit, env);
        }
        i += 2;
    }

    if ( results.length === 0 ) { return; }

    // One single result is expected to be a common occurrence, and in such
    // case there is no need to process exception vs. block, block important
    // occurrences.
    if ( results.length === 1 ) {
        const result = results[0];
        if ( (result.bits & ALLOW_REALM) !== 0 ) { return; }
        return [ result ];
    }

    const toAddImportant = new Map();
    const toAdd = new Map();
    const toRemove = new Map();

    for ( const result of results ) {
        const actionBits = result.bits & BLOCKALLOW_REALM;
        const modifyValue = result.value;
        if ( actionBits === BLOCKIMPORTANT_REALM ) {
            toAddImportant.set(modifyValue, result);
        } else if ( actionBits === BLOCK_REALM ) {
            toAdd.set(modifyValue, result);
        } else {
            toRemove.set(modifyValue, result);
        }
    }
    if ( toAddImportant.size === 0 && toAdd.size === 0 ) { return; }

    // Remove entries overridden by important block filters.
    if ( toAddImportant.size !== 0 ) {
        for ( const key of toAddImportant.keys() ) {
            toAdd.delete(key);
            toRemove.delete(key);
        }
    }

    // Exception filters
    //
    // Remove excepted block filters and unused exception filters.
    //
    // Special case, except-all:
    // - Except-all applies only if there is at least one normal block filters.
    // - Except-all does not apply to important block filters.
    if ( toRemove.size !== 0 ) {
        if ( toRemove.has('') === false ) {
            for ( const key of toRemove.keys() ) {
                if ( toAdd.has(key) ) {
                    toAdd.delete(key);
                } else {
                    toRemove.delete(key);
                }
            }
        } else if ( toAdd.size !== 0 ) {
            toAdd.clear();
            if ( toRemove.size !== 1 ) {
                const entry = toRemove.get('');
                toRemove.clear();
                toRemove.set('', entry);
            }
        } else {
            toRemove.clear();
        }
    }

    if (
        toAdd.size === 0 &&
        toAddImportant.size === 0 &&
        toRemove.size === 0
    ) {
        return;
    }

    const out = Array.from(toAdd.values());
    if ( toAddImportant.size !== 0 ) {
        out.push(...toAddImportant.values());
    }
    if ( toRemove.size !== 0 ) {
        out.push(...toRemove.values());
    }
    return out;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.realmMatchString = function(
    realmBits,
    typeBits,
    partyBits
) {
    if ( this.notReady ) { return false; }

    const exactType = typeBits & 0x80000000;
    typeBits &= 0x7FFFFFFF;

    const catBits00 = realmBits;
    const catBits01 = realmBits | typeBits;
    const catBits10 = realmBits | partyBits;
    const catBits11 = realmBits | typeBits | partyBits;

    const bucket00 = exactType === 0
        ? this.bitsToBucket.get(catBits00)
        : undefined;
    const bucket01 = exactType !== 0 || typeBits !== 0
        ? this.bitsToBucket.get(catBits01)
        : undefined;
    const bucket10 = exactType === 0 && partyBits !== 0
        ? this.bitsToBucket.get(catBits10)
        : undefined;
    const bucket11 = (exactType !== 0 || typeBits !== 0) && partyBits !== 0
        ? this.bitsToBucket.get(catBits11)
        : undefined;

    if (
        bucket00 === undefined && bucket01 === undefined &&
        bucket10 === undefined && bucket11 === undefined
    ) {
        return false;
    }

    let catBits = 0, iunit = 0;

    // Pure hostname-based filters
    let tokenHash = DOT_TOKEN_HASH;
    if (
        (bucket00 !== undefined) &&
        (iunit = bucket00.get(DOT_TOKEN_HASH) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits00;
    } else if (
        (bucket01 !== undefined) &&
        (iunit = bucket01.get(DOT_TOKEN_HASH) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits01;
    } else if (
        (bucket10 !== undefined) &&
        (iunit = bucket10.get(DOT_TOKEN_HASH) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits10;
    } else if (
        (bucket11 !== undefined) &&
        (iunit = bucket11.get(DOT_TOKEN_HASH) || 0) !== 0 &&
        (filterMatch(iunit) === true)
    ) {
        catBits = catBits11;
    }
    // Pattern-based filters
    else {
        const tokenHashes = urlTokenizer.getTokens();
        let i = 0;
        for (;;) {
            tokenHash = tokenHashes[i];
            if ( tokenHash === INVALID_TOKEN_HASH ) { return false; }
            $tokenBeg = tokenHashes[i+1];
            if (
                (bucket00 !== undefined) &&
                (iunit = bucket00.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits00;
                break;
            }
            if (
                (bucket01 !== undefined) &&
                (iunit = bucket01.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits01;
                break;
            }
            if (
                (bucket10 !== undefined) &&
                (iunit = bucket10.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits10;
                break;
            }
            if (
                (bucket11 !== undefined) &&
                (iunit = bucket11.get(tokenHash) || 0) !== 0 &&
                (filterMatch(iunit) === true)
            ) {
                catBits = catBits11;
                break;
            }
            i += 2;
        }
    }

    this.$catBits = catBits;
    this.$tokenHash = tokenHash;
    this.$filterUnit = iunit;
    return true;
};

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/116
//   Some type of requests are exceptional, they need custom handling,
//   not the generic handling.
// https://github.com/chrisaljoudi/uBlock/issues/519
//   Use exact type match for anything beyond `other`. Also, be prepared to
//   support unknown types.
// https://github.com/uBlockOrigin/uBlock-issues/issues/1501
//   Add support to evaluate allow realm before block realm.

/**
 * Matches a URL string using filtering context.
 * @param {FilteringContext} fctxt - The filtering context
 * @param {integer} [modifier=0] - A bit vector modifying the behavior of the
 *   matching algorithm:
 *   Bit 0: match exact type.
 *   Bit 1: lookup allow realm regardless of whether there was a match in
 *          block realm.
 *
 * @returns {integer} 0=no match, 1=block, 2=allow (exception)
 */
StaticNetFilteringEngine.prototype.matchRequest = function(fctxt, modifiers = 0) {
    let typeBits = typeNameToTypeValue[fctxt.type];
    if ( modifiers === 0 ) {
        if ( typeBits === undefined ) {
            typeBits = otherTypeBitValue;
        } else if ( typeBits === 0 || typeBits > otherTypeBitValue ) {
            modifiers |= 0b0001;
        }
    }
    if ( (modifiers & 0b0001) !== 0 ) {
        if ( typeBits === undefined ) { return 0; }
        typeBits |= 0x80000000;
    }

    const partyBits = fctxt.is3rdPartyToDoc() ? THIRDPARTY_REALM : FIRSTPARTY_REALM;

    resetRegisters(fctxt, typeBits);

    this.$filterUnit = 0;

    // Evaluate block realm before allow realm, and allow realm before
    // block-important realm, i.e. by order of likelihood of a match.
    const r = this.realmMatchString(BLOCK_REALM, typeBits, partyBits);
    if ( r || (modifiers & 0b0010) !== 0 ) {
        if ( $isBlockImportant ) { return 1; }
        if ( this.realmMatchString(ALLOW_REALM, typeBits, partyBits) ) {
            if ( this.realmMatchString(BLOCKIMPORTANT_REALM, typeBits, partyBits) ) {
                return 1;
            }
            return 2;
        }
        if ( r ) { return 1; }
    }
    return 0;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.matchHeaders = function(fctxt, ...headers) {
    const typeBits = typeNameToTypeValue[fctxt.type] || otherTypeBitValue;
    const partyBits = fctxt.is3rdPartyToDoc() ? THIRDPARTY_REALM : FIRSTPARTY_REALM;

    resetRegisters(fctxt, typeBits);

    $httpHeaders.init(...headers);

    this.$filterUnit = 0;

    let r = 0;
    if ( this.realmMatchString(HEADERS_REALM | BLOCK_REALM, typeBits, partyBits) ) {
        r = 1;
    }
    if ( r !== 0 && $isBlockImportant !== true ) {
        if ( this.realmMatchString(HEADERS_REALM | ALLOW_REALM, typeBits, partyBits) ) {
            r = 2;
        } else if ( this.realmMatchString(ALLOW_REALM, typeBits, partyBits) ) {
            r = 2;
        }
        if ( r === 2 ) {
            if ( this.realmMatchString(HEADERS_REALM | BLOCKIMPORTANT_REALM, typeBits, partyBits) ) {
                r = 1;
            }
        }
    }

    $httpHeaders.reset();

    return r;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.redirectRequest = function(redirectEngine, fctxt) {
    const directives = this.matchAndFetchModifiers(fctxt, 'redirect-rule');
    // No directive is the most common occurrence.
    if ( directives === undefined ) { return; }
    const highest = directives.length - 1;
    // More than a single directive means more work.
    if ( highest !== 0 ) {
        directives.sort((a, b) => compareRedirectRequests(redirectEngine, a, b));
    }
    // Redirect to highest-ranked directive
    const directive = directives[highest];
    if ( (directive.bits & ALLOW_REALM) !== 0 ) { return directives; }
    const { token } = parseRedirectRequestValue(directive);
    fctxt.redirectURL = redirectEngine.tokenToURL(fctxt, token);
    if ( fctxt.redirectURL === undefined ) { return; }
    return directives;
};

function parseRedirectRequestValue(directive) {
    if ( directive.cache === null ) {
        directive.cache = sfp.parseRedirectValue(directive.value);
    }
    return directive.cache;
}

function compareRedirectRequests(redirectEngine, a, b) {
    const { token: atok, priority: aint, bits: abits } =
        parseRedirectRequestValue(a);
    if ( redirectEngine.hasToken(atok) === false ) { return -1; }
    const { token: btok, priority: bint, bits: bbits } =
        parseRedirectRequestValue(b);
    if ( redirectEngine.hasToken(btok) === false ) { return 1; }
    if ( abits !== bbits ) {
        if ( (abits & IMPORTANT_REALM) !== 0 ) { return 1; }
        if ( (bbits & IMPORTANT_REALM) !== 0 ) { return -1; }
        if ( (abits & ALLOW_REALM) !== 0 ) { return -1; }
        if ( (bbits & ALLOW_REALM) !== 0 ) { return 1; }
    }
    return aint - bint;
}

/******************************************************************************/

StaticNetFilteringEngine.prototype.transformURL = function(fctxt, out = []) {
    const directives = this.matchAndFetchModifiers(fctxt, 'uritransform');
    if ( directives === undefined ) { return; }
    const redirectURL = new URL(fctxt.url);
    for ( const directive of directives ) {
        if ( (directive.bits & ALLOW_REALM) !== 0 ) {
            out.push(directive);
            continue;
        }
        if ( directive.cache === null ) {
            directive.cache = sfp.parseReplaceByRegexValue(directive.value);
        }
        const cache = directive.cache;
        if ( cache === undefined ) { continue; }
        let { re } = cache;
        const before = redirectURL.href;
        if ( re === undefined ) {
            const logdata = directive.logData();
            if ( logdata === undefined ) { continue; }
            try { re = new RegExp(logdata.regex, cache.flags); }
            catch { continue; }
        }
        if ( re.test(before) !== true ) { continue; }
        const after = before.replace(re, cache.replacement);
        try { void new URL(after); } catch { continue; }
        if ( after === before ) { continue; }
        redirectURL.href = after;
        out.push(directive);
        break;
    }
    if ( out.length === 0 ) { return; }
    if ( redirectURL.href !== fctxt.url ) {
        fctxt.redirectURL = redirectURL.href;
    }
    return out;
};

StaticNetFilteringEngine.prototype.urlSkip = function(
    fctxt,
    blocked,
    out = []
) {
    if ( fctxt.redirectURL !== undefined ) { return; }
    const directives = this.matchAndFetchModifiers(fctxt, 'urlskip');
    if ( directives === undefined ) { return; }
    for ( const directive of directives ) {
        if ( (directive.bits & ALLOW_REALM) !== 0 ) {
            out.push(directive);
            continue;
        }
        const urlin = fctxt.url;
        const value = directive.value;
        const steps = value.includes(' ') && value.split(/ +/) || [ value ];
        const urlout = urlSkip(urlin, blocked, steps, directive);
        if ( urlout === undefined ) { continue; }
        if ( urlout === urlin ) { continue; }
        fctxt.redirectURL = urlout;
        out.push(directive);
        break;
    }
    if ( out.length === 0 ) { return; }
    return out;
};

/******************************************************************************/

// https://github.com/uBlockOrigin/uBlock-issues/issues/1626
//   Do not redirect when the number of query parameters does not change.

StaticNetFilteringEngine.prototype.filterQuery = function(fctxt, out = []) {
    if ( fctxt.redirectURL !== undefined ) { return; }
    const directives = this.matchAndFetchModifiers(fctxt, 'removeparam');
    if ( directives === undefined ) { return; }
    const url = fctxt.url;
    const qpos = url.indexOf('?');
    if ( qpos === -1 ) { return; }
    let hpos = url.indexOf('#', qpos + 1);
    if ( hpos === -1 ) { hpos = url.length; }
    const params = [];
    const query = url.slice(qpos + 1, hpos);
    for ( let i = 0; i < query.length; ) {
        let pos = query.indexOf('&', i);
        if ( pos === -1 ) { pos = query.length; }
        const kv = query.slice(i, pos);
        i = pos + 1;
        pos = kv.indexOf('=');
        if ( pos !== -1 ) {
            params.push(kv.slice(0, pos), kv.slice(pos + 1));
        } else {
            params.push(kv, '');
        }
    }
    const beforeParamCount = params.length;
    for ( const directive of directives ) {
        if ( params.length === 0 ) { break; }
        const isException = (directive.bits & ALLOW_REALM) !== 0;
        if ( isException && directive.value === '' ) {
            out.push(directive);
            break;
        }
        const { all, bad, name, not, re } = parseQueryPruneValue(directive);
        if ( bad ) { continue; }
        if ( all ) {
            if ( isException === false ) { params.length = 0; }
            out.push(directive);
            break;
        }
        let filtered = false;
        let matched = false;
        let i = params.length;
        while ( i > 0 ) {
            i -= 2;
            if ( name !== undefined ) {
                matched = params[i] === name;
            } else if ( re !== undefined ) {
                const key = params[i+0];
                const raw = params[i+1];
                let value = raw;
                try { value = decodeURIComponent(value); }
                catch { }
                matched = re.test(`${key}=${value}`);
            }
            if ( matched === not ) { continue; }
            if ( isException === false ) {
                params.splice(i, 2);
            }
            filtered = true;
        }
        if ( filtered ) {
            out.push(directive);
        }
    }
    if ( out.length === 0 ) { return; }
    if ( params.length !== beforeParamCount ) {
        fctxt.redirectURL = url.slice(0, qpos);
        if ( params.length !== 0 ) {
            const queryParts = [];
            for ( let i = 0; i < params.length; i += 2 ) {
                const key = params[i+0];
                const val = params[i+1];
                queryParts.push(val !== '' ? `${key}=${val}` : key);
            }
            fctxt.redirectURL += '?' + queryParts.join('&');
        }
        if ( hpos !== url.length ) {
            fctxt.redirectURL += url.slice(hpos);
        }
    }
    return out;
};

function parseQueryPruneValue(directive) {
    if ( directive.cache === null ) {
        directive.cache =
            sfp.parseQueryPruneValue(directive.value);
    }
    return directive.cache;
}

/******************************************************************************/

StaticNetFilteringEngine.prototype.hasQuery = function(fctxt) {
    urlTokenizer.setURL(fctxt.url);
    return urlTokenizer.hasQuery();
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.toLogData = function() {
    if ( this.$filterUnit !== 0 ) {
        return new LogData(this.$catBits, this.$tokenHash, this.$filterUnit);
    }
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.isBlockImportant = function() {
    return this.$filterUnit !== 0 && $isBlockImportant;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.getFilterCount = function() {
    return this.acceptedCount - this.discardedCount;
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.enableWASM = function(wasmModuleFetcher, path) {
    return Promise.all([
        bidiTrie.enableWASM(wasmModuleFetcher, path),
        origHNTrieContainer.enableWASM(wasmModuleFetcher, path),
        destHNTrieContainer.enableWASM(wasmModuleFetcher, path),
    ]).then(results => {
        return results.every(a => a === true);
    });
};

/******************************************************************************/

StaticNetFilteringEngine.prototype.test = function(details) {
    const { url, type, from, redirectEngine } = details;
    if ( url === undefined ) { return; }
    const fctxt = new FilteringContext();
    fctxt.setURL(url);
    fctxt.setType(type || '');
    fctxt.setDocOriginFromURL(from || '');
    const r = this.matchRequest(fctxt);
    const out = [ `url: ${url}` ];
    if ( type ) {
        out.push(`type: ${type}`);
    }
    if ( from ) {
        out.push(`context: ${from}`);
    }
    if ( r !== 0 ) {
        const logdata = this.toLogData();
        if ( r === 1 ) {
            out.push(`blocked: ${logdata.raw}`);
        } else if ( r === 2 ) {
            out.push(`unblocked: ${logdata.raw}`);
        }
    } else {
        out.push('not blocked');
    }
    if ( r !== 1 ) {
        const entries = this.transformURL(fctxt);
        if ( entries ) {
            for ( const entry of entries ) {
                out.push(`modified: ${entry.logData().raw}`);
            }
        }
        if ( fctxt.redirectURL !== undefined && this.hasQuery(fctxt) ) {
            const entries = this.filterQuery(fctxt, 'removeparam');
            if ( entries ) {
                for ( const entry of entries ) {
                    out.push(`modified: ${entry.logData().raw}`);
                }
            }
        }
        if ( fctxt.type === 'main_frame' || fctxt.type === 'sub_frame' ) {
            const csps = this.matchAndFetchModifiers(fctxt, 'csp');
            if ( csps ) {
                for ( const csp of csps ) {
                    out.push(`modified: ${csp.logData().raw}`);
                }
            }
            const pps = this.matchAndFetchModifiers(fctxt, 'permissions');
            if ( pps ) {
                for ( const pp of pps ) {
                    out.push(`modified: ${pp.logData().raw}`);
                }
            }
        }
    } else if ( redirectEngine ) {
        const redirects = this.redirectRequest(redirectEngine, fctxt);
        if ( redirects ) {
            for ( const redirect of redirects ) {
                out.push(`modified: ${redirect.logData().raw}`);
            }
        }
    }
    const urlskips = this.matchAndFetchModifiers(fctxt, 'urlskip');
    if ( urlskips ) {
        for ( const urlskip of urlskips ) {
            out.push(`modified: ${urlskip.logData().raw}`);
        }
    }
    return out.join('\n');
}

/******************************************************************************/

StaticNetFilteringEngine.prototype.bucketHistogram = function() {
    const results = [];
    for ( const [ bits, bucket ] of this.bitsToBucket ) {
        for ( const [ th, iunit ] of bucket ) {
            const token = urlTokenizer.stringFromTokenHash(th);
            const fc = filterGetClass(iunit);
            const count = fc.getCount !== undefined ? fc.getCount(iunit) : 1;
            results.push({ bits: bits.toString(16), token, count, f: fc.name });
        }
    }
    results.sort((a, b) => {
        return b.count - a.count;
    });
    console.info(results);
};

/******************************************************************************/

// Dump the internal state of the filtering engine to the console.
// Useful to make development decisions and investigate issues.

StaticNetFilteringEngine.prototype.dump = function() {
    const thConstants = new Map([
        [ NO_TOKEN_HASH, 'NO_TOKEN_HASH' ],
        [ DOT_TOKEN_HASH, 'DOT_TOKEN_HASH' ],
        [ ANY_TOKEN_HASH, 'ANY_TOKEN_HASH' ],
        [ ANY_HTTPS_TOKEN_HASH, 'ANY_HTTPS_TOKEN_HASH' ],
        [ ANY_HTTP_TOKEN_HASH, 'ANY_HTTP_TOKEN_HASH' ],
        [ EMPTY_TOKEN_HASH, 'EMPTY_TOKEN_HASH' ],
    ]);

    const out = [];

    const toOutput = (depth, line) => {
        out.push(`${' '.repeat(depth*2)}${line}`);
    };

    const dumpUnit = (idata, depth = 0) => {
        const fc = filterGetClass(idata);
        fcCounts.set(fc.name, (fcCounts.get(fc.name) || 0) + 1);
        const info = filterDumpInfo(idata) || '';
        toOutput(depth, info !== '' ? `${fc.name}: ${info}` : fc.name);
        switch ( fc ) {
        case FilterBucket:
        case FilterCompositeAll:
        case FilterDomainHitAny: {
            fc.forEach(idata, i => {
                dumpUnit(i, depth+1);
            });
            break;
        }
        case FilterBucketIfOriginHits: {
            dumpUnit(filterData[idata+2], depth+1);
            dumpUnit(filterData[idata+1], depth+1);
            break;
        }
        case FilterBucketIfRegexHits: {
            dumpUnit(filterData[idata+1], depth+1);
            break;
        }
        case FilterPlainTrie: {
            for ( const details of bidiTrie.trieIterator(filterData[idata+1]) ) {
                toOutput(depth+1, details.pattern);
                let ix = details.iextra;
                if ( ix === 1 ) { continue; }
                for (;;) {
                    if ( ix === 0 ) { break; }
                    dumpUnit(filterData[ix+0], depth+2);
                    ix = filterData[ix+1];
                }
            }
            break;
        }
        default:
            break;
        }
    };

    const fcCounts = new Map();
    const thCounts = new Set();

    const realms = new Map([
        [ BLOCK_REALM, 'block' ],
        [ BLOCKIMPORTANT_REALM, 'block-important' ],
        [ ALLOW_REALM, 'unblock' ],
        [ REDIRECT_REALM, 'redirect' ],
        [ REMOVEPARAM_REALM, 'removeparam' ],
        [ CSP_REALM, 'csp' ],
        [ PERMISSIONS_REALM, 'permissions' ],
        [ URLTRANSFORM_REALM, 'uritransform' ],
        [ REPLACE_REALM, 'replace' ],
        [ URLSKIP_REALM, 'urlskip' ],
    ]);
    const partyness = new Map([
        [ ANYPARTY_REALM, 'any-party' ],
        [ FIRSTPARTY_REALM, '1st-party' ],
        [ THIRDPARTY_REALM, '3rd-party' ],
    ]);
    for ( const [ realmBits, realmName ] of realms ) {
        toOutput(1, `+ realm: ${realmName}`);
        for ( const [ partyBits, partyName ] of partyness ) {
            toOutput(2, `+ party: ${partyName}`);
            const processedTypeBits = new Set();
            for ( const typeName in typeNameToTypeValue ) {
                const typeBits = typeNameToTypeValue[typeName];
                if ( processedTypeBits.has(typeBits) ) { continue; }
                processedTypeBits.add(typeBits);
                const bits = realmBits | partyBits | typeBits;
                const bucket = this.bitsToBucket.get(bits);
                if ( bucket === undefined ) { continue; }
                const thCount = bucket.size;
                toOutput(3, `+ type: ${typeName} (${thCount})`);
                for ( const [ th, iunit ] of bucket) {
                    thCounts.add(th);
                    const ths = thConstants.has(th)
                        ? thConstants.get(th)
                        : `0x${th.toString(16)}`;
                    toOutput(4, `+ th: ${ths}`);
                    dumpUnit(iunit, 5);
                }
            }
        }
    }

    const knownTokens =
        urlTokenizer.knownTokens
                    .reduce((a, b) => b !== 0 ? a+1 : a, 0);

    out.unshift([
        'Static Network Filtering Engine internals:',
        `  Distinct token hashes: ${thCounts.size.toLocaleString('en')}`,
        `  Known-token sieve (Uint8Array): ${knownTokens.toLocaleString('en')} out of 65,536`,
        `  Filter data (Int32Array): ${filterDataWritePtr.toLocaleString('en')}`,
        `  Filter refs (JS array): ${filterRefsWritePtr.toLocaleString('en')}`,
        '  Origin trie container:',
        origHNTrieContainer.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '  Request trie container:',
        destHNTrieContainer.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '  Pattern trie container:',
        bidiTrie.dumpInfo().split('\n').map(a => `    ${a}`).join('\n'),
        '+ Filter class stats:',
        Array.from(fcCounts)
             .sort((a, b) => b[1] - a[1])
             .map(a => `    ${a[0]}: ${a[1].toLocaleString('en')}`)
             .join('\n'),
        '+ Filter tree:',
    ].join('\n'));
    return out.join('\n');
};

/******************************************************************************/

const staticNetFilteringEngine = new StaticNetFilteringEngine();

const __default = staticNetFilteringEngine;

return {default:__default};
},1:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2020-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

const cssTree = require(2);
const { ArglistParser } = require(3);
const { JSONPath } = require(4);

/*******************************************************************************
 * 
 * The parser creates a simple unidirectional AST from a raw line of text.
 * Each node in the AST is a sequence of numbers, so as to avoid the need to
 * make frequent memory allocation to represent the AST.
 * 
 * All the AST nodes are allocated in the same integer-only array, which
 * array is reused when parsing new lines.
 * 
 * The AST can only be walked from top to bottom, then left to right.
 * 
 * Each node typically refer to a corresponding string slice in the source
 * text.
 *
 * It may happens a node requires to normalize the corresponding source slice,
 * in which case there will be a reference in the AST to a transformed source
 * string. (For example, a domain name might contain unicode characters, in
 * which case the corresponding node will contain a reference to the
 * (transformed) punycoded version of the domain name.)
 * 
 * The AST can be easily used for syntax coloring purpose, in which case it's
 * just a matter of walking through all the nodes in natural order.
 * 
 * A tree walking utility class exists for compilation and syntax coloring
 * purpose.
 * 
**/

/******************************************************************************/

let iota = 0;

iota = 0;
const AST_TYPE_NONE                            = iota++;
const AST_TYPE_UNKNOWN                         = iota++;
const AST_TYPE_COMMENT                         = iota++;
const AST_TYPE_NETWORK                         = iota++;
const AST_TYPE_EXTENDED                        = iota++;

iota = 0;
const AST_TYPE_NETWORK_PATTERN_ANY             = iota++;
const AST_TYPE_NETWORK_PATTERN_HOSTNAME        = iota++;
const AST_TYPE_NETWORK_PATTERN_PLAIN           = iota++;
const AST_TYPE_NETWORK_PATTERN_REGEX           = iota++;
const AST_TYPE_NETWORK_PATTERN_GENERIC         = iota++;
const AST_TYPE_NETWORK_PATTERN_BAD             = iota++;
const AST_TYPE_EXTENDED_COSMETIC               = iota++;
const AST_TYPE_EXTENDED_SCRIPTLET              = iota++;
const AST_TYPE_EXTENDED_HTML                   = iota++;
const AST_TYPE_EXTENDED_RESPONSEHEADER         = iota++;
const AST_TYPE_COMMENT_PREPARSER               = iota++;

iota = 0;
const AST_FLAG_UNSUPPORTED                     = 1 << iota++;
const AST_FLAG_IGNORE                          = 1 << iota++;
const AST_FLAG_HAS_ERROR                       = 1 << iota++;
const AST_FLAG_IS_EXCEPTION                    = 1 << iota++;
const AST_FLAG_EXT_STRONG                      = 1 << iota++;
const AST_FLAG_EXT_STYLE                       = 1 << iota++;
const AST_FLAG_EXT_SCRIPTLET_ADG               = 1 << iota++;
const AST_FLAG_NET_PATTERN_LEFT_HNANCHOR       = 1 << iota++;
const AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR    = 1 << iota++;
const AST_FLAG_NET_PATTERN_LEFT_ANCHOR         = 1 << iota++;
const AST_FLAG_NET_PATTERN_RIGHT_ANCHOR        = 1 << iota++;
const AST_FLAG_HAS_OPTIONS                     = 1 << iota++;

iota = 0;
const AST_ERROR_NONE                           = 1 << iota++;
const AST_ERROR_REGEX                          = 1 << iota++;
const AST_ERROR_PATTERN                        = 1 << iota++;
const AST_ERROR_DOMAIN_NAME                    = 1 << iota++;
const AST_ERROR_OPTION_DUPLICATE               = 1 << iota++;
const AST_ERROR_OPTION_UNKNOWN                 = 1 << iota++;
const AST_ERROR_OPTION_BADVALUE                = 1 << iota++;
const AST_ERROR_OPTION_EXCLUDED                = 1 << iota++;
const AST_ERROR_IF_TOKEN_UNKNOWN               = 1 << iota++;
const AST_ERROR_UNTRUSTED_SOURCE               = 1 << iota++;
const AST_ERROR_CAPABILITY                     = 1 << iota++;

iota = 0;
const NODE_RIGHT_INDEX                                = iota++;
const NOOP_NODE_SIZE                                  = iota;
const NODE_TYPE_INDEX                                 = iota++;
const NODE_DOWN_INDEX                                 = iota++;
const NODE_BEG_INDEX                                  = iota++;
const NODE_END_INDEX                                  = iota++;
const NODE_FLAGS_INDEX                                = iota++;
const NODE_TRANSFORM_INDEX                            = iota++;
const FULL_NODE_SIZE                                  = iota;

iota = 0;
const NODE_TYPE_NOOP                           = iota++;
const NODE_TYPE_LINE_RAW                       = iota++;
const NODE_TYPE_LINE_BODY                      = iota++;
const NODE_TYPE_WHITESPACE                     = iota++;
const NODE_TYPE_COMMENT                        = iota++;
const NODE_TYPE_IGNORE                         = iota++;
const NODE_TYPE_EXT_RAW                        = iota++;
const NODE_TYPE_EXT_OPTIONS_ANCHOR             = iota++;
const NODE_TYPE_EXT_OPTIONS                    = iota++;
const NODE_TYPE_EXT_DECORATION                 = iota++;
const NODE_TYPE_EXT_PATTERN_RAW                = iota++;
const NODE_TYPE_EXT_PATTERN_COSMETIC           = iota++;
const NODE_TYPE_EXT_PATTERN_HTML               = iota++;
const NODE_TYPE_EXT_PATTERN_RESPONSEHEADER     = iota++;
const NODE_TYPE_EXT_PATTERN_SCRIPTLET          = iota++;
const NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN    = iota++;
const NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARGS     = iota++;
const NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG      = iota++;
const NODE_TYPE_NET_RAW                        = iota++;
const NODE_TYPE_NET_EXCEPTION                  = iota++;
const NODE_TYPE_NET_PATTERN_RAW                = iota++;
const NODE_TYPE_NET_PATTERN                    = iota++;
const NODE_TYPE_NET_PATTERN_PART               = iota++;
const NODE_TYPE_NET_PATTERN_PART_SPECIAL       = iota++;
const NODE_TYPE_NET_PATTERN_PART_UNICODE       = iota++;
const NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR      = iota++;
const NODE_TYPE_NET_PATTERN_LEFT_ANCHOR        = iota++;
const NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR       = iota++;
const NODE_TYPE_NET_OPTIONS_ANCHOR             = iota++;
const NODE_TYPE_NET_OPTIONS                    = iota++;
const NODE_TYPE_NET_OPTION_SEPARATOR           = iota++;
const NODE_TYPE_NET_OPTION_SENTINEL            = iota++;
const NODE_TYPE_NET_OPTION_RAW                 = iota++;
const NODE_TYPE_NET_OPTION_NAME_NOT            = iota++;
const NODE_TYPE_NET_OPTION_NAME_UNKNOWN        = iota++;
const NODE_TYPE_NET_OPTION_NAME_1P             = iota++;
const NODE_TYPE_NET_OPTION_NAME_STRICT1P       = iota++;
const NODE_TYPE_NET_OPTION_NAME_3P             = iota++;
const NODE_TYPE_NET_OPTION_NAME_STRICT3P       = iota++;
const NODE_TYPE_NET_OPTION_NAME_ALL            = iota++;
const NODE_TYPE_NET_OPTION_NAME_BADFILTER      = iota++;
const NODE_TYPE_NET_OPTION_NAME_CNAME          = iota++;
const NODE_TYPE_NET_OPTION_NAME_CSP            = iota++;
const NODE_TYPE_NET_OPTION_NAME_CSS            = iota++;
const NODE_TYPE_NET_OPTION_NAME_DENYALLOW      = iota++;
const NODE_TYPE_NET_OPTION_NAME_DOC            = iota++;
const NODE_TYPE_NET_OPTION_NAME_EHIDE          = iota++;
const NODE_TYPE_NET_OPTION_NAME_EMPTY          = iota++;
const NODE_TYPE_NET_OPTION_NAME_FONT           = iota++;
const NODE_TYPE_NET_OPTION_NAME_FRAME          = iota++;
const NODE_TYPE_NET_OPTION_NAME_FROM           = iota++;
const NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK   = iota++;
const NODE_TYPE_NET_OPTION_NAME_GHIDE          = iota++;
const NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER = iota++;
const NODE_TYPE_NET_OPTION_NAME_IMAGE          = iota++;
const NODE_TYPE_NET_OPTION_NAME_IMPORTANT      = iota++;
const NODE_TYPE_NET_OPTION_NAME_INLINEFONT     = iota++;
const NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT   = iota++;
const NODE_TYPE_NET_OPTION_NAME_IPADDRESS      = iota++;
const NODE_TYPE_NET_OPTION_NAME_MATCHCASE      = iota++;
const NODE_TYPE_NET_OPTION_NAME_MEDIA          = iota++;
const NODE_TYPE_NET_OPTION_NAME_METHOD         = iota++;
const NODE_TYPE_NET_OPTION_NAME_MP4            = iota++;
const NODE_TYPE_NET_OPTION_NAME_NOOP           = iota++;
const NODE_TYPE_NET_OPTION_NAME_OBJECT         = iota++;
const NODE_TYPE_NET_OPTION_NAME_OTHER          = iota++;
const NODE_TYPE_NET_OPTION_NAME_PERMISSIONS    = iota++;
const NODE_TYPE_NET_OPTION_NAME_PING           = iota++;
const NODE_TYPE_NET_OPTION_NAME_POPUNDER       = iota++;
const NODE_TYPE_NET_OPTION_NAME_POPUP          = iota++;
const NODE_TYPE_NET_OPTION_NAME_REASON         = iota++;
const NODE_TYPE_NET_OPTION_NAME_REDIRECT       = iota++;
const NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE   = iota++;
const NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM    = iota++;
const NODE_TYPE_NET_OPTION_NAME_REPLACE        = iota++;
const NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER  = iota++;
const NODE_TYPE_NET_OPTION_NAME_SCRIPT         = iota++;
const NODE_TYPE_NET_OPTION_NAME_SHIDE          = iota++;
const NODE_TYPE_NET_OPTION_NAME_TO             = iota++;
const NODE_TYPE_NET_OPTION_NAME_TOP            = iota++;
const NODE_TYPE_NET_OPTION_NAME_URLSKIP        = iota++;
const NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM   = iota++;
const NODE_TYPE_NET_OPTION_NAME_XHR            = iota++;
const NODE_TYPE_NET_OPTION_NAME_WEBRTC         = iota++;
const NODE_TYPE_NET_OPTION_NAME_WEBSOCKET      = iota++;
const NODE_TYPE_NET_OPTION_ASSIGN              = iota++;
const NODE_TYPE_NET_OPTION_QUOTE               = iota++;
const NODE_TYPE_NET_OPTION_VALUE               = iota++;
const NODE_TYPE_OPTION_VALUE_DOMAIN_LIST       = iota++;
const NODE_TYPE_OPTION_VALUE_DOMAIN_RAW        = iota++;
const NODE_TYPE_OPTION_VALUE_NOT               = iota++;
const NODE_TYPE_OPTION_VALUE_DOMAIN            = iota++;
const NODE_TYPE_OPTION_VALUE_SEPARATOR         = iota++;
const NODE_TYPE_PREPARSE_DIRECTIVE             = iota++;
const NODE_TYPE_PREPARSE_DIRECTIVE_VALUE       = iota++;
const NODE_TYPE_PREPARSE_DIRECTIVE_IF          = iota++;
const NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE    = iota++;
const NODE_TYPE_COMMENT_URL                    = iota++;
const NODE_TYPE_COUNT                          = iota;

iota = 0;
const NODE_FLAG_IGNORE                         = 1 << iota++;
const NODE_FLAG_ERROR                          = 1 << iota++;
const NODE_FLAG_IS_NEGATED                     = 1 << iota++;
const NODE_FLAG_OPTION_HAS_VALUE               = 1 << iota++;
const NODE_FLAG_PATTERN_UNTOKENIZABLE          = 1 << iota++;

const nodeTypeFromOptionName = new Map([
    [ '', NODE_TYPE_NET_OPTION_NAME_UNKNOWN ],
    [ '1p', NODE_TYPE_NET_OPTION_NAME_1P ],
    /* synonym */ [ 'first-party', NODE_TYPE_NET_OPTION_NAME_1P ],
    [ 'strict1p', NODE_TYPE_NET_OPTION_NAME_STRICT1P ],
    /* synonym */ [ 'strict-first-party', NODE_TYPE_NET_OPTION_NAME_STRICT1P ],
    [ '3p', NODE_TYPE_NET_OPTION_NAME_3P ],
    /* synonym */ [ 'third-party', NODE_TYPE_NET_OPTION_NAME_3P ],
    [ 'strict3p', NODE_TYPE_NET_OPTION_NAME_STRICT3P ],
    /* synonym */ [ 'strict-third-party', NODE_TYPE_NET_OPTION_NAME_STRICT3P ],
    [ 'all', NODE_TYPE_NET_OPTION_NAME_ALL ],
    [ 'badfilter', NODE_TYPE_NET_OPTION_NAME_BADFILTER ],
    [ 'cname', NODE_TYPE_NET_OPTION_NAME_CNAME ],
    [ 'csp', NODE_TYPE_NET_OPTION_NAME_CSP ],
    [ 'css', NODE_TYPE_NET_OPTION_NAME_CSS ],
    /* synonym */ [ 'stylesheet', NODE_TYPE_NET_OPTION_NAME_CSS ],
    [ 'denyallow', NODE_TYPE_NET_OPTION_NAME_DENYALLOW ],
    [ 'doc', NODE_TYPE_NET_OPTION_NAME_DOC ],
    /* synonym */ [ 'document', NODE_TYPE_NET_OPTION_NAME_DOC ],
    [ 'ehide', NODE_TYPE_NET_OPTION_NAME_EHIDE ],
    /* synonym */ [ 'elemhide', NODE_TYPE_NET_OPTION_NAME_EHIDE ],
    [ 'empty', NODE_TYPE_NET_OPTION_NAME_EMPTY ],
    [ 'font', NODE_TYPE_NET_OPTION_NAME_FONT ],
    [ 'frame', NODE_TYPE_NET_OPTION_NAME_FRAME ],
    /* synonym */ [ 'subdocument', NODE_TYPE_NET_OPTION_NAME_FRAME ],
    [ 'from', NODE_TYPE_NET_OPTION_NAME_FROM ],
    /* synonym */ [ 'domain', NODE_TYPE_NET_OPTION_NAME_FROM ],
    [ 'genericblock', NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK ],
    [ 'ghide', NODE_TYPE_NET_OPTION_NAME_GHIDE ],
    /* synonym */ [ 'generichide', NODE_TYPE_NET_OPTION_NAME_GHIDE ],
    [ 'image', NODE_TYPE_NET_OPTION_NAME_IMAGE ],
    [ 'important', NODE_TYPE_NET_OPTION_NAME_IMPORTANT ],
    [ 'inline-font', NODE_TYPE_NET_OPTION_NAME_INLINEFONT ],
    [ 'inline-script', NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT ],
    [ 'ipaddress', NODE_TYPE_NET_OPTION_NAME_IPADDRESS ],
    [ 'match-case', NODE_TYPE_NET_OPTION_NAME_MATCHCASE ],
    [ 'media', NODE_TYPE_NET_OPTION_NAME_MEDIA ],
    [ 'method', NODE_TYPE_NET_OPTION_NAME_METHOD ],
    [ 'mp4', NODE_TYPE_NET_OPTION_NAME_MP4 ],
    [ '_', NODE_TYPE_NET_OPTION_NAME_NOOP ],
    [ 'object', NODE_TYPE_NET_OPTION_NAME_OBJECT ],
    /* synonym */ [ 'object-subrequest', NODE_TYPE_NET_OPTION_NAME_OBJECT ],
    [ 'other', NODE_TYPE_NET_OPTION_NAME_OTHER ],
    [ 'permissions', NODE_TYPE_NET_OPTION_NAME_PERMISSIONS ],
    [ 'ping', NODE_TYPE_NET_OPTION_NAME_PING ],
    /* synonym */ [ 'beacon', NODE_TYPE_NET_OPTION_NAME_PING ],
    [ 'popunder', NODE_TYPE_NET_OPTION_NAME_POPUNDER ],
    [ 'popup', NODE_TYPE_NET_OPTION_NAME_POPUP ],
    [ 'reason', NODE_TYPE_NET_OPTION_NAME_REASON ],
    [ 'redirect', NODE_TYPE_NET_OPTION_NAME_REDIRECT ],
    /* synonym */ [ 'rewrite', NODE_TYPE_NET_OPTION_NAME_REDIRECT ],
    [ 'redirect-rule', NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE ],
    [ 'removeparam', NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM ],
    [ 'replace', NODE_TYPE_NET_OPTION_NAME_REPLACE ],
    /* synonym */ [ 'queryprune', NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM ],
    [ 'requestheader', NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER ],
    [ 'responseheader', NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER ],
    /* synonym */ [ 'header', NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER ],
    [ 'script', NODE_TYPE_NET_OPTION_NAME_SCRIPT ],
    [ 'shide', NODE_TYPE_NET_OPTION_NAME_SHIDE ],
    /* synonym */ [ 'specifichide', NODE_TYPE_NET_OPTION_NAME_SHIDE ],
    [ 'to', NODE_TYPE_NET_OPTION_NAME_TO ],
    [ 'top', NODE_TYPE_NET_OPTION_NAME_TOP ],
    [ 'urlskip', NODE_TYPE_NET_OPTION_NAME_URLSKIP ],
    [ 'uritransform', NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM ],
    [ 'xhr', NODE_TYPE_NET_OPTION_NAME_XHR ],
    /* synonym */ [ 'xmlhttprequest', NODE_TYPE_NET_OPTION_NAME_XHR ],
    [ 'webrtc', NODE_TYPE_NET_OPTION_NAME_WEBRTC ],
    [ 'websocket', NODE_TYPE_NET_OPTION_NAME_WEBSOCKET ],
]);

const nodeNameFromNodeType = new Map([
    [ NODE_TYPE_NOOP, 'noop' ],
    [ NODE_TYPE_LINE_RAW, 'lineRaw' ],
    [ NODE_TYPE_LINE_BODY, 'lineBody' ],
    [ NODE_TYPE_WHITESPACE, 'whitespace' ],
    [ NODE_TYPE_COMMENT, 'comment' ],
    [ NODE_TYPE_IGNORE, 'ignore' ],
    [ NODE_TYPE_EXT_RAW, 'extRaw' ],
    [ NODE_TYPE_EXT_OPTIONS_ANCHOR, 'extOptionsAnchor' ],
    [ NODE_TYPE_EXT_OPTIONS, 'extOptions' ],
    [ NODE_TYPE_EXT_DECORATION, 'extDecoration' ],
    [ NODE_TYPE_EXT_PATTERN_RAW, 'extPatternRaw' ],
    [ NODE_TYPE_EXT_PATTERN_COSMETIC, 'extPatternCosmetic' ],
    [ NODE_TYPE_EXT_PATTERN_HTML, 'extPatternHtml' ],
    [ NODE_TYPE_EXT_PATTERN_RESPONSEHEADER, 'extPatternResponseheader' ],
    [ NODE_TYPE_EXT_PATTERN_SCRIPTLET, 'extPatternScriptlet' ],
    [ NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN, 'extPatternScriptletToken' ],
    [ NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARGS, 'extPatternScriptletArgs' ],
    [ NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG, 'extPatternScriptletArg' ],
    [ NODE_TYPE_NET_RAW, 'netRaw' ],
    [ NODE_TYPE_NET_EXCEPTION, 'netException' ],
    [ NODE_TYPE_NET_PATTERN_RAW, 'netPatternRaw' ],
    [ NODE_TYPE_NET_PATTERN, 'netPattern' ],
    [ NODE_TYPE_NET_PATTERN_PART, 'netPatternPart' ],
    [ NODE_TYPE_NET_PATTERN_PART_SPECIAL, 'netPatternPartSpecial' ],
    [ NODE_TYPE_NET_PATTERN_PART_UNICODE, 'netPatternPartUnicode' ],
    [ NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR, 'netPatternLeftHnanchor' ],
    [ NODE_TYPE_NET_PATTERN_LEFT_ANCHOR, 'netPatternLeftAnchor' ],
    [ NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR, 'netPatternRightAnchor' ],
    [ NODE_TYPE_NET_OPTIONS_ANCHOR, 'netOptionsAnchor' ],
    [ NODE_TYPE_NET_OPTIONS, 'netOptions' ],
    [ NODE_TYPE_NET_OPTION_RAW, 'netOptionRaw' ],
    [ NODE_TYPE_NET_OPTION_SEPARATOR, 'netOptionSeparator'],
    [ NODE_TYPE_NET_OPTION_SENTINEL, 'netOptionSentinel' ],
    [ NODE_TYPE_NET_OPTION_NAME_NOT, 'netOptionNameNot'],
    [ NODE_TYPE_NET_OPTION_ASSIGN, 'netOptionAssign' ],
    [ NODE_TYPE_NET_OPTION_VALUE, 'netOptionValue' ],
    [ NODE_TYPE_OPTION_VALUE_DOMAIN_LIST, 'netOptionValueDomainList' ],
    [ NODE_TYPE_OPTION_VALUE_DOMAIN_RAW, 'netOptionValueDomainRaw' ],
    [ NODE_TYPE_OPTION_VALUE_NOT, 'netOptionValueNot' ],
    [ NODE_TYPE_OPTION_VALUE_DOMAIN, 'netOptionValueDomain' ],
    [ NODE_TYPE_OPTION_VALUE_SEPARATOR, 'netOptionsValueSeparator' ],
]);
{
    for ( const [ name, type ] of nodeTypeFromOptionName ) {
        nodeNameFromNodeType.set(type, name);
    }
}

/******************************************************************************/

// Local constants

const DOMAIN_CAN_USE_WILDCARD        = 0b0000001;
const DOMAIN_CAN_USE_ENTITY          = 0b0000010;
const DOMAIN_CAN_USE_SINGLE_WILDCARD = 0b0000100;
const DOMAIN_CAN_BE_NEGATED          = 0b0001000;
const DOMAIN_CAN_BE_REGEX            = 0b0010000;
const DOMAIN_CAN_BE_ANCESTOR         = 0b0100000;
const DOMAIN_CAN_HAVE_PATH           = 0b1000000;

const DOMAIN_FROM_FROMTO_LIST = DOMAIN_CAN_USE_ENTITY |
    DOMAIN_CAN_BE_NEGATED |
    DOMAIN_CAN_BE_REGEX;
const DOMAIN_FROM_DENYALLOW_LIST = 0;
const DOMAIN_FROM_EXT_LIST = DOMAIN_CAN_USE_ENTITY |
    DOMAIN_CAN_USE_SINGLE_WILDCARD |
    DOMAIN_CAN_BE_NEGATED |
    DOMAIN_CAN_BE_REGEX |
    DOMAIN_CAN_BE_ANCESTOR |
    DOMAIN_CAN_HAVE_PATH;

/******************************************************************************/

// Precomputed AST layouts for most common filters.

const astTemplates = {
    // ||example.com^
    netHnAnchoredHostnameAscii: {
        flags: AST_FLAG_NET_PATTERN_LEFT_HNANCHOR |
            AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR,
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR,
                    beg: 0,
                    end: 2,
                }, {
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 2,
                    end: -1,
                    register: true,
                }, {
                    type: NODE_TYPE_NET_PATTERN_PART_SPECIAL,
                    beg: -1,
                    end: 0,
                }],
            }],
        }],
    },
    // ||example.com^$third-party
    net3pHnAnchoredHostnameAscii: {
        flags: AST_FLAG_NET_PATTERN_LEFT_HNANCHOR |
            AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR |
            AST_FLAG_HAS_OPTIONS,
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR,
                    beg: 0,
                    end: 2,
                }, {
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 2,
                    end: -13,
                    register: true,
                }, {
                    type: NODE_TYPE_NET_PATTERN_PART_SPECIAL,
                    beg: -13,
                    end: -12,
                }],
            }, {
                type: NODE_TYPE_NET_OPTIONS_ANCHOR,
                beg: -12,
                end: -11,
            }, {
                type: NODE_TYPE_NET_OPTIONS,
                beg: -11,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_NET_OPTION_RAW,
                    beg: 0,
                    end: 0,
                    children: [{
                        type: NODE_TYPE_NET_OPTION_NAME_3P,
                        beg: 0,
                        end: 0,
                        register: true,
                    }],
                }],
            }],
        }],
    },
    // ||example.com/path/to/resource
    netHnAnchoredPlainAscii: {
        flags: AST_FLAG_NET_PATTERN_LEFT_HNANCHOR,
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR,
                    beg: 0,
                    end: 2,
                }, {
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 2,
                    end: 0,
                    register: true,
                }],
            }],
        }],
    },
    // example.com
    // -resource.
    netPlainAscii: {
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 0,
                    end: 0,
                    register: true,
                }],
            }],
        }],
    },
    // 127.0.0.1 example.com
    netHosts1: {
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_IGNORE,
                    beg: 0,
                    end: 10,
                }, {
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 10,
                    end: 0,
                    register: true,
                }],
            }],
        }],
    },
    // 0.0.0.0 example.com
    netHosts2: {
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_NET_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_NET_PATTERN_RAW,
                beg: 0,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_IGNORE,
                    beg: 0,
                    end: 8,
                }, {
                    type: NODE_TYPE_NET_PATTERN,
                    beg: 8,
                    end: 0,
                    register: true,
                }],
            }],
        }],
    },
    // ##.ads-container
    extPlainGenericSelector: {
        type: NODE_TYPE_LINE_BODY,
        beg: 0,
        end: 0,
        children: [{
            type: NODE_TYPE_EXT_RAW,
            beg: 0,
            end: 0,
            children: [{
                type: NODE_TYPE_EXT_OPTIONS_ANCHOR,
                beg: 0,
                end: 2,
                register: true,
            }, {
                type: NODE_TYPE_EXT_PATTERN_RAW,
                beg: 2,
                end: 0,
                register: true,
                children: [{
                    type: NODE_TYPE_EXT_PATTERN_COSMETIC,
                    beg: 0,
                    end: 0,
                    register: true,
                }],
            }],
        }],
    },
};

/******************************************************************************/

const removableHTTPHeaders = new Set([
    'location',
    'refresh',
    'report-to',
    'set-cookie',
]);

const preparserIfTokens = new Set([
    'ext_ublock',
    'ext_ubol',
    'ext_devbuild',
    'env_brave',
    'env_chromium',
    'env_edge',
    'env_firefox',
    'env_legacy',
    'env_mobile',
    'env_mv3',
    'env_safari',
    'cap_html_filtering',
    'cap_ipaddress',
    'cap_user_stylesheet',
    'false',
    'ext_abp',
    'adguard',
    'adguard_app_android',
    'adguard_app_cli',
    'adguard_app_ios',
    'adguard_app_mac',
    'adguard_app_windows',
    'adguard_ext_android_cb',
    'adguard_ext_chromium',
    'adguard_ext_chromium_mv3',
    'adguard_ext_edge',
    'adguard_ext_firefox',
    'adguard_ext_opera',
    'adguard_ext_safari',
]);

/******************************************************************************/

const exCharCodeAt = (s, i) => {
    const pos = i >= 0 ? i : s.length + i;
    return pos >= 0 ? s.charCodeAt(pos) : -1;
};

const escapeForRegex = s =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/******************************************************************************/

class AstWalker {
    constructor(parser, from = 0) {
        this.parser = parser;
        this.stack = [];
        this.reset(from);
    }
    get depth() {
        return this.stackPtr;
    }
    reset(from = 0) {
        this.nodes = this.parser.nodes;
        this.stackPtr = 0;
        return (this.current = from || this.parser.rootNode);
    }
    next() {
        const current = this.current;
        if ( current === 0 ) { return 0; }
        const down = this.nodes[current+NODE_DOWN_INDEX];
        if ( down !== 0 ) {
            this.stack[this.stackPtr++] = this.current;
            return (this.current = down);
        }
        const right = this.nodes[current+NODE_RIGHT_INDEX];
        if ( right !== 0 && this.stackPtr !== 0 ) {
            return (this.current = right);
        }
        while ( this.stackPtr !== 0 ) {
            const parent = this.stack[--this.stackPtr];
            const right = this.nodes[parent+NODE_RIGHT_INDEX];
            if ( right !== 0 ) {
                return (this.current = right);
            }
        }
        return (this.current = 0);
    }
    right() {
        const current = this.current;
        if ( current === 0 ) { return 0; }
        const right = this.nodes[current+NODE_RIGHT_INDEX];
        if ( right !== 0 && this.stackPtr !== 0 ) {
            return (this.current = right);
        }
        while ( this.stackPtr !== 0 ) {
            const parent = this.stack[--this.stackPtr];
            const right = this.nodes[parent+NODE_RIGHT_INDEX];
            if ( right !== 0 ) {
                return (this.current = right);
            }
        }
        return (this.current = 0);
    }
    until(which) {
        let node = this.next();
        while ( node !== 0 ) {
            if ( this.nodes[node+NODE_TYPE_INDEX] === which ) { return node; }
            node = this.next();
        }
        return 0;
    }
    canGoDown() {
        return this.nodes[this.current+NODE_DOWN_INDEX] !== 0;
    }
    dispose() {
        this.parser.walkerJunkyard.push(this);
    }
}

/******************************************************************************/

class DomainListIterator {
    constructor(parser, root) {
        this.parser = parser;
        this.walker = parser.getWalker();
        this.value = undefined;
        this.item = { hn: '', not: false, bad: false };
        this.reuse(root);
    }
    next() {
        if ( this.done ) { return this.value; }
        let node = this.walker.current;
        let ready = false;
        while ( node !== 0 ) {
            switch ( this.parser.getNodeType(node) ) {
            case NODE_TYPE_OPTION_VALUE_DOMAIN_RAW:
                this.item.hn = '';
                this.item.not = false;
                this.item.bad = this.parser.getNodeFlags(node, NODE_FLAG_ERROR) !== 0;
                break;
            case NODE_TYPE_OPTION_VALUE_NOT:
                this.item.not = true;
                break;
            case NODE_TYPE_OPTION_VALUE_DOMAIN:
                this.item.hn = this.parser.getNodeTransform(node);
                this.value = this.item;
                ready = true;
                break;
            default:
                break;
            }
            node = this.walker.next();
            if ( ready ) { return this; }
        }
        return this.stop();
    }
    reuse(root) {
        this.walker.reset(root);
        this.done = false;
        return this;
    }
    stop() {
        this.done = true;
        this.value = undefined;
        this.parser.domainListIteratorJunkyard.push(this);
        return this;
    }
    [Symbol.iterator]() {
        return this;
    }
}

/******************************************************************************/

class AstFilterParser {
    constructor(options = {}) {
        this.raw = '';
        this.rawEnd = 0;
        this.nodes = new Uint32Array(16384);
        this.nodePoolPtr = FULL_NODE_SIZE;
        this.nodePoolEnd = this.nodes.length;
        this.astTransforms = [ null ];
        this.astTransformPtr = 1;
        this.rootNode = 0;
        this.astType = AST_TYPE_NONE;
        this.astTypeFlavor = AST_TYPE_NONE;
        this.astFlags = 0;
        this.astError = 0;
        this.nodeTypeRegister = [];
        this.nodeTypeRegisterPtr = 0;
        this.nodeTypeLookupTable = new Uint32Array(NODE_TYPE_COUNT);
        this.punycoder = new URL('https://ublock0.invalid/');
        this.domainListIteratorJunkyard = [];
        this.walkerJunkyard = [];
        this.hasWhitespace = false;
        this.hasUnicode = false;
        this.hasUppercase = false;
        // Options
        this.options = options;
        this.interactive = options.interactive || false;
        this.badTypes = new Set(options.badTypes || []);
        this.maxTokenLength = options.maxTokenLength || 7;
        // TODO: rethink this
        this.result = { exception: false, raw: '', compiled: '', error: undefined };
        this.selectorCompiler = new ExtSelectorCompiler(options);
        // Regexes
        this.reWhitespaceStart = /^\s+/;
        this.reWhitespaceEnd = /(?:^|\S)(\s+)$/;
        this.reCommentLine = /^(?:!|#\s|####|\[adblock)/i;
        this.reExtAnchor = /(#@?(?:\$\?|\$|%|\?)?#).{1,2}/;
        this.reInlineComment = /(?:\s+#).*?$/;
        this.reNetException = /^@@/;
        this.reNetAnchor = /(?:)\$[^,\w~]/;
        this.reHnAnchoredPlainAscii = /^\|\|[0-9a-z%&,\-./:;=?_]+$/;
        this.reHnAnchoredHostnameAscii = /^\|\|(?:[\da-z][\da-z_-]*\.)*[\da-z_-]*[\da-z]\^$/;
        this.reHnAnchoredHostnameUnicode = /^\|\|(?:[\p{L}\p{N}][\p{L}\p{N}\u{2d}]*\.)*[\p{L}\p{N}\u{2d}]*[\p{L}\p{N}]\^$/u;
        this.reHn3pAnchoredHostnameAscii = /^\|\|(?:[\da-z][\da-z_-]*\.)*[\da-z_-]*[\da-z]\^\$third-party$/;
        this.rePlainAscii = /^[0-9a-z%&\-./:;=?_]{2,}$/;
        this.reNetHosts1 = /^127\.0\.0\.1 (?:[\da-z][\da-z_-]*\.)+[\da-z-]*[a-z]$/;
        this.reNetHosts2 = /^0\.0\.0\.0 (?:[\da-z][\da-z_-]*\.)+[\da-z-]*[a-z]$/;
        this.rePlainGenericCosmetic = /^##[.#][A-Za-z_][\w-]*$/;
        this.reHostnameAscii = /^(?:[\da-z][\da-z_-]*\.)*[\da-z][\da-z-]*[\da-z]$/;
        this.rePlainEntity = /^(?:[\da-z][\da-z_-]*\.)+\*$/;
        this.reHostsSink = /^[\w%.:[\]-]+\s+/;
        this.reHostsRedirect = /(?:0\.0\.0\.0|broadcasthost|local|localhost(?:\.localdomain)?|ip6-\w+)(?:[^\w.-]|$)/;
        this.reNetOptionComma = /,(?:~?[13a-z-]+(?:=.*?)?|_+)(?:,|$)/;
        this.rePointlessLeftAnchor = /^\|\|?\*+/;
        this.rePointlessLeadingWildcards = /^(\*+)[^%0-9A-Za-z\u{a0}-\u{10FFFF}]/u;
        this.rePointlessTrailingSeparator = /\*(\^\**)$/;
        this.rePointlessTrailingWildcards = /(?:[^%0-9A-Za-z]|[%0-9A-Za-z]{7,})(\*+)$/;
        this.reHasWhitespaceChar = /\s/;
        this.reHasUppercaseChar = /[A-Z]/;
        this.reHasUnicodeChar = /[^\x00-\x7F]/;
        this.reUnicodeChars = /\P{ASCII}/gu;
        this.reBadHostnameChars = /[\x00-\x24\x26-\x29\x2b\x2c\x2f\x3b-\x40\x5c\x5e\x60\x7b-\x7f]/;
        this.reIsEntity = /^[^*]+\.\*$/;
        this.rePreparseDirectiveIf = /^!#if /;
        this.rePreparseDirectiveAny = /^!#(?:else|endif|if |include )/;
        this.reURL = /\bhttps?:\/\/\S+/;
        this.reHasPatternSpecialChars = /[*^]/;
        this.rePatternAllSpecialChars = /[*^]+|[^\x00-\x7f]+/g;
        // https://github.com/uBlockOrigin/uBlock-issues/issues/1146
        //   From https://codemirror.net/doc/manual.html#option_specialChars
        this.reHasInvalidChar = /[\x00-\x1F\x7F-\x9F\xAD\u061C\u200B-\u200F\u2028\u2029\uFEFF\uFFF9-\uFFFC]/;
        this.reHostnamePatternPart = /^[^\x00-\x24\x26-\x29\x2B\x2C\x2F\x3A-\x40\x5B-\x5E\x60\x7B-\x7F]+/;
        this.reHostnameLabel = /[^.]+/g;
        this.reResponseheaderPattern = /^\^responseheader\(.*\)$/;
        this.rePatternScriptletJsonArgs = /^\{.*\}$/;
        this.reBadCSP = /(?:^|[;,])\s*report-(?:to|uri)\b/i;
        this.reBadPP = /(?:^|[;,])\s*report-to\b/i;
        this.reNetOption = /^(~?)([134a-z_-]+)(=?)/;
        this.reNoopOption = /^_+$/;
        this.reAdvancedDomainSyntax = /^([^>]+?)(>>)?(\/.*)?$/;
        this.netOptionValueParser = new ArglistParser(',');
        this.scriptletArgListParser = new ArglistParser(',');
        this.domainRegexValueParser = new ArglistParser('/');
        this.reNetOptionTokens = new RegExp(
            `^~?(${Array.from(netOptionTokenDescriptors.keys())
                .map(s => escapeForRegex(s))
                .join('|')})\\b`
        );
    }

    finish() {
        this.selectorCompiler.finish();
    }

    parse(raw) {
        this.raw = raw;
        this.rawEnd = raw.length;
        this.nodePoolPtr = FULL_NODE_SIZE;
        this.nodeTypeRegisterPtr = 0;
        this.astTransformPtr = 1;
        this.astType = AST_TYPE_NONE;
        this.astTypeFlavor = AST_TYPE_NONE;
        this.astFlags = 0;
        this.astError = 0;
        this.rootNode = this.allocTypedNode(NODE_TYPE_LINE_RAW, 0, this.rawEnd);
        if ( this.rawEnd === 0 ) { return; }

        // Fast-track very common simple filters using pre-computed AST layouts
        // to skip parsing and validation.
        const c1st = this.raw.charCodeAt(0);
        const clast = exCharCodeAt(this.raw, -1);
        if ( c1st === 0x7C /* | */ ) {
            if (
                clast === 0x5E /* ^ */ &&
                this.reHnAnchoredHostnameAscii.test(this.raw)
            ) {
                // ||example.com^
                this.astType = AST_TYPE_NETWORK;
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.netHnAnchoredHostnameAscii
                );
                this.linkDown(this.rootNode, node);
                return;
            }
            if (
                this.raw.endsWith('$third-party') &&
                this.reHn3pAnchoredHostnameAscii.test(this.raw)
            ) {
                // ||example.com^$third-party
                this.astType = AST_TYPE_NETWORK;
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.net3pHnAnchoredHostnameAscii
                );
                this.linkDown(this.rootNode, node);
                return;
            }
            if ( this.reHnAnchoredPlainAscii.test(this.raw) ) {
                // ||example.com/path/to/resource
                this.astType = AST_TYPE_NETWORK;
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_PLAIN;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.netHnAnchoredPlainAscii
                );
                this.linkDown(this.rootNode, node);
                return;
            }
        } else if ( c1st === 0x23 /* # */ ) {
            if ( this.rePlainGenericCosmetic.test(this.raw) ) {
                // ##.ads-container
                this.astType = AST_TYPE_EXTENDED;
                this.astTypeFlavor = AST_TYPE_EXTENDED_COSMETIC;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.extPlainGenericSelector
                );
                this.linkDown(this.rootNode, node);
                this.result.exception = false;
                this.result.raw = this.raw.slice(2);
                this.result.compiled = this.raw.slice(2);
                return;
            }
        } else if ( c1st === 0x31 /* 1 */ ) {
            if ( this.reNetHosts1.test(this.raw) ) {
                // 127.0.0.1 example.com
                this.astType = AST_TYPE_NETWORK;
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.netHosts1
                );
                this.linkDown(this.rootNode, node);
                return;
            }
        } else if ( c1st === 0x30 /* 0 */ ) {
            if ( this.reNetHosts2.test(this.raw) ) {
                // 0.0.0.0 example.com
                this.astType = AST_TYPE_NETWORK;
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
                const node = this.astFromTemplate(this.rootNode,
                    astTemplates.netHosts2
                );
                this.linkDown(this.rootNode, node);
                return;
            }
        } else if (
            (c1st !== 0x2F /* / */ || clast !== 0x2F /* / */) &&
            (this.rePlainAscii.test(this.raw))
        ) {
            // example.com
            // -resource.
            this.astType = AST_TYPE_NETWORK;
            this.astTypeFlavor = this.reHostnameAscii.test(this.raw)
                ? AST_TYPE_NETWORK_PATTERN_HOSTNAME
                : AST_TYPE_NETWORK_PATTERN_PLAIN;
            const node = this.astFromTemplate(this.rootNode,
                astTemplates.netPlainAscii
            );
            this.linkDown(this.rootNode, node);
            return;
        }

        // All else: full parsing and validation.
        this.hasWhitespace = this.reHasWhitespaceChar.test(raw);
        this.linkDown(this.rootNode, this.parseRaw(this.rootNode));
    }

    astFromTemplate(parent, template) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const beg = template.beg + (template.beg >= 0 ? parentBeg : parentEnd);
        const end = template.end + (template.end <= 0 ? parentEnd : parentBeg);
        const node = this.allocTypedNode(template.type, beg, end);
        if ( template.register ) {
            this.addNodeToRegister(template.type, node);
        }
        if ( template.flags ) {
            this.addFlags(template.flags);
        }
        if ( template.nodeFlags ) {
            this.addNodeFlags(node, template.nodeFlags);
        }
        const children = template.children;
        if ( children === undefined ) { return node; }
        const head = this.astFromTemplate(node, children[0]);
        this.linkDown(node, head);
        const n = children.length;
        if ( n === 1 ) { return node; }
        let prev = head;
        for ( let i = 1; i < n; i++ ) {
            prev = this.linkRight(prev, this.astFromTemplate(node, children[i]));
        }
        return node;
    }

    getType() {
        return this.astType;
    }

    isComment() {
        return this.astType === AST_TYPE_COMMENT;
    }

    isFilter() {
        return this.isNetworkFilter() || this.isExtendedFilter();
    }

    isNetworkFilter() {
        return this.astType === AST_TYPE_NETWORK;
    }

    isExtendedFilter() {
        return this.astType === AST_TYPE_EXTENDED;
    }

    isCosmeticFilter() {
        return this.astType === AST_TYPE_EXTENDED &&
            this.astTypeFlavor === AST_TYPE_EXTENDED_COSMETIC;
    }

    isScriptletFilter() {
        return this.astType === AST_TYPE_EXTENDED &&
            this.astTypeFlavor === AST_TYPE_EXTENDED_SCRIPTLET;
    }

    isHtmlFilter() {
        return this.astType === AST_TYPE_EXTENDED &&
            this.astTypeFlavor === AST_TYPE_EXTENDED_HTML;
    }

    isResponseheaderFilter() {
        return this.astType === AST_TYPE_EXTENDED &&
            this.astTypeFlavor === AST_TYPE_EXTENDED_RESPONSEHEADER;
    }

    getFlags(flags = 0xFFFFFFFF) {
        return this.astFlags & flags;
    }

    addFlags(flags) {
        this.astFlags |= flags;
    }

    parseRaw(parent) {
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const l1 = this.hasWhitespace
            ? this.leftWhitespaceCount(this.getNodeString(parent))
            : 0;
        if ( l1 !== 0 ) {
            next = this.allocTypedNode(
                NODE_TYPE_WHITESPACE,
                parentBeg,
                parentBeg + l1
            );
            prev = this.linkRight(prev, next);
            if ( l1 === parentEnd ) { return this.throwHeadNode(head); }
        }
        const r0 = this.hasWhitespace
            ? parentEnd - this.rightWhitespaceCount(this.getNodeString(parent))
            : parentEnd;
        if ( r0 !== l1 ) {
            next = this.allocTypedNode(
                NODE_TYPE_LINE_BODY,
                parentBeg + l1,
                parentBeg + r0
            );
            this.linkDown(next, this.parseFilter(next));
            prev = this.linkRight(prev, next);
        }
        if ( r0 !== parentEnd ) {
            next = this.allocTypedNode(
                NODE_TYPE_WHITESPACE,
                parentBeg + r0,
                parentEnd
            );
            this.linkRight(prev, next);
        }
        return this.throwHeadNode(head);
    }

    parseFilter(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const parentStr = this.getNodeString(parent);

        // A comment?
        if ( this.reCommentLine.test(parentStr) ) {
            const head = this.allocTypedNode(NODE_TYPE_COMMENT, parentBeg, parentEnd);
            this.astType = AST_TYPE_COMMENT;
            if ( this.interactive ) {
                this.linkDown(head, this.parseComment(head));
            }
            return head;
        }

        // An extended filter? (or rarely, a comment)
        if ( this.reExtAnchor.test(parentStr) ) {
            const match = this.reExtAnchor.exec(parentStr);
            const matchLen = match[1].length;
            const head = this.allocTypedNode(NODE_TYPE_EXT_RAW, parentBeg, parentEnd);
            this.linkDown(head, this.parseExt(head, parentBeg + match.index, matchLen));
            return head;
        } else if ( parentStr.charCodeAt(0) === 0x23 /* # */ ) {
            const head = this.allocTypedNode(NODE_TYPE_COMMENT, parentBeg, parentEnd);
            this.astType = AST_TYPE_COMMENT;
            return head;
        }

        // Good to know in advance to avoid costly tests later on
        this.hasUppercase = this.reHasUppercaseChar.test(parentStr);
        this.hasUnicode = this.reHasUnicodeChar.test(parentStr);

        // A network filter (probably)
        this.astType = AST_TYPE_NETWORK;

        // Parse inline comment if any
        let tail = 0, tailStart = parentEnd;
        if ( this.hasWhitespace && this.reInlineComment.test(parentStr) ) {
            const match = this.reInlineComment.exec(parentStr);
            tailStart = parentBeg + match.index;
            tail = this.allocTypedNode(NODE_TYPE_COMMENT, tailStart, parentEnd);
        }

        const head = this.allocTypedNode(NODE_TYPE_NET_RAW, parentBeg, tailStart);
        if ( this.linkDown(head, this.parseNet(head)) === 0 ) {
            this.astType = AST_TYPE_UNKNOWN;
            this.addFlags(AST_FLAG_UNSUPPORTED | AST_FLAG_HAS_ERROR);
        }
        if ( tail !== 0 ) {
            this.linkRight(head, tail);
        }
        return head;
    }

    parseComment(parent) {
        const parentStr = this.getNodeString(parent);
        if ( this.rePreparseDirectiveAny.test(parentStr) ) {
            this.astTypeFlavor = AST_TYPE_COMMENT_PREPARSER;
            return this.parsePreparseDirective(parent, parentStr);
        }
        if ( this.reURL.test(parentStr) === false ) { return 0; }
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const match = this.reURL.exec(parentStr);
        const urlBeg = parentBeg + match.index;
        const urlEnd = urlBeg + match[0].length;
        const head = this.allocTypedNode(NODE_TYPE_COMMENT, parentBeg, urlBeg);
        let next = this.allocTypedNode(NODE_TYPE_COMMENT_URL, urlBeg, urlEnd);
        let prev = this.linkRight(head, next);
        if ( urlEnd !== parentEnd ) {
            next = this.allocTypedNode(NODE_TYPE_COMMENT, urlEnd, parentEnd);
            this.linkRight(prev, next);
        }
        return head;
    }

    parsePreparseDirective(parent, s) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const match = this.rePreparseDirectiveAny.exec(s);
        const directiveEnd = parentBeg + match[0].length;
        const head = this.allocTypedNode(
            NODE_TYPE_PREPARSE_DIRECTIVE,
            parentBeg,
            directiveEnd
        );
        if ( directiveEnd !== parentEnd ) {
            const type = s.startsWith('!#if ')
                ? NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE
                : NODE_TYPE_PREPARSE_DIRECTIVE_VALUE;
            const next = this.allocTypedNode(type, directiveEnd, parentEnd);
            this.addNodeToRegister(type, next);
            this.linkRight(head, next);
            if ( type === NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE ) {
                const rawToken = this.getNodeString(next).trim();
                if ( utils.preparser.evaluateExpr(rawToken) === undefined ) {
                    this.addNodeFlags(next, NODE_FLAG_ERROR);
                    this.addFlags(AST_FLAG_HAS_ERROR);
                    this.astError = AST_ERROR_IF_TOKEN_UNKNOWN;
                }
            }
        }
        return head;
    }

    // Very common, look into fast-tracking such plain pattern:
    // /^[^!#\$\*\^][^#\$\*\^]*[^\$\*\|]$/
    parseNet(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const parentStr = this.getNodeString(parent);
        const head = this.allocHeadNode();
        let patternBeg = parentBeg;
        let prev = head, next = 0, tail = 0;
        if ( this.reNetException.test(parentStr) ) {
            this.addFlags(AST_FLAG_IS_EXCEPTION);
            next = this.allocTypedNode(NODE_TYPE_NET_EXCEPTION, parentBeg, parentBeg+2);
            prev = this.linkRight(prev, next);
            patternBeg += 2;
        }
        let anchorBeg = this.indexOfNetAnchor(parentStr);
        if ( anchorBeg === -1 ) { return 0; }
        anchorBeg += parentBeg;
        if ( anchorBeg !== parentEnd ) {
            tail = this.allocTypedNode(
                NODE_TYPE_NET_OPTIONS_ANCHOR,
                anchorBeg,
                anchorBeg + 1
            );
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTIONS,
                anchorBeg + 1,
                parentEnd
            );
            this.addFlags(AST_FLAG_HAS_OPTIONS);
            this.addNodeToRegister(NODE_TYPE_NET_OPTIONS, next);
            this.linkDown(next, this.parseNetOptions(next));
            this.linkRight(tail, next);
        }
        next = this.allocTypedNode(
            NODE_TYPE_NET_PATTERN_RAW,
            patternBeg,
            anchorBeg
        );
        this.addNodeToRegister(NODE_TYPE_NET_PATTERN_RAW, next);
        this.linkDown(next, this.parseNetPattern(next));
        prev = this.linkRight(prev, next);
        if ( tail !== 0 ) {
            this.linkRight(prev, tail);
        }
        if ( this.astType === AST_TYPE_NETWORK ) {
            this.validateNet();
        }
        return this.throwHeadNode(head);
    }

    validateNet() {
        const isException = this.isException();
        let bad = false, realBad = false;
        let abstractTypeCount = 0;
        let behaviorTypeCount = 0;
        let docTypeCount = 0;
        let modifierType = 0;
        let requestTypeCount = 0;
        let unredirectableTypeCount = 0;
        let isBadfilter = false;
        for ( let i = 0, n = this.nodeTypeRegisterPtr; i < n; i++ ) {
            const type = this.nodeTypeRegister[i];
            const targetNode = this.nodeTypeLookupTable[type];
            if ( targetNode === 0 ) { continue; }
            if ( this.badTypes.has(type) ) {
                this.addNodeFlags(NODE_FLAG_ERROR);
                this.addFlags(AST_FLAG_HAS_ERROR);
                this.astError = AST_ERROR_OPTION_EXCLUDED;
            }
            const flags = this.getNodeFlags(targetNode);
            if ( (flags & NODE_FLAG_ERROR) !== 0 ) { continue; }
            const isNegated = (flags & NODE_FLAG_IS_NEGATED) !== 0;
            const hasValue = (flags & NODE_FLAG_OPTION_HAS_VALUE) !== 0;
            bad = false; realBad = false;
            switch ( type ) {
            case NODE_TYPE_NET_OPTION_NAME_ALL:
                realBad = isNegated || hasValue || modifierType !== 0;
                break;
            case NODE_TYPE_NET_OPTION_NAME_1P:
            case NODE_TYPE_NET_OPTION_NAME_3P:
                realBad = hasValue;
                break;
            case NODE_TYPE_NET_OPTION_NAME_BADFILTER:
                isBadfilter = true;
                /* falls through */
            case NODE_TYPE_NET_OPTION_NAME_NOOP:
                realBad = isNegated || hasValue;
                break;
            case NODE_TYPE_NET_OPTION_NAME_CSS:
            case NODE_TYPE_NET_OPTION_NAME_FONT:
            case NODE_TYPE_NET_OPTION_NAME_IMAGE:
            case NODE_TYPE_NET_OPTION_NAME_MEDIA:
            case NODE_TYPE_NET_OPTION_NAME_OTHER:
            case NODE_TYPE_NET_OPTION_NAME_SCRIPT:
            case NODE_TYPE_NET_OPTION_NAME_XHR:
                realBad = hasValue;
                if ( realBad ) { break; }
                requestTypeCount += 1;
                break;
            case NODE_TYPE_NET_OPTION_NAME_CNAME:
                realBad = isException === false || isNegated || hasValue;
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_CSP:
                realBad = (hasValue || isException) === false ||
                    modifierType !== 0 ||
                    this.reBadCSP.test(
                        this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_CSP)
                    );
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_DENYALLOW:
                realBad = isNegated || hasValue === false ||
                    this.getBranchFromType(NODE_TYPE_NET_OPTION_NAME_FROM) === 0;
                break;
            case NODE_TYPE_NET_OPTION_NAME_DOC:
            case NODE_TYPE_NET_OPTION_NAME_FRAME:
            case NODE_TYPE_NET_OPTION_NAME_OBJECT:
                realBad = hasValue;
                if ( realBad ) { break; }
                docTypeCount += 1;
                break;
            case NODE_TYPE_NET_OPTION_NAME_EHIDE:
            case NODE_TYPE_NET_OPTION_NAME_GHIDE:
            case NODE_TYPE_NET_OPTION_NAME_SHIDE:
                realBad = isNegated || hasValue || modifierType !== 0;
                if ( realBad ) { break; }
                behaviorTypeCount += 1;
                unredirectableTypeCount += 1;
                break;
            case NODE_TYPE_NET_OPTION_NAME_EMPTY:
            case NODE_TYPE_NET_OPTION_NAME_MP4:
                realBad = isNegated || hasValue || modifierType !== 0;
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_FROM:
            case NODE_TYPE_NET_OPTION_NAME_METHOD:
            case NODE_TYPE_NET_OPTION_NAME_TO:
            case NODE_TYPE_NET_OPTION_NAME_TOP:
                realBad = isNegated || hasValue === false;
                break;
            case NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK:
                bad = true;
                realBad = isException === false || isNegated || hasValue;
                break;
            case NODE_TYPE_NET_OPTION_NAME_IMPORTANT:
                realBad = isException || isNegated || hasValue;
                break;
            case NODE_TYPE_NET_OPTION_NAME_INLINEFONT:
            case NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:
                realBad = hasValue;
                if ( realBad ) { break; }
                modifierType = type;
                unredirectableTypeCount += 1;
                break;
            case NODE_TYPE_NET_OPTION_NAME_IPADDRESS: {
                const value = this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_IPADDRESS);
                if ( /^\/.+\/$/.test(value) ) {
                    try { void new RegExp(value); }
                    catch { realBad = true; }
                }
                break;
            }
            case NODE_TYPE_NET_OPTION_NAME_MATCHCASE:
                realBad = this.isRegexPattern() === false;
                break;
            case NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:
                realBad = modifierType !== 0 ||
                    (hasValue || isException) === false ||
                    this.reBadPP.test(
                        this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_PERMISSIONS)
                    );
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_PING:
            case NODE_TYPE_NET_OPTION_NAME_WEBSOCKET:
                realBad = hasValue;
                if ( realBad ) { break; }
                requestTypeCount += 1;
                if ( (flags & NODE_FLAG_IS_NEGATED) === 0 ) {
                    unredirectableTypeCount += 1;
                }
                break;
            case NODE_TYPE_NET_OPTION_NAME_POPUNDER:
            case NODE_TYPE_NET_OPTION_NAME_POPUP:
                realBad = hasValue;
                if ( realBad ) { break; }
                abstractTypeCount += 1;
                unredirectableTypeCount += 1;
                break;
            case NODE_TYPE_NET_OPTION_NAME_REASON:
                realBad = hasValue === false;
                break;
            case NODE_TYPE_NET_OPTION_NAME_REDIRECT:
            case NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:
            case NODE_TYPE_NET_OPTION_NAME_REPLACE:
            case NODE_TYPE_NET_OPTION_NAME_URLSKIP:
            case NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:
                realBad = isNegated || (isException || hasValue) === false ||
                    modifierType !== 0;
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:
                realBad = isNegated || modifierType !== 0;
                if ( realBad ) { break; }
                modifierType = type;
                break;
            case NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER:
            case NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER:
                realBad = isNegated || hasValue === false;
                break;
            case NODE_TYPE_NET_OPTION_NAME_STRICT1P:
            case NODE_TYPE_NET_OPTION_NAME_STRICT3P:
                realBad = isNegated || hasValue;
                break;
            case NODE_TYPE_NET_OPTION_NAME_UNKNOWN:
                this.astError = AST_ERROR_OPTION_UNKNOWN;
                realBad = true;
                break;
            case NODE_TYPE_NET_OPTION_NAME_WEBRTC:
                realBad = true;
                break;
            case NODE_TYPE_NET_PATTERN_RAW:
                realBad = this.hasOptions() === false &&
                    this.getNetPattern().length <= 1;
                break;
            default:
                break;
            }
            if ( bad || realBad ) {
                this.addNodeFlags(targetNode, NODE_FLAG_ERROR);
            }
            if ( realBad ) {
                this.addFlags(AST_FLAG_HAS_ERROR);
            }
        }
        switch ( modifierType ) {
        case NODE_TYPE_NET_OPTION_NAME_CNAME:
            realBad = abstractTypeCount || behaviorTypeCount || requestTypeCount;
            break;
        case NODE_TYPE_NET_OPTION_NAME_CSP:
        case NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:
            realBad = abstractTypeCount || behaviorTypeCount || requestTypeCount;
            break;
        case NODE_TYPE_NET_OPTION_NAME_INLINEFONT:
        case NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:
            realBad = behaviorTypeCount;
            break;
        case NODE_TYPE_NET_OPTION_NAME_EMPTY:
            realBad = abstractTypeCount || behaviorTypeCount;
            break;
        case NODE_TYPE_NET_OPTION_NAME_MEDIA:
        case NODE_TYPE_NET_OPTION_NAME_MP4:
            realBad = abstractTypeCount || behaviorTypeCount || docTypeCount || requestTypeCount;
            break;
        case NODE_TYPE_NET_OPTION_NAME_REDIRECT:
        case NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE: {
            realBad = abstractTypeCount || behaviorTypeCount || unredirectableTypeCount;
            if ( realBad ) { break; }
            if ( isException || isBadfilter ) { break; }
            const { trustedSource, trustedTokens } = this.options;
            if ( trustedSource ) { break; }
            if ( trustedTokens instanceof Set === false ) { break; }
            const value = this.getNetOptionValue(modifierType);
            let { token } = parseRedirectValue(value);
            if ( trustedTokens.has(token) ) {
                this.astError = AST_ERROR_UNTRUSTED_SOURCE;
                realBad = true;
            }
            break;
        }
        case NODE_TYPE_NET_OPTION_NAME_REPLACE: {
            realBad = abstractTypeCount || behaviorTypeCount || unredirectableTypeCount;
            if ( realBad ) { break; }
            if ( isException || isBadfilter ) { break; }
            if ( this.options.canFilterResponseBody !== true ) {
                this.addFlags(AST_FLAG_HAS_ERROR);
                this.astError = AST_ERROR_CAPABILITY;
                realBad = true;
                break;
            }
            if ( this.options.trustedSource !== true ) {
                this.astError = AST_ERROR_UNTRUSTED_SOURCE;
                realBad = true;
                break;
            }
            const value = this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_REPLACE);
            if ( parseReplaceValue(value) === undefined ) {
                this.astError = AST_ERROR_OPTION_BADVALUE;
                realBad = true;
            }
            break;
        }
        case NODE_TYPE_NET_OPTION_NAME_URLSKIP: {
            realBad = abstractTypeCount || behaviorTypeCount || unredirectableTypeCount;
            if ( realBad ) { break; }
            if ( isException || isBadfilter ) { break; }
            if ( this.options.trustedSource !== true ) {
                this.astError = AST_ERROR_UNTRUSTED_SOURCE;
                realBad = true;
                break;
            }
            const value = this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_URLSKIP);
            if ( value.length < 2 ) {
                this.astError = AST_ERROR_OPTION_BADVALUE;
                realBad = true;
            }
            break;
        }
        case NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM: {
            realBad = abstractTypeCount || behaviorTypeCount || unredirectableTypeCount;
            if ( realBad ) { break; }
            if ( isException || isBadfilter ) { break; }
            if ( this.options.trustedSource !== true ) {
                this.astError = AST_ERROR_UNTRUSTED_SOURCE;
                realBad = true;
                break;
            }
            const value = this.getNetOptionValue(NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM);
            if ( value !== '' && parseReplaceByRegexValue(value) === undefined ) {
                this.astError = AST_ERROR_OPTION_BADVALUE;
                realBad = true;
            }
            break;
        }
        case NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:
            realBad = abstractTypeCount || behaviorTypeCount;
            break;
        default:
            break;
        }
        if ( realBad ) {
            const targetNode = this.getBranchFromType(modifierType);
            this.addNodeFlags(targetNode, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
    }

    indexOfNetAnchor(s) {
        const end = s.length;
        if ( end === 0 ) { return 0; }
        let j = s.lastIndexOf('$');
        if ( j === -1 ) { return end; }
        let htmlFilteringRule = false;
        for (;;) {
            if ( s.charCodeAt(j-1) === 0x24 /* $ */ ) {
                htmlFilteringRule = true;
            }
            if ( this.reNetOptionTokens.test(s.slice(j+1)) ) { return j; }
            if ( j === 0 ) { break; }
            j = s.lastIndexOf('$', j-1);
            if ( j === -1 ) { break; }
        }
        if ( htmlFilteringRule ) { return -1; } 
        return end;
    }

    parseNetPattern(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];

        // Empty pattern
        if ( parentEnd === parentBeg ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_ANY;
            const node = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN,
                parentBeg,
                parentEnd
            );
            this.addNodeToRegister(NODE_TYPE_NET_PATTERN, node);
            this.setNodeTransform(node, '*');
            return node;
        }

        const head = this.allocHeadNode();
        let prev = head, next = 0, tail = 0;
        let pattern = this.getNodeString(parent);
        const hasWildcard = pattern.includes('*');
        const c1st = pattern.charCodeAt(0);
        const c2nd = pattern.charCodeAt(1) || 0;
        const clast = exCharCodeAt(pattern, -1);

        // Common case: Easylist syntax-based hostname
        if (
            hasWildcard === false &&
            c1st === 0x7C /* | */ && c2nd === 0x7C /* | */ &&
            clast === 0x5E /* ^ */ &&
            this.isAdblockHostnamePattern(pattern)
        ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
            this.addFlags(
                AST_FLAG_NET_PATTERN_LEFT_HNANCHOR |
                AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR
            );
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR,
                parentBeg,
                parentBeg + 2
            );
            prev = this.linkRight(prev, next);
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN,
                parentBeg + 2,
                parentEnd - 1
            );
            pattern = pattern.slice(2, -1);
            const normal = this.hasUnicode
                ? this.normalizeHostnameValue(pattern)
                : pattern;
            if ( normal !== undefined && normal !== pattern ) {
                this.setNodeTransform(next, normal);
            }
            this.addNodeToRegister(NODE_TYPE_NET_PATTERN, next);
            prev = this.linkRight(prev, next);
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN_PART_SPECIAL,
                parentEnd - 1,
                parentEnd
            );
            this.linkRight(prev, next);
            return this.throwHeadNode(head);
        }

        let patternBeg = parentBeg;
        let patternEnd = parentEnd;

        // Hosts file entry?
        if (
            this.hasWhitespace &&
            this.isException() === false &&
            this.hasOptions() === false &&
            this.reHostsSink.test(pattern)
        ) {
            const match = this.reHostsSink.exec(pattern);
            patternBeg += match[0].length;
            pattern = pattern.slice(patternBeg);
            next = this.allocTypedNode(NODE_TYPE_IGNORE, parentBeg, patternBeg);
            prev = this.linkRight(prev, next);
            if (
                this.reHostsRedirect.test(pattern) ||
                this.reHostnameAscii.test(pattern) === false
            ) {
                this.astType = AST_TYPE_NONE;
                this.addFlags(AST_FLAG_IGNORE);
                next = this.allocTypedNode(NODE_TYPE_IGNORE, patternBeg, parentEnd);
                prev = this.linkRight(prev, next);
                return this.throwHeadNode(head);
            }
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
            this.addFlags(
                AST_FLAG_NET_PATTERN_LEFT_HNANCHOR |
                AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR
            );
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN,
                patternBeg,
                parentEnd
            );
            this.addNodeToRegister(NODE_TYPE_NET_PATTERN, next);
            this.linkRight(prev, next);
            return this.throwHeadNode(head);
        }

        // Regex?
        if (
            c1st === 0x2F /* / */ && clast === 0x2F /* / */ &&
            pattern.length > 2
        ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_REGEX;
            const normal = this.normalizeRegexPattern(pattern);
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN,
                patternBeg,
                patternEnd
            );
            this.addNodeToRegister(NODE_TYPE_NET_PATTERN, next);
            if ( normal !== '' ) {
                if ( normal !== pattern ) {
                    this.setNodeTransform(next, normal);
                }
            } else {
                this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_BAD;
                this.astError = AST_ERROR_REGEX;
                this.addFlags(AST_FLAG_HAS_ERROR);
                this.addNodeFlags(next, NODE_FLAG_ERROR);
            }
            this.linkRight(prev, next);
            return this.throwHeadNode(head);
        }

        // Left anchor
        if ( c1st === 0x7C /* '|' */ ) {
            if ( c2nd === 0x7C /* '|' */ ) {
                const type = this.isTokenCharCode(pattern.charCodeAt(2) || 0)
                    ? NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR
                    : NODE_TYPE_IGNORE;
                next = this.allocTypedNode(type, patternBeg, patternBeg+2);
                if ( type === NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR ) {
                    this.addFlags(AST_FLAG_NET_PATTERN_LEFT_HNANCHOR);
                }
                patternBeg += 2;
                pattern = pattern.slice(2);
            } else {
                const type = this.isTokenCharCode(c2nd)
                    ? NODE_TYPE_NET_PATTERN_LEFT_ANCHOR
                    : NODE_TYPE_IGNORE;
                next = this.allocTypedNode(type, patternBeg, patternBeg+1);
                if ( type === NODE_TYPE_NET_PATTERN_LEFT_ANCHOR ) {
                    this.addFlags(AST_FLAG_NET_PATTERN_LEFT_ANCHOR);
                }
                patternBeg += 1;
                pattern = pattern.slice(1);
            }
            prev = this.linkRight(prev, next);
            if ( patternBeg === patternEnd ) {
                this.addNodeFlags(next, NODE_FLAG_IGNORE);
            }
        }

        // Right anchor
        if ( exCharCodeAt(pattern, -1) === 0x7C /* | */ ) {
            const type = exCharCodeAt(pattern, -2) !== 0x2A /* * */
                ? NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR
                : NODE_TYPE_IGNORE;
            tail = this.allocTypedNode(type, patternEnd-1, patternEnd);
            if ( type === NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR ) {
                this.addFlags(AST_FLAG_NET_PATTERN_RIGHT_ANCHOR);
            }
            patternEnd -= 1;
            pattern = pattern.slice(0, -1);
            if ( patternEnd === patternBeg ) {
                this.addNodeFlags(tail, NODE_FLAG_IGNORE);
            }
        }

        // Ignore pointless leading wildcards
        if ( hasWildcard && this.rePointlessLeadingWildcards.test(pattern) ) {
            const match = this.rePointlessLeadingWildcards.exec(pattern);
            const ignoreLen = match[1].length;
            next = this.allocTypedNode(
                NODE_TYPE_IGNORE,
                patternBeg,
                patternBeg + ignoreLen
            );
            prev = this.linkRight(prev, next);
            patternBeg += ignoreLen;
            pattern = pattern.slice(ignoreLen);
        }

        // Ignore pointless trailing separators
        if ( this.rePointlessTrailingSeparator.test(pattern) ) {
            const match = this.rePointlessTrailingSeparator.exec(pattern);
            const ignoreLen = match[1].length;
            next = this.allocTypedNode(
                NODE_TYPE_IGNORE,
                patternEnd - ignoreLen,
                patternEnd
            );
            patternEnd -= ignoreLen;
            pattern = pattern.slice(0, -ignoreLen);
            if ( tail !== 0 ) { this.linkRight(next, tail); }
            tail = next;
        }

        // Ignore pointless trailing wildcards. Exception: when removing the
        // trailing wildcard make the pattern look like a regex.
        if ( hasWildcard && this.rePointlessTrailingWildcards.test(pattern) ) {
            const match = this.rePointlessTrailingWildcards.exec(pattern);
            const ignoreLen = match[1].length;
            const needWildcard = pattern.charCodeAt(0) === 0x2F &&
                exCharCodeAt(pattern, -ignoreLen-1) === 0x2F;
            const goodWildcardBeg = patternEnd - ignoreLen;
            const badWildcardBeg = goodWildcardBeg + (needWildcard ? 1 : 0);
            if ( badWildcardBeg !== patternEnd ) {
                next = this.allocTypedNode(
                    NODE_TYPE_IGNORE,
                    badWildcardBeg,
                    patternEnd
                );
                if ( tail !== 0 ) {this.linkRight(next, tail); }
                tail = next;
            }
            if ( goodWildcardBeg !== badWildcardBeg ) {
                next = this.allocTypedNode(
                    NODE_TYPE_NET_PATTERN_PART_SPECIAL,
                    goodWildcardBeg,
                    badWildcardBeg
                );
                if ( tail !== 0 ) { this.linkRight(next, tail); }
                tail = next;
            }
            patternEnd -= ignoreLen;
            pattern = pattern.slice(0, -ignoreLen);
        }

        const patternHasWhitespace = this.hasWhitespace &&
            this.reHasWhitespaceChar.test(pattern);
        const needNormalization = this.needPatternNormalization(pattern);
        const normal = needNormalization
            ? this.normalizePattern(pattern)
            : pattern;
        next = this.allocTypedNode(NODE_TYPE_NET_PATTERN, patternBeg, patternEnd);
        if ( patternHasWhitespace || normal === undefined ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_BAD;
            this.addFlags(AST_FLAG_HAS_ERROR);
            this.astError = AST_ERROR_PATTERN;
            this.addNodeFlags(next, NODE_FLAG_ERROR);
        } else if ( normal === '*' ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_ANY;
        } else if ( this.reHostnameAscii.test(normal) ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_HOSTNAME;
        } else if ( this.reHasPatternSpecialChars.test(normal) ) {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_GENERIC;
        } else {
            this.astTypeFlavor = AST_TYPE_NETWORK_PATTERN_PLAIN;
        }
        this.addNodeToRegister(NODE_TYPE_NET_PATTERN, next);
        if ( needNormalization && normal !== undefined ) {
            this.setNodeTransform(next, normal);
        }
        if ( this.interactive ) {
            this.linkDown(next, this.parsePatternParts(next, pattern));
        }
        prev = this.linkRight(prev, next);

        if ( tail !== 0 ) {
            this.linkRight(prev, tail);
        }
        return this.throwHeadNode(head);
    }

    isAdblockHostnamePattern(pattern) {
        if ( this.hasUnicode ) {
            return this.reHnAnchoredHostnameUnicode.test(pattern);
        }
        return this.reHnAnchoredHostnameAscii.test(pattern);
    }

    parsePatternParts(parent, pattern) {
        if ( pattern.length === 0 ) { return 0; }
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const matches = pattern.matchAll(this.rePatternAllSpecialChars);
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        let plainPartBeg = 0;
        for ( const match of matches ) {
            const plainPartEnd = match.index;
            if ( plainPartEnd !== plainPartBeg ) {
                next = this.allocTypedNode(
                    NODE_TYPE_NET_PATTERN_PART,
                    parentBeg + plainPartBeg,
                    parentBeg + plainPartEnd
                );
                prev = this.linkRight(prev, next);
            }
            plainPartBeg = plainPartEnd + match[0].length;
            const type = match[0].charCodeAt(0) < 0x80
                ? NODE_TYPE_NET_PATTERN_PART_SPECIAL
                : NODE_TYPE_NET_PATTERN_PART_UNICODE;
            next = this.allocTypedNode(
                type,
                parentBeg + plainPartEnd,
                parentBeg + plainPartBeg
            );
            prev = this.linkRight(prev, next);
        }
        if ( plainPartBeg !== pattern.length ) {
            next = this.allocTypedNode(
                NODE_TYPE_NET_PATTERN_PART,
                parentBeg + plainPartBeg,
                parentBeg + pattern.length
            );
            this.linkRight(prev, next);
        }
        return this.throwHeadNode(head);
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/1118#issuecomment-650730158
    //   Be ready to deal with non-punycode-able Unicode characters.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/772
    //   Encode Unicode characters beyond the hostname part.
    // Prepend with '*' character to prevent the browser API from refusing to
    // punycode -- this occurs when the extracted label starts with a dash.
    needPatternNormalization(pattern) {
        return pattern.length === 0 || this.hasUppercase || this.hasUnicode;
    }

    normalizePattern(pattern) {
        if ( pattern.length === 0 ) { return '*'; }
        if ( this.reHasInvalidChar.test(pattern) ) { return; }
        let normal = pattern.toLowerCase();
        if ( this.hasUnicode === false ) { return normal; }
        // Punycode hostname part of the pattern.
        if ( this.reHostnamePatternPart.test(normal) ) {
            const match = this.reHostnamePatternPart.exec(normal);
            const hn = match[0].replace(this.reHostnameLabel, s => {
                if ( this.reHasUnicodeChar.test(s) === false ) { return s; }
                if ( s.charCodeAt(0) === 0x2D /* - */ ) { s = '*' + s; }
                return this.normalizeHostnameValue(s, DOMAIN_CAN_USE_WILDCARD) || s;
            });
            normal = hn + normal.slice(match.index + match[0].length);
        }
        if ( this.reHasUnicodeChar.test(normal) === false ) { return normal; }
        // Percent-encode remaining Unicode characters.
        try {
            normal = normal.replace(this.reUnicodeChars, s =>
                encodeURIComponent(s).toLowerCase()
            );
        } catch {
            return;
        }
        return normal;
    }

    getNetPattern() {
        const node = this.nodeTypeLookupTable[NODE_TYPE_NET_PATTERN];
        return this.getNodeTransform(node);
    }

    isAnyPattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_ANY;
    }

    isHostnamePattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_HOSTNAME;
    }

    isRegexPattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_REGEX;
    }

    isPlainPattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_PLAIN;
    }

    isGenericPattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_GENERIC;
    }

    isBadPattern() {
        return this.astTypeFlavor === AST_TYPE_NETWORK_PATTERN_BAD;
    }

    parseNetOptions(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        if ( parentEnd === parentBeg ) { return 0; }
        const s = this.getNodeString(parent);
        const optionsEnd = s.length;
        const parseDetails = { node: 0, len: 0 };
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        let optionBeg = 0, optionEnd = 0;
        while ( optionBeg !== optionsEnd ) {
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTION_RAW,
                parentBeg + optionBeg,
                parentBeg + optionsEnd // open ended
            );
            this.parseNetOption(next, parseDetails);
            // set next's end to down's end
            optionEnd += parseDetails.len;
            this.nodes[next+NODE_END_INDEX] = parentBeg + optionEnd;
            this.linkDown(next, parseDetails.node);
            prev = this.linkRight(prev, next);
            if ( optionEnd === optionsEnd ) { break; }
            optionBeg = optionEnd + 1;
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTION_SEPARATOR,
                parentBeg + optionEnd,
                parentBeg + optionBeg
            );
            if ( parseDetails.len === 0 || optionBeg === optionsEnd ) {
                this.addNodeFlags(next, NODE_FLAG_ERROR);
                this.addFlags(AST_FLAG_HAS_ERROR);
            }
            prev = this.linkRight(prev, next);
            optionEnd = optionBeg;
        }
        this.linkRight(prev,
            this.allocSentinelNode(NODE_TYPE_NET_OPTION_SENTINEL, parentEnd)
        );
        return this.throwHeadNode(head);
    }

    parseNetOption(parent, parseDetails) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const s = this.getNodeString(parent);
        const match = this.reNetOption.exec(s) || [];
        if ( match.length === 0 ) {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
            this.astError = AST_ERROR_OPTION_UNKNOWN;
            parseDetails.node = 0;
            parseDetails.len = s.length;
            return;
        }
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        const matchEnd = match && match[0].length || 0;
        const negated = match[1] === '~';
        if ( negated ) {
            this.addNodeFlags(parent, NODE_FLAG_IS_NEGATED);
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTION_NAME_NOT,
                parentBeg,
                parentBeg+1
            );
            prev = this.linkRight(prev, next);
        }
        const nameBeg = negated ? 1 : 0;
        const assigned = match[3] === '=';
        const nameEnd = matchEnd - (assigned ? 1 : 0);
        const name = match[2] || '';
        let nodeOptionType = nodeTypeFromOptionName.get(name);
        if ( nodeOptionType === undefined ) {
            nodeOptionType = this.reNoopOption.test(name)
                ? NODE_TYPE_NET_OPTION_NAME_NOOP
                : NODE_TYPE_NET_OPTION_NAME_UNKNOWN;
        }
        next = this.allocTypedNode(
            nodeOptionType,
            parentBeg + nameBeg,
            parentBeg + nameEnd
        );
        if (
            nodeOptionType !== NODE_TYPE_NET_OPTION_NAME_NOOP &&
            this.getBranchFromType(nodeOptionType) !== 0
        ) {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
            this.astError = AST_ERROR_OPTION_DUPLICATE;
        } else {
            this.addNodeToRegister(nodeOptionType, parent);
        }
        prev = this.linkRight(prev, next);
        if ( assigned === false ) {
            parseDetails.node = this.throwHeadNode(head);
            parseDetails.len = matchEnd;
            return;
        }
        next = this.allocTypedNode(
            NODE_TYPE_NET_OPTION_ASSIGN,
            parentBeg + matchEnd - 1,
            parentBeg + matchEnd
        );
        prev = this.linkRight(prev, next);
        this.addNodeFlags(parent, NODE_FLAG_OPTION_HAS_VALUE);
        const details = this.netOptionValueParser.nextArg(s, matchEnd);
        if ( details.quoteBeg !== details.argBeg ) {
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTION_QUOTE,
                parentBeg + details.quoteBeg,
                parentBeg + details.argBeg
            );
            prev = this.linkRight(prev, next);
        } else {
            const argEnd = this.endOfNetOption(s, matchEnd);
            if ( argEnd !== details.argEnd ) {
                details.argEnd = details.quoteEnd = argEnd;
            }
        }
        next = this.allocTypedNode(
            NODE_TYPE_NET_OPTION_VALUE,
            parentBeg + details.argBeg,
            parentBeg + details.argEnd
        );
        if ( details.argBeg === details.argEnd ) {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
            this.astError = AST_ERROR_OPTION_BADVALUE;
        } else if ( details.transform ) {
            const arg = s.slice(details.argBeg, details.argEnd);
            this.setNodeTransform(next, this.netOptionValueParser.normalizeArg(arg));
        }
        switch ( nodeOptionType ) {
        case NODE_TYPE_NET_OPTION_NAME_DENYALLOW:
            this.linkDown(next, this.parseDomainList(next, '|'), DOMAIN_FROM_DENYALLOW_LIST);
            break;
        case NODE_TYPE_NET_OPTION_NAME_FROM:
        case NODE_TYPE_NET_OPTION_NAME_TO:
        case NODE_TYPE_NET_OPTION_NAME_TOP:
            this.linkDown(next, this.parseDomainList(next, '|', DOMAIN_FROM_FROMTO_LIST));
            break;
        default:
            break;
        }
        prev = this.linkRight(prev, next);
        if ( details.quoteEnd !== details.argEnd ) {
            next = this.allocTypedNode(
                NODE_TYPE_NET_OPTION_QUOTE,
                parentBeg + details.argEnd,
                parentBeg + details.quoteEnd
            );
            this.linkRight(prev, next);
        }
        parseDetails.node = this.throwHeadNode(head);
        parseDetails.len = details.quoteEnd;
    }

    endOfNetOption(s, beg) {
        const match = this.reNetOptionComma.exec(s.slice(beg));
        return match !== null ? beg + match.index : s.length;
    }

    getNetOptionValue(type) {
        if ( this.nodeTypeRegister.includes(type) === false ) { return ''; }
        const optionNode = this.nodeTypeLookupTable[type];
        if ( optionNode === 0 ) { return ''; }
        const valueNode = this.findDescendantByType(optionNode, NODE_TYPE_NET_OPTION_VALUE);
        if ( valueNode === 0 ) { return ''; }
        return this.getNodeTransform(valueNode);
    }

    parseDomainList(parent, separator, mode = 0) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const containerNode = this.allocTypedNode(
            NODE_TYPE_OPTION_VALUE_DOMAIN_LIST,
            parentBeg,
            parentEnd
        );
        if ( parentEnd === parentBeg ) { return containerNode; }
        const separatorCode = separator.charCodeAt(0);
        const parseDetails = { separator, mode, node: 0, len: 0 };
        const listNode = this.allocHeadNode();
        let prev = listNode;
        let domainNode = 0;
        let separatorNode = 0;
        const s = this.getNodeString(parent);
        const listEnd = s.length;
        let beg = 0, end = 0;
        while ( beg < listEnd ) {
            const next = this.allocTypedNode(
                NODE_TYPE_OPTION_VALUE_DOMAIN_RAW,
                parentBeg + beg,
                parentBeg + listEnd // open ended
            );
            this.parseDomain(next, parseDetails);
            end = beg + parseDetails.len;
            const badSeparator = end < listEnd && s.charCodeAt(end) !== separatorCode;
            if ( badSeparator ) {
                end = s.indexOf(separator, end);
                if ( end === -1 ) { end = listEnd; }
            }
            this.nodes[next+NODE_END_INDEX] = parentBeg + end;
            if ( end !== beg ) {
                domainNode = next;
                this.linkDown(domainNode, parseDetails.node);
                prev = this.linkRight(prev, domainNode);
                if ( badSeparator ) {
                    this.addNodeFlags(domainNode, NODE_FLAG_ERROR);
                    this.addFlags(AST_FLAG_HAS_ERROR);
                }
            } else {
                domainNode = 0;
                if ( separatorNode !== 0 ) {
                    this.addNodeFlags(separatorNode, NODE_FLAG_ERROR);
                    this.addFlags(AST_FLAG_HAS_ERROR);
                }
            }
            if ( s.charCodeAt(end) === separatorCode ) {
                beg = end;
                end += 1;
                separatorNode = this.allocTypedNode(
                    NODE_TYPE_OPTION_VALUE_SEPARATOR,
                    parentBeg + beg,
                    parentBeg + end
                );
                prev = this.linkRight(prev, separatorNode);
                if ( domainNode === 0 ) {
                    this.addNodeFlags(separatorNode, NODE_FLAG_ERROR);
                    this.addFlags(AST_FLAG_HAS_ERROR);
                }
            } else {
                separatorNode = 0;
            }
            beg = end;
        }
        // Dangling separator node
        if ( separatorNode !== 0 ) {
            this.addNodeFlags(separatorNode, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        this.linkDown(containerNode, this.throwHeadNode(listNode));
        return containerNode;
    }

    parseDomain(parent, parseDetails) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const not = this.charCodeAt(parentBeg) === 0x7E /* ~ */;
        let head = 0, next = 0;
        let beg = parentBeg;
        if ( not ) {
            this.addNodeFlags(parent, NODE_FLAG_IS_NEGATED);
            head = this.allocTypedNode(NODE_TYPE_OPTION_VALUE_NOT, beg, beg + 1);
            if ( (parseDetails.mode & DOMAIN_CAN_BE_NEGATED) === 0 ) {
                this.addNodeFlags(parent, NODE_FLAG_ERROR);
            }
            beg += 1;
        }
        const c0 = this.charCodeAt(beg);
        let end = beg;
        let isRegex = false;
        if ( c0 === 0x2F /* / */ ) {
            this.domainRegexValueParser.nextArg(this.raw, beg+1);
            end = this.domainRegexValueParser.separatorEnd;
            if ( end <= parentEnd ) {
                isRegex = true;
            } else {
                end = -1;
            }
        } else if ( c0 === 0x5B /* [ */ && this.startsWith('[$domain=/', beg) ) {
            end = this.indexOf('/]', beg + 10, parentEnd);
            if ( end !== -1 ) { end += 2; }
            isRegex = true;
        } else {
            end = this.indexOf(parseDetails.separator, end, parentEnd);
        }
        if ( end === -1 ) { end = parentEnd; }
        if ( beg !== end ) {
            next = this.allocTypedNode(NODE_TYPE_OPTION_VALUE_DOMAIN, beg, end);
            const hn = this.normalizeDomainValue(next, isRegex, parseDetails.mode);
            if ( hn !== undefined ) {
                if ( hn !== '' ) {
                    this.setNodeTransform(next, hn);
                } else {
                    this.addNodeFlags(parent, NODE_FLAG_ERROR);
                    this.addFlags(AST_FLAG_HAS_ERROR);
                    this.astError = AST_ERROR_DOMAIN_NAME;
                }
            }
            if ( head === 0 ) {
                head = next;
            } else {
                this.linkRight(head, next);
            }
        } else {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        parseDetails.node = head;
        parseDetails.len = end - parentBeg;
    }

    normalizeDomainValue(node, isRegex, modeBits) {
        const raw = this.getNodeString(node);
        if ( isRegex ) {
            if ( (modeBits & DOMAIN_CAN_BE_REGEX) === 0 ) { return ''; }
            return this.normalizeDomainRegexValue(raw);
        }
        // Common: Assume plain hostname
        const r1 = this.normalizeHostnameValue(raw, modeBits);
        if ( r1 === undefined ) { return; }
        if ( r1 !== '' ) { return r1; }
        // Rare: Maybe advanced syntax is used
        const match = this.reAdvancedDomainSyntax.exec(raw);
        if ( match === null ) { return '' };
        const isAncestor = match[2] !== undefined;
        if ( isAncestor && (modeBits & DOMAIN_CAN_BE_ANCESTOR) === 0 ) { return ''; }
        const hasPath = match[3] !== undefined;
        if ( hasPath && (modeBits & DOMAIN_CAN_HAVE_PATH) === 0 ) { return ''; }
        if ( isAncestor && hasPath ) { return ''; }
        const r2 = this.normalizeHostnameValue(match[1], modeBits);
        if ( r2 === undefined ) { return; }
        if ( r2 === '' ) { return ''; }
        return `${r2}${match[2] ?? ''}${match[3] ?? ''}`;
    }

    normalizeDomainRegexValue(before) {
        const regex = before.startsWith('[$domain=/')
            ? `${before.slice(9, -1)}`
            : before;
        // TODO: Remove unescaping of `|` once AdGuard filters no longer unduly
        // escape. In the mean time, if a literal `|` is needed in a path-based
        // regex, the solution is to use `\x7C` instead of `\|`.
        const source = this.normalizeRegexPattern(regex.replace(/\\\|/g, '|'));
        if ( source === '' ) { return ''; }
        const after = `/${source}/`;
        if ( after === before ) { return; }
        return after;
    }

    parseExt(parent, anchorBeg, anchorLen) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        this.astType = AST_TYPE_EXTENDED;
        this.addFlags(this.extFlagsFromAnchor(anchorBeg));
        if ( anchorBeg > parentBeg ) {
            next = this.allocTypedNode(
                NODE_TYPE_EXT_OPTIONS,
                parentBeg,
                anchorBeg
            );
            this.addFlags(AST_FLAG_HAS_OPTIONS);
            this.addNodeToRegister(NODE_TYPE_EXT_OPTIONS, next);
            const down = this.parseDomainList(next, ',', DOMAIN_FROM_EXT_LIST);
            this.linkDown(next, down);
            prev = this.linkRight(prev, next);
        }
        next = this.allocTypedNode(
            NODE_TYPE_EXT_OPTIONS_ANCHOR,
            anchorBeg,
            anchorBeg + anchorLen
        );
        this.addNodeToRegister(NODE_TYPE_EXT_OPTIONS_ANCHOR, next);
        prev = this.linkRight(prev, next);
        next = this.allocTypedNode(
            NODE_TYPE_EXT_PATTERN_RAW,
            anchorBeg + anchorLen,
            parentEnd
        );
        this.addNodeToRegister(NODE_TYPE_EXT_PATTERN_RAW, next);
        const down = this.parseExtPattern(next);
        if ( down !== 0 ) {
            this.linkDown(next, down);
        } else {
            this.addNodeFlags(next, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        this.linkRight(prev, next);
        this.validateExt();
        return this.throwHeadNode(head);
    }

    extFlagsFromAnchor(anchorBeg) {
        let c = this.charCodeAt(anchorBeg+1) ;
        if ( c === 0x23 /* # */ ) { return 0; }
        if ( c === 0x25 /* % */ ) { return AST_FLAG_EXT_SCRIPTLET_ADG; }
        if ( c === 0x3F /* ? */ ) { return AST_FLAG_EXT_STRONG; }
        if ( c === 0x24 /* $ */ ) {
            c = this.charCodeAt(anchorBeg+2);
            if ( c === 0x23 /* # */ ) { return AST_FLAG_EXT_STYLE; }
            if ( c === 0x3F /* ? */ ) {
                return AST_FLAG_EXT_STYLE | AST_FLAG_EXT_STRONG;
            }
        }
        if ( c === 0x40 /* @ */ ) {
            return AST_FLAG_IS_EXCEPTION | this.extFlagsFromAnchor(anchorBeg+1);
        }
        return AST_FLAG_UNSUPPORTED | AST_FLAG_HAS_ERROR;
    }

    validateExt() {
        const isException = this.isException();
        let realBad = false;
        for ( let i = 0, n = this.nodeTypeRegisterPtr; i < n; i++ ) {
            const type = this.nodeTypeRegister[i];
            const targetNode = this.nodeTypeLookupTable[type];
            if ( targetNode === 0 ) { continue; }
            const flags = this.getNodeFlags(targetNode);
            if ( (flags & NODE_FLAG_ERROR) !== 0 ) { continue; }
            realBad = false;
            switch ( type ) {
            case NODE_TYPE_EXT_PATTERN_RESPONSEHEADER: {
                const pattern = this.getNodeString(targetNode);
                realBad =
                    pattern !== '' && removableHTTPHeaders.has(pattern) === false ||
                    pattern === '' && isException === false;
                break;
            }
            case NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN: {
                if ( isException ) { break; }
                const { trustedSource, trustedTokens } = this.options;
                if ( trustedSource ) { break; }
                if ( trustedTokens instanceof Set === false ) { break; }
                const token = this.getNodeString(targetNode);
                if ( trustedTokens.has(token) ) {
                    this.astError = AST_ERROR_UNTRUSTED_SOURCE;
                    realBad = true;
                }
                break;
            }
            default:
                break;
            }
            if ( realBad ) {
                this.addNodeFlags(targetNode, NODE_FLAG_ERROR);
                this.addFlags(AST_FLAG_HAS_ERROR);
            }
        }
    }

    parseExtPattern(parent) {
        const c = this.charCodeAt(this.nodes[parent+NODE_BEG_INDEX]);
        // ##+js(...)
        if ( c === 0x2B /* + */ ) {
            const s = this.getNodeString(parent);
            if ( /^\+js\(.*\)$/.exec(s) !== null ) {
                this.astTypeFlavor = AST_TYPE_EXTENDED_SCRIPTLET;
                return this.parseExtPatternScriptlet(parent);
            }
        }
        // #%#//scriptlet(...)
        if ( this.getFlags(AST_FLAG_EXT_SCRIPTLET_ADG) ) {
            const s = this.getNodeString(parent);
            if ( /^\/\/scriptlet\(.*\)$/.exec(s) !== null ) {
                this.astTypeFlavor = AST_TYPE_EXTENDED_SCRIPTLET;
                return this.parseExtPatternScriptlet(parent);
            }
            return 0;
        }
        // ##^... | ##^responseheader(...)
        if ( c === 0x5E /* ^ */ ) {
            const s = this.getNodeString(parent);
            if ( this.reResponseheaderPattern.test(s) ) {
                this.astTypeFlavor = AST_TYPE_EXTENDED_RESPONSEHEADER;
                return this.parseExtPatternResponseheader(parent);
            }
            this.astTypeFlavor = AST_TYPE_EXTENDED_HTML;
            if ( this.options.canFilterResponseBody !== true ) {
                this.astError = AST_ERROR_CAPABILITY;
                return 0;
            }
            return this.parseExtPatternHtml(parent);
        }
        // ##...
        this.astTypeFlavor = AST_TYPE_EXTENDED_COSMETIC;
        return this.parseExtPatternCosmetic(parent);
    }

    parseExtPatternScriptlet(parent) {
        const beg = this.nodes[parent+NODE_BEG_INDEX];
        const end = this.nodes[parent+NODE_END_INDEX];
        const s = this.getNodeString(parent);
        const rawArg0 = beg + (s.startsWith('+js') ? 4 : 12);
        const rawArg1 = end - 1;
        const head = this.allocTypedNode(NODE_TYPE_EXT_DECORATION, beg, rawArg0);
        let prev = head, next = 0;
        next = this.allocTypedNode(NODE_TYPE_EXT_PATTERN_SCRIPTLET, rawArg0, rawArg1);
        this.addNodeToRegister(NODE_TYPE_EXT_PATTERN_SCRIPTLET, next);
        this.linkDown(next, this.parseExtPatternScriptletArgs(next));
        prev = this.linkRight(prev, next);
        next = this.allocTypedNode(NODE_TYPE_EXT_DECORATION, rawArg1, end);
        this.linkRight(prev, next);
        return head;
    }

    parseExtPatternScriptletArgs(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        if ( parentEnd === parentBeg ) { return 0; }
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        const s = this.getNodeString(parent);
        const argsEnd = s.length;
        // token
        this.scriptletArgListParser.mustQuote = 
            this.getFlags(AST_FLAG_EXT_SCRIPTLET_ADG) !== 0;
        const details = this.scriptletArgListParser.nextArg(s, 0);
        if ( details.argBeg > 0 ) {
            next = this.allocTypedNode(
                NODE_TYPE_EXT_DECORATION,
                parentBeg,
                parentBeg + details.argBeg
            );
            prev = this.linkRight(prev, next);
        }
        const token = s.slice(details.argBeg, details.argEnd);
        const tokenEnd = details.argEnd - (token.endsWith('.js') ? 3 : 0);
        next = this.allocTypedNode(
            NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN,
            parentBeg + details.argBeg,
            parentBeg + tokenEnd
        );
        this.addNodeToRegister(NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN, next);
        if ( details.failed ) {
            this.addNodeFlags(next, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        prev = this.linkRight(prev, next);
        if ( tokenEnd < details.argEnd ) {
            next = this.allocTypedNode(
                NODE_TYPE_IGNORE,
                parentBeg + tokenEnd,
                parentBeg + details.argEnd
            );
            prev = this.linkRight(prev, next);
        }
        if ( details.quoteEnd < argsEnd ) {
            next = this.allocTypedNode(
                NODE_TYPE_EXT_DECORATION,
                parentBeg + details.argEnd,
                parentBeg + details.separatorEnd
            );
            prev = this.linkRight(prev, next);
        }
        // all args
        next = this.allocTypedNode(
            NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARGS,
            parentBeg + details.separatorEnd,
            parentBeg + argsEnd
        );
        this.linkDown(next, this.parseExtPatternScriptletArglist(next));
        this.linkRight(prev, next);
        return this.throwHeadNode(head);
    }

    parseExtPatternScriptletArglist(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        if ( parentEnd === parentBeg ) { return 0; }
        const s = this.getNodeString(parent);
        const argsEnd = s.length;
        const head = this.allocHeadNode();
        let prev = head, next = 0;
        let decorationBeg = 0;
        let i = 0;
        for (;;) {
            const details = this.scriptletArgListParser.nextArg(s, i);
            if ( decorationBeg < details.argBeg ) {
                next = this.allocTypedNode(
                    NODE_TYPE_EXT_DECORATION,
                    parentBeg + decorationBeg,
                    parentBeg + details.argBeg
                );
                prev = this.linkRight(prev, next);
            }
            if ( i === argsEnd ) { break; }
            next = this.allocTypedNode(
                NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG,
                parentBeg + details.argBeg,
                parentBeg + details.argEnd
            );
            if ( details.transform ) {
                const arg = s.slice(details.argBeg, details.argEnd);
                this.setNodeTransform(next,
                    this.scriptletArgListParser.normalizeArg(arg)
                );
            }
            prev = this.linkRight(prev, next);
            if ( details.failed ) {
                this.addNodeFlags(next, NODE_FLAG_ERROR);
                this.addFlags(AST_FLAG_HAS_ERROR);
            }
            decorationBeg = details.argEnd;
            i = details.separatorEnd;
        }
        return this.throwHeadNode(head);
    }

    getScriptletArgs() {
        const args = [];
        if ( this.isScriptletFilter() === false ) { return args; }
        const root = this.getBranchFromType(NODE_TYPE_EXT_PATTERN_SCRIPTLET);
        const walker = this.getWalker(root);
        for ( let node = walker.next(); node !== 0; node = walker.next() ) {
            switch ( this.getNodeType(node) ) {
            case NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN:
            case NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG:
                args.push(this.getNodeTransform(node));
                break;
            default:
                break;
            }
        }
        walker.dispose();
        return args;
    }

    parseExtPatternResponseheader(parent) {
        const beg = this.nodes[parent+NODE_BEG_INDEX];
        const end = this.nodes[parent+NODE_END_INDEX];
        const s = this.getNodeString(parent);
        const rawArg0 = beg + 16;
        const rawArg1 = end - 1;
        const head = this.allocTypedNode(NODE_TYPE_EXT_DECORATION, beg, rawArg0);
        let prev = head, next = 0;
        const trimmedArg0 = rawArg0 + this.leftWhitespaceCount(s);
        const trimmedArg1 = rawArg1 - this.rightWhitespaceCount(s);
        if ( trimmedArg0 !== rawArg0 ) {
            next = this.allocTypedNode(NODE_TYPE_WHITESPACE, rawArg0, trimmedArg0);
            prev = this.linkRight(prev, next);
        }
        next = this.allocTypedNode(NODE_TYPE_EXT_PATTERN_RESPONSEHEADER, rawArg0, rawArg1);
        this.addNodeToRegister(NODE_TYPE_EXT_PATTERN_RESPONSEHEADER, next);
        if ( rawArg1 === rawArg0 && this.isException() === false ) {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        prev = this.linkRight(prev, next);
        if ( trimmedArg1 !== rawArg1 ) {
            next = this.allocTypedNode(NODE_TYPE_WHITESPACE, trimmedArg1, rawArg1);
            prev = this.linkRight(prev, next);
        }
        next = this.allocTypedNode(NODE_TYPE_EXT_DECORATION, rawArg1, end);
        this.linkRight(prev, next);
        return head;
    }

    getResponseheaderName() {
        if ( this.isResponseheaderFilter() === false ) { return ''; }
        const root = this.getBranchFromType(NODE_TYPE_EXT_PATTERN_RESPONSEHEADER);
        return this.getNodeString(root);
    }

    parseExtPatternHtml(parent) {
        const beg = this.nodes[parent+NODE_BEG_INDEX];
        const end = this.nodes[parent+NODE_END_INDEX];
        const head = this.allocTypedNode(NODE_TYPE_EXT_DECORATION, beg, beg + 1);
        let prev = head, next = 0;
        next = this.allocTypedNode(NODE_TYPE_EXT_PATTERN_HTML, beg + 1, end);
        this.linkRight(prev, next);
        if ( (this.hasOptions() || this.isException()) === false ) {
            this.addNodeFlags(parent, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
            return head;
        }
        this.result.exception = this.isException();
        this.result.raw = this.getNodeString(next);
        this.result.compiled = undefined;
        const success = this.selectorCompiler.compile(
            this.result.raw,
            this.result, {
                asProcedural: this.getFlags(AST_FLAG_EXT_STRONG) !== 0
            }
        );
        if ( success !== true ) {
            this.addNodeFlags(next, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        return head;
    }

    parseExtPatternCosmetic(parent) {
        const parentBeg = this.nodes[parent+NODE_BEG_INDEX];
        const parentEnd = this.nodes[parent+NODE_END_INDEX];
        const head = this.allocTypedNode(
            NODE_TYPE_EXT_PATTERN_COSMETIC,
            parentBeg,
            parentEnd
        );
        this.addNodeToRegister(NODE_TYPE_EXT_PATTERN_COSMETIC, head);
        this.result.exception = this.isException();
        this.result.raw = this.getNodeString(head);
        this.result.compiled = undefined;
        const success = this.selectorCompiler.compile(
            this.result.raw,
            this.result, {
                asProcedural: this.getFlags(AST_FLAG_EXT_STRONG) !== 0,
                adgStyleSyntax: this.getFlags(AST_FLAG_EXT_STYLE) !== 0,
            }
        );
        if ( success !== true ) {
            this.addNodeFlags(head, NODE_FLAG_ERROR);
            this.addFlags(AST_FLAG_HAS_ERROR);
        }
        return head;
    }

    hasError() {
        return (this.astFlags & AST_FLAG_HAS_ERROR) !== 0;
    }

    isUnsupported() {
        return (this.astFlags & AST_FLAG_UNSUPPORTED) !== 0;
    }

    hasOptions() {
        return (this.astFlags & AST_FLAG_HAS_OPTIONS) !== 0;
    }

    isNegatedOption(type) {
        const node = this.nodeTypeLookupTable[type];
        const flags = this.nodes[node+NODE_FLAGS_INDEX];
        return (flags & NODE_FLAG_IS_NEGATED) !== 0;
    }

    isException() {
        return (this.astFlags & AST_FLAG_IS_EXCEPTION) !== 0;
    }

    isLeftHnAnchored() {
        return (this.astFlags & AST_FLAG_NET_PATTERN_LEFT_HNANCHOR) !== 0;
    }

    isLeftAnchored() {
        return (this.astFlags & AST_FLAG_NET_PATTERN_LEFT_ANCHOR) !== 0;
    }

    isRightAnchored() {
        return (this.astFlags & AST_FLAG_NET_PATTERN_RIGHT_ANCHOR) !== 0;
    }

    linkRight(prev, next) {
        return (this.nodes[prev+NODE_RIGHT_INDEX] = next);
    }

    linkDown(node, down) {
        return (this.nodes[node+NODE_DOWN_INDEX] = down);
    }

    makeChain(nodes) {
        for ( let i = 1; i < nodes.length; i++ ) {
            this.nodes[nodes[i-1]+NODE_RIGHT_INDEX] = nodes[i];
        }
        return nodes[0];
    }

    allocHeadNode() {
        const node = this.nodePoolPtr;
        this.nodePoolPtr += NOOP_NODE_SIZE;
        if ( this.nodePoolPtr > this.nodePoolEnd ) {
            this.growNodePool(this.nodePoolPtr);
        }
        this.nodes[node+NODE_RIGHT_INDEX] = 0;
        return node;
    }

    throwHeadNode(head) {
        return this.nodes[head+NODE_RIGHT_INDEX];
    }

    allocTypedNode(type, beg, end) {
        const node = this.nodePoolPtr;
        this.nodePoolPtr += FULL_NODE_SIZE;
        if ( this.nodePoolPtr > this.nodePoolEnd ) {
            this.growNodePool(this.nodePoolPtr);
        }
        this.nodes[node+NODE_RIGHT_INDEX] = 0;
        this.nodes[node+NODE_TYPE_INDEX] = type;
        this.nodes[node+NODE_DOWN_INDEX] = 0;
        this.nodes[node+NODE_BEG_INDEX] = beg;
        this.nodes[node+NODE_END_INDEX] = end;
        this.nodes[node+NODE_TRANSFORM_INDEX] = 0;
        this.nodes[node+NODE_FLAGS_INDEX] = 0;
        return node;
    }

    allocSentinelNode(type, beg) {
        return this.allocTypedNode(type, beg, beg);
    }

    growNodePool(min) {
        const oldSize = this.nodes.length;
        const newSize = (min + 16383) & ~16383;
        if ( newSize === oldSize ) { return; }
        const newArray = new Uint32Array(newSize);
        newArray.set(this.nodes);
        this.nodes = newArray;
        this.nodePoolEnd = newSize;
    }

    getNodeTypes() {
        return this.nodeTypeRegister.slice(0, this.nodeTypeRegisterPtr);
    }

    getNodeType(node) {
        return node !== 0 ? this.nodes[node+NODE_TYPE_INDEX] : 0;
    }

    getNodeFlags(node, flags = 0xFFFFFFFF) {
        return this.nodes[node+NODE_FLAGS_INDEX] & flags;
    }

    setNodeFlags(node, flags) {
        this.nodes[node+NODE_FLAGS_INDEX] = flags;
    }

    addNodeFlags(node, flags) {
        if ( node === 0 ) { return; }
        this.nodes[node+NODE_FLAGS_INDEX] |= flags;
    }

    removeNodeFlags(node, flags) {
        this.nodes[node+NODE_FLAGS_INDEX] &= ~flags;
    }

    addNodeToRegister(type, node) {
        this.nodeTypeRegister[this.nodeTypeRegisterPtr++] = type;
        this.nodeTypeLookupTable[type] = node;
    }

    getBranchFromType(type) {
        const ptr = this.nodeTypeRegisterPtr;
        if ( ptr === 0 ) { return 0; }
        return this.nodeTypeRegister.lastIndexOf(type, ptr-1) !== -1
            ? this.nodeTypeLookupTable[type]
            : 0;
    }

    nodeIsEmptyString(node) {
        return this.nodes[node+NODE_END_INDEX] ===
            this.nodes[node+NODE_BEG_INDEX];
    }

    getNodeString(node) {
        const beg = this.nodes[node+NODE_BEG_INDEX];
        const end = this.nodes[node+NODE_END_INDEX];
        if ( end === beg ) { return ''; }
        if ( beg === 0 && end === this.rawEnd ) {
            return this.raw;
        }
        return this.raw.slice(beg, end);
    }

    getNodeStringBeg(node) {
        return this.nodes[node+NODE_BEG_INDEX];
    }

    getNodeStringEnd(node) {
        return this.nodes[node+NODE_END_INDEX];
    }

    getNodeStringLen(node) {
        if ( node === 0 ) { return ''; }
        return this.nodes[node+NODE_END_INDEX] - this.nodes[node+NODE_BEG_INDEX];
    }

    isNodeTransformed(node) {
        return this.nodes[node+NODE_TRANSFORM_INDEX] !== 0;
    }

    getNodeTransform(node) {
        if ( node === 0 ) { return ''; }
        const slot = this.nodes[node+NODE_TRANSFORM_INDEX];
        return slot !== 0 ? this.astTransforms[slot] : this.getNodeString(node);
    }

    setNodeTransform(node, value) {
        const slot = this.astTransformPtr++;
        this.astTransforms[slot] = value;
        this.nodes[node+NODE_TRANSFORM_INDEX] = slot;
    }

    getTypeString(type) {
        const node = this.getBranchFromType(type);
        if ( node === 0 ) { return; }
        return this.getNodeString(node);
    }

    leftWhitespaceCount(s) {
        const match = this.reWhitespaceStart.exec(s);
        return match === null ? 0 : match[0].length;
    }

    rightWhitespaceCount(s) {
        const match = this.reWhitespaceEnd.exec(s);
        return match === null ? 0 : match[1].length;
    }

    nextCommaInCommaSeparatedListString(s, start) {
        const n = s.length;
        if ( n === 0 ) { return -1; }
        const ilastchar = n - 1;
        let i = start;
        while ( i < n ) {
            const c = s.charCodeAt(i);
            if ( c === 0x2C /* ',' */ ) { return i + 1; }
            if ( c === 0x5C /* '\\' */ ) {
                if ( i < ilastchar ) { i += 1; }
            }
        }
        return -1;
    }

    endOfLiteralRegex(s, start) {
        const n = s.length;
        if ( n === 0 ) { return -1; }
        const ilastchar = n - 1;
        let i = start + 1;
        while ( i < n ) {
            const c = s.charCodeAt(i);
            if ( c === 0x2F /* '/' */ ) { return i + 1; }
            if ( c === 0x5C /* '\\' */ ) {
                if ( i < ilastchar ) { i += 1; }
            }
            i += 1;
        }
        return -1;
    }

    charCodeAt(pos) {
        return pos < this.rawEnd ? this.raw.charCodeAt(pos) : -1;
    }

    indexOf(needle, beg, end = 0) {
        const haystack = end === 0 ? this.raw : this.raw.slice(0, end);
        return haystack.indexOf(needle, beg);
    }

    startsWith(s, pos) {
        return pos < this.rawEnd && this.raw.startsWith(s, pos);
    }

    isTokenCharCode(c) {
        return c === 0x25 ||
            c >= 0x30 && c <= 0x39 ||
            c >= 0x41 && c <= 0x5A ||
            c >= 0x61 && c <= 0x7A;
    }

    // Ultimately, let the browser API do the hostname normalization, after
    // making some other trivial checks.
    //
    // returns:
    //   undefined: no normalization needed, use original hostname
    //   empty string: hostname is invalid
    //   non-empty string: normalized hostname
    normalizeHostnameValue(s, modeBits = 0) {
        if ( this.reHostnameAscii.test(s) ) { return; }
        if ( this.reBadHostnameChars.test(s) ) { return ''; }
        let hn = s;
        const hasWildcard = hn.includes('*');
        if ( hasWildcard ) {
            if ( modeBits === 0 ) { return ''; }
            if ( hn.length === 1 ) {
                if ( (modeBits & DOMAIN_CAN_USE_SINGLE_WILDCARD) === 0 ) { return ''; }
                return;
            }
            if ( (modeBits & DOMAIN_CAN_USE_ENTITY) !== 0 ) {
                if ( this.rePlainEntity.test(hn) ) { return; }
                if ( this.reIsEntity.test(hn) === false ) { return ''; }
            } else if ( (modeBits & DOMAIN_CAN_USE_WILDCARD) === 0 ) {
                return '';
            }
            hn = hn.replace(/\*/g, '__asterisk__');
        }
        this.punycoder.hostname = '_';
        try {
            this.punycoder.hostname = hn;
            hn = this.punycoder.hostname;
        } catch {
            return '';
        }
        if ( hn === '_' || hn === '' ) { return ''; }
        if ( hasWildcard ) {
            hn = this.punycoder.hostname.replace(/__asterisk__/g, '*');
        }
        if (
            (modeBits & DOMAIN_CAN_USE_WILDCARD) === 0 && (
                hn.charCodeAt(0) === 0x2E /* . */ ||
                exCharCodeAt(hn, -1) === 0x2E /* . */
            )
        ) {
            return '';
        }
        return hn;
    }

    normalizeRegexPattern(s) {
        try {
            const source = /^\/.+\/$/.test(s) ? s.slice(1,-1) : s;
            const regex = new RegExp(source);
            return regex.source;
        } catch (ex) {
            this.normalizeRegexPattern.message = ex.toString();
        }
        return '';
    }

    getDomainListIterator(root) {
        const iter = this.domainListIteratorJunkyard.length !== 0
            ? this.domainListIteratorJunkyard.pop().reuse(root)
            : new DomainListIterator(this, root);
        return root !== 0 ? iter : iter.stop();
    }

    getNetFilterFromOptionIterator() {
        return this.getDomainListIterator(
            this.getBranchFromType(NODE_TYPE_NET_OPTION_NAME_FROM)
        );
    }

    getNetFilterTopOptionIterator() {
        return this.getDomainListIterator(
            this.getBranchFromType(NODE_TYPE_NET_OPTION_NAME_TOP)
        );
    }

    getNetFilterToOptionIterator() {
        return this.getDomainListIterator(
            this.getBranchFromType(NODE_TYPE_NET_OPTION_NAME_TO)
        );
    }

    getNetFilterDenyallowOptionIterator() {
        return this.getDomainListIterator(
            this.getBranchFromType(NODE_TYPE_NET_OPTION_NAME_DENYALLOW)
        );
    }

    getExtFilterDomainIterator() {
        return this.getDomainListIterator(
            this.getBranchFromType(NODE_TYPE_EXT_OPTIONS)
        );
    }

    getWalker(from) {
        if ( this.walkerJunkyard.length === 0 ) {
            return new AstWalker(this, from);
        }
        const walker = this.walkerJunkyard.pop();
        walker.reset(from);
        return walker;
    }

    findDescendantByType(from, type) {
        const walker = this.getWalker(from);
        let node = walker.next();
        while ( node !== 0 ) {
            if ( this.getNodeType(node) === type ) { return node; }
            node = walker.next();
        }
        return 0;
    }

    dump() {
        if ( this.astType === AST_TYPE_COMMENT ) { return; }
        const walker = this.getWalker();
        for ( let node = walker.reset(); node !== 0; node = walker.next() ) {
            const type = this.nodes[node+NODE_TYPE_INDEX];
            const value = this.getNodeString(node);
            const name = nodeNameFromNodeType.get(type) || `${type}`;
            const bits = this.getNodeFlags(node).toString(2).padStart(4, '0');
            const indent = '  '.repeat(walker.depth);
            console.log(`${indent}type=${name} "${value}" 0b${bits}`);
            if ( this.isNodeTransformed(node) ) {
                console.log(`${indent}    transform="${this.getNodeTransform(node)}"`);
            }
        }
    }
}

/******************************************************************************/

function parseRedirectValue(arg) {
    let token = arg.trim();
    let priority = 0;
    const asDataURI = token.charCodeAt(0) === 0x25 /* '%' */;
    if ( asDataURI ) { token = token.slice(1); }
    const match = /:-?\d+$/.exec(token);
    if ( match !== null ) {
        priority = parseInt(token.slice(match.index + 1), 10);
        token = token.slice(0, match.index);
    }
    return { token, priority, asDataURI };
}

function parseQueryPruneValue(arg) {
    let s = arg.trim();
    if ( s === '' ) { return { all: true }; }
    const out = { };
    out.not = s.charCodeAt(0) === 0x7E /* '~' */;
    if ( out.not ) {
        s = s.slice(1);
    }
    const match = /^\/(.+)\/(i)?$/.exec(s);
    if ( match !== null ) {
        try {
            out.re = new RegExp(match[1], match[2] || '');
        }
        catch {
            out.bad = true;
        }
        return out;
    }
    // TODO: remove once no longer used in filter lists
    if ( s.startsWith('|') ) {
        try {
            out.re = new RegExp('^' + s.slice(1), 'i');
        } catch {
            out.bad = true;
        }
        return out;
    }
    // Multiple values not supported (because very inefficient)
    if ( s.includes('|') ) {
        out.bad = true;
        return out;
    }
    out.name = s;
    return out;
}

function parseHeaderValue(arg) {
    let s = arg.trim();
    const out = { };
    let pos = s.indexOf(':');
    if ( pos === -1 ) { pos = s.length; }
    out.name = s.slice(0, pos).toLowerCase();
    out.bad = out.name === '';
    s = s.slice(pos + 1);
    out.not = s.charCodeAt(0) === 0x7E /* '~' */;
    if ( out.not ) { s = s.slice(1); }
    out.value = s;
    if ( s === '' ) { return out; }
    const match = /^\/(.+)\/(i)?$/.exec(s);
    out.isRegex = match !== null;
    if ( out.isRegex ) {
        out.reStr = match[1];
        out.reFlags = match[2] || '';
        try { new RegExp(out.reStr, out.reFlags); }
        catch { out.bad = true; }
        return out;
    }
    out.reFlags = 'i';
    if ( /[*?]/.test(s) === false ) {
        out.reStr = escapeForRegex(s);
        return out;
    }
    const reConstruct = /(?<!\\)[*?]/g;
    const reParts = [];
    let beg = 0;
    for (;;) {
        const match = reConstruct.exec(s);
        if ( match === null ) { break; }
        reParts.push(
            escapeForRegex(s.slice(beg, match.index)),
            match[0] === '*' ? '.*' : '.?',
        );
        beg = reConstruct.lastIndex;
    }
    reParts.push(escapeForRegex(s.slice(beg)));
    out.reStr = reParts.join('');
    return out;
}

// https://adguard.com/kb/general/ad-filtering/create-own-filters/#replace-modifier

function parseReplaceByRegexValue(s) {
    if ( s.charCodeAt(0) !== 0x2F /* / */ ) { return; }
    const parser = new ArglistParser('/');
    parser.nextArg(s, 1);
    let pattern = s.slice(parser.argBeg, parser.argEnd);
    if ( parser.transform ) {
        pattern = parser.normalizeArg(pattern);
    }
    if ( pattern !== '' ) {
        pattern = parser.normalizeArg(pattern, '$');
        pattern = parser.normalizeArg(pattern, ',');
    }
    parser.nextArg(s, parser.separatorEnd);
    let replacement = s.slice(parser.argBeg, parser.argEnd);
    if ( parser.separatorEnd === parser.separatorBeg ) { return; }
    if ( parser.transform ) {
        replacement = parser.normalizeArg(replacement);
    }
    replacement = parser.normalizeArg(replacement, '$');
    replacement = parser.normalizeArg(replacement, ',');
    const flags = s.slice(parser.separatorEnd);
    if ( pattern === '' ) {
        return { flags, replacement }
    }
    try {
        return { re: new RegExp(pattern, flags), replacement };
    } catch {
    }
}

function parseReplaceValue(s) {
    if ( s.startsWith('/') ) {
        const r = parseReplaceByRegexValue(s);
        if ( r ) {
            if ( r.re === undefined ) { return; }
            r.type = 'text';
        }
        return r;
    }
    const pos = s.indexOf(':');
    if ( pos === -1 ) { return; }
    const type = s.slice(0, pos);
    if ( type === 'json' || type === 'jsonl' ) {
        const query = s.slice(pos+1);
        const jsonp = JSONPath.create(query);
        if ( jsonp.valid === false ) { return; }
        return { type, jsonp };
    }
}

/******************************************************************************/

const netOptionTokenDescriptors = new Map([
    [ '1p', { canNegate: true } ],
    /* synonym */ [ 'first-party', { canNegate: true } ],
    [ 'strict1p', { } ],
    /* synonym */ [ 'strict-first-party', { } ],
    [ '3p', { canNegate: true } ],
    /* synonym */ [ 'third-party', { canNegate: true } ],
    [ 'strict3p', { } ],
    /* synonym */ [ 'strict-third-party', { } ],
    [ 'all', { } ],
    [ 'badfilter', { } ],
    [ 'cname', { allowOnly: true } ],
    [ 'csp', { mustAssign: true } ],
    [ 'css', { canNegate: true } ],
    /* synonym */ [ 'stylesheet', { canNegate: true } ],
    [ 'denyallow', { mustAssign: true } ],
    [ 'doc', { canNegate: true } ],
    /* synonym */ [ 'document', { canNegate: true } ],
    [ 'ehide', { } ],
    /* synonym */ [ 'elemhide', { } ],
    [ 'empty', { blockOnly: true } ],
    [ 'frame', { canNegate: true } ],
    /* synonym */ [ 'subdocument', { canNegate: true } ],
    [ 'from', { mustAssign: true } ],
    /* synonym */ [ 'domain', { mustAssign: true } ],
    [ 'font', { canNegate: true } ],
    [ 'genericblock', { } ],
    [ 'ghide', { } ],
    /* synonym */ [ 'generichide', { } ],
    [ 'image', { canNegate: true } ],
    [ 'important', { blockOnly: true } ],
    [ 'inline-font', { canNegate: true } ],
    [ 'inline-script', { canNegate: true } ],
    [ 'ipaddress', { mustAssign: true } ],
    [ 'match-case', { } ],
    [ 'media', { canNegate: true } ],
    [ 'method', { mustAssign: true } ],
    [ 'mp4', { blockOnly: true } ],
    [ '_', { } ],
    [ 'object', { canNegate: true } ],
    /* synonym */ [ 'object-subrequest', { canNegate: true } ],
    [ 'other', { canNegate: true } ],
    [ 'permissions', { mustAssign: true } ],
    [ 'ping', { canNegate: true } ],
    /* synonym */ [ 'beacon', { canNegate: true } ],
    [ 'popunder', { } ],
    [ 'popup', { canNegate: true } ],
    [ 'reason', { mustAssign: true } ],
    [ 'redirect', { mustAssign: true } ],
    /* synonym */ [ 'rewrite', { mustAssign: true } ],
    [ 'redirect-rule', { mustAssign: true } ],
    [ 'removeparam', { } ],
    /* synonym */ [ 'queryprune', { } ],
    [ 'replace', { mustAssign: true } ],
    [ 'requestheader', { mustAssign: true } ],
    [ 'responseheader', { mustAssign: true } ],
    /* synonym */ [ 'header', { mustAssign: true } ],
    [ 'script', { canNegate: true } ],
    [ 'shide', { } ],
    /* synonym */ [ 'specifichide', { } ],
    [ 'to', { mustAssign: true } ],
    [ 'top', { mustAssign: true } ],
    [ 'urlskip', { mustAssign: true } ],
    [ 'uritransform', { mustAssign: true } ],
    [ 'xhr', { canNegate: true } ],
    /* synonym */ [ 'xmlhttprequest', { canNegate: true } ],
    [ 'webrtc', { } ],
    [ 'websocket', { canNegate: true } ],
]);

/******************************************************************************/

// https://github.com/chrisaljoudi/uBlock/issues/1004
//   Detect and report invalid CSS selectors.

// Discard new ABP's `-abp-properties` directive until it is
// implemented (if ever). Unlikely, see:
// https://github.com/gorhill/uBlock/issues/1752

// https://github.com/gorhill/uBlock/issues/2624
//   Convert Adguard's `-ext-has='...'` into uBO's `:has(...)`.

// https://github.com/uBlockOrigin/uBlock-issues/issues/89
//   Do not discard unknown pseudo-elements.

class ExtSelectorCompiler {
    constructor(instanceOptions = {}) {
        this.reParseRegexLiteral = /^\/(.+)\/([imu]+)?$/;

        // Use a regex for most common CSS selectors known to be valid in any
        // context.
        const cssIdentifier = '[A-Za-z_][\\w-]*';
        const cssClassOrId = `[.#]${cssIdentifier}`;
        const cssAttribute = `\\[${cssIdentifier}(?:[*^$]?="[^"\\]\\\\\\x09-\\x0D]+")?\\]`;
        const cssSimple =
            '(?:' +
            `${cssIdentifier}(?:${cssClassOrId})*(?:${cssAttribute})*` + '|' +
            `${cssClassOrId}(?:${cssClassOrId})*(?:${cssAttribute})*` + '|' +
            `${cssAttribute}(?:${cssAttribute})*` +
            ')';
        const cssCombinator = '(?: | [+>~] )';
        this.reCommonSelector = new RegExp(
            `^${cssSimple}(?:${cssCombinator}${cssSimple})*$`
        );
        // Resulting regex literal:
        // /^(?:[A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|[.#][A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\](?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*)(?:(?:\s+|\s*[>+~]\s*)(?:[A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|[.#][A-Za-z_][\w-]*(?:[.#][A-Za-z_][\w-]*)*(?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*|\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\](?:\[[A-Za-z_][\w-]*(?:[*^$]?="[^"\]\\]+")?\])*))*$/

        this.reEatBackslashes = /\\([()])/g;
        // https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-classes
        this.knownPseudoClasses = new Set([
            'active', 'any-link', 'autofill',
            'blank',
            'checked', 'current',
            'default', 'defined', 'dir', 'disabled',
            'empty', 'enabled',
            'first', 'first-child', 'first-of-type', 'fullscreen', 'future', 'focus', 'focus-visible', 'focus-within',
            'has', 'host', 'host-context', 'hover',
            'indeterminate', 'in-range', 'invalid', 'is',
            'lang', 'last-child', 'last-of-type', 'left', 'link', 'local-link',
            'modal',
            'not', 'nth-child', 'nth-col', 'nth-last-child', 'nth-last-col', 'nth-last-of-type', 'nth-of-type',
            'only-child', 'only-of-type', 'optional', 'out-of-range',
            'past', 'picture-in-picture', 'placeholder-shown', 'paused', 'playing',
            'read-only', 'read-write', 'required', 'right', 'root',
            'scope', 'state', 'target', 'target-within',
            'user-invalid', 'valid', 'visited',
            'where',
        ]);
        this.knownPseudoClassesWithArgs = new Set([
            'dir',
            'has', 'host-context',
            'is',
            'lang',
            'not', 'nth-child', 'nth-col', 'nth-last-child', 'nth-last-col', 'nth-last-of-type', 'nth-of-type',
            'state',
            'where',
        ]);
        // https://developer.mozilla.org/en-US/docs/Web/CSS/Pseudo-elements
        this.knownPseudoElements = new Set([
            'after',
            'backdrop', 'before',
            'cue', 'cue-region',
            'first-letter', 'first-line', 'file-selector-button',
            'grammar-error', 'marker',
            'part', 'placeholder',
            'selection', 'slotted', 'spelling-error',
            'target-text',
        ]);
        this.knownPseudoElementsWithArgs = new Set([
            'part',
            'slotted',
        ]);
        // https://github.com/gorhill/uBlock/issues/2793
        this.normalizedOperators = new Map([
            [ '-abp-has', 'has' ],
            [ '-abp-contains', 'has-text' ],
            [ 'contains', 'has-text' ],
            [ 'nth-ancestor', 'upward' ],
            [ 'watch-attrs', 'watch-attr' ],
        ]);
        this.actionOperators = new Set([
            ':remove',
            ':style',
        ]);
        this.proceduralOperatorNames = new Set([
            'content',
            'has-text',
            'if',
            'if-not',
            'matches-attr',
            'matches-css',
            'matches-css-after',
            'matches-css-before',
            'matches-media',
            'matches-path',
            'matches-prop',
            'min-text-length',
            'others',
            'shadow',
            'upward',
            'watch-attr',
            'xpath',
        ]);
        this.maybeProceduralOperatorNames = new Set([
            'has',
            'not',
        ]);
        this.proceduralActionNames = new Set([
            'remove',
            'remove-attr',
            'remove-class',
            'style',
        ]);
        this.normalizedExtendedSyntaxOperators = new Map([
            [ 'contains', 'has-text' ],
            [ 'has', 'has' ],
        ]);
        this.reIsRelativeSelector = /^\s*[+>~]/;
        this.reExtendedSyntax = /\[-(?:abp|ext)-[a-z-]+=(['"])(?:.+?)(?:\1)\]/;
        this.reExtendedSyntaxReplacer = /\[-(?:abp|ext)-([a-z-]+)=(['"])(.+?)\2\]/g;
        this.abpProceduralOpReplacer = /:-abp-(?:[a-z]+)\(/g;
        this.nativeCssHas = instanceOptions.nativeCssHas === true;
        // https://www.w3.org/TR/css-syntax-3/#typedef-ident-token
        this.reInvalidIdentifier = /^\d/;
        this.error = undefined;
    }

    // CSSTree library holds onto last string parsed, and this is problematic
    // when the string is a slice of a huge parent string (typically a whole
    // filter list), it causes the huge parent string to stay in memory.
    // Asking CSSTree to parse an empty string resolves this issue.
    finish() {
        cssTree.parse('');
    }

    compile(raw, out, compileOptions = {}) {
        this.asProcedural = compileOptions.asProcedural === true;

        // https://github.com/gorhill/uBlock/issues/952
        //   Find out whether we are dealing with an Adguard-specific cosmetic
        //   filter, and if so, translate it if supported, or discard it if not
        //   supported.
        //   We have an Adguard/ABP cosmetic filter if and only if the
        //   character is `$`, `%` or `?`, otherwise it's not a cosmetic
        //   filter.
        // Adguard/EasyList style injection: translate to uBO's format.
        if ( this.isStyleInjectionFilter(raw) ) {
            const translated = this.translateStyleInjectionFilter(raw);
            if ( translated === undefined ) { return false; }
            raw = translated;
        } else if ( compileOptions.adgStyleSyntax === true ) {
            return false;
        }

        // Normalize AdGuard's attribute-based procedural operators.
        // Normalize ABP's procedural operator names
        if ( this.asProcedural ) {
            if ( this.reExtendedSyntax.test(raw) ) {
                raw = raw.replace(this.reExtendedSyntaxReplacer, (a, a1, a2, a3) => {
                    const op = this.normalizedExtendedSyntaxOperators.get(a1);
                    if ( op === undefined ) { return a; }
                    return `:${op}(${a3})`;
                });
            } else {
                let asProcedural = false;
                raw = raw.replace(this.abpProceduralOpReplacer, match => {
                    if ( match === ':-abp-contains(' ) { return ':has-text('; } 
                    if ( match === ':-abp-has(' ) { return ':has('; }
                    asProcedural = true;
                    return match;
                });
                this.asProcedural = asProcedural;
            }
        }

        // Relative selectors not allowed at top level.
        if ( this.reIsRelativeSelector.test(raw) ) { return false; }

        if ( this.reCommonSelector.test(raw) ) {
            out.compiled = raw;
            return true;
        }

        this.error = undefined;
        out.compiled = this.compileSelector(raw);
        if ( out.compiled === undefined ) {
            out.error = this.error;
            return false;
        }

        if ( out.compiled instanceof Object ) {
            out.compiled.raw = raw;
            out.compiled = JSON.stringify(out.compiled);
        }
        return true;
    }

    compileSelector(raw) {
        const parts = this.astFromRaw(raw, 'selectorList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Error') ) { return; }
        if ( this.astHasType(parts, 'Selector') === false ) { return; }
        if ( this.astIsValidSelectorList(parts) === false ) { return; }
        if ( this.astHasType(parts, 'ProceduralSelector') ) {
            if ( this.astHasType(parts, 'PseudoElementSelector') ) { return; }
        } else if ( this.astHasType(parts, 'ActionSelector') === false ) {
            return this.astSerialize(parts);
        }
        const r = this.astCompile(parts);
        if ( this.isCssable(r) ) {
            r.cssable = true;
        }
        return r;
    }

    isCssable(r) {
        if ( r instanceof Object === false ) { return false; }
        if ( Array.isArray(r.action) && r.action[0] !== 'style' ) { return false; }
        if ( Array.isArray(r.tasks) === false ) { return true; }
        if ( r.tasks[0][0] === 'matches-media' ) {
            if ( r.tasks.length === 1 ) { return true; }
            if ( r.tasks.length === 2 ) {
                if ( r.selector !== '' ) { return false; }
                if ( r.tasks[1][0] === 'spath' ) { return true; }
            }
        }
        return false;
    }

    astFromRaw(raw, type) {
        let ast;
        try {
            ast = cssTree.parse(raw, {
                context: type,
                parseValue: false,
            });
        } catch(reason) {
            const lines = [ reason.message ];
            const extra = reason.sourceFragment().split('\n');
            if ( extra.length !== 0 ) { lines.push(''); }
            const match = /^[^|]+\|/.exec(extra[0]);
            const beg = match !== null ? match[0].length : 0;
            lines.push(...extra.map(a => a.slice(beg)));
            this.error = lines.join('\n');
            return;
        }
        const parts = [];
        this.astFlatten(ast, parts);
        return parts;
    }

    astFlatten(data, out) {
        const head = data.children && data.children.head;
        let args;
        switch ( data.type ) {
        case 'AttributeSelector':
        case 'ClassSelector':
        case 'Combinator':
        case 'IdSelector':
        case 'MediaFeature':
        case 'Nth':
        case 'Raw':
        case 'TypeSelector':
            out.push({ data });
            break;
        case 'Declaration':
            if ( data.value ) {
                this.astFlatten(data.value, args = []);
            }
            out.push({ data, args });
            args = undefined;
            break;
        case 'DeclarationList':
        case 'Identifier':
        case 'MediaQueryList':
        case 'Selector':
        case 'SelectorList':
            args = out;
            out.push({ data });
            break;
        case 'MediaQuery':
        case 'PseudoClassSelector':
        case 'PseudoElementSelector':
            if ( head ) { args = []; }
            out.push({ data, args });
            break;
        case 'Value':
            args = out;
            break;
        default:
            break;
        }
        if ( head ) {
            if ( args ) {
                this.astFlatten(head.data, args);
            }
            let next = head.next;
            while ( next ) {
                this.astFlatten(next.data, args);
                next = next.next;
            }
        }
        if ( data.type !== 'PseudoClassSelector' ) { return; }
        if ( data.name.startsWith('-abp-') && this.asProcedural === false ) {
            this.error = `${data.name} requires '#?#' separator syntax`;
            return;
        }
        // Post-analysis, mind:
        // - https://w3c.github.io/csswg-drafts/selectors-4/#has-pseudo
        // - https://w3c.github.io/csswg-drafts/selectors-4/#negation
        data.name = this.normalizedOperators.get(data.name) || data.name;
        if ( this.proceduralOperatorNames.has(data.name) ) {
            data.type = 'ProceduralSelector';
        } else if ( this.proceduralActionNames.has(data.name) ) {
            data.type = 'ActionSelector';
        } else if ( data.name.startsWith('-abp-') ) {
            data.type = 'Error';
            this.error = `${data.name} is not supported`;
            return;
        }
        if ( this.maybeProceduralOperatorNames.has(data.name) === false ) {
            return;
        }
        if ( this.astHasType(args, 'ActionSelector') ) {
            data.type = 'Error';
            this.error = 'invalid use of action operator';
            return;
        }
        if ( this.astHasType(args, 'ProceduralSelector') ) {
            data.type = 'ProceduralSelector';
            return;
        }
        switch ( data.name ) {
        case 'has':
            if (
                this.asProcedural ||
                this.nativeCssHas !== true ||
                this.astHasName(args, 'has')
            ) {
                data.type = 'ProceduralSelector';
            } else if ( this.astHasType(args, 'PseudoElementSelector') ) {
                data.type = 'Error';
            }
            break;
        case 'not': {
            if ( this.astHasType(args, 'Combinator', 0) === false ) { break; }
            if ( this.astIsValidSelectorList(args) !== true ) {
                data.type = 'Error';
            }
            break;
        }
        default:
            break;
        }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/2300
    //   Unquoted attribute values are parsed as Identifier instead of String.
    // https://github.com/uBlockOrigin/uBlock-issues/issues/3127
    //   Escape [\t\n\v\f\r]
    astSerializePart(part) {
        const out = [];
        const { data } = part;
        switch ( data.type ) {
        case 'AttributeSelector': {
            const name = data.name.name;
            if ( this.reInvalidIdentifier.test(name) ) { return; }
            if ( data.matcher === null ) {
                out.push(`[${name}]`);
                break;
            }
            let value = data.value.value;
            if ( typeof value !== 'string' ) {
                value = data.value.name;
            }
            if ( /["\\]/.test(value) ) {
                value = value.replace(/["\\]/g, '\\$&');
            }
            if ( /[\x09-\x0D]/.test(value) ) {
                value = value.replace(/[\x09-\x0D]/g, s =>
                    `\\${s.charCodeAt(0).toString(16).toUpperCase()} `
                );
            }
            let flags = '';
            if ( typeof data.flags === 'string' ) {
                if ( /^(is?|si?)$/.test(data.flags) === false ) { return; }
                flags = ` ${data.flags}`;
            }
            out.push(`[${name}${data.matcher}"${value}"${flags}]`);
            break;
        }
        case 'ClassSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(`.${data.name}`);
            break;
        case 'Combinator':
            out.push(data.name);
            break;
        case 'Identifier':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(data.name);
            break;
        case 'IdSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(`#${data.name}`);
            break;
        case 'Nth': {
            if ( data.selector !== null ) { return; }
            if ( data.nth.type === 'AnPlusB' ) {
                const a = parseInt(data.nth.a, 10) || null;
                const b = parseInt(data.nth.b, 10) || null;
                if ( a !== null ) {
                    out.push(`${a}n`);
                    if ( b === null ) { break; }
                    if ( b < 0 ) {
                        out.push(`${b}`);
                    } else {
                        out.push(`+${b}`);
                    }
                } else if ( b !== null ) {
                    out.push(`${b}`);
                }
            } else if ( data.nth.type === 'Identifier' ) {
                out.push(data.nth.name);
            }
            break;
        }
        case 'PseudoElementSelector': {
            const hasArgs = Array.isArray(part.args);
            if ( data.name.charCodeAt(0) !== 0x2D /* '-' */ ) {
                if ( this.knownPseudoElements.has(data.name) === false ) { return; }
                if ( this.knownPseudoElementsWithArgs.has(data.name) && hasArgs === false ) { return; }
            }
            out.push(`::${data.name}`);
            if ( hasArgs ) {
                const arg = this.astSerialize(part.args);
                if ( typeof arg !== 'string' ) { return; }
                out.push(`(${arg})`);
            }
            break;
        }
        case 'PseudoClassSelector': {
            const hasArgs = Array.isArray(part.args);
            if ( data.name.charCodeAt(0) !== 0x2D /* '-' */ ) {
                if ( this.knownPseudoClasses.has(data.name) === false ) { return; }
                if ( this.knownPseudoClassesWithArgs.has(data.name) && hasArgs === false ) { return; }
            }
            out.push(`:${data.name}`);
            if ( hasArgs ) {
                const arg = this.astSerialize(part.args);
                if ( typeof arg !== 'string' ) { return; }
                out.push(`(${arg.trim()})`);
            }
            break;
        }
        case 'Raw':
            out.push(data.value);
            break;
        case 'TypeSelector':
            if ( this.reInvalidIdentifier.test(data.name) ) { return; }
            out.push(data.name);
            break;
        default:
            break;
        }
        return out.join('');
    }

    astSerialize(parts, plainCSS = true) {
        const out = [];
        for ( const part of parts ) {
            const { data } = part;
            switch ( data.type ) {
            case 'AttributeSelector':
            case 'ClassSelector':
            case 'Identifier':
            case 'IdSelector':
            case 'Nth':
            case 'PseudoClassSelector':
            case 'PseudoElementSelector': {
                const s = this.astSerializePart(part);
                if ( s === undefined ) { return; }
                out.push(s);
                break;
            }
            case 'Combinator': {
                const s = this.astSerializePart(part);
                if ( s === undefined ) { return; }
                if ( out.length !== 0 ) { out.push(' '); }
                if ( s !== ' ' ) { out.push(s, ' '); }
                break;
            }
            case 'TypeSelector': {
                const s = this.astSerializePart(part);
                if ( s === undefined ) { return; }
                if ( s === '*' && out.length !== 0 ) {
                    const before = out[out.length-1];
                    if ( before.endsWith(' ') === false ) { return; }
                }
                out.push(s);
                break;
            }
            case 'Raw':
                if ( plainCSS ) { return; }
                out.push(this.astSerializePart(part));
                break;
            case 'Selector':
                if ( out.length !== 0 ) { out.push(', '); }
                break;
            case 'SelectorList':
                break;
            default:
                return;
            }
        }
        return out.join('');
    }

    astCompile(parts, details = {}) {
        if ( Array.isArray(parts) === false ) { return; }
        if ( parts.length === 0 ) { return; }
        if ( parts[0].data.type !== 'SelectorList' ) { return; }
        const out = { selector: '' };
        const prelude = [];
        const tasks = [];
        let startOfSelector = true;
        for ( const part of parts ) {
            if ( out.action !== undefined ) { return; }
            const { data } = part;
            switch ( data.type ) {
            case 'ActionSelector': {
                if ( details.noaction ) { return; }
                if ( prelude.length !== 0 ) {
                    if ( tasks.length === 0 ) {
                        out.selector = prelude.join('');
                    } else {
                        tasks.push(this.createSpathTask(prelude.join('')));
                    }
                    prelude.length = 0;
                }
                const args = this.compileArgumentAst(data.name, part.args);
                if ( args === undefined ) { return; }
                out.action = [ data.name, args ];
                break;
            }
            case 'AttributeSelector':
            case 'ClassSelector':
            case 'IdSelector':
            case 'PseudoClassSelector':
            case 'PseudoElementSelector':
            case 'TypeSelector': {
                const s = this.astSerializePart(part);
                if ( s === undefined ) { return; }
                prelude.push(s);
                startOfSelector = false;
                break;
            }
            case 'Combinator': {
                const s = this.astSerializePart(part);
                if ( s === undefined ) { return; }
                if ( startOfSelector === false || prelude.length !== 0 ) {
                    prelude.push(' ');
                }
                if ( s !== ' ' ) { prelude.push(s, ' '); }
                startOfSelector = false;
                break;
            }
            case 'ProceduralSelector': {
                if ( prelude.length !== 0 ) {
                    let spath = prelude.join('');
                    prelude.length = 0;
                    if ( spath.endsWith(' ') ) { spath += '*'; }
                    if ( tasks.length === 0 ) {
                        out.selector = spath;
                    } else {
                        tasks.push(this.createSpathTask(spath));
                    }
                }
                const args = this.compileArgumentAst(data.name, part.args);
                if ( args === undefined ) { return; }
                tasks.push([ data.name, args ]);
                startOfSelector = false;
                break;
            }
            case 'Selector':
                if ( prelude.length !== 0 ) {
                    prelude.push(', ');
                }
                startOfSelector = true;
                break;
            case 'SelectorList':
                startOfSelector = true;
                break;
            default:
                return;
            }
        }
        if ( tasks.length === 0 && out.action === undefined ) {
            if ( prelude.length === 0 ) { return; }
            return prelude.join('').trim();
        }
        if ( prelude.length !== 0 ) {
            tasks.push(this.createSpathTask(prelude.join('')));
        }
        if ( tasks.length !== 0 ) {
            out.tasks = tasks;
        }
        return out;
    }

    astHasType(parts, type, depth = 0x7FFFFFFF) {
        if ( Array.isArray(parts) === false ) { return false; }
        for ( const part of parts ) {
            if ( part.data.type === type ) { return true; }
            if (
                Array.isArray(part.args) &&
                depth !== 0 &&
                this.astHasType(part.args, type, depth-1)
            ) {
                return true;
            }
        }
        return false;
    }

    astHasName(parts, name) {
        if ( Array.isArray(parts) === false ) { return false; }
        for ( const part of parts ) {
            if ( part.data.name === name ) { return true; }
            if ( Array.isArray(part.args) && this.astHasName(part.args, name) ) {
                return true;
            }
        }
        return false;
    }

    astSelectorsFromSelectorList(args) {
        if ( Array.isArray(args) === false ) { return; }
        if ( args.length < 3 ) { return; }
        if ( args[0].data instanceof Object === false ) { return; }
        if ( args[0].data.type !== 'SelectorList' ) { return; }
        if ( args[1].data instanceof Object === false ) { return; }
        if ( args[1].data.type !== 'Selector' ) { return; }
        const out = [];
        let beg = 1, end = 0, i = 2;
        for (;;) {
            if ( i < args.length ) {
                const type = args[i].data instanceof Object && args[i].data.type;
                if ( type === 'Selector' ) {
                    end = i;
                }
            } else {
                end = args.length;
            }
            if ( end !== 0 ) {
                const components = args.slice(beg+1, end);
                if ( components.length === 0 ) { return; }
                out.push(components);
                if ( end === args.length ) { break; }
                beg = end; end = 0;
            }
            if ( i === args.length ) { break; }
            i += 1;
        }
        return out;
    }

    astIsValidSelector(components) {
        const len = components.length;
        if ( len === 0 ) { return false; }
        if ( components[0].data.type === 'Combinator' ) { return false; }
        if ( len === 1 ) { return true; }
        if ( components[len-1].data.type === 'Combinator' ) { return false; }
        return true;
    }

    astIsValidSelectorList(args) {
        const selectors = this.astSelectorsFromSelectorList(args);
        if ( Array.isArray(selectors) === false || selectors.length === 0 ) {
            return false;
        }
        for ( const selector of selectors ) {
            if ( this.astIsValidSelector(selector) !== true ) { return false; }
        }
        return true;
    }

    isStyleInjectionFilter(selector) {
        const len = selector.length;
        return len !== 0 && selector.charCodeAt(len-1) === 0x7D /* } */;
    }

    translateStyleInjectionFilter(raw) {
        const matches = /^(.+)\s*\{([^}]+)\}$/.exec(raw);
        if ( matches === null ) { return; }
        const selector = matches[1].trim();
        const style = matches[2].trim();
        // Special style directive `remove: true` is converted into a
        // `:remove()` operator.
        if ( /^\s*remove:\s*true[; ]*$/.test(style) ) {
            return `${selector}:remove()`;
        }
        // For some reasons, many of Adguard's plain cosmetic filters are
        // "disguised" as style-based cosmetic filters: convert such filters
        // to plain cosmetic filters.
        return /display\s*:\s*none\s*!important;?$/.test(style)
            ? selector
            : `${selector}:style(${style})`;
    }

    createSpathTask(selector) {
        return [ 'spath', selector ];
    }

    compileArgumentAst(operator, parts) {
        switch ( operator ) {
        case 'has': {
            let r = this.astCompile(parts, { noaction: true });
            if ( typeof r === 'string' ) {
                r = { selector: r.replace(/^\s*:scope\s*/, '') };
            }
            return r;
        }
        case 'not': {
            return this.astCompile(parts, { noaction: true });
        }
        default:
            break;
        }
        if ( Array.isArray(parts) === false || parts.length === 0 ) { return; }
        const arg = this.astSerialize(parts, false);
        if ( arg === undefined ) { return; }
        switch ( operator ) {
        case 'content':
            return this.compileSelector(arg);
        case 'has-text':
            return this.compileText(arg);
        case 'if':
            return this.compileSelector(arg);
        case 'if-not':
            return this.compileSelector(arg);
        case 'matches-attr':
        case 'matches-prop':
            return this.compileMatchAttrArgument(arg);
        case 'matches-css':
            return this.compileCSSDeclaration(arg);
        case 'matches-css-after':
            return this.compileCSSDeclaration(`after, ${arg}`);
        case 'matches-css-before':
            return this.compileCSSDeclaration(`before, ${arg}`);
        case 'matches-media':
            return this.compileMediaQuery(arg);
        case 'matches-path':
            return this.compileText(arg);
        case 'min-text-length':
            return this.compileInteger(arg);
        case 'others':
            return this.compileNoArgument(arg);
        case 'remove':
            return this.compileNoArgument(arg);
        case 'remove-attr':
            return this.compileText(arg);
        case 'remove-class':
            return this.compileText(arg);
        case 'shadow':
            return this.compileSelector(arg);
        case 'style':
            return this.compileStyleProperties(arg);
        case 'upward':
            return this.compileUpwardArgument(arg);
        case 'watch-attr':
            return this.compileAttrList(arg);
        case 'xpath':
            return this.compileXpathExpression(arg);
        default:
            break;
        }
    }

    isBadRegex(s) {
        try {
            void new RegExp(s);
        } catch (ex) {
            this.isBadRegex.message = ex.toString();
            return true;
        }
        return false;
    }

    unquoteString(s) {
        const end = s.length;
        if ( end === 0 ) {
            return { s: '', end };
        }
        if ( /^['"]/.test(s) === false ) {
            return { s, i: end };
        }
        const quote = s.charCodeAt(0);
        const out = [];
        let i = 1, c = 0;
        for (;;) {
            c = s.charCodeAt(i);
            if ( c === quote ) {
                i += 1;
                break;
            }
            if ( c === 0x5C /* '\\' */ ) {
                i += 1;
                if ( i === end ) { break; }
                c = s.charCodeAt(i);
                if ( c !== 0x5C && c !== quote ) {
                    out.push(0x5C);
                }
            }
            out.push(c);
            i += 1;
            if ( i === end ) { break; }
        }
        return { s: String.fromCharCode(...out), i };
    }

    compileMatchAttrArgument(s) {
        if ( s === '' ) { return; }
        let attr = '', value = '';
        let r = this.unquoteString(s);
        if ( r.i === s.length ) {
            const pos = r.s.indexOf('=');
            if ( pos === -1 ) {
                attr = r.s;
            } else {
                attr = r.s.slice(0, pos);
                value = r.s.slice(pos+1);
            }
        } else {
            attr = r.s;
            if ( s.charCodeAt(r.i) !== 0x3D ) { return; }
            value = s.slice(r.i+1);
        }
        if ( attr === '' ) { return; }
        if ( value.length !== 0 ) {
            r = this.unquoteString(value);
            if ( r.i !== value.length ) { return; }
            value = r.s;
        }
        return { attr, value };
    }

    // Remove potentially present quotes before processing.
    compileText(s) {
        if ( s === '' ) {
            this.error = 'argument missing';
            return;
        }
        const r = this.unquoteString(s);
        if ( r.i !== s.length ) { return; }
        return r.s;
    }

    compileCSSDeclaration(s) {
        let pseudo; {
            const match = /^[a-z-]+,/.exec(s);
            if ( match !== null ) {
                pseudo = match[0].slice(0, -1);
                s = s.slice(match[0].length).trim();
            }
        }
        const pos = s.indexOf(':');
        if ( pos === -1 ) { return; }
        const name = s.slice(0, pos).trim();
        const value = s.slice(pos + 1).trim();
        const match = this.reParseRegexLiteral.exec(value);
        let regexDetails;
        if ( match !== null ) {
            regexDetails = match[1];
            if ( this.isBadRegex(regexDetails) ) { return; }
            if ( match[2] ) {
                regexDetails = [ regexDetails, match[2] ];
            }
        } else {
            regexDetails = `^${escapeForRegex(value)}$`;
        }
        return { name, pseudo, value: regexDetails };
    }

    compileInteger(s, min = 0, max = 0x7FFFFFFF) {
        if ( /^\d+$/.test(s) === false ) { return; }
        const n = parseInt(s, 10);
        if ( n < min || n >= max ) { return; }
        return n;
    }

    compileMediaQuery(s) {
        const parts = this.astFromRaw(s, 'mediaQueryList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Raw') ) { return; }
        if ( this.astHasType(parts, 'MediaQuery') === false ) { return; }
        // TODO: normalize by serializing resulting AST
        return s;
    }

    compileUpwardArgument(s) {
        const i = this.compileInteger(s, 1, 256);
        if ( i !== undefined ) { return i; }
        return this.compilePlainSelector(s);
    }

    compilePlainSelector(s) {
        const parts = this.astFromRaw(s, 'selectorList' );
        if ( this.astIsValidSelectorList(parts) !== true ) { return; }
        if ( this.astHasType(parts, 'ProceduralSelector') ) { return; }
        if ( this.astHasType(parts, 'ActionSelector') ) { return; }
        if ( this.astHasType(parts, 'Error') ) { return; }
        return s;
    }

    compileNoArgument(s) {
        if ( s === '' ) { return s; }
    }

    // https://github.com/uBlockOrigin/uBlock-issues/issues/668
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1693
    // https://github.com/uBlockOrigin/uBlock-issues/issues/1811
    //   Forbid instances of:
    //   - `image-set(`
    //   - `url(`
    //   - any instance of `//`
    //   - backslashes `\`
    //   - opening comment `/*`
    compileStyleProperties(s) {
        if ( /image-set\(|url\(|\/\s*\/|\\|\/\*/i.test(s) ) { return; }
        const parts = this.astFromRaw(s, 'declarationList');
        if ( parts === undefined ) { return; }
        if ( this.astHasType(parts, 'Declaration') === false ) { return; }
        return s;
    }

    compileAttrList(s) {
        if ( s === '' ) { return s; }
        const attrs = s.split(/\s*,\s*/);
        const out = [];
        for ( const attr of attrs ) {
            if ( attr !== '' ) {
                out.push(attr);
            }
        }
        return out;
    }

    compileXpathExpression(s) {
        const r = this.unquoteString(s);
        if ( r.i !== s.length ) { return; }
        const doc = globalThis.document;
        if ( doc instanceof Object === false ) { return r.s; }
        try {
            const expr = doc.createExpression(r.s, null);
            expr.evaluate(doc, XPathResult.ANY_UNORDERED_NODE_TYPE);
        } catch {
            return;
        }
        return r.s;
    }
}

// bit 0: can be used as auto-completion hint
// bit 1: can not be used in HTML filtering
//
const proceduralOperatorTokens = new Map([
    [ '-abp-contains', 0b00 ],
    [ '-abp-has', 0b00, ],
    [ 'contains', 0b00, ],
    [ 'content', 0b01, ],
    [ 'has', 0b01 ],
    [ 'has-text', 0b01 ],
    [ 'if', 0b00 ],
    [ 'if-not', 0b00 ],
    [ 'matches-attr', 0b11 ],
    [ 'matches-css', 0b11 ],
    [ 'matches-media', 0b11 ],
    [ 'matches-path', 0b11 ],
    [ 'matches-prop', 0b11 ],
    [ 'min-text-length', 0b01 ],
    [ 'not', 0b01 ],
    [ 'nth-ancestor', 0b00 ],
    [ 'others', 0b11 ],
    [ 'remove', 0b01 ],
    [ 'remove-attr', 0b11 ],
    [ 'remove-class', 0b11 ],
    [ 'shadow', 0b11, ],
    [ 'style', 0b11 ],
    [ 'upward', 0b01 ],
    [ 'watch-attr', 0b11 ],
    [ 'watch-attrs', 0b00 ],
    [ 'xpath', 0b01 ],
]);

/******************************************************************************/

const utils = (( ) => {

    const preparserTokens = new Map([
        [ 'ext_ublock', 'ublock' ],
        [ 'ext_ubol', 'ubol' ],
        [ 'ext_devbuild', 'devbuild' ],
        [ 'env_brave', 'brave' ],
        [ 'env_chromium', 'chromium' ],
        [ 'env_edge', 'edge' ],
        [ 'env_firefox', 'firefox' ],
        [ 'env_legacy', 'legacy' ],
        [ 'env_mobile', 'mobile' ],
        [ 'env_mv3', 'mv3' ],
        [ 'env_safari', 'safari' ],
        [ 'cap_html_filtering', 'html_filtering' ],
        [ 'cap_ipaddress', 'ipaddress' ],
        [ 'false', 'false' ],
        // Hoping ABP-only list maintainers can at least make use of it to
        // help non-ABP content blockers better deal with filters benefiting
        // only ABP.
        [ 'ext_abp', 'false' ],
        // Compatibility with other blockers
        // https://adguard.com/kb/general/ad-filtering/create-own-filters/#conditions-directive
        [ 'adguard', 'adguard' ],
        [ 'adguard_app_android', 'false' ],
        [ 'adguard_app_cli', 'false' ],
        [ 'adguard_app_ios', 'false' ],
        [ 'adguard_app_mac', 'false' ],
        [ 'adguard_app_windows', 'false' ],
        [ 'adguard_ext_android_cb', 'false' ],
        [ 'adguard_ext_chromium', 'chromium' ],
        [ 'adguard_ext_chromium_mv3', 'mv3' ],
        [ 'adguard_ext_edge', 'edge' ],
        [ 'adguard_ext_firefox', 'firefox' ],
        [ 'adguard_ext_opera', 'chromium' ],
        [ 'adguard_ext_safari', 'false' ],
    ]);

    const toURL = url => {
        try {
            return new URL(url.trim());
        } catch {
        }
    };

    // Useful reference:
    // https://adguard.com/kb/general/ad-filtering/create-own-filters/#conditions-directive

    class preparser {
        static evaluateExprToken(token, env = []) {
            const not = token.charCodeAt(0) === 0x21 /* ! */;
            if ( not ) { token = token.slice(1); }
            let state = preparserTokens.get(token);
            if ( state === undefined ) {
                if ( token.startsWith('cap_') === false ) { return; }
                state = 'false';
            }
            return state === 'false' && not || env.includes(state) !== not;
        }

        static evaluateExpr(expr, env = []) {
            if ( expr.startsWith('(') && expr.endsWith(')') ) {
                expr = expr.slice(1, -1);
            }
            const matches = Array.from(expr.matchAll(/(?:(?:&&|\|\|)\s+)?\S+/g));
            if ( matches.length === 0 ) { return; }
            if ( matches[0][0].startsWith('|') || matches[0][0].startsWith('&') ) { return; }
            let result = this.evaluateExprToken(matches[0][0], env);
            for ( let i = 1; i < matches.length; i++ ) {
                const parts = matches[i][0].split(/ +/);
                if ( parts.length !== 2 ) { return; }
                const state = this.evaluateExprToken(parts[1], env);
                if ( state === undefined ) { return; }
                if ( parts[0] === '||' ) {
                    result = result || state;
                } else if ( parts[0] === '&&' ) {
                    result = result && state;
                } else {
                    return;
                }
            }
            return result;
        }

        // This method returns an array of indices, corresponding to position in
        // the content string which should alternatively be parsed and discarded.
        static splitter(content, env = []) {
            const reIf = /^!#(if|else|endif)\b([^\n]*)(?:[\n\r]+|$)/gm;
            const stack = [];
            const parts = [ 0 ];
            let discard = false;

            const shouldDiscard = ( ) => stack.some(v => v.known && v.discard);

            const begif = details => {
                if ( discard === false && details.known && details.discard ) {
                    parts.push(details.pos);
                    discard = true;
                }
                stack.push(details);
            };

            const endif = match => {
                stack.pop();
                const stopDiscard = shouldDiscard() === false;
                if ( discard && stopDiscard ) {
                    parts.push(match.index + match[0].length);
                    discard = false;
                }
            };

            for (;;) {
                const match = reIf.exec(content);
                if ( match === null ) { break; }

                switch ( match[1] ) {
                case 'if': {
                    const result = this.evaluateExpr(match[2].trim(), env);
                    begif({
                        known: result !== undefined,
                        discard: result === false,
                        pos: match.index,
                    });
                    break;
                }
                case 'else': {
                    if ( stack.length === 0 ) { break; }
                    const details = stack[stack.length-1];
                    endif(match);
                    details.discard = details.discard === false;
                    details.pos = match.index;
                    begif(details);
                    break;
                }
                case 'endif': {
                    endif(match);
                    break;
                }
                default:
                    break;
                }
            }

            parts.push(content.length);
            return parts;
        }

        static expandIncludes(parts, env = []) {
            const out = [];
            const reInclude = /^!#include +(\S+)[^\n\r]*(?:[\n\r]+|$)/gm;
            for ( const part of parts ) {
                if ( typeof part === 'string' ) {
                    out.push(part);
                    continue;
                }
                if ( part instanceof Object === false ) { continue; }
                const content = part.content;
                if ( typeof content !== 'string' ) { continue; }
                const slices = this.splitter(content, env);
                for ( let i = 0, n = slices.length; i < n; i += 2 ) {
                    const slice = content.slice(slices[i+0], slices[i+1]);
                    let lastIndex = 0;
                    for (;;) {
                        const match = reInclude.exec(slice);
                        if ( match === null ) { break; }
                        if ( toURL(match[1]) !== undefined ) { continue; }
                        if ( match[1].indexOf('..') !== -1 ) { continue; }
                        // Compute nested list path relative to parent list path
                        const pos = part.url.lastIndexOf('/');
                        if ( pos === -1 ) { continue; }
                        const subURL = part.url.slice(0, pos + 1) + match[1].trim();
                        out.push(
                            slice.slice(lastIndex, match.index + match[0].length),
                            `! >>>>>>>> ${subURL}\n`,
                            { url: subURL },
                            `! <<<<<<<< ${subURL}\n`
                        );
                        lastIndex = reInclude.lastIndex;
                    }
                    out.push(lastIndex === 0 ? slice : slice.slice(lastIndex));
                }
            }
            return out;
        }

        static prune(content, env) {
            const parts = this.splitter(content, env);
            const out = [];
            for ( let i = 0, n = parts.length; i < n; i += 2 ) {
                const beg = parts[i+0];
                const end = parts[i+1];
                out.push(content.slice(beg, end));
            }
            return out.join('\n');
        }

        static getHints() {
            const out = [];
            const vals = new Set();
            for ( const [ key, val ] of preparserTokens ) {
                if ( vals.has(val) ) { continue; }
                vals.add(val);
                out.push(key);
            }
            return out;
        }

        static getTokens(env) {
            const out = new Map();
            for ( const [ key, val ] of preparserTokens ) {
                out.set(key, val !== 'false' && env.includes(val));
            }
            return Array.from(out);
        }
    }

    return {
        preparser,
    };
})();

/******************************************************************************/

return {AST_TYPE_NONE:AST_TYPE_NONE,AST_TYPE_UNKNOWN:AST_TYPE_UNKNOWN,AST_TYPE_COMMENT:AST_TYPE_COMMENT,AST_TYPE_NETWORK:AST_TYPE_NETWORK,AST_TYPE_EXTENDED:AST_TYPE_EXTENDED,AST_TYPE_NETWORK_PATTERN_ANY:AST_TYPE_NETWORK_PATTERN_ANY,AST_TYPE_NETWORK_PATTERN_HOSTNAME:AST_TYPE_NETWORK_PATTERN_HOSTNAME,AST_TYPE_NETWORK_PATTERN_PLAIN:AST_TYPE_NETWORK_PATTERN_PLAIN,AST_TYPE_NETWORK_PATTERN_REGEX:AST_TYPE_NETWORK_PATTERN_REGEX,AST_TYPE_NETWORK_PATTERN_GENERIC:AST_TYPE_NETWORK_PATTERN_GENERIC,AST_TYPE_NETWORK_PATTERN_BAD:AST_TYPE_NETWORK_PATTERN_BAD,AST_TYPE_EXTENDED_COSMETIC:AST_TYPE_EXTENDED_COSMETIC,AST_TYPE_EXTENDED_SCRIPTLET:AST_TYPE_EXTENDED_SCRIPTLET,AST_TYPE_EXTENDED_HTML:AST_TYPE_EXTENDED_HTML,AST_TYPE_EXTENDED_RESPONSEHEADER:AST_TYPE_EXTENDED_RESPONSEHEADER,AST_TYPE_COMMENT_PREPARSER:AST_TYPE_COMMENT_PREPARSER,AST_FLAG_UNSUPPORTED:AST_FLAG_UNSUPPORTED,AST_FLAG_IGNORE:AST_FLAG_IGNORE,AST_FLAG_HAS_ERROR:AST_FLAG_HAS_ERROR,AST_FLAG_IS_EXCEPTION:AST_FLAG_IS_EXCEPTION,AST_FLAG_EXT_STRONG:AST_FLAG_EXT_STRONG,AST_FLAG_EXT_STYLE:AST_FLAG_EXT_STYLE,AST_FLAG_EXT_SCRIPTLET_ADG:AST_FLAG_EXT_SCRIPTLET_ADG,AST_FLAG_NET_PATTERN_LEFT_HNANCHOR:AST_FLAG_NET_PATTERN_LEFT_HNANCHOR,AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR:AST_FLAG_NET_PATTERN_RIGHT_PATHANCHOR,AST_FLAG_NET_PATTERN_LEFT_ANCHOR:AST_FLAG_NET_PATTERN_LEFT_ANCHOR,AST_FLAG_NET_PATTERN_RIGHT_ANCHOR:AST_FLAG_NET_PATTERN_RIGHT_ANCHOR,AST_FLAG_HAS_OPTIONS:AST_FLAG_HAS_OPTIONS,AST_ERROR_NONE:AST_ERROR_NONE,AST_ERROR_REGEX:AST_ERROR_REGEX,AST_ERROR_PATTERN:AST_ERROR_PATTERN,AST_ERROR_DOMAIN_NAME:AST_ERROR_DOMAIN_NAME,AST_ERROR_OPTION_DUPLICATE:AST_ERROR_OPTION_DUPLICATE,AST_ERROR_OPTION_UNKNOWN:AST_ERROR_OPTION_UNKNOWN,AST_ERROR_OPTION_BADVALUE:AST_ERROR_OPTION_BADVALUE,AST_ERROR_OPTION_EXCLUDED:AST_ERROR_OPTION_EXCLUDED,AST_ERROR_IF_TOKEN_UNKNOWN:AST_ERROR_IF_TOKEN_UNKNOWN,AST_ERROR_UNTRUSTED_SOURCE:AST_ERROR_UNTRUSTED_SOURCE,AST_ERROR_CAPABILITY:AST_ERROR_CAPABILITY,NODE_TYPE_NOOP:NODE_TYPE_NOOP,NODE_TYPE_LINE_RAW:NODE_TYPE_LINE_RAW,NODE_TYPE_LINE_BODY:NODE_TYPE_LINE_BODY,NODE_TYPE_WHITESPACE:NODE_TYPE_WHITESPACE,NODE_TYPE_COMMENT:NODE_TYPE_COMMENT,NODE_TYPE_IGNORE:NODE_TYPE_IGNORE,NODE_TYPE_EXT_RAW:NODE_TYPE_EXT_RAW,NODE_TYPE_EXT_OPTIONS_ANCHOR:NODE_TYPE_EXT_OPTIONS_ANCHOR,NODE_TYPE_EXT_OPTIONS:NODE_TYPE_EXT_OPTIONS,NODE_TYPE_EXT_DECORATION:NODE_TYPE_EXT_DECORATION,NODE_TYPE_EXT_PATTERN_RAW:NODE_TYPE_EXT_PATTERN_RAW,NODE_TYPE_EXT_PATTERN_COSMETIC:NODE_TYPE_EXT_PATTERN_COSMETIC,NODE_TYPE_EXT_PATTERN_HTML:NODE_TYPE_EXT_PATTERN_HTML,NODE_TYPE_EXT_PATTERN_RESPONSEHEADER:NODE_TYPE_EXT_PATTERN_RESPONSEHEADER,NODE_TYPE_EXT_PATTERN_SCRIPTLET:NODE_TYPE_EXT_PATTERN_SCRIPTLET,NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN:NODE_TYPE_EXT_PATTERN_SCRIPTLET_TOKEN,NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARGS:NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARGS,NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG:NODE_TYPE_EXT_PATTERN_SCRIPTLET_ARG,NODE_TYPE_NET_RAW:NODE_TYPE_NET_RAW,NODE_TYPE_NET_EXCEPTION:NODE_TYPE_NET_EXCEPTION,NODE_TYPE_NET_PATTERN_RAW:NODE_TYPE_NET_PATTERN_RAW,NODE_TYPE_NET_PATTERN:NODE_TYPE_NET_PATTERN,NODE_TYPE_NET_PATTERN_PART:NODE_TYPE_NET_PATTERN_PART,NODE_TYPE_NET_PATTERN_PART_SPECIAL:NODE_TYPE_NET_PATTERN_PART_SPECIAL,NODE_TYPE_NET_PATTERN_PART_UNICODE:NODE_TYPE_NET_PATTERN_PART_UNICODE,NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR:NODE_TYPE_NET_PATTERN_LEFT_HNANCHOR,NODE_TYPE_NET_PATTERN_LEFT_ANCHOR:NODE_TYPE_NET_PATTERN_LEFT_ANCHOR,NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR:NODE_TYPE_NET_PATTERN_RIGHT_ANCHOR,NODE_TYPE_NET_OPTIONS_ANCHOR:NODE_TYPE_NET_OPTIONS_ANCHOR,NODE_TYPE_NET_OPTIONS:NODE_TYPE_NET_OPTIONS,NODE_TYPE_NET_OPTION_SEPARATOR:NODE_TYPE_NET_OPTION_SEPARATOR,NODE_TYPE_NET_OPTION_SENTINEL:NODE_TYPE_NET_OPTION_SENTINEL,NODE_TYPE_NET_OPTION_RAW:NODE_TYPE_NET_OPTION_RAW,NODE_TYPE_NET_OPTION_NAME_NOT:NODE_TYPE_NET_OPTION_NAME_NOT,NODE_TYPE_NET_OPTION_NAME_UNKNOWN:NODE_TYPE_NET_OPTION_NAME_UNKNOWN,NODE_TYPE_NET_OPTION_NAME_1P:NODE_TYPE_NET_OPTION_NAME_1P,NODE_TYPE_NET_OPTION_NAME_STRICT1P:NODE_TYPE_NET_OPTION_NAME_STRICT1P,NODE_TYPE_NET_OPTION_NAME_3P:NODE_TYPE_NET_OPTION_NAME_3P,NODE_TYPE_NET_OPTION_NAME_STRICT3P:NODE_TYPE_NET_OPTION_NAME_STRICT3P,NODE_TYPE_NET_OPTION_NAME_ALL:NODE_TYPE_NET_OPTION_NAME_ALL,NODE_TYPE_NET_OPTION_NAME_BADFILTER:NODE_TYPE_NET_OPTION_NAME_BADFILTER,NODE_TYPE_NET_OPTION_NAME_CNAME:NODE_TYPE_NET_OPTION_NAME_CNAME,NODE_TYPE_NET_OPTION_NAME_CSP:NODE_TYPE_NET_OPTION_NAME_CSP,NODE_TYPE_NET_OPTION_NAME_CSS:NODE_TYPE_NET_OPTION_NAME_CSS,NODE_TYPE_NET_OPTION_NAME_DENYALLOW:NODE_TYPE_NET_OPTION_NAME_DENYALLOW,NODE_TYPE_NET_OPTION_NAME_DOC:NODE_TYPE_NET_OPTION_NAME_DOC,NODE_TYPE_NET_OPTION_NAME_EHIDE:NODE_TYPE_NET_OPTION_NAME_EHIDE,NODE_TYPE_NET_OPTION_NAME_EMPTY:NODE_TYPE_NET_OPTION_NAME_EMPTY,NODE_TYPE_NET_OPTION_NAME_FONT:NODE_TYPE_NET_OPTION_NAME_FONT,NODE_TYPE_NET_OPTION_NAME_FRAME:NODE_TYPE_NET_OPTION_NAME_FRAME,NODE_TYPE_NET_OPTION_NAME_FROM:NODE_TYPE_NET_OPTION_NAME_FROM,NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK:NODE_TYPE_NET_OPTION_NAME_GENERICBLOCK,NODE_TYPE_NET_OPTION_NAME_GHIDE:NODE_TYPE_NET_OPTION_NAME_GHIDE,NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER:NODE_TYPE_NET_OPTION_NAME_RESPONSEHEADER,NODE_TYPE_NET_OPTION_NAME_IMAGE:NODE_TYPE_NET_OPTION_NAME_IMAGE,NODE_TYPE_NET_OPTION_NAME_IMPORTANT:NODE_TYPE_NET_OPTION_NAME_IMPORTANT,NODE_TYPE_NET_OPTION_NAME_INLINEFONT:NODE_TYPE_NET_OPTION_NAME_INLINEFONT,NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT:NODE_TYPE_NET_OPTION_NAME_INLINESCRIPT,NODE_TYPE_NET_OPTION_NAME_IPADDRESS:NODE_TYPE_NET_OPTION_NAME_IPADDRESS,NODE_TYPE_NET_OPTION_NAME_MATCHCASE:NODE_TYPE_NET_OPTION_NAME_MATCHCASE,NODE_TYPE_NET_OPTION_NAME_MEDIA:NODE_TYPE_NET_OPTION_NAME_MEDIA,NODE_TYPE_NET_OPTION_NAME_METHOD:NODE_TYPE_NET_OPTION_NAME_METHOD,NODE_TYPE_NET_OPTION_NAME_MP4:NODE_TYPE_NET_OPTION_NAME_MP4,NODE_TYPE_NET_OPTION_NAME_NOOP:NODE_TYPE_NET_OPTION_NAME_NOOP,NODE_TYPE_NET_OPTION_NAME_OBJECT:NODE_TYPE_NET_OPTION_NAME_OBJECT,NODE_TYPE_NET_OPTION_NAME_OTHER:NODE_TYPE_NET_OPTION_NAME_OTHER,NODE_TYPE_NET_OPTION_NAME_PERMISSIONS:NODE_TYPE_NET_OPTION_NAME_PERMISSIONS,NODE_TYPE_NET_OPTION_NAME_PING:NODE_TYPE_NET_OPTION_NAME_PING,NODE_TYPE_NET_OPTION_NAME_POPUNDER:NODE_TYPE_NET_OPTION_NAME_POPUNDER,NODE_TYPE_NET_OPTION_NAME_POPUP:NODE_TYPE_NET_OPTION_NAME_POPUP,NODE_TYPE_NET_OPTION_NAME_REASON:NODE_TYPE_NET_OPTION_NAME_REASON,NODE_TYPE_NET_OPTION_NAME_REDIRECT:NODE_TYPE_NET_OPTION_NAME_REDIRECT,NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE:NODE_TYPE_NET_OPTION_NAME_REDIRECTRULE,NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM:NODE_TYPE_NET_OPTION_NAME_REMOVEPARAM,NODE_TYPE_NET_OPTION_NAME_REPLACE:NODE_TYPE_NET_OPTION_NAME_REPLACE,NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER:NODE_TYPE_NET_OPTION_NAME_REQUESTHEADER,NODE_TYPE_NET_OPTION_NAME_SCRIPT:NODE_TYPE_NET_OPTION_NAME_SCRIPT,NODE_TYPE_NET_OPTION_NAME_SHIDE:NODE_TYPE_NET_OPTION_NAME_SHIDE,NODE_TYPE_NET_OPTION_NAME_TO:NODE_TYPE_NET_OPTION_NAME_TO,NODE_TYPE_NET_OPTION_NAME_TOP:NODE_TYPE_NET_OPTION_NAME_TOP,NODE_TYPE_NET_OPTION_NAME_URLSKIP:NODE_TYPE_NET_OPTION_NAME_URLSKIP,NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM:NODE_TYPE_NET_OPTION_NAME_URLTRANSFORM,NODE_TYPE_NET_OPTION_NAME_XHR:NODE_TYPE_NET_OPTION_NAME_XHR,NODE_TYPE_NET_OPTION_NAME_WEBRTC:NODE_TYPE_NET_OPTION_NAME_WEBRTC,NODE_TYPE_NET_OPTION_NAME_WEBSOCKET:NODE_TYPE_NET_OPTION_NAME_WEBSOCKET,NODE_TYPE_NET_OPTION_ASSIGN:NODE_TYPE_NET_OPTION_ASSIGN,NODE_TYPE_NET_OPTION_QUOTE:NODE_TYPE_NET_OPTION_QUOTE,NODE_TYPE_NET_OPTION_VALUE:NODE_TYPE_NET_OPTION_VALUE,NODE_TYPE_OPTION_VALUE_DOMAIN_LIST:NODE_TYPE_OPTION_VALUE_DOMAIN_LIST,NODE_TYPE_OPTION_VALUE_DOMAIN_RAW:NODE_TYPE_OPTION_VALUE_DOMAIN_RAW,NODE_TYPE_OPTION_VALUE_NOT:NODE_TYPE_OPTION_VALUE_NOT,NODE_TYPE_OPTION_VALUE_DOMAIN:NODE_TYPE_OPTION_VALUE_DOMAIN,NODE_TYPE_OPTION_VALUE_SEPARATOR:NODE_TYPE_OPTION_VALUE_SEPARATOR,NODE_TYPE_PREPARSE_DIRECTIVE:NODE_TYPE_PREPARSE_DIRECTIVE,NODE_TYPE_PREPARSE_DIRECTIVE_VALUE:NODE_TYPE_PREPARSE_DIRECTIVE_VALUE,NODE_TYPE_PREPARSE_DIRECTIVE_IF:NODE_TYPE_PREPARSE_DIRECTIVE_IF,NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE:NODE_TYPE_PREPARSE_DIRECTIVE_IF_VALUE,NODE_TYPE_COMMENT_URL:NODE_TYPE_COMMENT_URL,NODE_TYPE_COUNT:NODE_TYPE_COUNT,NODE_FLAG_IGNORE:NODE_FLAG_IGNORE,NODE_FLAG_ERROR:NODE_FLAG_ERROR,NODE_FLAG_IS_NEGATED:NODE_FLAG_IS_NEGATED,NODE_FLAG_OPTION_HAS_VALUE:NODE_FLAG_OPTION_HAS_VALUE,NODE_FLAG_PATTERN_UNTOKENIZABLE:NODE_FLAG_PATTERN_UNTOKENIZABLE,nodeTypeFromOptionName:nodeTypeFromOptionName,nodeNameFromNodeType:nodeNameFromNodeType,removableHTTPHeaders:removableHTTPHeaders,preparserIfTokens:preparserIfTokens,AstFilterParser:AstFilterParser,parseRedirectValue:parseRedirectValue,parseQueryPruneValue:parseQueryPruneValue,parseHeaderValue:parseHeaderValue,parseReplaceByRegexValue:parseReplaceByRegexValue,parseReplaceValue:parseReplaceValue,netOptionTokenDescriptors:netOptionTokenDescriptors,ExtSelectorCompiler:ExtSelectorCompiler,proceduralOperatorTokens:proceduralOperatorTokens,utils:utils};
},2:function(require){/**
 * Skipped minification because the original files appears to be already minified.
 * Original file: /npm/css-tree@2.2.1/dist/csstree.esm.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
var ts=Object.create;var nr=Object.defineProperty;var rs=Object.getOwnPropertyDescriptor;var ns=Object.getOwnPropertyNames;var os=Object.getPrototypeOf,is=Object.prototype.hasOwnProperty;var Oe=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),b=(e,t)=>{for(var r in t)nr(e,r,{get:t[r],enumerable:!0})},as=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of ns(t))!is.call(e,o)&&o!==r&&nr(e,o,{get:()=>t[o],enumerable:!(n=rs(t,o))||n.enumerable});return e};var ss=(e,t,r)=>(r=e!=null?ts(os(e)):{},as(t||!e||!e.__esModule?nr(r,"default",{value:e,enumerable:!0}):r,e));var Zo=Oe(hr=>{var $o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("");hr.encode=function(e){if(0<=e&&e<$o.length)return $o[e];throw new TypeError("Must be between 0 and 63: "+e)};hr.decode=function(e){var t=65,r=90,n=97,o=122,i=48,s=57,u=43,c=47,a=26,l=52;return t<=e&&e<=r?e-t:n<=e&&e<=o?e-n+a:i<=e&&e<=s?e-i+l:e==u?62:e==c?63:-1}});var ni=Oe(fr=>{var Jo=Zo(),mr=5,ei=1<<mr,ti=ei-1,ri=ei;function ys(e){return e<0?(-e<<1)+1:(e<<1)+0}function ks(e){var t=(e&1)===1,r=e>>1;return t?-r:r}fr.encode=function(t){var r="",n,o=ys(t);do n=o&ti,o>>>=mr,o>0&&(n|=ri),r+=Jo.encode(n);while(o>0);return r};fr.decode=function(t,r,n){var o=t.length,i=0,s=0,u,c;do{if(r>=o)throw new Error("Expected more digits in base 64 VLQ value.");if(c=Jo.decode(t.charCodeAt(r++)),c===-1)throw new Error("Invalid base64 digit: "+t.charAt(r-1));u=!!(c&ri),c&=ti,i=i+(c<<s),s+=mr}while(u);n.value=ks(i),n.rest=r}});var Lt=Oe(K=>{function ws(e,t,r){if(t in e)return e[t];if(arguments.length===3)return r;throw new Error('"'+t+'" is a required argument.')}K.getArg=ws;var oi=/^(?:([\w+\-.]+):)?\/\/(?:(\w+:\w+)@)?([\w.-]*)(?::(\d+))?(.*)$/,vs=/^data:.+\,.+$/;function ot(e){var t=e.match(oi);return t?{scheme:t[1],auth:t[2],host:t[3],port:t[4],path:t[5]}:null}K.urlParse=ot;function Ue(e){var t="";return e.scheme&&(t+=e.scheme+":"),t+="//",e.auth&&(t+=e.auth+"@"),e.host&&(t+=e.host),e.port&&(t+=":"+e.port),e.path&&(t+=e.path),t}K.urlGenerate=Ue;var Ss=32;function Cs(e){var t=[];return function(r){for(var n=0;n<t.length;n++)if(t[n].input===r){var o=t[0];return t[0]=t[n],t[n]=o,t[0].result}var i=e(r);return t.unshift({input:r,result:i}),t.length>Ss&&t.pop(),i}}var dr=Cs(function(t){var r=t,n=ot(t);if(n){if(!n.path)return t;r=n.path}for(var o=K.isAbsolute(r),i=[],s=0,u=0;;)if(s=u,u=r.indexOf("/",s),u===-1){i.push(r.slice(s));break}else for(i.push(r.slice(s,u));u<r.length&&r[u]==="/";)u++;for(var c,a=0,u=i.length-1;u>=0;u--)c=i[u],c==="."?i.splice(u,1):c===".."?a++:a>0&&(c===""?(i.splice(u+1,a),a=0):(i.splice(u,2),a--));return r=i.join("/"),r===""&&(r=o?"/":"."),n?(n.path=r,Ue(n)):r});K.normalize=dr;function ii(e,t){e===""&&(e="."),t===""&&(t=".");var r=ot(t),n=ot(e);if(n&&(e=n.path||"/"),r&&!r.scheme)return n&&(r.scheme=n.scheme),Ue(r);if(r||t.match(vs))return t;if(n&&!n.host&&!n.path)return n.host=t,Ue(n);var o=t.charAt(0)==="/"?t:dr(e.replace(/\/+$/,"")+"/"+t);return n?(n.path=o,Ue(n)):o}K.join=ii;K.isAbsolute=function(e){return e.charAt(0)==="/"||oi.test(e)};function As(e,t){e===""&&(e="."),e=e.replace(/\/$/,"");for(var r=0;t.indexOf(e+"/")!==0;){var n=e.lastIndexOf("/");if(n<0||(e=e.slice(0,n),e.match(/^([^\/]+:\/)?\/*$/)))return t;++r}return Array(r+1).join("../")+t.substr(e.length+1)}K.relative=As;var ai=function(){var e=Object.create(null);return!("__proto__"in e)}();function si(e){return e}function Ts(e){return li(e)?"$"+e:e}K.toSetString=ai?si:Ts;function Es(e){return li(e)?e.slice(1):e}K.fromSetString=ai?si:Es;function li(e){if(!e)return!1;var t=e.length;if(t<9||e.charCodeAt(t-1)!==95||e.charCodeAt(t-2)!==95||e.charCodeAt(t-3)!==111||e.charCodeAt(t-4)!==116||e.charCodeAt(t-5)!==111||e.charCodeAt(t-6)!==114||e.charCodeAt(t-7)!==112||e.charCodeAt(t-8)!==95||e.charCodeAt(t-9)!==95)return!1;for(var r=t-10;r>=0;r--)if(e.charCodeAt(r)!==36)return!1;return!0}function Ls(e,t,r){var n=be(e.source,t.source);return n!==0||(n=e.originalLine-t.originalLine,n!==0)||(n=e.originalColumn-t.originalColumn,n!==0||r)||(n=e.generatedColumn-t.generatedColumn,n!==0)||(n=e.generatedLine-t.generatedLine,n!==0)?n:be(e.name,t.name)}K.compareByOriginalPositions=Ls;function Ps(e,t,r){var n;return n=e.originalLine-t.originalLine,n!==0||(n=e.originalColumn-t.originalColumn,n!==0||r)||(n=e.generatedColumn-t.generatedColumn,n!==0)||(n=e.generatedLine-t.generatedLine,n!==0)?n:be(e.name,t.name)}K.compareByOriginalPositionsNoSource=Ps;function Is(e,t,r){var n=e.generatedLine-t.generatedLine;return n!==0||(n=e.generatedColumn-t.generatedColumn,n!==0||r)||(n=be(e.source,t.source),n!==0)||(n=e.originalLine-t.originalLine,n!==0)||(n=e.originalColumn-t.originalColumn,n!==0)?n:be(e.name,t.name)}K.compareByGeneratedPositionsDeflated=Is;function Ds(e,t,r){var n=e.generatedColumn-t.generatedColumn;return n!==0||r||(n=be(e.source,t.source),n!==0)||(n=e.originalLine-t.originalLine,n!==0)||(n=e.originalColumn-t.originalColumn,n!==0)?n:be(e.name,t.name)}K.compareByGeneratedPositionsDeflatedNoLine=Ds;function be(e,t){return e===t?0:e===null?1:t===null?-1:e>t?1:-1}function Os(e,t){var r=e.generatedLine-t.generatedLine;return r!==0||(r=e.generatedColumn-t.generatedColumn,r!==0)||(r=be(e.source,t.source),r!==0)||(r=e.originalLine-t.originalLine,r!==0)||(r=e.originalColumn-t.originalColumn,r!==0)?r:be(e.name,t.name)}K.compareByGeneratedPositionsInflated=Os;function Ns(e){return JSON.parse(e.replace(/^\)]}'[^\n]*\n/,""))}K.parseSourceMapInput=Ns;function zs(e,t,r){if(t=t||"",e&&(e[e.length-1]!=="/"&&t[0]!=="/"&&(e+="/"),t=e+t),r){var n=ot(r);if(!n)throw new Error("sourceMapURL could not be parsed");if(n.path){var o=n.path.lastIndexOf("/");o>=0&&(n.path=n.path.substring(0,o+1))}t=ii(Ue(n),t)}return dr(t)}K.computeSourceURL=zs});var ui=Oe(ci=>{var gr=Lt(),br=Object.prototype.hasOwnProperty,Le=typeof Map<"u";function xe(){this._array=[],this._set=Le?new Map:Object.create(null)}xe.fromArray=function(t,r){for(var n=new xe,o=0,i=t.length;o<i;o++)n.add(t[o],r);return n};xe.prototype.size=function(){return Le?this._set.size:Object.getOwnPropertyNames(this._set).length};xe.prototype.add=function(t,r){var n=Le?t:gr.toSetString(t),o=Le?this.has(t):br.call(this._set,n),i=this._array.length;(!o||r)&&this._array.push(t),o||(Le?this._set.set(t,i):this._set[n]=i)};xe.prototype.has=function(t){if(Le)return this._set.has(t);var r=gr.toSetString(t);return br.call(this._set,r)};xe.prototype.indexOf=function(t){if(Le){var r=this._set.get(t);if(r>=0)return r}else{var n=gr.toSetString(t);if(br.call(this._set,n))return this._set[n]}throw new Error('"'+t+'" is not in the set.')};xe.prototype.at=function(t){if(t>=0&&t<this._array.length)return this._array[t];throw new Error("No element indexed by "+t)};xe.prototype.toArray=function(){return this._array.slice()};ci.ArraySet=xe});var mi=Oe(hi=>{var pi=Lt();function Ms(e,t){var r=e.generatedLine,n=t.generatedLine,o=e.generatedColumn,i=t.generatedColumn;return n>r||n==r&&i>=o||pi.compareByGeneratedPositionsInflated(e,t)<=0}function Pt(){this._array=[],this._sorted=!0,this._last={generatedLine:-1,generatedColumn:0}}Pt.prototype.unsortedForEach=function(t,r){this._array.forEach(t,r)};Pt.prototype.add=function(t){Ms(this._last,t)?(this._last=t,this._array.push(t)):(this._sorted=!1,this._array.push(t))};Pt.prototype.toArray=function(){return this._sorted||(this._array.sort(pi.compareByGeneratedPositionsInflated),this._sorted=!0),this._array};hi.MappingList=Pt});var di=Oe(fi=>{var it=ni(),H=Lt(),It=ui().ArraySet,Rs=mi().MappingList;function oe(e){e||(e={}),this._file=H.getArg(e,"file",null),this._sourceRoot=H.getArg(e,"sourceRoot",null),this._skipValidation=H.getArg(e,"skipValidation",!1),this._sources=new It,this._names=new It,this._mappings=new Rs,this._sourcesContents=null}oe.prototype._version=3;oe.fromSourceMap=function(t){var r=t.sourceRoot,n=new oe({file:t.file,sourceRoot:r});return t.eachMapping(function(o){var i={generated:{line:o.generatedLine,column:o.generatedColumn}};o.source!=null&&(i.source=o.source,r!=null&&(i.source=H.relative(r,i.source)),i.original={line:o.originalLine,column:o.originalColumn},o.name!=null&&(i.name=o.name)),n.addMapping(i)}),t.sources.forEach(function(o){var i=o;r!==null&&(i=H.relative(r,o)),n._sources.has(i)||n._sources.add(i);var s=t.sourceContentFor(o);s!=null&&n.setSourceContent(o,s)}),n};oe.prototype.addMapping=function(t){var r=H.getArg(t,"generated"),n=H.getArg(t,"original",null),o=H.getArg(t,"source",null),i=H.getArg(t,"name",null);this._skipValidation||this._validateMapping(r,n,o,i),o!=null&&(o=String(o),this._sources.has(o)||this._sources.add(o)),i!=null&&(i=String(i),this._names.has(i)||this._names.add(i)),this._mappings.add({generatedLine:r.line,generatedColumn:r.column,originalLine:n!=null&&n.line,originalColumn:n!=null&&n.column,source:o,name:i})};oe.prototype.setSourceContent=function(t,r){var n=t;this._sourceRoot!=null&&(n=H.relative(this._sourceRoot,n)),r!=null?(this._sourcesContents||(this._sourcesContents=Object.create(null)),this._sourcesContents[H.toSetString(n)]=r):this._sourcesContents&&(delete this._sourcesContents[H.toSetString(n)],Object.keys(this._sourcesContents).length===0&&(this._sourcesContents=null))};oe.prototype.applySourceMap=function(t,r,n){var o=r;if(r==null){if(t.file==null)throw new Error(`SourceMapGenerator.prototype.applySourceMap requires either an explicit source file, or the source map's "file" property. Both were omitted.`);o=t.file}var i=this._sourceRoot;i!=null&&(o=H.relative(i,o));var s=new It,u=new It;this._mappings.unsortedForEach(function(c){if(c.source===o&&c.originalLine!=null){var a=t.originalPositionFor({line:c.originalLine,column:c.originalColumn});a.source!=null&&(c.source=a.source,n!=null&&(c.source=H.join(n,c.source)),i!=null&&(c.source=H.relative(i,c.source)),c.originalLine=a.line,c.originalColumn=a.column,a.name!=null&&(c.name=a.name))}var l=c.source;l!=null&&!s.has(l)&&s.add(l);var p=c.name;p!=null&&!u.has(p)&&u.add(p)},this),this._sources=s,this._names=u,t.sources.forEach(function(c){var a=t.sourceContentFor(c);a!=null&&(n!=null&&(c=H.join(n,c)),i!=null&&(c=H.relative(i,c)),this.setSourceContent(c,a))},this)};oe.prototype._validateMapping=function(t,r,n,o){if(r&&typeof r.line!="number"&&typeof r.column!="number")throw new Error("original.line and original.column are not numbers -- you probably meant to omit the original mapping entirely and only map the generated position. If so, pass null for the original mapping instead of an object with empty or null values.");if(!(t&&"line"in t&&"column"in t&&t.line>0&&t.column>=0&&!r&&!n&&!o)){if(t&&"line"in t&&"column"in t&&r&&"line"in r&&"column"in r&&t.line>0&&t.column>=0&&r.line>0&&r.column>=0&&n)return;throw new Error("Invalid mapping: "+JSON.stringify({generated:t,source:n,original:r,name:o}))}};oe.prototype._serializeMappings=function(){for(var t=0,r=1,n=0,o=0,i=0,s=0,u="",c,a,l,p,m=this._mappings.toArray(),f=0,P=m.length;f<P;f++){if(a=m[f],c="",a.generatedLine!==r)for(t=0;a.generatedLine!==r;)c+=";",r++;else if(f>0){if(!H.compareByGeneratedPositionsInflated(a,m[f-1]))continue;c+=","}c+=it.encode(a.generatedColumn-t),t=a.generatedColumn,a.source!=null&&(p=this._sources.indexOf(a.source),c+=it.encode(p-s),s=p,c+=it.encode(a.originalLine-1-o),o=a.originalLine-1,c+=it.encode(a.originalColumn-n),n=a.originalColumn,a.name!=null&&(l=this._names.indexOf(a.name),c+=it.encode(l-i),i=l)),u+=c}return u};oe.prototype._generateSourcesContent=function(t,r){return t.map(function(n){if(!this._sourcesContents)return null;r!=null&&(n=H.relative(r,n));var o=H.toSetString(n);return Object.prototype.hasOwnProperty.call(this._sourcesContents,o)?this._sourcesContents[o]:null},this)};oe.prototype.toJSON=function(){var t={version:this._version,sources:this._sources.toArray(),names:this._names.toArray(),mappings:this._serializeMappings()};return this._file!=null&&(t.file=this._file),this._sourceRoot!=null&&(t.sourceRoot=this._sourceRoot),this._sourcesContents&&(t.sourcesContent=this._generateSourcesContent(t.sources,t.sourceRoot)),t};oe.prototype.toString=function(){return JSON.stringify(this.toJSON())};fi.SourceMapGenerator=oe});var Ze={};b(Ze,{AtKeyword:()=>D,BadString:()=>Ae,BadUrl:()=>Y,CDC:()=>j,CDO:()=>ue,Colon:()=>O,Comma:()=>G,Comment:()=>E,Delim:()=>g,Dimension:()=>y,EOF:()=>$e,Function:()=>x,Hash:()=>v,Ident:()=>h,LeftCurlyBracket:()=>M,LeftParenthesis:()=>T,LeftSquareBracket:()=>U,Number:()=>d,Percentage:()=>A,RightCurlyBracket:()=>W,RightParenthesis:()=>w,RightSquareBracket:()=>V,Semicolon:()=>_,String:()=>q,Url:()=>F,WhiteSpace:()=>k});var $e=0,h=1,x=2,D=3,v=4,q=5,Ae=6,F=7,Y=8,g=9,d=10,A=11,y=12,k=13,ue=14,j=15,O=16,_=17,G=18,U=19,V=20,T=21,w=22,M=23,W=24,E=25;function B(e){return e>=48&&e<=57}function ee(e){return B(e)||e>=65&&e<=70||e>=97&&e<=102}function kt(e){return e>=65&&e<=90}function ls(e){return e>=97&&e<=122}function cs(e){return kt(e)||ls(e)}function us(e){return e>=128}function yt(e){return cs(e)||us(e)||e===95}function Ne(e){return yt(e)||B(e)||e===45}function ps(e){return e>=0&&e<=8||e===11||e>=14&&e<=31||e===127}function Je(e){return e===10||e===13||e===12}function pe(e){return Je(e)||e===32||e===9}function $(e,t){return!(e!==92||Je(t)||t===0)}function ze(e,t,r){return e===45?yt(t)||t===45||$(t,r):yt(e)?!0:e===92?$(e,t):!1}function wt(e,t,r){return e===43||e===45?B(t)?2:t===46&&B(r)?3:0:e===46?B(t)?2:0:B(e)?1:0}function vt(e){return e===65279||e===65534?1:0}var or=new Array(128),hs=128,et=130,ir=131,St=132,ar=133;for(let e=0;e<or.length;e++)or[e]=pe(e)&&et||B(e)&&ir||yt(e)&&St||ps(e)&&ar||e||hs;function Ct(e){return e<128?or[e]:St}function Me(e,t){return t<e.length?e.charCodeAt(t):0}function At(e,t,r){return r===13&&Me(e,t+1)===10?2:1}function de(e,t,r){let n=e.charCodeAt(t);return kt(n)&&(n=n|32),n===r}function ge(e,t,r,n){if(r-t!==n.length||t<0||r>e.length)return!1;for(let o=t;o<r;o++){let i=n.charCodeAt(o-t),s=e.charCodeAt(o);if(kt(s)&&(s=s|32),s!==i)return!1}return!0}function _o(e,t){for(;t>=0&&pe(e.charCodeAt(t));t--);return t+1}function tt(e,t){for(;t<e.length&&pe(e.charCodeAt(t));t++);return t}function sr(e,t){for(;t<e.length&&B(e.charCodeAt(t));t++);return t}function se(e,t){if(t+=2,ee(Me(e,t-1))){for(let n=Math.min(e.length,t+5);t<n&&ee(Me(e,t));t++);let r=Me(e,t);pe(r)&&(t+=At(e,t,r))}return t}function rt(e,t){for(;t<e.length;t++){let r=e.charCodeAt(t);if(!Ne(r)){if($(r,Me(e,t+1))){t=se(e,t)-1;continue}break}}return t}function Te(e,t){let r=e.charCodeAt(t);if((r===43||r===45)&&(r=e.charCodeAt(t+=1)),B(r)&&(t=sr(e,t+1),r=e.charCodeAt(t)),r===46&&B(e.charCodeAt(t+1))&&(t+=2,t=sr(e,t)),de(e,t,101)){let n=0;r=e.charCodeAt(t+1),(r===45||r===43)&&(n=1,r=e.charCodeAt(t+2)),B(r)&&(t=sr(e,t+1+n+1))}return t}function Tt(e,t){for(;t<e.length;t++){let r=e.charCodeAt(t);if(r===41){t++;break}$(r,Me(e,t+1))&&(t=se(e,t))}return t}function Re(e){if(e.length===1&&!ee(e.charCodeAt(0)))return e[0];let t=parseInt(e,16);return(t===0||t>=55296&&t<=57343||t>1114111)&&(t=65533),String.fromCodePoint(t)}var Fe=["EOF-token","ident-token","function-token","at-keyword-token","hash-token","string-token","bad-string-token","url-token","bad-url-token","delim-token","number-token","percentage-token","dimension-token","whitespace-token","CDO-token","CDC-token","colon-token","semicolon-token","comma-token","[-token","]-token","(-token",")-token","{-token","}-token"];function Be(e=null,t){return e===null||e.length<t?new Uint32Array(Math.max(t+1024,16384)):e}var Uo=10,ms=12,jo=13;function Ho(e){let t=e.source,r=t.length,n=t.length>0?vt(t.charCodeAt(0)):0,o=Be(e.lines,r),i=Be(e.columns,r),s=e.startLine,u=e.startColumn;for(let c=n;c<r;c++){let a=t.charCodeAt(c);o[c]=s,i[c]=u++,(a===Uo||a===jo||a===ms)&&(a===jo&&c+1<r&&t.charCodeAt(c+1)===Uo&&(c++,o[c]=s,i[c]=u),s++,u=1)}o[r]=s,i[r]=u,e.lines=o,e.columns=i,e.computed=!0}var Et=class{constructor(){this.lines=null,this.columns=null,this.computed=!1}setSource(t,r=0,n=1,o=1){this.source=t,this.startOffset=r,this.startLine=n,this.startColumn=o,this.computed=!1}getLocation(t,r){return this.computed||Ho(this),{source:r,offset:this.startOffset+t,line:this.lines[t],column:this.columns[t]}}getLocationRange(t,r,n){return this.computed||Ho(this),{source:n,start:{offset:this.startOffset+t,line:this.lines[t],column:this.columns[t]},end:{offset:this.startOffset+r,line:this.lines[r],column:this.columns[r]}}}};var ne=16777215,we=24,fs=new Map([[2,22],[21,22],[19,20],[23,24]]),nt=class{constructor(t,r){this.setSource(t,r)}reset(){this.eof=!1,this.tokenIndex=-1,this.tokenType=0,this.tokenStart=this.firstCharOffset,this.tokenEnd=this.firstCharOffset}setSource(t="",r=()=>{}){t=String(t||"");let n=t.length,o=Be(this.offsetAndType,t.length+1),i=Be(this.balance,t.length+1),s=0,u=0,c=0,a=-1;for(this.offsetAndType=null,this.balance=null,r(t,(l,p,m)=>{switch(l){default:i[s]=n;break;case u:{let f=c&ne;for(c=i[f],u=c>>we,i[s]=f,i[f++]=s;f<s;f++)i[f]===n&&(i[f]=s);break}case 21:case 2:case 19:case 23:i[s]=c,u=fs.get(l),c=u<<we|s;break}o[s++]=l<<we|m,a===-1&&(a=p)}),o[s]=0<<we|n,i[s]=n,i[n]=n;c!==0;){let l=c&ne;c=i[l],i[l]=n}this.source=t,this.firstCharOffset=a===-1?0:a,this.tokenCount=s,this.offsetAndType=o,this.balance=i,this.reset(),this.next()}lookupType(t){return t+=this.tokenIndex,t<this.tokenCount?this.offsetAndType[t]>>we:0}lookupOffset(t){return t+=this.tokenIndex,t<this.tokenCount?this.offsetAndType[t-1]&ne:this.source.length}lookupValue(t,r){return t+=this.tokenIndex,t<this.tokenCount?ge(this.source,this.offsetAndType[t-1]&ne,this.offsetAndType[t]&ne,r):!1}getTokenStart(t){return t===this.tokenIndex?this.tokenStart:t>0?t<this.tokenCount?this.offsetAndType[t-1]&ne:this.offsetAndType[this.tokenCount]&ne:this.firstCharOffset}substrToCursor(t){return this.source.substring(t,this.tokenStart)}isBalanceEdge(t){return this.balance[this.tokenIndex]<t}isDelim(t,r){return r?this.lookupType(r)===9&&this.source.charCodeAt(this.lookupOffset(r))===t:this.tokenType===9&&this.source.charCodeAt(this.tokenStart)===t}skip(t){let r=this.tokenIndex+t;r<this.tokenCount?(this.tokenIndex=r,this.tokenStart=this.offsetAndType[r-1]&ne,r=this.offsetAndType[r],this.tokenType=r>>we,this.tokenEnd=r&ne):(this.tokenIndex=this.tokenCount,this.next())}next(){let t=this.tokenIndex+1;t<this.tokenCount?(this.tokenIndex=t,this.tokenStart=this.tokenEnd,t=this.offsetAndType[t],this.tokenType=t>>we,this.tokenEnd=t&ne):(this.eof=!0,this.tokenIndex=this.tokenCount,this.tokenType=0,this.tokenStart=this.tokenEnd=this.source.length)}skipSC(){for(;this.tokenType===13||this.tokenType===25;)this.next()}skipUntilBalanced(t,r){let n=t,o,i;e:for(;n<this.tokenCount;n++){if(o=this.balance[n],o<t)break e;switch(i=n>0?this.offsetAndType[n-1]&ne:this.firstCharOffset,r(this.source.charCodeAt(i))){case 1:break e;case 2:n++;break e;default:this.balance[o]===n&&(n=o)}}this.skip(n-this.tokenIndex)}forEachToken(t){for(let r=0,n=this.firstCharOffset;r<this.tokenCount;r++){let o=n,i=this.offsetAndType[r],s=i&ne,u=i>>we;n=s,t(u,o,s,r)}}dump(){let t=new Array(this.tokenCount);return this.forEachToken((r,n,o,i)=>{t[i]={idx:i,type:Fe[r],chunk:this.source.substring(n,o),balance:this.balance[i]}}),t}};function ve(e,t){function r(p){return p<u?e.charCodeAt(p):0}function n(){if(a=Te(e,a),ze(r(a),r(a+1),r(a+2))){l=12,a=rt(e,a);return}if(r(a)===37){l=11,a++;return}l=10}function o(){let p=a;if(a=rt(e,a),ge(e,p,a,"url")&&r(a)===40){if(a=tt(e,a+1),r(a)===34||r(a)===39){l=2,a=p+4;return}s();return}if(r(a)===40){l=2,a++;return}l=1}function i(p){for(p||(p=r(a++)),l=5;a<e.length;a++){let m=e.charCodeAt(a);switch(Ct(m)){case p:a++;return;case et:if(Je(m)){a+=At(e,a,m),l=6;return}break;case 92:if(a===e.length-1)break;let f=r(a+1);Je(f)?a+=At(e,a+1,f):$(m,f)&&(a=se(e,a)-1);break}}}function s(){for(l=7,a=tt(e,a);a<e.length;a++){let p=e.charCodeAt(a);switch(Ct(p)){case 41:a++;return;case et:if(a=tt(e,a),r(a)===41||a>=e.length){a<e.length&&a++;return}a=Tt(e,a),l=8;return;case 34:case 39:case 40:case ar:a=Tt(e,a),l=8;return;case 92:if($(p,r(a+1))){a=se(e,a)-1;break}a=Tt(e,a),l=8;return}}}e=String(e||"");let u=e.length,c=vt(r(0)),a=c,l;for(;a<u;){let p=e.charCodeAt(a);switch(Ct(p)){case et:l=13,a=tt(e,a+1);break;case 34:i();break;case 35:Ne(r(a+1))||$(r(a+1),r(a+2))?(l=4,a=rt(e,a+1)):(l=9,a++);break;case 39:i();break;case 40:l=21,a++;break;case 41:l=22,a++;break;case 43:wt(p,r(a+1),r(a+2))?n():(l=9,a++);break;case 44:l=18,a++;break;case 45:wt(p,r(a+1),r(a+2))?n():r(a+1)===45&&r(a+2)===62?(l=15,a=a+3):ze(p,r(a+1),r(a+2))?o():(l=9,a++);break;case 46:wt(p,r(a+1),r(a+2))?n():(l=9,a++);break;case 47:r(a+1)===42?(l=25,a=e.indexOf("*/",a+2),a=a===-1?e.length:a+2):(l=9,a++);break;case 58:l=16,a++;break;case 59:l=17,a++;break;case 60:r(a+1)===33&&r(a+2)===45&&r(a+3)===45?(l=14,a=a+4):(l=9,a++);break;case 64:ze(r(a+1),r(a+2),r(a+3))?(l=3,a=rt(e,a+1)):(l=9,a++);break;case 91:l=19,a++;break;case 92:$(p,r(a+1))?o():(l=9,a++);break;case 93:l=20,a++;break;case 123:l=23,a++;break;case 125:l=24,a++;break;case ir:n();break;case St:o();break;default:l=9,a++}t(l,c,c=a)}}var _e=null,I=class{static createItem(t){return{prev:null,next:null,data:t}}constructor(){this.head=null,this.tail=null,this.cursor=null}createItem(t){return I.createItem(t)}allocateCursor(t,r){let n;return _e!==null?(n=_e,_e=_e.cursor,n.prev=t,n.next=r,n.cursor=this.cursor):n={prev:t,next:r,cursor:this.cursor},this.cursor=n,n}releaseCursor(){let{cursor:t}=this;this.cursor=t.cursor,t.prev=null,t.next=null,t.cursor=_e,_e=t}updateCursors(t,r,n,o){let{cursor:i}=this;for(;i!==null;)i.prev===t&&(i.prev=r),i.next===n&&(i.next=o),i=i.cursor}*[Symbol.iterator](){for(let t=this.head;t!==null;t=t.next)yield t.data}get size(){let t=0;for(let r=this.head;r!==null;r=r.next)t++;return t}get isEmpty(){return this.head===null}get first(){return this.head&&this.head.data}get last(){return this.tail&&this.tail.data}fromArray(t){let r=null;this.head=null;for(let n of t){let o=I.createItem(n);r!==null?r.next=o:this.head=o,o.prev=r,r=o}return this.tail=r,this}toArray(){return[...this]}toJSON(){return[...this]}forEach(t,r=this){let n=this.allocateCursor(null,this.head);for(;n.next!==null;){let o=n.next;n.next=o.next,t.call(r,o.data,o,this)}this.releaseCursor()}forEachRight(t,r=this){let n=this.allocateCursor(this.tail,null);for(;n.prev!==null;){let o=n.prev;n.prev=o.prev,t.call(r,o.data,o,this)}this.releaseCursor()}reduce(t,r,n=this){let o=this.allocateCursor(null,this.head),i=r,s;for(;o.next!==null;)s=o.next,o.next=s.next,i=t.call(n,i,s.data,s,this);return this.releaseCursor(),i}reduceRight(t,r,n=this){let o=this.allocateCursor(this.tail,null),i=r,s;for(;o.prev!==null;)s=o.prev,o.prev=s.prev,i=t.call(n,i,s.data,s,this);return this.releaseCursor(),i}some(t,r=this){for(let n=this.head;n!==null;n=n.next)if(t.call(r,n.data,n,this))return!0;return!1}map(t,r=this){let n=new I;for(let o=this.head;o!==null;o=o.next)n.appendData(t.call(r,o.data,o,this));return n}filter(t,r=this){let n=new I;for(let o=this.head;o!==null;o=o.next)t.call(r,o.data,o,this)&&n.appendData(o.data);return n}nextUntil(t,r,n=this){if(t===null)return;let o=this.allocateCursor(null,t);for(;o.next!==null;){let i=o.next;if(o.next=i.next,r.call(n,i.data,i,this))break}this.releaseCursor()}prevUntil(t,r,n=this){if(t===null)return;let o=this.allocateCursor(t,null);for(;o.prev!==null;){let i=o.prev;if(o.prev=i.prev,r.call(n,i.data,i,this))break}this.releaseCursor()}clear(){this.head=null,this.tail=null}copy(){let t=new I;for(let r of this)t.appendData(r);return t}prepend(t){return this.updateCursors(null,t,this.head,t),this.head!==null?(this.head.prev=t,t.next=this.head):this.tail=t,this.head=t,this}prependData(t){return this.prepend(I.createItem(t))}append(t){return this.insert(t)}appendData(t){return this.insert(I.createItem(t))}insert(t,r=null){if(r!==null)if(this.updateCursors(r.prev,t,r,t),r.prev===null){if(this.head!==r)throw new Error("before doesn't belong to list");this.head=t,r.prev=t,t.next=r,this.updateCursors(null,t)}else r.prev.next=t,t.prev=r.prev,r.prev=t,t.next=r;else this.updateCursors(this.tail,t,null,t),this.tail!==null?(this.tail.next=t,t.prev=this.tail):this.head=t,this.tail=t;return this}insertData(t,r){return this.insert(I.createItem(t),r)}remove(t){if(this.updateCursors(t,t.prev,t,t.next),t.prev!==null)t.prev.next=t.next;else{if(this.head!==t)throw new Error("item doesn't belong to list");this.head=t.next}if(t.next!==null)t.next.prev=t.prev;else{if(this.tail!==t)throw new Error("item doesn't belong to list");this.tail=t.prev}return t.prev=null,t.next=null,t}push(t){this.insert(I.createItem(t))}pop(){return this.tail!==null?this.remove(this.tail):null}unshift(t){this.prepend(I.createItem(t))}shift(){return this.head!==null?this.remove(this.head):null}prependList(t){return this.insertList(t,this.head)}appendList(t){return this.insertList(t)}insertList(t,r){return t.head===null?this:(r!=null?(this.updateCursors(r.prev,t.tail,r,t.head),r.prev!==null?(r.prev.next=t.head,t.head.prev=r.prev):this.head=t.head,r.prev=t.tail,t.tail.next=r):(this.updateCursors(this.tail,t.tail,null,t.head),this.tail!==null?(this.tail.next=t.head,t.head.prev=this.tail):this.head=t.head,this.tail=t.tail),t.head=null,t.tail=null,this)}replace(t,r){"head"in r?this.insertList(r,t):this.insert(r,t),this.remove(t)}};function Ee(e,t){let r=Object.create(SyntaxError.prototype),n=new Error;return Object.assign(r,{name:e,message:t,get stack(){return(n.stack||"").replace(/^(.+\n){1,3}/,`${e}: ${t}
`)}})}var lr=100,qo=60,Wo="    ";function Yo({source:e,line:t,column:r},n){function o(l,p){return i.slice(l,p).map((m,f)=>String(l+f+1).padStart(c)+" |"+m).join(`
`)}let i=e.split(/\r\n?|\n|\f/),s=Math.max(1,t-n)-1,u=Math.min(t+n,i.length+1),c=Math.max(4,String(u).length)+1,a=0;r+=(Wo.length-1)*(i[t-1].substr(0,r-1).match(/\t/g)||[]).length,r>lr&&(a=r-qo+3,r=qo-2);for(let l=s;l<=u;l++)l>=0&&l<i.length&&(i[l]=i[l].replace(/\t/g,Wo),i[l]=(a>0&&i[l].length>a?"\u2026":"")+i[l].substr(a,lr-2)+(i[l].length>a+lr-1?"\u2026":""));return[o(s,t),new Array(r+c+2).join("-")+"^",o(t,u)].filter(Boolean).join(`
`)}function cr(e,t,r,n,o){return Object.assign(Ee("SyntaxError",e),{source:t,offset:r,line:n,column:o,sourceFragment(s){return Yo({source:t,line:n,column:o},isNaN(s)?0:s)},get formattedMessage(){return`Parse error: ${e}
`+Yo({source:t,line:n,column:o},2)}})}function Go(e){let t=this.createList(),r=!1,n={recognizer:e};for(;!this.eof;){switch(this.tokenType){case 25:this.next();continue;case 13:r=!0,this.next();continue}let o=e.getNode.call(this,n);if(o===void 0)break;r&&(e.onWhiteSpace&&e.onWhiteSpace.call(this,o,t,n),r=!1),t.push(o)}return r&&e.onWhiteSpace&&e.onWhiteSpace.call(this,null,t,n),t}var Vo=()=>{},ds=33,gs=35,ur=59,Ko=123,Qo=0;function bs(e){return function(){return this[e]()}}function pr(e){let t=Object.create(null);for(let r in e){let n=e[r],o=n.parse||n;o&&(t[r]=o)}return t}function xs(e){let t={context:Object.create(null),scope:Object.assign(Object.create(null),e.scope),atrule:pr(e.atrule),pseudo:pr(e.pseudo),node:pr(e.node)};for(let r in e.parseContext)switch(typeof e.parseContext[r]){case"function":t.context[r]=e.parseContext[r];break;case"string":t.context[r]=bs(e.parseContext[r]);break}return{config:t,...t,...t.node}}function Xo(e){let t="",r="<unknown>",n=!1,o=Vo,i=!1,s=new Et,u=Object.assign(new nt,xs(e||{}),{parseAtrulePrelude:!0,parseRulePrelude:!0,parseValue:!0,parseCustomProperty:!1,readSequence:Go,consumeUntilBalanceEnd:()=>0,consumeUntilLeftCurlyBracket(a){return a===Ko?1:0},consumeUntilLeftCurlyBracketOrSemicolon(a){return a===Ko||a===ur?1:0},consumeUntilExclamationMarkOrSemicolon(a){return a===ds||a===ur?1:0},consumeUntilSemicolonIncluded(a){return a===ur?2:0},createList(){return new I},createSingleNodeList(a){return new I().appendData(a)},getFirstListNode(a){return a&&a.first},getLastListNode(a){return a&&a.last},parseWithFallback(a,l){let p=this.tokenIndex;try{return a.call(this)}catch(m){if(i)throw m;let f=l.call(this,p);return i=!0,o(m,f),i=!1,f}},lookupNonWSType(a){let l;do if(l=this.lookupType(a++),l!==13)return l;while(l!==Qo);return Qo},charCodeAt(a){return a>=0&&a<t.length?t.charCodeAt(a):0},substring(a,l){return t.substring(a,l)},substrToCursor(a){return this.source.substring(a,this.tokenStart)},cmpChar(a,l){return de(t,a,l)},cmpStr(a,l,p){return ge(t,a,l,p)},consume(a){let l=this.tokenStart;return this.eat(a),this.substrToCursor(l)},consumeFunctionName(){let a=t.substring(this.tokenStart,this.tokenEnd-1);return this.eat(2),a},consumeNumber(a){let l=t.substring(this.tokenStart,Te(t,this.tokenStart));return this.eat(a),l},eat(a){if(this.tokenType!==a){let l=Fe[a].slice(0,-6).replace(/-/g," ").replace(/^./,f=>f.toUpperCase()),p=`${/[[\](){}]/.test(l)?`"${l}"`:l} is expected`,m=this.tokenStart;switch(a){case 1:this.tokenType===2||this.tokenType===7?(m=this.tokenEnd-1,p="Identifier is expected but function found"):p="Identifier is expected";break;case 4:this.isDelim(gs)&&(this.next(),m++,p="Name is expected");break;case 11:this.tokenType===10&&(m=this.tokenEnd,p="Percent sign is expected");break}this.error(p,m)}this.next()},eatIdent(a){(this.tokenType!==1||this.lookupValue(0,a)===!1)&&this.error(`Identifier "${a}" is expected`),this.next()},eatDelim(a){this.isDelim(a)||this.error(`Delim "${String.fromCharCode(a)}" is expected`),this.next()},getLocation(a,l){return n?s.getLocationRange(a,l,r):null},getLocationFromList(a){if(n){let l=this.getFirstListNode(a),p=this.getLastListNode(a);return s.getLocationRange(l!==null?l.loc.start.offset-s.startOffset:this.tokenStart,p!==null?p.loc.end.offset-s.startOffset:this.tokenStart,r)}return null},error(a,l){let p=typeof l<"u"&&l<t.length?s.getLocation(l):this.eof?s.getLocation(_o(t,t.length-1)):s.getLocation(this.tokenStart);throw new cr(a||"Unexpected input",t,p.offset,p.line,p.column)}});return Object.assign(function(a,l){t=a,l=l||{},u.setSource(t,ve),s.setSource(t,l.offset,l.line,l.column),r=l.filename||"<unknown>",n=Boolean(l.positions),o=typeof l.onParseError=="function"?l.onParseError:Vo,i=!1,u.parseAtrulePrelude="parseAtrulePrelude"in l?Boolean(l.parseAtrulePrelude):!0,u.parseRulePrelude="parseRulePrelude"in l?Boolean(l.parseRulePrelude):!0,u.parseValue="parseValue"in l?Boolean(l.parseValue):!0,u.parseCustomProperty="parseCustomProperty"in l?Boolean(l.parseCustomProperty):!1;let{context:p="default",onComment:m}=l;if(!(p in u.context))throw new Error("Unknown context `"+p+"`");typeof m=="function"&&u.forEachToken((P,te,X)=>{if(P===25){let S=u.getLocation(te,X),R=ge(t,X-2,X,"*/")?t.slice(te+2,X-2):t.slice(te+2,X);m(R,S)}});let f=u.context[p].call(u,l);return u.eof||u.error(),f},{SyntaxError:cr,config:u.config})}var bi=ss(di(),1),gi=new Set(["Atrule","Selector","Declaration"]);function xi(e){let t=new bi.SourceMapGenerator,r={line:1,column:0},n={line:0,column:0},o={line:1,column:0},i={generated:o},s=1,u=0,c=!1,a=e.node;e.node=function(m){if(m.loc&&m.loc.start&&gi.has(m.type)){let f=m.loc.start.line,P=m.loc.start.column-1;(n.line!==f||n.column!==P)&&(n.line=f,n.column=P,r.line=s,r.column=u,c&&(c=!1,(r.line!==o.line||r.column!==o.column)&&t.addMapping(i)),c=!0,t.addMapping({source:m.loc.source,original:n,generated:r}))}a.call(this,m),c&&gi.has(m.type)&&(o.line=s,o.column=u)};let l=e.emit;e.emit=function(m,f,P){for(let te=0;te<m.length;te++)m.charCodeAt(te)===10?(s++,u=0):u++;l(m,f,P)};let p=e.result;return e.result=function(){return c&&t.addMapping(i),{css:p(),map:t}},e}var Dt={};b(Dt,{safe:()=>yr,spec:()=>Us});var Fs=43,Bs=45,xr=(e,t)=>{if(e===9&&(e=t),typeof e=="string"){let r=e.charCodeAt(0);return r>127?32768:r<<8}return e},yi=[[1,1],[1,2],[1,7],[1,8],[1,"-"],[1,10],[1,11],[1,12],[1,15],[1,21],[3,1],[3,2],[3,7],[3,8],[3,"-"],[3,10],[3,11],[3,12],[3,15],[4,1],[4,2],[4,7],[4,8],[4,"-"],[4,10],[4,11],[4,12],[4,15],[12,1],[12,2],[12,7],[12,8],[12,"-"],[12,10],[12,11],[12,12],[12,15],["#",1],["#",2],["#",7],["#",8],["#","-"],["#",10],["#",11],["#",12],["#",15],["-",1],["-",2],["-",7],["-",8],["-","-"],["-",10],["-",11],["-",12],["-",15],[10,1],[10,2],[10,7],[10,8],[10,10],[10,11],[10,12],[10,"%"],[10,15],["@",1],["@",2],["@",7],["@",8],["@","-"],["@",15],[".",10],[".",11],[".",12],["+",10],["+",11],["+",12],["/","*"]],_s=yi.concat([[1,4],[12,4],[4,4],[3,21],[3,5],[3,16],[11,11],[11,12],[11,2],[11,"-"],[22,1],[22,2],[22,11],[22,12],[22,4],[22,"-"]]);function ki(e){let t=new Set(e.map(([r,n])=>xr(r)<<16|xr(n)));return function(r,n,o){let i=xr(n,o),s=o.charCodeAt(0);return(s===Bs&&n!==1&&n!==2&&n!==15||s===Fs?t.has(r<<16|s<<8):t.has(r<<16|i))&&this.emit(" ",13,!0),i}}var Us=ki(yi),yr=ki(_s);var js=92;function Hs(e,t){if(typeof t=="function"){let r=null;e.children.forEach(n=>{r!==null&&t.call(this,r),this.node(n),r=n});return}e.children.forEach(this.node,this)}function qs(e){ve(e,(t,r,n)=>{this.token(t,e.slice(r,n))})}function wi(e){let t=new Map;for(let r in e.node){let n=e.node[r];typeof(n.generate||n)=="function"&&t.set(r,n.generate||n)}return function(r,n){let o="",i=0,s={node(c){if(t.has(c.type))t.get(c.type).call(u,c);else throw new Error("Unknown node type: "+c.type)},tokenBefore:yr,token(c,a){i=this.tokenBefore(i,c,a),this.emit(a,c,!1),c===9&&a.charCodeAt(0)===js&&this.emit(`
`,13,!0)},emit(c){o+=c},result(){return o}};n&&(typeof n.decorator=="function"&&(s=n.decorator(s)),n.sourceMap&&(s=xi(s)),n.mode in Dt&&(s.tokenBefore=Dt[n.mode]));let u={node:c=>s.node(c),children:Hs,token:(c,a)=>s.token(c,a),tokenize:qs};return s.node(r),s.result()}}function vi(e){return{fromPlainObject(t){return e(t,{enter(r){r.children&&!(r.children instanceof I)&&(r.children=new I().fromArray(r.children))}}),t},toPlainObject(t){return e(t,{leave(r){r.children&&r.children instanceof I&&(r.children=r.children.toArray())}}),t}}}var{hasOwnProperty:kr}=Object.prototype,at=function(){};function Si(e){return typeof e=="function"?e:at}function Ci(e,t){return function(r,n,o){r.type===t&&e.call(this,r,n,o)}}function Ws(e,t){let r=t.structure,n=[];for(let o in r){if(kr.call(r,o)===!1)continue;let i=r[o],s={name:o,type:!1,nullable:!1};Array.isArray(i)||(i=[i]);for(let u of i)u===null?s.nullable=!0:typeof u=="string"?s.type="node":Array.isArray(u)&&(s.type="list");s.type&&n.push(s)}return n.length?{context:t.walkContext,fields:n}:null}function Ys(e){let t={};for(let r in e.node)if(kr.call(e.node,r)){let n=e.node[r];if(!n.structure)throw new Error("Missed `structure` field in `"+r+"` node type definition");t[r]=Ws(r,n)}return t}function Ai(e,t){let r=e.fields.slice(),n=e.context,o=typeof n=="string";return t&&r.reverse(),function(i,s,u,c){let a;o&&(a=s[n],s[n]=i);for(let l of r){let p=i[l.name];if(!l.nullable||p){if(l.type==="list"){if(t?p.reduceRight(c,!1):p.reduce(c,!1))return!0}else if(u(p))return!0}}o&&(s[n]=a)}}function Ti({StyleSheet:e,Atrule:t,Rule:r,Block:n,DeclarationList:o}){return{Atrule:{StyleSheet:e,Atrule:t,Rule:r,Block:n},Rule:{StyleSheet:e,Atrule:t,Rule:r,Block:n},Declaration:{StyleSheet:e,Atrule:t,Rule:r,Block:n,DeclarationList:o}}}function Ei(e){let t=Ys(e),r={},n={},o=Symbol("break-walk"),i=Symbol("skip-node");for(let a in t)kr.call(t,a)&&t[a]!==null&&(r[a]=Ai(t[a],!1),n[a]=Ai(t[a],!0));let s=Ti(r),u=Ti(n),c=function(a,l){function p(S,R,ke){let z=m.call(X,S,R,ke);return z===o?!0:z===i?!1:!!(P.hasOwnProperty(S.type)&&P[S.type](S,X,p,te)||f.call(X,S,R,ke)===o)}let m=at,f=at,P=r,te=(S,R,ke,z)=>S||p(R,ke,z),X={break:o,skip:i,root:a,stylesheet:null,atrule:null,atrulePrelude:null,rule:null,selector:null,block:null,declaration:null,function:null};if(typeof l=="function")m=l;else if(l&&(m=Si(l.enter),f=Si(l.leave),l.reverse&&(P=n),l.visit)){if(s.hasOwnProperty(l.visit))P=l.reverse?u[l.visit]:s[l.visit];else if(!t.hasOwnProperty(l.visit))throw new Error("Bad value `"+l.visit+"` for `visit` option (should be: "+Object.keys(t).sort().join(", ")+")");m=Ci(m,l.visit),f=Ci(f,l.visit)}if(m===at&&f===at)throw new Error("Neither `enter` nor `leave` walker handler is set or both aren't a function");p(a)};return c.break=o,c.skip=i,c.find=function(a,l){let p=null;return c(a,function(m,f,P){if(l.call(this,m,f,P))return p=m,o}),p},c.findLast=function(a,l){let p=null;return c(a,{reverse:!0,enter(m,f,P){if(l.call(this,m,f,P))return p=m,o}}),p},c.findAll=function(a,l){let p=[];return c(a,function(m,f,P){l.call(this,m,f,P)&&p.push(m)}),p},c}function Gs(e){return e}function Vs(e){let{min:t,max:r,comma:n}=e;return t===0&&r===0?n?"#?":"*":t===0&&r===1?"?":t===1&&r===0?n?"#":"+":t===1&&r===1?"":(n?"#":"")+(t===r?"{"+t+"}":"{"+t+","+(r!==0?r:"")+"}")}function Ks(e){switch(e.type){case"Range":return" ["+(e.min===null?"-\u221E":e.min)+","+(e.max===null?"\u221E":e.max)+"]";default:throw new Error("Unknown node type `"+e.type+"`")}}function Qs(e,t,r,n){let o=e.combinator===" "||n?e.combinator:" "+e.combinator+" ",i=e.terms.map(s=>wr(s,t,r,n)).join(o);return e.explicit||r?(n||i[0]===","?"[":"[ ")+i+(n?"]":" ]"):i}function wr(e,t,r,n){let o;switch(e.type){case"Group":o=Qs(e,t,r,n)+(e.disallowEmpty?"!":"");break;case"Multiplier":return wr(e.term,t,r,n)+t(Vs(e),e);case"Type":o="<"+e.name+(e.opts?t(Ks(e.opts),e.opts):"")+">";break;case"Property":o="<'"+e.name+"'>";break;case"Keyword":o=e.name;break;case"AtKeyword":o="@"+e.name;break;case"Function":o=e.name+"(";break;case"String":case"Token":o=e.value;break;case"Comma":o=",";break;default:throw new Error("Unknown node type `"+e.type+"`")}return t(o,e)}function Pe(e,t){let r=Gs,n=!1,o=!1;return typeof t=="function"?r=t:t&&(n=Boolean(t.forceBraces),o=Boolean(t.compact),typeof t.decorate=="function"&&(r=t.decorate)),wr(e,r,n,o)}var Li={offset:0,line:1,column:1};function Xs(e,t){let r=e.tokens,n=e.longestMatch,o=n<r.length&&r[n].node||null,i=o!==t?o:null,s=0,u=0,c=0,a="",l,p;for(let m=0;m<r.length;m++){let f=r[m].value;m===n&&(u=f.length,s=a.length),i!==null&&r[m].node===i&&(m<=n?c++:c=0),a+=f}return n===r.length||c>1?(l=Ot(i||t,"end")||st(Li,a),p=st(l)):(l=Ot(i,"start")||st(Ot(t,"start")||Li,a.slice(0,s)),p=Ot(i,"end")||st(l,a.substr(s,u))),{css:a,mismatchOffset:s,mismatchLength:u,start:l,end:p}}function Ot(e,t){let r=e&&e.loc&&e.loc[t];return r?"line"in r?st(r):r:null}function st({offset:e,line:t,column:r},n){let o={offset:e,line:t,column:r};if(n){let i=n.split(/\n|\r\n?|\f/);o.offset+=n.length,o.line+=i.length-1,o.column=i.length===1?o.column+n.length:i.pop().length+1}return o}var je=function(e,t){let r=Ee("SyntaxReferenceError",e+(t?" `"+t+"`":""));return r.reference=t,r},Pi=function(e,t,r,n){let o=Ee("SyntaxMatchError",e),{css:i,mismatchOffset:s,mismatchLength:u,start:c,end:a}=Xs(n,r);return o.rawMessage=e,o.syntax=t?Pe(t):"<generic>",o.css=i,o.mismatchOffset=s,o.mismatchLength=u,o.message=e+`
  syntax: `+o.syntax+`
   value: `+(i||"<empty string>")+`
  --------`+new Array(o.mismatchOffset+1).join("-")+"^",Object.assign(o,c),o.loc={source:r&&r.loc&&r.loc.source||"<unknown>",start:c,end:a},o};var Nt=new Map,He=new Map,zt=45,Mt=$s,vr=Zs,_m=Sr;function Rt(e,t){return t=t||0,e.length-t>=2&&e.charCodeAt(t)===zt&&e.charCodeAt(t+1)===zt}function Sr(e,t){if(t=t||0,e.length-t>=3&&e.charCodeAt(t)===zt&&e.charCodeAt(t+1)!==zt){let r=e.indexOf("-",t+2);if(r!==-1)return e.substring(t,r+1)}return""}function $s(e){if(Nt.has(e))return Nt.get(e);let t=e.toLowerCase(),r=Nt.get(t);if(r===void 0){let n=Rt(t,0),o=n?"":Sr(t,0);r=Object.freeze({basename:t.substr(o.length),name:t,prefix:o,vendor:o,custom:n})}return Nt.set(e,r),r}function Zs(e){if(He.has(e))return He.get(e);let t=e,r=e[0];r==="/"?r=e[1]==="/"?"//":"/":r!=="_"&&r!=="*"&&r!=="$"&&r!=="#"&&r!=="+"&&r!=="&"&&(r="");let n=Rt(t,r.length);if(!n&&(t=t.toLowerCase(),He.has(t))){let u=He.get(t);return He.set(e,u),u}let o=n?"":Sr(t,r.length),i=t.substr(0,r.length+o.length),s=Object.freeze({basename:t.substr(i.length),name:t.substr(r.length),hack:r,vendor:o,prefix:i,custom:n});return He.set(e,s),s}var Ft=["initial","inherit","unset","revert","revert-layer"];var ct=43,he=45,Cr=110,qe=!0,el=!1;function Tr(e,t){return e!==null&&e.type===9&&e.value.charCodeAt(0)===t}function lt(e,t,r){for(;e!==null&&(e.type===13||e.type===25);)e=r(++t);return t}function Se(e,t,r,n){if(!e)return 0;let o=e.value.charCodeAt(t);if(o===ct||o===he){if(r)return 0;t++}for(;t<e.value.length;t++)if(!B(e.value.charCodeAt(t)))return 0;return n+1}function Ar(e,t,r){let n=!1,o=lt(e,t,r);if(e=r(o),e===null)return t;if(e.type!==10)if(Tr(e,ct)||Tr(e,he)){if(n=!0,o=lt(r(++o),o,r),e=r(o),e===null||e.type!==10)return 0}else return t;if(!n){let i=e.value.charCodeAt(0);if(i!==ct&&i!==he)return 0}return Se(e,n?0:1,n,o)}function Er(e,t){let r=0;if(!e)return 0;if(e.type===10)return Se(e,0,el,r);if(e.type===1&&e.value.charCodeAt(0)===he){if(!de(e.value,1,Cr))return 0;switch(e.value.length){case 2:return Ar(t(++r),r,t);case 3:return e.value.charCodeAt(2)!==he?0:(r=lt(t(++r),r,t),e=t(r),Se(e,0,qe,r));default:return e.value.charCodeAt(2)!==he?0:Se(e,3,qe,r)}}else if(e.type===1||Tr(e,ct)&&t(r+1).type===1){if(e.type!==1&&(e=t(++r)),e===null||!de(e.value,0,Cr))return 0;switch(e.value.length){case 1:return Ar(t(++r),r,t);case 2:return e.value.charCodeAt(1)!==he?0:(r=lt(t(++r),r,t),e=t(r),Se(e,0,qe,r));default:return e.value.charCodeAt(1)!==he?0:Se(e,2,qe,r)}}else if(e.type===12){let n=e.value.charCodeAt(0),o=n===ct||n===he?1:0,i=o;for(;i<e.value.length&&B(e.value.charCodeAt(i));i++);return i===o||!de(e.value,i,Cr)?0:i+1===e.value.length?Ar(t(++r),r,t):e.value.charCodeAt(i+1)!==he?0:i+2===e.value.length?(r=lt(t(++r),r,t),e=t(r),Se(e,0,qe,r)):Se(e,i+2,qe,r)}return 0}var tl=43,Ii=45,Di=63,rl=117;function Lr(e,t){return e!==null&&e.type===9&&e.value.charCodeAt(0)===t}function nl(e,t){return e.value.charCodeAt(0)===t}function ut(e,t,r){let n=0;for(let o=t;o<e.value.length;o++){let i=e.value.charCodeAt(o);if(i===Ii&&r&&n!==0)return ut(e,t+n+1,!1),6;if(!ee(i)||++n>6)return 0}return n}function Bt(e,t,r){if(!e)return 0;for(;Lr(r(t),Di);){if(++e>6)return 0;t++}return t}function Pr(e,t){let r=0;if(e===null||e.type!==1||!de(e.value,0,rl)||(e=t(++r),e===null))return 0;if(Lr(e,tl))return e=t(++r),e===null?0:e.type===1?Bt(ut(e,0,!0),++r,t):Lr(e,Di)?Bt(1,++r,t):0;if(e.type===10){let n=ut(e,1,!0);return n===0?0:(e=t(++r),e===null?r:e.type===12||e.type===10?!nl(e,Ii)||!ut(e,1,!1)?0:r+1:Bt(n,r,t))}return e.type===12?Bt(ut(e,1,!0),++r,t):0}var ol=["calc(","-moz-calc(","-webkit-calc("],Ir=new Map([[2,22],[21,22],[19,20],[23,24]]),il=["cm","mm","q","in","pt","pc","px","em","rem","ex","rex","cap","rcap","ch","rch","ic","ric","lh","rlh","vw","svw","lvw","dvw","vh","svh","lvh","dvh","vi","svi","lvi","dvi","vb","svb","lvb","dvb","vmin","svmin","lvmin","dvmin","vmax","svmax","lvmax","dvmax","cqw","cqh","cqi","cqb","cqmin","cqmax"],al=["deg","grad","rad","turn"],sl=["s","ms"],ll=["hz","khz"],cl=["dpi","dpcm","dppx","x"],ul=["fr"],pl=["db"],hl=["st"];function le(e,t){return t<e.length?e.charCodeAt(t):0}function Ni(e,t){return ge(e,0,e.length,t)}function zi(e,t){for(let r=0;r<t.length;r++)if(Ni(e,t[r]))return!0;return!1}function Mi(e,t){return t!==e.length-2?!1:le(e,t)===92&&B(le(e,t+1))}function _t(e,t,r){if(e&&e.type==="Range"){let n=Number(r!==void 0&&r!==t.length?t.substr(0,r):t);if(isNaN(n)||e.min!==null&&n<e.min&&typeof e.min!="string"||e.max!==null&&n>e.max&&typeof e.max!="string")return!0}return!1}function ml(e,t){let r=0,n=[],o=0;e:do{switch(e.type){case 24:case 22:case 20:if(e.type!==r)break e;if(r=n.pop(),n.length===0){o++;break e}break;case 2:case 21:case 19:case 23:n.push(r),r=Ir.get(e.type);break}o++}while(e=t(o));return o}function ie(e){return function(t,r,n){return t===null?0:t.type===2&&zi(t.value,ol)?ml(t,r):e(t,r,n)}}function N(e){return function(t){return t===null||t.type!==e?0:1}}function fl(e){if(e===null||e.type!==1)return 0;let t=e.value.toLowerCase();return zi(t,Ft)||Ni(t,"default")?0:1}function dl(e){return e===null||e.type!==1||le(e.value,0)!==45||le(e.value,1)!==45?0:1}function gl(e){if(e===null||e.type!==4)return 0;let t=e.value.length;if(t!==4&&t!==5&&t!==7&&t!==9)return 0;for(let r=1;r<t;r++)if(!ee(le(e.value,r)))return 0;return 1}function bl(e){return e===null||e.type!==4||!ze(le(e.value,1),le(e.value,2),le(e.value,3))?0:1}function xl(e,t){if(!e)return 0;let r=0,n=[],o=0;e:do{switch(e.type){case 6:case 8:break e;case 24:case 22:case 20:if(e.type!==r)break e;r=n.pop();break;case 17:if(r===0)break e;break;case 9:if(r===0&&e.value==="!")break e;break;case 2:case 21:case 19:case 23:n.push(r),r=Ir.get(e.type);break}o++}while(e=t(o));return o}function yl(e,t){if(!e)return 0;let r=0,n=[],o=0;e:do{switch(e.type){case 6:case 8:break e;case 24:case 22:case 20:if(e.type!==r)break e;r=n.pop();break;case 2:case 21:case 19:case 23:n.push(r),r=Ir.get(e.type);break}o++}while(e=t(o));return o}function ye(e){return e&&(e=new Set(e)),function(t,r,n){if(t===null||t.type!==12)return 0;let o=Te(t.value,0);if(e!==null){let i=t.value.indexOf("\\",o),s=i===-1||!Mi(t.value,i)?t.value.substr(o):t.value.substring(o,i);if(e.has(s.toLowerCase())===!1)return 0}return _t(n,t.value,o)?0:1}}function kl(e,t,r){return e===null||e.type!==11||_t(r,e.value,e.value.length-1)?0:1}function Oi(e){return typeof e!="function"&&(e=function(){return 0}),function(t,r,n){return t!==null&&t.type===10&&Number(t.value)===0?1:e(t,r,n)}}function wl(e,t,r){if(e===null)return 0;let n=Te(e.value,0);return!(n===e.value.length)&&!Mi(e.value,n)||_t(r,e.value,n)?0:1}function vl(e,t,r){if(e===null||e.type!==10)return 0;let n=le(e.value,0)===43||le(e.value,0)===45?1:0;for(;n<e.value.length;n++)if(!B(le(e.value,n)))return 0;return _t(r,e.value,n)?0:1}var Dr={"ident-token":N(1),"function-token":N(2),"at-keyword-token":N(3),"hash-token":N(4),"string-token":N(5),"bad-string-token":N(6),"url-token":N(7),"bad-url-token":N(8),"delim-token":N(9),"number-token":N(10),"percentage-token":N(11),"dimension-token":N(12),"whitespace-token":N(13),"CDO-token":N(14),"CDC-token":N(15),"colon-token":N(16),"semicolon-token":N(17),"comma-token":N(18),"[-token":N(19),"]-token":N(20),"(-token":N(21),")-token":N(22),"{-token":N(23),"}-token":N(24),string:N(5),ident:N(1),"custom-ident":fl,"custom-property-name":dl,"hex-color":gl,"id-selector":bl,"an-plus-b":Er,urange:Pr,"declaration-value":xl,"any-value":yl,dimension:ie(ye(null)),angle:ie(ye(al)),decibel:ie(ye(pl)),frequency:ie(ye(ll)),flex:ie(ye(ul)),length:ie(Oi(ye(il))),resolution:ie(ye(cl)),semitones:ie(ye(hl)),time:ie(ye(sl)),percentage:ie(kl),zero:Oi(),number:ie(wl),integer:ie(vl)};var Qi={};b(Qi,{SyntaxError:()=>Ut,generate:()=>Pe,parse:()=>Ge,walk:()=>Vt});function Ut(e,t,r){return Object.assign(Ee("SyntaxError",e),{input:t,offset:r,rawMessage:e,message:e+`
  `+t+`
--`+new Array((r||t.length)+1).join("-")+"^"})}var Sl=9,Cl=10,Al=12,Tl=13,El=32,jt=class{constructor(t){this.str=t,this.pos=0}charCodeAt(t){return t<this.str.length?this.str.charCodeAt(t):0}charCode(){return this.charCodeAt(this.pos)}nextCharCode(){return this.charCodeAt(this.pos+1)}nextNonWsCode(t){return this.charCodeAt(this.findWsEnd(t))}findWsEnd(t){for(;t<this.str.length;t++){let r=this.str.charCodeAt(t);if(r!==Tl&&r!==Cl&&r!==Al&&r!==El&&r!==Sl)break}return t}substringToPos(t){return this.str.substring(this.pos,this.pos=t)}eat(t){this.charCode()!==t&&this.error("Expect `"+String.fromCharCode(t)+"`"),this.pos++}peek(){return this.pos<this.str.length?this.str.charAt(this.pos++):""}error(t){throw new Ut(t,this.str,this.pos)}};var Ll=9,Pl=10,Il=12,Dl=13,Ol=32,qi=33,zr=35,Ri=38,Ht=39,Wi=40,Nl=41,Yi=42,Mr=43,Rr=44,Fi=45,Fr=60,Gi=62,Nr=63,zl=64,Gt=91,Br=93,qt=123,Bi=124,_i=125,Ui=8734,pt=new Uint8Array(128).map((e,t)=>/[a-zA-Z0-9\-]/.test(String.fromCharCode(t))?1:0),ji={" ":1,"&&":2,"||":3,"|":4};function Wt(e){return e.substringToPos(e.findWsEnd(e.pos))}function We(e){let t=e.pos;for(;t<e.str.length;t++){let r=e.str.charCodeAt(t);if(r>=128||pt[r]===0)break}return e.pos===t&&e.error("Expect a keyword"),e.substringToPos(t)}function Yt(e){let t=e.pos;for(;t<e.str.length;t++){let r=e.str.charCodeAt(t);if(r<48||r>57)break}return e.pos===t&&e.error("Expect a number"),e.substringToPos(t)}function Ml(e){let t=e.str.indexOf("'",e.pos+1);return t===-1&&(e.pos=e.str.length,e.error("Expect an apostrophe")),e.substringToPos(t+1)}function Hi(e){let t=null,r=null;return e.eat(qt),t=Yt(e),e.charCode()===Rr?(e.pos++,e.charCode()!==_i&&(r=Yt(e))):r=t,e.eat(_i),{min:Number(t),max:r?Number(r):0}}function Rl(e){let t=null,r=!1;switch(e.charCode()){case Yi:e.pos++,t={min:0,max:0};break;case Mr:e.pos++,t={min:1,max:0};break;case Nr:e.pos++,t={min:0,max:1};break;case zr:e.pos++,r=!0,e.charCode()===qt?t=Hi(e):e.charCode()===Nr?(e.pos++,t={min:0,max:0}):t={min:1,max:0};break;case qt:t=Hi(e);break;default:return null}return{type:"Multiplier",comma:r,min:t.min,max:t.max,term:null}}function Ye(e,t){let r=Rl(e);return r!==null?(r.term=t,e.charCode()===zr&&e.charCodeAt(e.pos-1)===Mr?Ye(e,r):r):t}function Or(e){let t=e.peek();return t===""?null:{type:"Token",value:t}}function Fl(e){let t;return e.eat(Fr),e.eat(Ht),t=We(e),e.eat(Ht),e.eat(Gi),Ye(e,{type:"Property",name:t})}function Bl(e){let t=null,r=null,n=1;return e.eat(Gt),e.charCode()===Fi&&(e.peek(),n=-1),n==-1&&e.charCode()===Ui?e.peek():(t=n*Number(Yt(e)),pt[e.charCode()]!==0&&(t+=We(e))),Wt(e),e.eat(Rr),Wt(e),e.charCode()===Ui?e.peek():(n=1,e.charCode()===Fi&&(e.peek(),n=-1),r=n*Number(Yt(e)),pt[e.charCode()]!==0&&(r+=We(e))),e.eat(Br),{type:"Range",min:t,max:r}}function _l(e){let t,r=null;return e.eat(Fr),t=We(e),e.charCode()===Wi&&e.nextCharCode()===Nl&&(e.pos+=2,t+="()"),e.charCodeAt(e.findWsEnd(e.pos))===Gt&&(Wt(e),r=Bl(e)),e.eat(Gi),Ye(e,{type:"Type",name:t,opts:r})}function Ul(e){let t=We(e);return e.charCode()===Wi?(e.pos++,{type:"Function",name:t}):Ye(e,{type:"Keyword",name:t})}function jl(e,t){function r(o,i){return{type:"Group",terms:o,combinator:i,disallowEmpty:!1,explicit:!1}}let n;for(t=Object.keys(t).sort((o,i)=>ji[o]-ji[i]);t.length>0;){n=t.shift();let o=0,i=0;for(;o<e.length;o++){let s=e[o];s.type==="Combinator"&&(s.value===n?(i===-1&&(i=o-1),e.splice(o,1),o--):(i!==-1&&o-i>1&&(e.splice(i,o-i,r(e.slice(i,o),n)),o=i+1),i=-1))}i!==-1&&t.length&&e.splice(i,o-i,r(e.slice(i,o),n))}return n}function Vi(e){let t=[],r={},n,o=null,i=e.pos;for(;n=ql(e);)n.type!=="Spaces"&&(n.type==="Combinator"?((o===null||o.type==="Combinator")&&(e.pos=i,e.error("Unexpected combinator")),r[n.value]=!0):o!==null&&o.type!=="Combinator"&&(r[" "]=!0,t.push({type:"Combinator",value:" "})),t.push(n),o=n,i=e.pos);return o!==null&&o.type==="Combinator"&&(e.pos-=i,e.error("Unexpected combinator")),{type:"Group",terms:t,combinator:jl(t,r)||" ",disallowEmpty:!1,explicit:!1}}function Hl(e){let t;return e.eat(Gt),t=Vi(e),e.eat(Br),t.explicit=!0,e.charCode()===qi&&(e.pos++,t.disallowEmpty=!0),t}function ql(e){let t=e.charCode();if(t<128&&pt[t]===1)return Ul(e);switch(t){case Br:break;case Gt:return Ye(e,Hl(e));case Fr:return e.nextCharCode()===Ht?Fl(e):_l(e);case Bi:return{type:"Combinator",value:e.substringToPos(e.pos+(e.nextCharCode()===Bi?2:1))};case Ri:return e.pos++,e.eat(Ri),{type:"Combinator",value:"&&"};case Rr:return e.pos++,{type:"Comma"};case Ht:return Ye(e,{type:"String",value:Ml(e)});case Ol:case Ll:case Pl:case Dl:case Il:return{type:"Spaces",value:Wt(e)};case zl:return t=e.nextCharCode(),t<128&&pt[t]===1?(e.pos++,{type:"AtKeyword",name:We(e)}):Or(e);case Yi:case Mr:case Nr:case zr:case qi:break;case qt:if(t=e.nextCharCode(),t<48||t>57)return Or(e);break;default:return Or(e)}}function Ge(e){let t=new jt(e),r=Vi(t);return t.pos!==e.length&&t.error("Unexpected input"),r.terms.length===1&&r.terms[0].type==="Group"?r.terms[0]:r}var ht=function(){};function Ki(e){return typeof e=="function"?e:ht}function Vt(e,t,r){function n(s){switch(o.call(r,s),s.type){case"Group":s.terms.forEach(n);break;case"Multiplier":n(s.term);break;case"Type":case"Property":case"Keyword":case"AtKeyword":case"Function":case"String":case"Token":case"Comma":break;default:throw new Error("Unknown type: "+s.type)}i.call(r,s)}let o=ht,i=ht;if(typeof t=="function"?o=t:t&&(o=Ki(t.enter),i=Ki(t.leave)),o===ht&&i===ht)throw new Error("Neither `enter` nor `leave` walker handler is set or both aren't a function");n(e,r)}var Wl={decorator(e){let t=[],r=null;return{...e,node(n){let o=r;r=n,e.node.call(this,n),r=o},emit(n,o,i){t.push({type:o,value:n,node:i?null:r})},result(){return t}}}};function Yl(e){let t=[];return ve(e,(r,n,o)=>t.push({type:r,value:e.slice(n,o),node:null})),t}function Xi(e,t){return typeof e=="string"?Yl(e):t.generate(e,Wl)}var C={type:"Match"},L={type:"Mismatch"},Kt={type:"DisallowEmpty"},Gl=40,Vl=41;function Z(e,t,r){return t===C&&r===L||e===C&&t===C&&r===C?e:(e.type==="If"&&e.else===L&&t===C&&(t=e.then,e=e.match),{type:"If",match:e,then:t,else:r})}function Zi(e){return e.length>2&&e.charCodeAt(e.length-2)===Gl&&e.charCodeAt(e.length-1)===Vl}function $i(e){return e.type==="Keyword"||e.type==="AtKeyword"||e.type==="Function"||e.type==="Type"&&Zi(e.name)}function _r(e,t,r){switch(e){case" ":{let n=C;for(let o=t.length-1;o>=0;o--){let i=t[o];n=Z(i,n,L)}return n}case"|":{let n=L,o=null;for(let i=t.length-1;i>=0;i--){let s=t[i];if($i(s)&&(o===null&&i>0&&$i(t[i-1])&&(o=Object.create(null),n=Z({type:"Enum",map:o},C,n)),o!==null)){let u=(Zi(s.name)?s.name.slice(0,-1):s.name).toLowerCase();if(!(u in o)){o[u]=s;continue}}o=null,n=Z(s,C,n)}return n}case"&&":{if(t.length>5)return{type:"MatchOnce",terms:t,all:!0};let n=L;for(let o=t.length-1;o>=0;o--){let i=t[o],s;t.length>1?s=_r(e,t.filter(function(u){return u!==i}),!1):s=C,n=Z(i,s,n)}return n}case"||":{if(t.length>5)return{type:"MatchOnce",terms:t,all:!1};let n=r?C:L;for(let o=t.length-1;o>=0;o--){let i=t[o],s;t.length>1?s=_r(e,t.filter(function(u){return u!==i}),!0):s=C,n=Z(i,s,n)}return n}}}function Kl(e){let t=C,r=Ur(e.term);if(e.max===0)r=Z(r,Kt,L),t=Z(r,null,L),t.then=Z(C,C,t),e.comma&&(t.then.else=Z({type:"Comma",syntax:e},t,L));else for(let n=e.min||1;n<=e.max;n++)e.comma&&t!==C&&(t=Z({type:"Comma",syntax:e},t,L)),t=Z(r,Z(C,C,t),L);if(e.min===0)t=Z(C,C,t);else for(let n=0;n<e.min-1;n++)e.comma&&t!==C&&(t=Z({type:"Comma",syntax:e},t,L)),t=Z(r,t,L);return t}function Ur(e){if(typeof e=="function")return{type:"Generic",fn:e};switch(e.type){case"Group":{let t=_r(e.combinator,e.terms.map(Ur),!1);return e.disallowEmpty&&(t=Z(t,Kt,L)),t}case"Multiplier":return Kl(e);case"Type":case"Property":return{type:e.type,name:e.name,syntax:e};case"Keyword":return{type:e.type,name:e.name.toLowerCase(),syntax:e};case"AtKeyword":return{type:e.type,name:"@"+e.name.toLowerCase(),syntax:e};case"Function":return{type:e.type,name:e.name.toLowerCase()+"(",syntax:e};case"String":return e.value.length===3?{type:"Token",value:e.value.charAt(1),syntax:e}:{type:e.type,value:e.value.substr(1,e.value.length-2).replace(/\\'/g,"'"),syntax:e};case"Token":return{type:e.type,value:e.value,syntax:e};case"Comma":return{type:e.type,syntax:e};default:throw new Error("Unknown node type:",e.type)}}function Qt(e,t){return typeof e=="string"&&(e=Ge(e)),{type:"MatchGraph",match:Ur(e),syntax:t||null,source:e}}var{hasOwnProperty:Ji}=Object.prototype,Ql=0,Xl=1,Hr=2,oa=3,ea="Match",$l="Mismatch",Zl="Maximum iteration number exceeded (please fill an issue on https://github.com/csstree/csstree/issues)",ta=15e3,Jl=0;function ec(e){let t=null,r=null,n=e;for(;n!==null;)r=n.prev,n.prev=t,t=n,n=r;return t}function jr(e,t){if(e.length!==t.length)return!1;for(let r=0;r<e.length;r++){let n=t.charCodeAt(r),o=e.charCodeAt(r);if(o>=65&&o<=90&&(o=o|32),o!==n)return!1}return!0}function tc(e){return e.type!==9?!1:e.value!=="?"}function ra(e){return e===null?!0:e.type===18||e.type===2||e.type===21||e.type===19||e.type===23||tc(e)}function na(e){return e===null?!0:e.type===22||e.type===20||e.type===24||e.type===9&&e.value==="/"}function rc(e,t,r){function n(){do R++,S=R<e.length?e[R]:null;while(S!==null&&(S.type===13||S.type===25))}function o(ae){let fe=R+ae;return fe<e.length?e[fe]:null}function i(ae,fe){return{nextState:ae,matchStack:z,syntaxStack:p,thenStack:m,tokenIndex:R,prev:fe}}function s(ae){m={nextState:ae,matchStack:z,syntaxStack:p,prev:m}}function u(ae){f=i(ae,f)}function c(){z={type:Xl,syntax:t.syntax,token:S,prev:z},n(),P=null,R>ke&&(ke=R)}function a(){p={syntax:t.syntax,opts:t.syntax.opts||p!==null&&p.opts||null,prev:p},z={type:Hr,syntax:t.syntax,token:z.token,prev:z}}function l(){z.type===Hr?z=z.prev:z={type:oa,syntax:p.syntax,token:z.token,prev:z},p=p.prev}let p=null,m=null,f=null,P=null,te=0,X=null,S=null,R=-1,ke=0,z={type:Ql,syntax:null,token:null,prev:null};for(n();X===null&&++te<ta;)switch(t.type){case"Match":if(m===null){if(S!==null&&(R!==e.length-1||S.value!=="\\0"&&S.value!=="\\9")){t=L;break}X=ea;break}if(t=m.nextState,t===Kt)if(m.matchStack===z){t=L;break}else t=C;for(;m.syntaxStack!==p;)l();m=m.prev;break;case"Mismatch":if(P!==null&&P!==!1)(f===null||R>f.tokenIndex)&&(f=P,P=!1);else if(f===null){X=$l;break}t=f.nextState,m=f.thenStack,p=f.syntaxStack,z=f.matchStack,R=f.tokenIndex,S=R<e.length?e[R]:null,f=f.prev;break;case"MatchGraph":t=t.match;break;case"If":t.else!==L&&u(t.else),t.then!==C&&s(t.then),t=t.match;break;case"MatchOnce":t={type:"MatchOnceBuffer",syntax:t,index:0,mask:0};break;case"MatchOnceBuffer":{let Q=t.syntax.terms;if(t.index===Q.length){if(t.mask===0||t.syntax.all){t=L;break}t=C;break}if(t.mask===(1<<Q.length)-1){t=C;break}for(;t.index<Q.length;t.index++){let J=1<<t.index;if((t.mask&J)===0){u(t),s({type:"AddMatchOnce",syntax:t.syntax,mask:t.mask|J}),t=Q[t.index++];break}}break}case"AddMatchOnce":t={type:"MatchOnceBuffer",syntax:t.syntax,index:0,mask:t.mask};break;case"Enum":if(S!==null){let Q=S.value.toLowerCase();if(Q.indexOf("\\")!==-1&&(Q=Q.replace(/\\[09].*$/,"")),Ji.call(t.map,Q)){t=t.map[Q];break}}t=L;break;case"Generic":{let Q=p!==null?p.opts:null,J=R+Math.floor(t.fn(S,o,Q));if(!isNaN(J)&&J>R){for(;R<J;)c();t=C}else t=L;break}case"Type":case"Property":{let Q=t.type==="Type"?"types":"properties",J=Ji.call(r,Q)?r[Q][t.name]:null;if(!J||!J.match)throw new Error("Bad syntax reference: "+(t.type==="Type"?"<"+t.name+">":"<'"+t.name+"'>"));if(P!==!1&&S!==null&&t.type==="Type"&&(t.name==="custom-ident"&&S.type===1||t.name==="length"&&S.value==="0")){P===null&&(P=i(t,f)),t=L;break}a(),t=J.match;break}case"Keyword":{let Q=t.name;if(S!==null){let J=S.value;if(J.indexOf("\\")!==-1&&(J=J.replace(/\\[09].*$/,"")),jr(J,Q)){c(),t=C;break}}t=L;break}case"AtKeyword":case"Function":if(S!==null&&jr(S.value,t.name)){c(),t=C;break}t=L;break;case"Token":if(S!==null&&S.value===t.value){c(),t=C;break}t=L;break;case"Comma":S!==null&&S.type===18?ra(z.token)?t=L:(c(),t=na(S)?L:C):t=ra(z.token)||na(S)?C:L;break;case"String":let ae="",fe=R;for(;fe<e.length&&ae.length<t.value.length;fe++)ae+=e[fe].value;if(jr(ae,t.value)){for(;R<fe;)c();t=C}else t=L;break;default:throw new Error("Unknown node type: "+t.type)}switch(Jl+=te,X){case null:console.warn("[csstree-match] BREAK after "+ta+" iterations"),X=Zl,z=null;break;case ea:for(;p!==null;)l();break;default:z=null}return{tokens:e,reason:X,iterations:te,match:z,longestMatch:ke}}function qr(e,t,r){let n=rc(e,t,r||{});if(n.match===null)return n;let o=n.match,i=n.match={syntax:t.syntax||null,match:[]},s=[i];for(o=ec(o).prev;o!==null;){switch(o.type){case Hr:i.match.push(i={syntax:o.syntax,match:[]}),s.push(i);break;case oa:s.pop(),i=s[s.length-1];break;default:i.match.push({syntax:o.syntax||null,token:o.token.value,node:o.token.node})}o=o.prev}return n}var Yr={};b(Yr,{getTrace:()=>ia,isKeyword:()=>ic,isProperty:()=>oc,isType:()=>nc});function ia(e){function t(o){return o===null?!1:o.type==="Type"||o.type==="Property"||o.type==="Keyword"}function r(o){if(Array.isArray(o.match)){for(let i=0;i<o.match.length;i++)if(r(o.match[i]))return t(o.syntax)&&n.unshift(o.syntax),!0}else if(o.node===e)return n=t(o.syntax)?[o.syntax]:[],!0;return!1}let n=null;return this.matched!==null&&r(this.matched),n}function nc(e,t){return Wr(this,e,r=>r.type==="Type"&&r.name===t)}function oc(e,t){return Wr(this,e,r=>r.type==="Property"&&r.name===t)}function ic(e){return Wr(this,e,t=>t.type==="Keyword")}function Wr(e,t,r){let n=ia.call(e,t);return n===null?!1:n.some(r)}function aa(e){return"node"in e?e.node:aa(e.match[0])}function sa(e){return"node"in e?e.node:sa(e.match[e.match.length-1])}function Gr(e,t,r,n,o){function i(u){if(u.syntax!==null&&u.syntax.type===n&&u.syntax.name===o){let c=aa(u),a=sa(u);e.syntax.walk(t,function(l,p,m){if(l===c){let f=new I;do{if(f.appendData(p.data),p.data===a)break;p=p.next}while(p!==null);s.push({parent:m,nodes:f})}})}Array.isArray(u.match)&&u.match.forEach(i)}let s=[];return r.matched!==null&&i(r.matched),s}var{hasOwnProperty:mt}=Object.prototype;function Vr(e){return typeof e=="number"&&isFinite(e)&&Math.floor(e)===e&&e>=0}function la(e){return Boolean(e)&&Vr(e.offset)&&Vr(e.line)&&Vr(e.column)}function ac(e,t){return function(n,o){if(!n||n.constructor!==Object)return o(n,"Type of node should be an Object");for(let i in n){let s=!0;if(mt.call(n,i)!==!1){if(i==="type")n.type!==e&&o(n,"Wrong node type `"+n.type+"`, expected `"+e+"`");else if(i==="loc"){if(n.loc===null)continue;if(n.loc&&n.loc.constructor===Object)if(typeof n.loc.source!="string")i+=".source";else if(!la(n.loc.start))i+=".start";else if(!la(n.loc.end))i+=".end";else continue;s=!1}else if(t.hasOwnProperty(i)){s=!1;for(let u=0;!s&&u<t[i].length;u++){let c=t[i][u];switch(c){case String:s=typeof n[i]=="string";break;case Boolean:s=typeof n[i]=="boolean";break;case null:s=n[i]===null;break;default:typeof c=="string"?s=n[i]&&n[i].type===c:Array.isArray(c)&&(s=n[i]instanceof I)}}}else o(n,"Unknown field `"+i+"` for "+e+" node type");s||o(n,"Bad value for `"+e+"."+i+"`")}}for(let i in t)mt.call(t,i)&&mt.call(n,i)===!1&&o(n,"Field `"+e+"."+i+"` is missed")}}function sc(e,t){let r=t.structure,n={type:String,loc:!0},o={type:'"'+e+'"'};for(let i in r){if(mt.call(r,i)===!1)continue;let s=[],u=n[i]=Array.isArray(r[i])?r[i].slice():[r[i]];for(let c=0;c<u.length;c++){let a=u[c];if(a===String||a===Boolean)s.push(a.name);else if(a===null)s.push("null");else if(typeof a=="string")s.push("<"+a+">");else if(Array.isArray(a))s.push("List");else throw new Error("Wrong value `"+a+"` in `"+e+"."+i+"` structure definition")}o[i]=s.join(" | ")}return{docs:o,check:ac(e,n)}}function ca(e){let t={};if(e.node){for(let r in e.node)if(mt.call(e.node,r)){let n=e.node[r];if(n.structure)t[r]=sc(r,n);else throw new Error("Missed `structure` field in `"+r+"` node type definition")}}return t}var lc=Qt(Ft.join(" | "));function Kr(e,t,r){let n={};for(let o in e)e[o].syntax&&(n[o]=r?e[o].syntax:Pe(e[o].syntax,{compact:t}));return n}function cc(e,t,r){let n={};for(let[o,i]of Object.entries(e))n[o]={prelude:i.prelude&&(r?i.prelude.syntax:Pe(i.prelude.syntax,{compact:t})),descriptors:i.descriptors&&Kr(i.descriptors,t,r)};return n}function uc(e){for(let t=0;t<e.length;t++)if(e[t].value.toLowerCase()==="var(")return!0;return!1}function ce(e,t,r){return{matched:e,iterations:r,error:t,...Yr}}function Ve(e,t,r,n){let o=Xi(r,e.syntax),i;return uc(o)?ce(null,new Error("Matching for a tree with var() is not supported")):(n&&(i=qr(o,e.cssWideKeywordsSyntax,e)),(!n||!i.match)&&(i=qr(o,t.match,e),!i.match)?ce(null,new Pi(i.reason,t.syntax,r,i),i.iterations):ce(i.match,null,i.iterations))}var Ke=class{constructor(t,r,n){if(this.cssWideKeywordsSyntax=lc,this.syntax=r,this.generic=!1,this.atrules=Object.create(null),this.properties=Object.create(null),this.types=Object.create(null),this.structure=n||ca(t),t){if(t.types)for(let o in t.types)this.addType_(o,t.types[o]);if(t.generic){this.generic=!0;for(let o in Dr)this.addType_(o,Dr[o])}if(t.atrules)for(let o in t.atrules)this.addAtrule_(o,t.atrules[o]);if(t.properties)for(let o in t.properties)this.addProperty_(o,t.properties[o])}}checkStructure(t){function r(i,s){o.push({node:i,message:s})}let n=this.structure,o=[];return this.syntax.walk(t,function(i){n.hasOwnProperty(i.type)?n[i.type].check(i,r):r(i,"Unknown node type `"+i.type+"`")}),o.length?o:!1}createDescriptor(t,r,n,o=null){let i={type:r,name:n},s={type:r,name:n,parent:o,serializable:typeof t=="string"||t&&typeof t.type=="string",syntax:null,match:null};return typeof t=="function"?s.match=Qt(t,i):(typeof t=="string"?Object.defineProperty(s,"syntax",{get(){return Object.defineProperty(s,"syntax",{value:Ge(t)}),s.syntax}}):s.syntax=t,Object.defineProperty(s,"match",{get(){return Object.defineProperty(s,"match",{value:Qt(s.syntax,i)}),s.match}})),s}addAtrule_(t,r){!r||(this.atrules[t]={type:"Atrule",name:t,prelude:r.prelude?this.createDescriptor(r.prelude,"AtrulePrelude",t):null,descriptors:r.descriptors?Object.keys(r.descriptors).reduce((n,o)=>(n[o]=this.createDescriptor(r.descriptors[o],"AtruleDescriptor",o,t),n),Object.create(null)):null})}addProperty_(t,r){!r||(this.properties[t]=this.createDescriptor(r,"Property",t))}addType_(t,r){!r||(this.types[t]=this.createDescriptor(r,"Type",t))}checkAtruleName(t){if(!this.getAtrule(t))return new je("Unknown at-rule","@"+t)}checkAtrulePrelude(t,r){let n=this.checkAtruleName(t);if(n)return n;let o=this.getAtrule(t);if(!o.prelude&&r)return new SyntaxError("At-rule `@"+t+"` should not contain a prelude");if(o.prelude&&!r&&!Ve(this,o.prelude,"",!1).matched)return new SyntaxError("At-rule `@"+t+"` should contain a prelude")}checkAtruleDescriptorName(t,r){let n=this.checkAtruleName(t);if(n)return n;let o=this.getAtrule(t),i=Mt(r);if(!o.descriptors)return new SyntaxError("At-rule `@"+t+"` has no known descriptors");if(!o.descriptors[i.name]&&!o.descriptors[i.basename])return new je("Unknown at-rule descriptor",r)}checkPropertyName(t){if(!this.getProperty(t))return new je("Unknown property",t)}matchAtrulePrelude(t,r){let n=this.checkAtrulePrelude(t,r);if(n)return ce(null,n);let o=this.getAtrule(t);return o.prelude?Ve(this,o.prelude,r||"",!1):ce(null,null)}matchAtruleDescriptor(t,r,n){let o=this.checkAtruleDescriptorName(t,r);if(o)return ce(null,o);let i=this.getAtrule(t),s=Mt(r);return Ve(this,i.descriptors[s.name]||i.descriptors[s.basename],n,!1)}matchDeclaration(t){return t.type!=="Declaration"?ce(null,new Error("Not a Declaration node")):this.matchProperty(t.property,t.value)}matchProperty(t,r){if(vr(t).custom)return ce(null,new Error("Lexer matching doesn't applicable for custom properties"));let n=this.checkPropertyName(t);return n?ce(null,n):Ve(this,this.getProperty(t),r,!0)}matchType(t,r){let n=this.getType(t);return n?Ve(this,n,r,!1):ce(null,new je("Unknown type",t))}match(t,r){return typeof t!="string"&&(!t||!t.type)?ce(null,new je("Bad syntax")):((typeof t=="string"||!t.match)&&(t=this.createDescriptor(t,"Type","anonymous")),Ve(this,t,r,!1))}findValueFragments(t,r,n,o){return Gr(this,r,this.matchProperty(t,r),n,o)}findDeclarationValueFragments(t,r,n){return Gr(this,t.value,this.matchDeclaration(t),r,n)}findAllFragments(t,r,n){let o=[];return this.syntax.walk(t,{visit:"Declaration",enter:i=>{o.push.apply(o,this.findDeclarationValueFragments(i,r,n))}}),o}getAtrule(t,r=!0){let n=Mt(t);return(n.vendor&&r?this.atrules[n.name]||this.atrules[n.basename]:this.atrules[n.name])||null}getAtrulePrelude(t,r=!0){let n=this.getAtrule(t,r);return n&&n.prelude||null}getAtruleDescriptor(t,r){return this.atrules.hasOwnProperty(t)&&this.atrules.declarators&&this.atrules[t].declarators[r]||null}getProperty(t,r=!0){let n=vr(t);return(n.vendor&&r?this.properties[n.name]||this.properties[n.basename]:this.properties[n.name])||null}getType(t){return hasOwnProperty.call(this.types,t)?this.types[t]:null}validate(){function t(o,i,s,u){if(s.has(i))return s.get(i);s.set(i,!1),u.syntax!==null&&Vt(u.syntax,function(c){if(c.type!=="Type"&&c.type!=="Property")return;let a=c.type==="Type"?o.types:o.properties,l=c.type==="Type"?r:n;(!hasOwnProperty.call(a,c.name)||t(o,c.name,l,a[c.name]))&&s.set(i,!0)},this)}let r=new Map,n=new Map;for(let o in this.types)t(this,o,r,this.types[o]);for(let o in this.properties)t(this,o,n,this.properties[o]);return r=[...r.keys()].filter(o=>r.get(o)),n=[...n.keys()].filter(o=>n.get(o)),r.length||n.length?{types:r,properties:n}:null}dump(t,r){return{generic:this.generic,types:Kr(this.types,!r,t),properties:Kr(this.properties,!r,t),atrules:cc(this.atrules,!r,t)}}toString(){return JSON.stringify(this.dump())}};var{hasOwnProperty:Qe}=Object.prototype,pc={generic:!0,types:Qr,atrules:{prelude:pa,descriptors:pa},properties:Qr,parseContext:hc,scope:ma,atrule:["parse"],pseudo:["parse"],node:["name","structure","parse","generate","walkContext"]};function Xt(e){return e&&e.constructor===Object}function ha(e){return Xt(e)?{...e}:e}function hc(e,t){return Object.assign(e,t)}function ma(e,t){for(let r in t)Qe.call(t,r)&&(Xt(e[r])?ma(e[r],t[r]):e[r]=ha(t[r]));return e}function ua(e,t){return typeof t=="string"&&/^\s*\|/.test(t)?typeof e=="string"?e+t:t.replace(/^\s*\|\s*/,""):t||null}function Qr(e,t){if(typeof t=="string")return ua(e,t);let r={...e};for(let n in t)Qe.call(t,n)&&(r[n]=ua(Qe.call(e,n)?e[n]:void 0,t[n]));return r}function pa(e,t){let r=Qr(e,t);return!Xt(r)||Object.keys(r).length?r:null}function ft(e,t,r){for(let n in r)if(Qe.call(r,n)!==!1){if(r[n]===!0)Qe.call(t,n)&&(e[n]=ha(t[n]));else if(r[n]){if(typeof r[n]=="function"){let o=r[n];e[n]=o({},e[n]),e[n]=o(e[n]||{},t[n])}else if(Xt(r[n])){let o={};for(let i in e[n])o[i]=ft({},e[n][i],r[n]);for(let i in t[n])o[i]=ft(o[i]||{},t[n][i],r[n]);e[n]=o}else if(Array.isArray(r[n])){let o={},i=r[n].reduce(function(s,u){return s[u]=!0,s},{});for(let[s,u]of Object.entries(e[n]||{}))o[s]={},u&&ft(o[s],u,i);for(let s in t[n])Qe.call(t[n],s)&&(o[s]||(o[s]={}),t[n]&&t[n][s]&&ft(o[s],t[n][s],i));e[n]=o}}}return e}var $t=(e,t)=>ft(e,t,pc);function fa(e){let t=Xo(e),r=Ei(e),n=wi(e),{fromPlainObject:o,toPlainObject:i}=vi(r),s={lexer:null,createLexer:u=>new Ke(u,s,s.lexer.structure),tokenize:ve,parse:t,generate:n,walk:r,find:r.find,findLast:r.findLast,findAll:r.findAll,fromPlainObject:o,toPlainObject:i,fork(u){let c=$t({},e);return fa(typeof u=="function"?u(c,Object.assign):$t(c,u))}};return s.lexer=new Ke({generic:!0,types:e.types,atrules:e.atrules,properties:e.properties,node:e.node},s),s}var Xr=e=>fa($t({},e));var da={generic:!0,types:{"absolute-size":"xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large","alpha-value":"<number>|<percentage>","angle-percentage":"<angle>|<percentage>","angular-color-hint":"<angle-percentage>","angular-color-stop":"<color>&&<color-stop-angle>?","angular-color-stop-list":"[<angular-color-stop> [, <angular-color-hint>]?]# , <angular-color-stop>","animateable-feature":"scroll-position|contents|<custom-ident>",attachment:"scroll|fixed|local","attr()":"attr( <attr-name> <type-or-unit>? [, <attr-fallback>]? )","attr-matcher":"['~'|'|'|'^'|'$'|'*']? '='","attr-modifier":"i|s","attribute-selector":"'[' <wq-name> ']'|'[' <wq-name> <attr-matcher> [<string-token>|<ident-token>] <attr-modifier>? ']'","auto-repeat":"repeat( [auto-fill|auto-fit] , [<line-names>? <fixed-size>]+ <line-names>? )","auto-track-list":"[<line-names>? [<fixed-size>|<fixed-repeat>]]* <line-names>? <auto-repeat> [<line-names>? [<fixed-size>|<fixed-repeat>]]* <line-names>?","baseline-position":"[first|last]? baseline","basic-shape":"<inset()>|<circle()>|<ellipse()>|<polygon()>|<path()>","bg-image":"none|<image>","bg-layer":"<bg-image>||<bg-position> [/ <bg-size>]?||<repeat-style>||<attachment>||<box>||<box>","bg-position":"[[left|center|right|top|bottom|<length-percentage>]|[left|center|right|<length-percentage>] [top|center|bottom|<length-percentage>]|[center|[left|right] <length-percentage>?]&&[center|[top|bottom] <length-percentage>?]]","bg-size":"[<length-percentage>|auto]{1,2}|cover|contain","blur()":"blur( <length> )","blend-mode":"normal|multiply|screen|overlay|darken|lighten|color-dodge|color-burn|hard-light|soft-light|difference|exclusion|hue|saturation|color|luminosity",box:"border-box|padding-box|content-box","brightness()":"brightness( <number-percentage> )","calc()":"calc( <calc-sum> )","calc-sum":"<calc-product> [['+'|'-'] <calc-product>]*","calc-product":"<calc-value> ['*' <calc-value>|'/' <number>]*","calc-value":"<number>|<dimension>|<percentage>|( <calc-sum> )","cf-final-image":"<image>|<color>","cf-mixing-image":"<percentage>?&&<image>","circle()":"circle( [<shape-radius>]? [at <position>]? )","clamp()":"clamp( <calc-sum>#{3} )","class-selector":"'.' <ident-token>","clip-source":"<url>",color:"<rgb()>|<rgba()>|<hsl()>|<hsla()>|<hwb()>|<lab()>|<lch()>|<hex-color>|<named-color>|currentcolor|<deprecated-system-color>","color-stop":"<color-stop-length>|<color-stop-angle>","color-stop-angle":"<angle-percentage>{1,2}","color-stop-length":"<length-percentage>{1,2}","color-stop-list":"[<linear-color-stop> [, <linear-color-hint>]?]# , <linear-color-stop>",combinator:"'>'|'+'|'~'|['||']","common-lig-values":"[common-ligatures|no-common-ligatures]","compat-auto":"searchfield|textarea|push-button|slider-horizontal|checkbox|radio|square-button|menulist|listbox|meter|progress-bar|button","composite-style":"clear|copy|source-over|source-in|source-out|source-atop|destination-over|destination-in|destination-out|destination-atop|xor","compositing-operator":"add|subtract|intersect|exclude","compound-selector":"[<type-selector>? <subclass-selector>* [<pseudo-element-selector> <pseudo-class-selector>*]*]!","compound-selector-list":"<compound-selector>#","complex-selector":"<compound-selector> [<combinator>? <compound-selector>]*","complex-selector-list":"<complex-selector>#","conic-gradient()":"conic-gradient( [from <angle>]? [at <position>]? , <angular-color-stop-list> )","contextual-alt-values":"[contextual|no-contextual]","content-distribution":"space-between|space-around|space-evenly|stretch","content-list":"[<string>|contents|<image>|<counter>|<quote>|<target>|<leader()>|<attr()>]+","content-position":"center|start|end|flex-start|flex-end","content-replacement":"<image>","contrast()":"contrast( [<number-percentage>] )",counter:"<counter()>|<counters()>","counter()":"counter( <counter-name> , <counter-style>? )","counter-name":"<custom-ident>","counter-style":"<counter-style-name>|symbols( )","counter-style-name":"<custom-ident>","counters()":"counters( <counter-name> , <string> , <counter-style>? )","cross-fade()":"cross-fade( <cf-mixing-image> , <cf-final-image>? )","cubic-bezier-timing-function":"ease|ease-in|ease-out|ease-in-out|cubic-bezier( <number [0,1]> , <number> , <number [0,1]> , <number> )","deprecated-system-color":"ActiveBorder|ActiveCaption|AppWorkspace|Background|ButtonFace|ButtonHighlight|ButtonShadow|ButtonText|CaptionText|GrayText|Highlight|HighlightText|InactiveBorder|InactiveCaption|InactiveCaptionText|InfoBackground|InfoText|Menu|MenuText|Scrollbar|ThreeDDarkShadow|ThreeDFace|ThreeDHighlight|ThreeDLightShadow|ThreeDShadow|Window|WindowFrame|WindowText","discretionary-lig-values":"[discretionary-ligatures|no-discretionary-ligatures]","display-box":"contents|none","display-inside":"flow|flow-root|table|flex|grid|ruby","display-internal":"table-row-group|table-header-group|table-footer-group|table-row|table-cell|table-column-group|table-column|table-caption|ruby-base|ruby-text|ruby-base-container|ruby-text-container","display-legacy":"inline-block|inline-list-item|inline-table|inline-flex|inline-grid","display-listitem":"<display-outside>?&&[flow|flow-root]?&&list-item","display-outside":"block|inline|run-in","drop-shadow()":"drop-shadow( <length>{2,3} <color>? )","east-asian-variant-values":"[jis78|jis83|jis90|jis04|simplified|traditional]","east-asian-width-values":"[full-width|proportional-width]","element()":"element( <custom-ident> , [first|start|last|first-except]? )|element( <id-selector> )","ellipse()":"ellipse( [<shape-radius>{2}]? [at <position>]? )","ending-shape":"circle|ellipse","env()":"env( <custom-ident> , <declaration-value>? )","explicit-track-list":"[<line-names>? <track-size>]+ <line-names>?","family-name":"<string>|<custom-ident>+","feature-tag-value":"<string> [<integer>|on|off]?","feature-type":"@stylistic|@historical-forms|@styleset|@character-variant|@swash|@ornaments|@annotation","feature-value-block":"<feature-type> '{' <feature-value-declaration-list> '}'","feature-value-block-list":"<feature-value-block>+","feature-value-declaration":"<custom-ident> : <integer>+ ;","feature-value-declaration-list":"<feature-value-declaration>","feature-value-name":"<custom-ident>","fill-rule":"nonzero|evenodd","filter-function":"<blur()>|<brightness()>|<contrast()>|<drop-shadow()>|<grayscale()>|<hue-rotate()>|<invert()>|<opacity()>|<saturate()>|<sepia()>","filter-function-list":"[<filter-function>|<url>]+","final-bg-layer":"<'background-color'>||<bg-image>||<bg-position> [/ <bg-size>]?||<repeat-style>||<attachment>||<box>||<box>","fit-content()":"fit-content( [<length>|<percentage>] )","fixed-breadth":"<length-percentage>","fixed-repeat":"repeat( [<integer [1,\u221E]>] , [<line-names>? <fixed-size>]+ <line-names>? )","fixed-size":"<fixed-breadth>|minmax( <fixed-breadth> , <track-breadth> )|minmax( <inflexible-breadth> , <fixed-breadth> )","font-stretch-absolute":"normal|ultra-condensed|extra-condensed|condensed|semi-condensed|semi-expanded|expanded|extra-expanded|ultra-expanded|<percentage>","font-variant-css21":"[normal|small-caps]","font-weight-absolute":"normal|bold|<number [1,1000]>","frequency-percentage":"<frequency>|<percentage>","general-enclosed":"[<function-token> <any-value> )]|( <ident> <any-value> )","generic-family":"serif|sans-serif|cursive|fantasy|monospace|-apple-system","generic-name":"serif|sans-serif|cursive|fantasy|monospace","geometry-box":"<shape-box>|fill-box|stroke-box|view-box",gradient:"<linear-gradient()>|<repeating-linear-gradient()>|<radial-gradient()>|<repeating-radial-gradient()>|<conic-gradient()>|<repeating-conic-gradient()>|<-legacy-gradient>","grayscale()":"grayscale( <number-percentage> )","grid-line":"auto|<custom-ident>|[<integer>&&<custom-ident>?]|[span&&[<integer>||<custom-ident>]]","historical-lig-values":"[historical-ligatures|no-historical-ligatures]","hsl()":"hsl( <hue> <percentage> <percentage> [/ <alpha-value>]? )|hsl( <hue> , <percentage> , <percentage> , <alpha-value>? )","hsla()":"hsla( <hue> <percentage> <percentage> [/ <alpha-value>]? )|hsla( <hue> , <percentage> , <percentage> , <alpha-value>? )",hue:"<number>|<angle>","hue-rotate()":"hue-rotate( <angle> )","hwb()":"hwb( [<hue>|none] [<percentage>|none] [<percentage>|none] [/ [<alpha-value>|none]]? )",image:"<url>|<image()>|<image-set()>|<element()>|<paint()>|<cross-fade()>|<gradient>","image()":"image( <image-tags>? [<image-src>? , <color>?]! )","image-set()":"image-set( <image-set-option># )","image-set-option":"[<image>|<string>] [<resolution>||type( <string> )]","image-src":"<url>|<string>","image-tags":"ltr|rtl","inflexible-breadth":"<length>|<percentage>|min-content|max-content|auto","inset()":"inset( <length-percentage>{1,4} [round <'border-radius'>]? )","invert()":"invert( <number-percentage> )","keyframes-name":"<custom-ident>|<string>","keyframe-block":"<keyframe-selector># { <declaration-list> }","keyframe-block-list":"<keyframe-block>+","keyframe-selector":"from|to|<percentage>","layer()":"layer( <layer-name> )","layer-name":"<ident> ['.' <ident>]*","leader()":"leader( <leader-type> )","leader-type":"dotted|solid|space|<string>","length-percentage":"<length>|<percentage>","line-names":"'[' <custom-ident>* ']'","line-name-list":"[<line-names>|<name-repeat>]+","line-style":"none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset","line-width":"<length>|thin|medium|thick","linear-color-hint":"<length-percentage>","linear-color-stop":"<color> <color-stop-length>?","linear-gradient()":"linear-gradient( [<angle>|to <side-or-corner>]? , <color-stop-list> )","mask-layer":"<mask-reference>||<position> [/ <bg-size>]?||<repeat-style>||<geometry-box>||[<geometry-box>|no-clip]||<compositing-operator>||<masking-mode>","mask-position":"[<length-percentage>|left|center|right] [<length-percentage>|top|center|bottom]?","mask-reference":"none|<image>|<mask-source>","mask-source":"<url>","masking-mode":"alpha|luminance|match-source","matrix()":"matrix( <number>#{6} )","matrix3d()":"matrix3d( <number>#{16} )","max()":"max( <calc-sum># )","media-and":"<media-in-parens> [and <media-in-parens>]+","media-condition":"<media-not>|<media-and>|<media-or>|<media-in-parens>","media-condition-without-or":"<media-not>|<media-and>|<media-in-parens>","media-feature":"( [<mf-plain>|<mf-boolean>|<mf-range>] )","media-in-parens":"( <media-condition> )|<media-feature>|<general-enclosed>","media-not":"not <media-in-parens>","media-or":"<media-in-parens> [or <media-in-parens>]+","media-query":"<media-condition>|[not|only]? <media-type> [and <media-condition-without-or>]?","media-query-list":"<media-query>#","media-type":"<ident>","mf-boolean":"<mf-name>","mf-name":"<ident>","mf-plain":"<mf-name> : <mf-value>","mf-range":"<mf-name> ['<'|'>']? '='? <mf-value>|<mf-value> ['<'|'>']? '='? <mf-name>|<mf-value> '<' '='? <mf-name> '<' '='? <mf-value>|<mf-value> '>' '='? <mf-name> '>' '='? <mf-value>","mf-value":"<number>|<dimension>|<ident>|<ratio>","min()":"min( <calc-sum># )","minmax()":"minmax( [<length>|<percentage>|min-content|max-content|auto] , [<length>|<percentage>|<flex>|min-content|max-content|auto] )","name-repeat":"repeat( [<integer [1,\u221E]>|auto-fill] , <line-names>+ )","named-color":"transparent|aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue|blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk|crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki|darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen|darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue|dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite|gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki|lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgoldenrodyellow|lightgray|lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray|lightslategrey|lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine|mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen|mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite|navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen|paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple|rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell|sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal|thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen|<-non-standard-color>","namespace-prefix":"<ident>","ns-prefix":"[<ident-token>|'*']? '|'","number-percentage":"<number>|<percentage>","numeric-figure-values":"[lining-nums|oldstyle-nums]","numeric-fraction-values":"[diagonal-fractions|stacked-fractions]","numeric-spacing-values":"[proportional-nums|tabular-nums]",nth:"<an-plus-b>|even|odd","opacity()":"opacity( [<number-percentage>] )","overflow-position":"unsafe|safe","outline-radius":"<length>|<percentage>","page-body":"<declaration>? [; <page-body>]?|<page-margin-box> <page-body>","page-margin-box":"<page-margin-box-type> '{' <declaration-list> '}'","page-margin-box-type":"@top-left-corner|@top-left|@top-center|@top-right|@top-right-corner|@bottom-left-corner|@bottom-left|@bottom-center|@bottom-right|@bottom-right-corner|@left-top|@left-middle|@left-bottom|@right-top|@right-middle|@right-bottom","page-selector-list":"[<page-selector>#]?","page-selector":"<pseudo-page>+|<ident> <pseudo-page>*","page-size":"A5|A4|A3|B5|B4|JIS-B5|JIS-B4|letter|legal|ledger","path()":"path( [<fill-rule> ,]? <string> )","paint()":"paint( <ident> , <declaration-value>? )","perspective()":"perspective( <length> )","polygon()":"polygon( <fill-rule>? , [<length-percentage> <length-percentage>]# )",position:"[[left|center|right]||[top|center|bottom]|[left|center|right|<length-percentage>] [top|center|bottom|<length-percentage>]?|[[left|right] <length-percentage>]&&[[top|bottom] <length-percentage>]]","pseudo-class-selector":"':' <ident-token>|':' <function-token> <any-value> ')'","pseudo-element-selector":"':' <pseudo-class-selector>","pseudo-page":": [left|right|first|blank]",quote:"open-quote|close-quote|no-open-quote|no-close-quote","radial-gradient()":"radial-gradient( [<ending-shape>||<size>]? [at <position>]? , <color-stop-list> )","relative-selector":"<combinator>? <complex-selector>","relative-selector-list":"<relative-selector>#","relative-size":"larger|smaller","repeat-style":"repeat-x|repeat-y|[repeat|space|round|no-repeat]{1,2}","repeating-conic-gradient()":"repeating-conic-gradient( [from <angle>]? [at <position>]? , <angular-color-stop-list> )","repeating-linear-gradient()":"repeating-linear-gradient( [<angle>|to <side-or-corner>]? , <color-stop-list> )","repeating-radial-gradient()":"repeating-radial-gradient( [<ending-shape>||<size>]? [at <position>]? , <color-stop-list> )","rgb()":"rgb( <percentage>{3} [/ <alpha-value>]? )|rgb( <number>{3} [/ <alpha-value>]? )|rgb( <percentage>#{3} , <alpha-value>? )|rgb( <number>#{3} , <alpha-value>? )","rgba()":"rgba( <percentage>{3} [/ <alpha-value>]? )|rgba( <number>{3} [/ <alpha-value>]? )|rgba( <percentage>#{3} , <alpha-value>? )|rgba( <number>#{3} , <alpha-value>? )","rotate()":"rotate( [<angle>|<zero>] )","rotate3d()":"rotate3d( <number> , <number> , <number> , [<angle>|<zero>] )","rotateX()":"rotateX( [<angle>|<zero>] )","rotateY()":"rotateY( [<angle>|<zero>] )","rotateZ()":"rotateZ( [<angle>|<zero>] )","saturate()":"saturate( <number-percentage> )","scale()":"scale( <number> , <number>? )","scale3d()":"scale3d( <number> , <number> , <number> )","scaleX()":"scaleX( <number> )","scaleY()":"scaleY( <number> )","scaleZ()":"scaleZ( <number> )","self-position":"center|start|end|self-start|self-end|flex-start|flex-end","shape-radius":"<length-percentage>|closest-side|farthest-side","skew()":"skew( [<angle>|<zero>] , [<angle>|<zero>]? )","skewX()":"skewX( [<angle>|<zero>] )","skewY()":"skewY( [<angle>|<zero>] )","sepia()":"sepia( <number-percentage> )",shadow:"inset?&&<length>{2,4}&&<color>?","shadow-t":"[<length>{2,3}&&<color>?]",shape:"rect( <top> , <right> , <bottom> , <left> )|rect( <top> <right> <bottom> <left> )","shape-box":"<box>|margin-box","side-or-corner":"[left|right]||[top|bottom]","single-animation":"<time>||<easing-function>||<time>||<single-animation-iteration-count>||<single-animation-direction>||<single-animation-fill-mode>||<single-animation-play-state>||[none|<keyframes-name>]","single-animation-direction":"normal|reverse|alternate|alternate-reverse","single-animation-fill-mode":"none|forwards|backwards|both","single-animation-iteration-count":"infinite|<number>","single-animation-play-state":"running|paused","single-animation-timeline":"auto|none|<timeline-name>","single-transition":"[none|<single-transition-property>]||<time>||<easing-function>||<time>","single-transition-property":"all|<custom-ident>",size:"closest-side|farthest-side|closest-corner|farthest-corner|<length>|<length-percentage>{2}","step-position":"jump-start|jump-end|jump-none|jump-both|start|end","step-timing-function":"step-start|step-end|steps( <integer> [, <step-position>]? )","subclass-selector":"<id-selector>|<class-selector>|<attribute-selector>|<pseudo-class-selector>","supports-condition":"not <supports-in-parens>|<supports-in-parens> [and <supports-in-parens>]*|<supports-in-parens> [or <supports-in-parens>]*","supports-in-parens":"( <supports-condition> )|<supports-feature>|<general-enclosed>","supports-feature":"<supports-decl>|<supports-selector-fn>","supports-decl":"( <declaration> )","supports-selector-fn":"selector( <complex-selector> )",symbol:"<string>|<image>|<custom-ident>",target:"<target-counter()>|<target-counters()>|<target-text()>","target-counter()":"target-counter( [<string>|<url>] , <custom-ident> , <counter-style>? )","target-counters()":"target-counters( [<string>|<url>] , <custom-ident> , <string> , <counter-style>? )","target-text()":"target-text( [<string>|<url>] , [content|before|after|first-letter]? )","time-percentage":"<time>|<percentage>","timeline-name":"<custom-ident>|<string>","easing-function":"linear|<cubic-bezier-timing-function>|<step-timing-function>","track-breadth":"<length-percentage>|<flex>|min-content|max-content|auto","track-list":"[<line-names>? [<track-size>|<track-repeat>]]+ <line-names>?","track-repeat":"repeat( [<integer [1,\u221E]>] , [<line-names>? <track-size>]+ <line-names>? )","track-size":"<track-breadth>|minmax( <inflexible-breadth> , <track-breadth> )|fit-content( [<length>|<percentage>] )","transform-function":"<matrix()>|<translate()>|<translateX()>|<translateY()>|<scale()>|<scaleX()>|<scaleY()>|<rotate()>|<skew()>|<skewX()>|<skewY()>|<matrix3d()>|<translate3d()>|<translateZ()>|<scale3d()>|<scaleZ()>|<rotate3d()>|<rotateX()>|<rotateY()>|<rotateZ()>|<perspective()>","transform-list":"<transform-function>+","translate()":"translate( <length-percentage> , <length-percentage>? )","translate3d()":"translate3d( <length-percentage> , <length-percentage> , <length> )","translateX()":"translateX( <length-percentage> )","translateY()":"translateY( <length-percentage> )","translateZ()":"translateZ( <length> )","type-or-unit":"string|color|url|integer|number|length|angle|time|frequency|cap|ch|em|ex|ic|lh|rlh|rem|vb|vi|vw|vh|vmin|vmax|mm|Q|cm|in|pt|pc|px|deg|grad|rad|turn|ms|s|Hz|kHz|%","type-selector":"<wq-name>|<ns-prefix>? '*'","var()":"var( <custom-property-name> , <declaration-value>? )","viewport-length":"auto|<length-percentage>","visual-box":"content-box|padding-box|border-box","wq-name":"<ns-prefix>? <ident-token>","-legacy-gradient":"<-webkit-gradient()>|<-legacy-linear-gradient>|<-legacy-repeating-linear-gradient>|<-legacy-radial-gradient>|<-legacy-repeating-radial-gradient>","-legacy-linear-gradient":"-moz-linear-gradient( <-legacy-linear-gradient-arguments> )|-webkit-linear-gradient( <-legacy-linear-gradient-arguments> )|-o-linear-gradient( <-legacy-linear-gradient-arguments> )","-legacy-repeating-linear-gradient":"-moz-repeating-linear-gradient( <-legacy-linear-gradient-arguments> )|-webkit-repeating-linear-gradient( <-legacy-linear-gradient-arguments> )|-o-repeating-linear-gradient( <-legacy-linear-gradient-arguments> )","-legacy-linear-gradient-arguments":"[<angle>|<side-or-corner>]? , <color-stop-list>","-legacy-radial-gradient":"-moz-radial-gradient( <-legacy-radial-gradient-arguments> )|-webkit-radial-gradient( <-legacy-radial-gradient-arguments> )|-o-radial-gradient( <-legacy-radial-gradient-arguments> )","-legacy-repeating-radial-gradient":"-moz-repeating-radial-gradient( <-legacy-radial-gradient-arguments> )|-webkit-repeating-radial-gradient( <-legacy-radial-gradient-arguments> )|-o-repeating-radial-gradient( <-legacy-radial-gradient-arguments> )","-legacy-radial-gradient-arguments":"[<position> ,]? [[[<-legacy-radial-gradient-shape>||<-legacy-radial-gradient-size>]|[<length>|<percentage>]{2}] ,]? <color-stop-list>","-legacy-radial-gradient-size":"closest-side|closest-corner|farthest-side|farthest-corner|contain|cover","-legacy-radial-gradient-shape":"circle|ellipse","-non-standard-font":"-apple-system-body|-apple-system-headline|-apple-system-subheadline|-apple-system-caption1|-apple-system-caption2|-apple-system-footnote|-apple-system-short-body|-apple-system-short-headline|-apple-system-short-subheadline|-apple-system-short-caption1|-apple-system-short-footnote|-apple-system-tall-body","-non-standard-color":"-moz-ButtonDefault|-moz-ButtonHoverFace|-moz-ButtonHoverText|-moz-CellHighlight|-moz-CellHighlightText|-moz-Combobox|-moz-ComboboxText|-moz-Dialog|-moz-DialogText|-moz-dragtargetzone|-moz-EvenTreeRow|-moz-Field|-moz-FieldText|-moz-html-CellHighlight|-moz-html-CellHighlightText|-moz-mac-accentdarkestshadow|-moz-mac-accentdarkshadow|-moz-mac-accentface|-moz-mac-accentlightesthighlight|-moz-mac-accentlightshadow|-moz-mac-accentregularhighlight|-moz-mac-accentregularshadow|-moz-mac-chrome-active|-moz-mac-chrome-inactive|-moz-mac-focusring|-moz-mac-menuselect|-moz-mac-menushadow|-moz-mac-menutextselect|-moz-MenuHover|-moz-MenuHoverText|-moz-MenuBarText|-moz-MenuBarHoverText|-moz-nativehyperlinktext|-moz-OddTreeRow|-moz-win-communicationstext|-moz-win-mediatext|-moz-activehyperlinktext|-moz-default-background-color|-moz-default-color|-moz-hyperlinktext|-moz-visitedhyperlinktext|-webkit-activelink|-webkit-focus-ring-color|-webkit-link|-webkit-text","-non-standard-image-rendering":"optimize-contrast|-moz-crisp-edges|-o-crisp-edges|-webkit-optimize-contrast","-non-standard-overflow":"-moz-scrollbars-none|-moz-scrollbars-horizontal|-moz-scrollbars-vertical|-moz-hidden-unscrollable","-non-standard-width":"fill-available|min-intrinsic|intrinsic|-moz-available|-moz-fit-content|-moz-min-content|-moz-max-content|-webkit-min-content|-webkit-max-content","-webkit-gradient()":"-webkit-gradient( <-webkit-gradient-type> , <-webkit-gradient-point> [, <-webkit-gradient-point>|, <-webkit-gradient-radius> , <-webkit-gradient-point>] [, <-webkit-gradient-radius>]? [, <-webkit-gradient-color-stop>]* )","-webkit-gradient-color-stop":"from( <color> )|color-stop( [<number-zero-one>|<percentage>] , <color> )|to( <color> )","-webkit-gradient-point":"[left|center|right|<length-percentage>] [top|center|bottom|<length-percentage>]","-webkit-gradient-radius":"<length>|<percentage>","-webkit-gradient-type":"linear|radial","-webkit-mask-box-repeat":"repeat|stretch|round","-webkit-mask-clip-style":"border|border-box|padding|padding-box|content|content-box|text","-ms-filter-function-list":"<-ms-filter-function>+","-ms-filter-function":"<-ms-filter-function-progid>|<-ms-filter-function-legacy>","-ms-filter-function-progid":"'progid:' [<ident-token> '.']* [<ident-token>|<function-token> <any-value>? )]","-ms-filter-function-legacy":"<ident-token>|<function-token> <any-value>? )","-ms-filter":"<string>",age:"child|young|old","attr-name":"<wq-name>","attr-fallback":"<any-value>","bg-clip":"<box>|border|text","border-radius":"<length-percentage>{1,2}",bottom:"<length>|auto","generic-voice":"[<age>? <gender> <integer>?]",gender:"male|female|neutral","lab()":"lab( [<percentage>|<number>|none] [<percentage>|<number>|none] [<percentage>|<number>|none] [/ [<alpha-value>|none]]? )","lch()":"lch( [<percentage>|<number>|none] [<percentage>|<number>|none] [<hue>|none] [/ [<alpha-value>|none]]? )",left:"<length>|auto","mask-image":"<mask-reference>#",paint:"none|<color>|<url> [none|<color>]?|context-fill|context-stroke",ratio:"<number [0,\u221E]> [/ <number [0,\u221E]>]?","reversed-counter-name":"reversed( <counter-name> )",right:"<length>|auto","svg-length":"<percentage>|<length>|<number>","svg-writing-mode":"lr-tb|rl-tb|tb-rl|lr|rl|tb",top:"<length>|auto","track-group":"'(' [<string>* <track-minmax> <string>*]+ ')' ['[' <positive-integer> ']']?|<track-minmax>","track-list-v0":"[<string>* <track-group> <string>*]+|none","track-minmax":"minmax( <track-breadth> , <track-breadth> )|auto|<track-breadth>|fit-content",x:"<number>",y:"<number>",declaration:"<ident-token> : <declaration-value>? ['!' important]?","declaration-list":"[<declaration>? ';']* <declaration>?",url:"url( <string> <url-modifier>* )|<url-token>","url-modifier":"<ident>|<function-token> <any-value> )","number-zero-one":"<number [0,1]>","number-one-or-greater":"<number [1,\u221E]>","positive-integer":"<integer [0,\u221E]>","-non-standard-display":"-ms-inline-flexbox|-ms-grid|-ms-inline-grid|-webkit-flex|-webkit-inline-flex|-webkit-box|-webkit-inline-box|-moz-inline-stack|-moz-box|-moz-inline-box"},properties:{"--*":"<declaration-value>","-ms-accelerator":"false|true","-ms-block-progression":"tb|rl|bt|lr","-ms-content-zoom-chaining":"none|chained","-ms-content-zooming":"none|zoom","-ms-content-zoom-limit":"<'-ms-content-zoom-limit-min'> <'-ms-content-zoom-limit-max'>","-ms-content-zoom-limit-max":"<percentage>","-ms-content-zoom-limit-min":"<percentage>","-ms-content-zoom-snap":"<'-ms-content-zoom-snap-type'>||<'-ms-content-zoom-snap-points'>","-ms-content-zoom-snap-points":"snapInterval( <percentage> , <percentage> )|snapList( <percentage># )","-ms-content-zoom-snap-type":"none|proximity|mandatory","-ms-filter":"<string>","-ms-flow-from":"[none|<custom-ident>]#","-ms-flow-into":"[none|<custom-ident>]#","-ms-grid-columns":"none|<track-list>|<auto-track-list>","-ms-grid-rows":"none|<track-list>|<auto-track-list>","-ms-high-contrast-adjust":"auto|none","-ms-hyphenate-limit-chars":"auto|<integer>{1,3}","-ms-hyphenate-limit-lines":"no-limit|<integer>","-ms-hyphenate-limit-zone":"<percentage>|<length>","-ms-ime-align":"auto|after","-ms-overflow-style":"auto|none|scrollbar|-ms-autohiding-scrollbar","-ms-scrollbar-3dlight-color":"<color>","-ms-scrollbar-arrow-color":"<color>","-ms-scrollbar-base-color":"<color>","-ms-scrollbar-darkshadow-color":"<color>","-ms-scrollbar-face-color":"<color>","-ms-scrollbar-highlight-color":"<color>","-ms-scrollbar-shadow-color":"<color>","-ms-scrollbar-track-color":"<color>","-ms-scroll-chaining":"chained|none","-ms-scroll-limit":"<'-ms-scroll-limit-x-min'> <'-ms-scroll-limit-y-min'> <'-ms-scroll-limit-x-max'> <'-ms-scroll-limit-y-max'>","-ms-scroll-limit-x-max":"auto|<length>","-ms-scroll-limit-x-min":"<length>","-ms-scroll-limit-y-max":"auto|<length>","-ms-scroll-limit-y-min":"<length>","-ms-scroll-rails":"none|railed","-ms-scroll-snap-points-x":"snapInterval( <length-percentage> , <length-percentage> )|snapList( <length-percentage># )","-ms-scroll-snap-points-y":"snapInterval( <length-percentage> , <length-percentage> )|snapList( <length-percentage># )","-ms-scroll-snap-type":"none|proximity|mandatory","-ms-scroll-snap-x":"<'-ms-scroll-snap-type'> <'-ms-scroll-snap-points-x'>","-ms-scroll-snap-y":"<'-ms-scroll-snap-type'> <'-ms-scroll-snap-points-y'>","-ms-scroll-translation":"none|vertical-to-horizontal","-ms-text-autospace":"none|ideograph-alpha|ideograph-numeric|ideograph-parenthesis|ideograph-space","-ms-touch-select":"grippers|none","-ms-user-select":"none|element|text","-ms-wrap-flow":"auto|both|start|end|maximum|clear","-ms-wrap-margin":"<length>","-ms-wrap-through":"wrap|none","-moz-appearance":"none|button|button-arrow-down|button-arrow-next|button-arrow-previous|button-arrow-up|button-bevel|button-focus|caret|checkbox|checkbox-container|checkbox-label|checkmenuitem|dualbutton|groupbox|listbox|listitem|menuarrow|menubar|menucheckbox|menuimage|menuitem|menuitemtext|menulist|menulist-button|menulist-text|menulist-textfield|menupopup|menuradio|menuseparator|meterbar|meterchunk|progressbar|progressbar-vertical|progresschunk|progresschunk-vertical|radio|radio-container|radio-label|radiomenuitem|range|range-thumb|resizer|resizerpanel|scale-horizontal|scalethumbend|scalethumb-horizontal|scalethumbstart|scalethumbtick|scalethumb-vertical|scale-vertical|scrollbarbutton-down|scrollbarbutton-left|scrollbarbutton-right|scrollbarbutton-up|scrollbarthumb-horizontal|scrollbarthumb-vertical|scrollbartrack-horizontal|scrollbartrack-vertical|searchfield|separator|sheet|spinner|spinner-downbutton|spinner-textfield|spinner-upbutton|splitter|statusbar|statusbarpanel|tab|tabpanel|tabpanels|tab-scroll-arrow-back|tab-scroll-arrow-forward|textfield|textfield-multiline|toolbar|toolbarbutton|toolbarbutton-dropdown|toolbargripper|toolbox|tooltip|treeheader|treeheadercell|treeheadersortarrow|treeitem|treeline|treetwisty|treetwistyopen|treeview|-moz-mac-unified-toolbar|-moz-win-borderless-glass|-moz-win-browsertabbar-toolbox|-moz-win-communicationstext|-moz-win-communications-toolbox|-moz-win-exclude-glass|-moz-win-glass|-moz-win-mediatext|-moz-win-media-toolbox|-moz-window-button-box|-moz-window-button-box-maximized|-moz-window-button-close|-moz-window-button-maximize|-moz-window-button-minimize|-moz-window-button-restore|-moz-window-frame-bottom|-moz-window-frame-left|-moz-window-frame-right|-moz-window-titlebar|-moz-window-titlebar-maximized","-moz-binding":"<url>|none","-moz-border-bottom-colors":"<color>+|none","-moz-border-left-colors":"<color>+|none","-moz-border-right-colors":"<color>+|none","-moz-border-top-colors":"<color>+|none","-moz-context-properties":"none|[fill|fill-opacity|stroke|stroke-opacity]#","-moz-float-edge":"border-box|content-box|margin-box|padding-box","-moz-force-broken-image-icon":"0|1","-moz-image-region":"<shape>|auto","-moz-orient":"inline|block|horizontal|vertical","-moz-outline-radius":"<outline-radius>{1,4} [/ <outline-radius>{1,4}]?","-moz-outline-radius-bottomleft":"<outline-radius>","-moz-outline-radius-bottomright":"<outline-radius>","-moz-outline-radius-topleft":"<outline-radius>","-moz-outline-radius-topright":"<outline-radius>","-moz-stack-sizing":"ignore|stretch-to-fit","-moz-text-blink":"none|blink","-moz-user-focus":"ignore|normal|select-after|select-before|select-menu|select-same|select-all|none","-moz-user-input":"auto|none|enabled|disabled","-moz-user-modify":"read-only|read-write|write-only","-moz-window-dragging":"drag|no-drag","-moz-window-shadow":"default|menu|tooltip|sheet|none","-webkit-appearance":"none|button|button-bevel|caps-lock-indicator|caret|checkbox|default-button|inner-spin-button|listbox|listitem|media-controls-background|media-controls-fullscreen-background|media-current-time-display|media-enter-fullscreen-button|media-exit-fullscreen-button|media-fullscreen-button|media-mute-button|media-overlay-play-button|media-play-button|media-seek-back-button|media-seek-forward-button|media-slider|media-sliderthumb|media-time-remaining-display|media-toggle-closed-captions-button|media-volume-slider|media-volume-slider-container|media-volume-sliderthumb|menulist|menulist-button|menulist-text|menulist-textfield|meter|progress-bar|progress-bar-value|push-button|radio|scrollbarbutton-down|scrollbarbutton-left|scrollbarbutton-right|scrollbarbutton-up|scrollbargripper-horizontal|scrollbargripper-vertical|scrollbarthumb-horizontal|scrollbarthumb-vertical|scrollbartrack-horizontal|scrollbartrack-vertical|searchfield|searchfield-cancel-button|searchfield-decoration|searchfield-results-button|searchfield-results-decoration|slider-horizontal|slider-vertical|sliderthumb-horizontal|sliderthumb-vertical|square-button|textarea|textfield|-apple-pay-button","-webkit-border-before":"<'border-width'>||<'border-style'>||<color>","-webkit-border-before-color":"<color>","-webkit-border-before-style":"<'border-style'>","-webkit-border-before-width":"<'border-width'>","-webkit-box-reflect":"[above|below|right|left]? <length>? <image>?","-webkit-line-clamp":"none|<integer>","-webkit-mask":"[<mask-reference>||<position> [/ <bg-size>]?||<repeat-style>||[<box>|border|padding|content|text]||[<box>|border|padding|content]]#","-webkit-mask-attachment":"<attachment>#","-webkit-mask-clip":"[<box>|border|padding|content|text]#","-webkit-mask-composite":"<composite-style>#","-webkit-mask-image":"<mask-reference>#","-webkit-mask-origin":"[<box>|border|padding|content]#","-webkit-mask-position":"<position>#","-webkit-mask-position-x":"[<length-percentage>|left|center|right]#","-webkit-mask-position-y":"[<length-percentage>|top|center|bottom]#","-webkit-mask-repeat":"<repeat-style>#","-webkit-mask-repeat-x":"repeat|no-repeat|space|round","-webkit-mask-repeat-y":"repeat|no-repeat|space|round","-webkit-mask-size":"<bg-size>#","-webkit-overflow-scrolling":"auto|touch","-webkit-tap-highlight-color":"<color>","-webkit-text-fill-color":"<color>","-webkit-text-stroke":"<length>||<color>","-webkit-text-stroke-color":"<color>","-webkit-text-stroke-width":"<length>","-webkit-touch-callout":"default|none","-webkit-user-modify":"read-only|read-write|read-write-plaintext-only","accent-color":"auto|<color>","align-content":"normal|<baseline-position>|<content-distribution>|<overflow-position>? <content-position>","align-items":"normal|stretch|<baseline-position>|[<overflow-position>? <self-position>]","align-self":"auto|normal|stretch|<baseline-position>|<overflow-position>? <self-position>","align-tracks":"[normal|<baseline-position>|<content-distribution>|<overflow-position>? <content-position>]#",all:"initial|inherit|unset|revert|revert-layer",animation:"<single-animation>#","animation-delay":"<time>#","animation-direction":"<single-animation-direction>#","animation-duration":"<time>#","animation-fill-mode":"<single-animation-fill-mode>#","animation-iteration-count":"<single-animation-iteration-count>#","animation-name":"[none|<keyframes-name>]#","animation-play-state":"<single-animation-play-state>#","animation-timing-function":"<easing-function>#","animation-timeline":"<single-animation-timeline>#",appearance:"none|auto|textfield|menulist-button|<compat-auto>","aspect-ratio":"auto|<ratio>",azimuth:"<angle>|[[left-side|far-left|left|center-left|center|center-right|right|far-right|right-side]||behind]|leftwards|rightwards","backdrop-filter":"none|<filter-function-list>","backface-visibility":"visible|hidden",background:"[<bg-layer> ,]* <final-bg-layer>","background-attachment":"<attachment>#","background-blend-mode":"<blend-mode>#","background-clip":"<bg-clip>#","background-color":"<color>","background-image":"<bg-image>#","background-origin":"<box>#","background-position":"<bg-position>#","background-position-x":"[center|[[left|right|x-start|x-end]? <length-percentage>?]!]#","background-position-y":"[center|[[top|bottom|y-start|y-end]? <length-percentage>?]!]#","background-repeat":"<repeat-style>#","background-size":"<bg-size>#","block-overflow":"clip|ellipsis|<string>","block-size":"<'width'>",border:"<line-width>||<line-style>||<color>","border-block":"<'border-top-width'>||<'border-top-style'>||<color>","border-block-color":"<'border-top-color'>{1,2}","border-block-style":"<'border-top-style'>","border-block-width":"<'border-top-width'>","border-block-end":"<'border-top-width'>||<'border-top-style'>||<color>","border-block-end-color":"<'border-top-color'>","border-block-end-style":"<'border-top-style'>","border-block-end-width":"<'border-top-width'>","border-block-start":"<'border-top-width'>||<'border-top-style'>||<color>","border-block-start-color":"<'border-top-color'>","border-block-start-style":"<'border-top-style'>","border-block-start-width":"<'border-top-width'>","border-bottom":"<line-width>||<line-style>||<color>","border-bottom-color":"<'border-top-color'>","border-bottom-left-radius":"<length-percentage>{1,2}","border-bottom-right-radius":"<length-percentage>{1,2}","border-bottom-style":"<line-style>","border-bottom-width":"<line-width>","border-collapse":"collapse|separate","border-color":"<color>{1,4}","border-end-end-radius":"<length-percentage>{1,2}","border-end-start-radius":"<length-percentage>{1,2}","border-image":"<'border-image-source'>||<'border-image-slice'> [/ <'border-image-width'>|/ <'border-image-width'>? / <'border-image-outset'>]?||<'border-image-repeat'>","border-image-outset":"[<length>|<number>]{1,4}","border-image-repeat":"[stretch|repeat|round|space]{1,2}","border-image-slice":"<number-percentage>{1,4}&&fill?","border-image-source":"none|<image>","border-image-width":"[<length-percentage>|<number>|auto]{1,4}","border-inline":"<'border-top-width'>||<'border-top-style'>||<color>","border-inline-end":"<'border-top-width'>||<'border-top-style'>||<color>","border-inline-color":"<'border-top-color'>{1,2}","border-inline-style":"<'border-top-style'>","border-inline-width":"<'border-top-width'>","border-inline-end-color":"<'border-top-color'>","border-inline-end-style":"<'border-top-style'>","border-inline-end-width":"<'border-top-width'>","border-inline-start":"<'border-top-width'>||<'border-top-style'>||<color>","border-inline-start-color":"<'border-top-color'>","border-inline-start-style":"<'border-top-style'>","border-inline-start-width":"<'border-top-width'>","border-left":"<line-width>||<line-style>||<color>","border-left-color":"<color>","border-left-style":"<line-style>","border-left-width":"<line-width>","border-radius":"<length-percentage>{1,4} [/ <length-percentage>{1,4}]?","border-right":"<line-width>||<line-style>||<color>","border-right-color":"<color>","border-right-style":"<line-style>","border-right-width":"<line-width>","border-spacing":"<length> <length>?","border-start-end-radius":"<length-percentage>{1,2}","border-start-start-radius":"<length-percentage>{1,2}","border-style":"<line-style>{1,4}","border-top":"<line-width>||<line-style>||<color>","border-top-color":"<color>","border-top-left-radius":"<length-percentage>{1,2}","border-top-right-radius":"<length-percentage>{1,2}","border-top-style":"<line-style>","border-top-width":"<line-width>","border-width":"<line-width>{1,4}",bottom:"<length>|<percentage>|auto","box-align":"start|center|end|baseline|stretch","box-decoration-break":"slice|clone","box-direction":"normal|reverse|inherit","box-flex":"<number>","box-flex-group":"<integer>","box-lines":"single|multiple","box-ordinal-group":"<integer>","box-orient":"horizontal|vertical|inline-axis|block-axis|inherit","box-pack":"start|center|end|justify","box-shadow":"none|<shadow>#","box-sizing":"content-box|border-box","break-after":"auto|avoid|always|all|avoid-page|page|left|right|recto|verso|avoid-column|column|avoid-region|region","break-before":"auto|avoid|always|all|avoid-page|page|left|right|recto|verso|avoid-column|column|avoid-region|region","break-inside":"auto|avoid|avoid-page|avoid-column|avoid-region","caption-side":"top|bottom|block-start|block-end|inline-start|inline-end","caret-color":"auto|<color>",clear:"none|left|right|both|inline-start|inline-end",clip:"<shape>|auto","clip-path":"<clip-source>|[<basic-shape>||<geometry-box>]|none",color:"<color>","print-color-adjust":"economy|exact","color-scheme":"normal|[light|dark|<custom-ident>]+&&only?","column-count":"<integer>|auto","column-fill":"auto|balance|balance-all","column-gap":"normal|<length-percentage>","column-rule":"<'column-rule-width'>||<'column-rule-style'>||<'column-rule-color'>","column-rule-color":"<color>","column-rule-style":"<'border-style'>","column-rule-width":"<'border-width'>","column-span":"none|all","column-width":"<length>|auto",columns:"<'column-width'>||<'column-count'>",contain:"none|strict|content|[size||layout||style||paint]",content:"normal|none|[<content-replacement>|<content-list>] [/ [<string>|<counter>]+]?","content-visibility":"visible|auto|hidden","counter-increment":"[<counter-name> <integer>?]+|none","counter-reset":"[<counter-name> <integer>?|<reversed-counter-name> <integer>?]+|none","counter-set":"[<counter-name> <integer>?]+|none",cursor:"[[<url> [<x> <y>]? ,]* [auto|default|none|context-menu|help|pointer|progress|wait|cell|crosshair|text|vertical-text|alias|copy|move|no-drop|not-allowed|e-resize|n-resize|ne-resize|nw-resize|s-resize|se-resize|sw-resize|w-resize|ew-resize|ns-resize|nesw-resize|nwse-resize|col-resize|row-resize|all-scroll|zoom-in|zoom-out|grab|grabbing|hand|-webkit-grab|-webkit-grabbing|-webkit-zoom-in|-webkit-zoom-out|-moz-grab|-moz-grabbing|-moz-zoom-in|-moz-zoom-out]]",direction:"ltr|rtl",display:"[<display-outside>||<display-inside>]|<display-listitem>|<display-internal>|<display-box>|<display-legacy>|<-non-standard-display>","empty-cells":"show|hide",filter:"none|<filter-function-list>|<-ms-filter-function-list>",flex:"none|[<'flex-grow'> <'flex-shrink'>?||<'flex-basis'>]","flex-basis":"content|<'width'>","flex-direction":"row|row-reverse|column|column-reverse","flex-flow":"<'flex-direction'>||<'flex-wrap'>","flex-grow":"<number>","flex-shrink":"<number>","flex-wrap":"nowrap|wrap|wrap-reverse",float:"left|right|none|inline-start|inline-end",font:"[[<'font-style'>||<font-variant-css21>||<'font-weight'>||<'font-stretch'>]? <'font-size'> [/ <'line-height'>]? <'font-family'>]|caption|icon|menu|message-box|small-caption|status-bar","font-family":"[<family-name>|<generic-family>]#","font-feature-settings":"normal|<feature-tag-value>#","font-kerning":"auto|normal|none","font-language-override":"normal|<string>","font-optical-sizing":"auto|none","font-variation-settings":"normal|[<string> <number>]#","font-size":"<absolute-size>|<relative-size>|<length-percentage>","font-size-adjust":"none|[ex-height|cap-height|ch-width|ic-width|ic-height]? [from-font|<number>]","font-smooth":"auto|never|always|<absolute-size>|<length>","font-stretch":"<font-stretch-absolute>","font-style":"normal|italic|oblique <angle>?","font-synthesis":"none|[weight||style||small-caps]","font-variant":"normal|none|[<common-lig-values>||<discretionary-lig-values>||<historical-lig-values>||<contextual-alt-values>||stylistic( <feature-value-name> )||historical-forms||styleset( <feature-value-name># )||character-variant( <feature-value-name># )||swash( <feature-value-name> )||ornaments( <feature-value-name> )||annotation( <feature-value-name> )||[small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps]||<numeric-figure-values>||<numeric-spacing-values>||<numeric-fraction-values>||ordinal||slashed-zero||<east-asian-variant-values>||<east-asian-width-values>||ruby]","font-variant-alternates":"normal|[stylistic( <feature-value-name> )||historical-forms||styleset( <feature-value-name># )||character-variant( <feature-value-name># )||swash( <feature-value-name> )||ornaments( <feature-value-name> )||annotation( <feature-value-name> )]","font-variant-caps":"normal|small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps","font-variant-east-asian":"normal|[<east-asian-variant-values>||<east-asian-width-values>||ruby]","font-variant-ligatures":"normal|none|[<common-lig-values>||<discretionary-lig-values>||<historical-lig-values>||<contextual-alt-values>]","font-variant-numeric":"normal|[<numeric-figure-values>||<numeric-spacing-values>||<numeric-fraction-values>||ordinal||slashed-zero]","font-variant-position":"normal|sub|super","font-weight":"<font-weight-absolute>|bolder|lighter","forced-color-adjust":"auto|none",gap:"<'row-gap'> <'column-gap'>?",grid:"<'grid-template'>|<'grid-template-rows'> / [auto-flow&&dense?] <'grid-auto-columns'>?|[auto-flow&&dense?] <'grid-auto-rows'>? / <'grid-template-columns'>","grid-area":"<grid-line> [/ <grid-line>]{0,3}","grid-auto-columns":"<track-size>+","grid-auto-flow":"[row|column]||dense","grid-auto-rows":"<track-size>+","grid-column":"<grid-line> [/ <grid-line>]?","grid-column-end":"<grid-line>","grid-column-gap":"<length-percentage>","grid-column-start":"<grid-line>","grid-gap":"<'grid-row-gap'> <'grid-column-gap'>?","grid-row":"<grid-line> [/ <grid-line>]?","grid-row-end":"<grid-line>","grid-row-gap":"<length-percentage>","grid-row-start":"<grid-line>","grid-template":"none|[<'grid-template-rows'> / <'grid-template-columns'>]|[<line-names>? <string> <track-size>? <line-names>?]+ [/ <explicit-track-list>]?","grid-template-areas":"none|<string>+","grid-template-columns":"none|<track-list>|<auto-track-list>|subgrid <line-name-list>?","grid-template-rows":"none|<track-list>|<auto-track-list>|subgrid <line-name-list>?","hanging-punctuation":"none|[first||[force-end|allow-end]||last]",height:"auto|<length>|<percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )","hyphenate-character":"auto|<string>",hyphens:"none|manual|auto","image-orientation":"from-image|<angle>|[<angle>? flip]","image-rendering":"auto|crisp-edges|pixelated|optimizeSpeed|optimizeQuality|<-non-standard-image-rendering>","image-resolution":"[from-image||<resolution>]&&snap?","ime-mode":"auto|normal|active|inactive|disabled","initial-letter":"normal|[<number> <integer>?]","initial-letter-align":"[auto|alphabetic|hanging|ideographic]","inline-size":"<'width'>","input-security":"auto|none",inset:"<'top'>{1,4}","inset-block":"<'top'>{1,2}","inset-block-end":"<'top'>","inset-block-start":"<'top'>","inset-inline":"<'top'>{1,2}","inset-inline-end":"<'top'>","inset-inline-start":"<'top'>",isolation:"auto|isolate","justify-content":"normal|<content-distribution>|<overflow-position>? [<content-position>|left|right]","justify-items":"normal|stretch|<baseline-position>|<overflow-position>? [<self-position>|left|right]|legacy|legacy&&[left|right|center]","justify-self":"auto|normal|stretch|<baseline-position>|<overflow-position>? [<self-position>|left|right]","justify-tracks":"[normal|<content-distribution>|<overflow-position>? [<content-position>|left|right]]#",left:"<length>|<percentage>|auto","letter-spacing":"normal|<length-percentage>","line-break":"auto|loose|normal|strict|anywhere","line-clamp":"none|<integer>","line-height":"normal|<number>|<length>|<percentage>","line-height-step":"<length>","list-style":"<'list-style-type'>||<'list-style-position'>||<'list-style-image'>","list-style-image":"<image>|none","list-style-position":"inside|outside","list-style-type":"<counter-style>|<string>|none",margin:"[<length>|<percentage>|auto]{1,4}","margin-block":"<'margin-left'>{1,2}","margin-block-end":"<'margin-left'>","margin-block-start":"<'margin-left'>","margin-bottom":"<length>|<percentage>|auto","margin-inline":"<'margin-left'>{1,2}","margin-inline-end":"<'margin-left'>","margin-inline-start":"<'margin-left'>","margin-left":"<length>|<percentage>|auto","margin-right":"<length>|<percentage>|auto","margin-top":"<length>|<percentage>|auto","margin-trim":"none|in-flow|all",mask:"<mask-layer>#","mask-border":"<'mask-border-source'>||<'mask-border-slice'> [/ <'mask-border-width'>? [/ <'mask-border-outset'>]?]?||<'mask-border-repeat'>||<'mask-border-mode'>","mask-border-mode":"luminance|alpha","mask-border-outset":"[<length>|<number>]{1,4}","mask-border-repeat":"[stretch|repeat|round|space]{1,2}","mask-border-slice":"<number-percentage>{1,4} fill?","mask-border-source":"none|<image>","mask-border-width":"[<length-percentage>|<number>|auto]{1,4}","mask-clip":"[<geometry-box>|no-clip]#","mask-composite":"<compositing-operator>#","mask-image":"<mask-reference>#","mask-mode":"<masking-mode>#","mask-origin":"<geometry-box>#","mask-position":"<position>#","mask-repeat":"<repeat-style>#","mask-size":"<bg-size>#","mask-type":"luminance|alpha","masonry-auto-flow":"[pack|next]||[definite-first|ordered]","math-style":"normal|compact","max-block-size":"<'max-width'>","max-height":"none|<length-percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )","max-inline-size":"<'max-width'>","max-lines":"none|<integer>","max-width":"none|<length-percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )|<-non-standard-width>","min-block-size":"<'min-width'>","min-height":"auto|<length>|<percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )","min-inline-size":"<'min-width'>","min-width":"auto|<length>|<percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )|<-non-standard-width>","mix-blend-mode":"<blend-mode>|plus-lighter","object-fit":"fill|contain|cover|none|scale-down","object-position":"<position>",offset:"[<'offset-position'>? [<'offset-path'> [<'offset-distance'>||<'offset-rotate'>]?]?]! [/ <'offset-anchor'>]?","offset-anchor":"auto|<position>","offset-distance":"<length-percentage>","offset-path":"none|ray( [<angle>&&<size>&&contain?] )|<path()>|<url>|[<basic-shape>||<geometry-box>]","offset-position":"auto|<position>","offset-rotate":"[auto|reverse]||<angle>",opacity:"<alpha-value>",order:"<integer>",orphans:"<integer>",outline:"[<'outline-color'>||<'outline-style'>||<'outline-width'>]","outline-color":"<color>|invert","outline-offset":"<length>","outline-style":"auto|<'border-style'>","outline-width":"<line-width>",overflow:"[visible|hidden|clip|scroll|auto]{1,2}|<-non-standard-overflow>","overflow-anchor":"auto|none","overflow-block":"visible|hidden|clip|scroll|auto","overflow-clip-box":"padding-box|content-box","overflow-clip-margin":"<visual-box>||<length [0,\u221E]>","overflow-inline":"visible|hidden|clip|scroll|auto","overflow-wrap":"normal|break-word|anywhere","overflow-x":"visible|hidden|clip|scroll|auto","overflow-y":"visible|hidden|clip|scroll|auto","overscroll-behavior":"[contain|none|auto]{1,2}","overscroll-behavior-block":"contain|none|auto","overscroll-behavior-inline":"contain|none|auto","overscroll-behavior-x":"contain|none|auto","overscroll-behavior-y":"contain|none|auto",padding:"[<length>|<percentage>]{1,4}","padding-block":"<'padding-left'>{1,2}","padding-block-end":"<'padding-left'>","padding-block-start":"<'padding-left'>","padding-bottom":"<length>|<percentage>","padding-inline":"<'padding-left'>{1,2}","padding-inline-end":"<'padding-left'>","padding-inline-start":"<'padding-left'>","padding-left":"<length>|<percentage>","padding-right":"<length>|<percentage>","padding-top":"<length>|<percentage>","page-break-after":"auto|always|avoid|left|right|recto|verso","page-break-before":"auto|always|avoid|left|right|recto|verso","page-break-inside":"auto|avoid","paint-order":"normal|[fill||stroke||markers]",perspective:"none|<length>","perspective-origin":"<position>","place-content":"<'align-content'> <'justify-content'>?","place-items":"<'align-items'> <'justify-items'>?","place-self":"<'align-self'> <'justify-self'>?","pointer-events":"auto|none|visiblePainted|visibleFill|visibleStroke|visible|painted|fill|stroke|all|inherit",position:"static|relative|absolute|sticky|fixed|-webkit-sticky",quotes:"none|auto|[<string> <string>]+",resize:"none|both|horizontal|vertical|block|inline",right:"<length>|<percentage>|auto",rotate:"none|<angle>|[x|y|z|<number>{3}]&&<angle>","row-gap":"normal|<length-percentage>","ruby-align":"start|center|space-between|space-around","ruby-merge":"separate|collapse|auto","ruby-position":"[alternate||[over|under]]|inter-character",scale:"none|<number>{1,3}","scrollbar-color":"auto|<color>{2}","scrollbar-gutter":"auto|stable&&both-edges?","scrollbar-width":"auto|thin|none","scroll-behavior":"auto|smooth","scroll-margin":"<length>{1,4}","scroll-margin-block":"<length>{1,2}","scroll-margin-block-start":"<length>","scroll-margin-block-end":"<length>","scroll-margin-bottom":"<length>","scroll-margin-inline":"<length>{1,2}","scroll-margin-inline-start":"<length>","scroll-margin-inline-end":"<length>","scroll-margin-left":"<length>","scroll-margin-right":"<length>","scroll-margin-top":"<length>","scroll-padding":"[auto|<length-percentage>]{1,4}","scroll-padding-block":"[auto|<length-percentage>]{1,2}","scroll-padding-block-start":"auto|<length-percentage>","scroll-padding-block-end":"auto|<length-percentage>","scroll-padding-bottom":"auto|<length-percentage>","scroll-padding-inline":"[auto|<length-percentage>]{1,2}","scroll-padding-inline-start":"auto|<length-percentage>","scroll-padding-inline-end":"auto|<length-percentage>","scroll-padding-left":"auto|<length-percentage>","scroll-padding-right":"auto|<length-percentage>","scroll-padding-top":"auto|<length-percentage>","scroll-snap-align":"[none|start|end|center]{1,2}","scroll-snap-coordinate":"none|<position>#","scroll-snap-destination":"<position>","scroll-snap-points-x":"none|repeat( <length-percentage> )","scroll-snap-points-y":"none|repeat( <length-percentage> )","scroll-snap-stop":"normal|always","scroll-snap-type":"none|[x|y|block|inline|both] [mandatory|proximity]?","scroll-snap-type-x":"none|mandatory|proximity","scroll-snap-type-y":"none|mandatory|proximity","shape-image-threshold":"<alpha-value>","shape-margin":"<length-percentage>","shape-outside":"none|[<shape-box>||<basic-shape>]|<image>","tab-size":"<integer>|<length>","table-layout":"auto|fixed","text-align":"start|end|left|right|center|justify|match-parent","text-align-last":"auto|start|end|left|right|center|justify","text-combine-upright":"none|all|[digits <integer>?]","text-decoration":"<'text-decoration-line'>||<'text-decoration-style'>||<'text-decoration-color'>||<'text-decoration-thickness'>","text-decoration-color":"<color>","text-decoration-line":"none|[underline||overline||line-through||blink]|spelling-error|grammar-error","text-decoration-skip":"none|[objects||[spaces|[leading-spaces||trailing-spaces]]||edges||box-decoration]","text-decoration-skip-ink":"auto|all|none","text-decoration-style":"solid|double|dotted|dashed|wavy","text-decoration-thickness":"auto|from-font|<length>|<percentage>","text-emphasis":"<'text-emphasis-style'>||<'text-emphasis-color'>","text-emphasis-color":"<color>","text-emphasis-position":"[over|under]&&[right|left]","text-emphasis-style":"none|[[filled|open]||[dot|circle|double-circle|triangle|sesame]]|<string>","text-indent":"<length-percentage>&&hanging?&&each-line?","text-justify":"auto|inter-character|inter-word|none","text-orientation":"mixed|upright|sideways","text-overflow":"[clip|ellipsis|<string>]{1,2}","text-rendering":"auto|optimizeSpeed|optimizeLegibility|geometricPrecision","text-shadow":"none|<shadow-t>#","text-size-adjust":"none|auto|<percentage>","text-transform":"none|capitalize|uppercase|lowercase|full-width|full-size-kana","text-underline-offset":"auto|<length>|<percentage>","text-underline-position":"auto|from-font|[under||[left|right]]",top:"<length>|<percentage>|auto","touch-action":"auto|none|[[pan-x|pan-left|pan-right]||[pan-y|pan-up|pan-down]||pinch-zoom]|manipulation",transform:"none|<transform-list>","transform-box":"content-box|border-box|fill-box|stroke-box|view-box","transform-origin":"[<length-percentage>|left|center|right|top|bottom]|[[<length-percentage>|left|center|right]&&[<length-percentage>|top|center|bottom]] <length>?","transform-style":"flat|preserve-3d",transition:"<single-transition>#","transition-delay":"<time>#","transition-duration":"<time>#","transition-property":"none|<single-transition-property>#","transition-timing-function":"<easing-function>#",translate:"none|<length-percentage> [<length-percentage> <length>?]?","unicode-bidi":"normal|embed|isolate|bidi-override|isolate-override|plaintext|-moz-isolate|-moz-isolate-override|-moz-plaintext|-webkit-isolate|-webkit-isolate-override|-webkit-plaintext","user-select":"auto|text|none|contain|all","vertical-align":"baseline|sub|super|text-top|text-bottom|middle|top|bottom|<percentage>|<length>",visibility:"visible|hidden|collapse","white-space":"normal|pre|nowrap|pre-wrap|pre-line|break-spaces",widows:"<integer>",width:"auto|<length>|<percentage>|min-content|max-content|fit-content|fit-content( <length-percentage> )|fill|stretch|intrinsic|-moz-max-content|-webkit-max-content|-moz-fit-content|-webkit-fit-content","will-change":"auto|<animateable-feature>#","word-break":"normal|break-all|keep-all|break-word","word-spacing":"normal|<length>","word-wrap":"normal|break-word","writing-mode":"horizontal-tb|vertical-rl|vertical-lr|sideways-rl|sideways-lr|<svg-writing-mode>","z-index":"auto|<integer>",zoom:"normal|reset|<number>|<percentage>","-moz-background-clip":"padding|border","-moz-border-radius-bottomleft":"<'border-bottom-left-radius'>","-moz-border-radius-bottomright":"<'border-bottom-right-radius'>","-moz-border-radius-topleft":"<'border-top-left-radius'>","-moz-border-radius-topright":"<'border-bottom-right-radius'>","-moz-control-character-visibility":"visible|hidden","-moz-osx-font-smoothing":"auto|grayscale","-moz-user-select":"none|text|all|-moz-none","-ms-flex-align":"start|end|center|baseline|stretch","-ms-flex-item-align":"auto|start|end|center|baseline|stretch","-ms-flex-line-pack":"start|end|center|justify|distribute|stretch","-ms-flex-negative":"<'flex-shrink'>","-ms-flex-pack":"start|end|center|justify|distribute","-ms-flex-order":"<integer>","-ms-flex-positive":"<'flex-grow'>","-ms-flex-preferred-size":"<'flex-basis'>","-ms-interpolation-mode":"nearest-neighbor|bicubic","-ms-grid-column-align":"start|end|center|stretch","-ms-grid-row-align":"start|end|center|stretch","-ms-hyphenate-limit-last":"none|always|column|page|spread","-webkit-background-clip":"[<box>|border|padding|content|text]#","-webkit-column-break-after":"always|auto|avoid","-webkit-column-break-before":"always|auto|avoid","-webkit-column-break-inside":"always|auto|avoid","-webkit-font-smoothing":"auto|none|antialiased|subpixel-antialiased","-webkit-mask-box-image":"[<url>|<gradient>|none] [<length-percentage>{4} <-webkit-mask-box-repeat>{2}]?","-webkit-print-color-adjust":"economy|exact","-webkit-text-security":"none|circle|disc|square","-webkit-user-drag":"none|element|auto","-webkit-user-select":"auto|none|text|all","alignment-baseline":"auto|baseline|before-edge|text-before-edge|middle|central|after-edge|text-after-edge|ideographic|alphabetic|hanging|mathematical","baseline-shift":"baseline|sub|super|<svg-length>",behavior:"<url>+","clip-rule":"nonzero|evenodd",cue:"<'cue-before'> <'cue-after'>?","cue-after":"<url> <decibel>?|none","cue-before":"<url> <decibel>?|none","dominant-baseline":"auto|use-script|no-change|reset-size|ideographic|alphabetic|hanging|mathematical|central|middle|text-after-edge|text-before-edge",fill:"<paint>","fill-opacity":"<number-zero-one>","fill-rule":"nonzero|evenodd","glyph-orientation-horizontal":"<angle>","glyph-orientation-vertical":"<angle>",kerning:"auto|<svg-length>",marker:"none|<url>","marker-end":"none|<url>","marker-mid":"none|<url>","marker-start":"none|<url>",pause:"<'pause-before'> <'pause-after'>?","pause-after":"<time>|none|x-weak|weak|medium|strong|x-strong","pause-before":"<time>|none|x-weak|weak|medium|strong|x-strong",rest:"<'rest-before'> <'rest-after'>?","rest-after":"<time>|none|x-weak|weak|medium|strong|x-strong","rest-before":"<time>|none|x-weak|weak|medium|strong|x-strong","shape-rendering":"auto|optimizeSpeed|crispEdges|geometricPrecision",src:"[<url> [format( <string># )]?|local( <family-name> )]#",speak:"auto|none|normal","speak-as":"normal|spell-out||digits||[literal-punctuation|no-punctuation]",stroke:"<paint>","stroke-dasharray":"none|[<svg-length>+]#","stroke-dashoffset":"<svg-length>","stroke-linecap":"butt|round|square","stroke-linejoin":"miter|round|bevel","stroke-miterlimit":"<number-one-or-greater>","stroke-opacity":"<number-zero-one>","stroke-width":"<svg-length>","text-anchor":"start|middle|end","unicode-range":"<urange>#","voice-balance":"<number>|left|center|right|leftwards|rightwards","voice-duration":"auto|<time>","voice-family":"[[<family-name>|<generic-voice>] ,]* [<family-name>|<generic-voice>]|preserve","voice-pitch":"<frequency>&&absolute|[[x-low|low|medium|high|x-high]||[<frequency>|<semitones>|<percentage>]]","voice-range":"<frequency>&&absolute|[[x-low|low|medium|high|x-high]||[<frequency>|<semitones>|<percentage>]]","voice-rate":"[normal|x-slow|slow|medium|fast|x-fast]||<percentage>","voice-stress":"normal|strong|moderate|none|reduced","voice-volume":"silent|[[x-soft|soft|medium|loud|x-loud]||<decibel>]"},atrules:{charset:{prelude:"<string>",descriptors:null},"counter-style":{prelude:"<counter-style-name>",descriptors:{"additive-symbols":"[<integer>&&<symbol>]#",fallback:"<counter-style-name>",negative:"<symbol> <symbol>?",pad:"<integer>&&<symbol>",prefix:"<symbol>",range:"[[<integer>|infinite]{2}]#|auto","speak-as":"auto|bullets|numbers|words|spell-out|<counter-style-name>",suffix:"<symbol>",symbols:"<symbol>+",system:"cyclic|numeric|alphabetic|symbolic|additive|[fixed <integer>?]|[extends <counter-style-name>]"}},document:{prelude:"[<url>|url-prefix( <string> )|domain( <string> )|media-document( <string> )|regexp( <string> )]#",descriptors:null},"font-face":{prelude:null,descriptors:{"ascent-override":"normal|<percentage>","descent-override":"normal|<percentage>","font-display":"[auto|block|swap|fallback|optional]","font-family":"<family-name>","font-feature-settings":"normal|<feature-tag-value>#","font-variation-settings":"normal|[<string> <number>]#","font-stretch":"<font-stretch-absolute>{1,2}","font-style":"normal|italic|oblique <angle>{0,2}","font-weight":"<font-weight-absolute>{1,2}","font-variant":"normal|none|[<common-lig-values>||<discretionary-lig-values>||<historical-lig-values>||<contextual-alt-values>||stylistic( <feature-value-name> )||historical-forms||styleset( <feature-value-name># )||character-variant( <feature-value-name># )||swash( <feature-value-name> )||ornaments( <feature-value-name> )||annotation( <feature-value-name> )||[small-caps|all-small-caps|petite-caps|all-petite-caps|unicase|titling-caps]||<numeric-figure-values>||<numeric-spacing-values>||<numeric-fraction-values>||ordinal||slashed-zero||<east-asian-variant-values>||<east-asian-width-values>||ruby]","line-gap-override":"normal|<percentage>","size-adjust":"<percentage>",src:"[<url> [format( <string># )]?|local( <family-name> )]#","unicode-range":"<urange>#"}},"font-feature-values":{prelude:"<family-name>#",descriptors:null},import:{prelude:"[<string>|<url>] [layer|layer( <layer-name> )]? [supports( [<supports-condition>|<declaration>] )]? <media-query-list>?",descriptors:null},keyframes:{prelude:"<keyframes-name>",descriptors:null},layer:{prelude:"[<layer-name>#|<layer-name>?]",descriptors:null},media:{prelude:"<media-query-list>",descriptors:null},namespace:{prelude:"<namespace-prefix>? [<string>|<url>]",descriptors:null},page:{prelude:"<page-selector-list>",descriptors:{bleed:"auto|<length>",marks:"none|[crop||cross]",size:"<length>{1,2}|auto|[<page-size>||[portrait|landscape]]"}},property:{prelude:"<custom-property-name>",descriptors:{syntax:"<string>",inherits:"true|false","initial-value":"<string>"}},"scroll-timeline":{prelude:"<timeline-name>",descriptors:null},supports:{prelude:"<supports-condition>",descriptors:null},viewport:{prelude:null,descriptors:{height:"<viewport-length>{1,2}","max-height":"<viewport-length>","max-width":"<viewport-length>","max-zoom":"auto|<number>|<percentage>","min-height":"<viewport-length>","min-width":"<viewport-length>","min-zoom":"auto|<number>|<percentage>",orientation:"auto|portrait|landscape","user-zoom":"zoom|fixed","viewport-fit":"auto|contain|cover",width:"<viewport-length>{1,2}",zoom:"auto|<number>|<percentage>"}}}};var bt={};b(bt,{AnPlusB:()=>Jr,Atrule:()=>tn,AtrulePrelude:()=>nn,AttributeSelector:()=>sn,Block:()=>cn,Brackets:()=>pn,CDC:()=>mn,CDO:()=>dn,ClassSelector:()=>bn,Combinator:()=>yn,Comment:()=>wn,Declaration:()=>Sn,DeclarationList:()=>An,Dimension:()=>En,Function:()=>Pn,Hash:()=>Dn,IdSelector:()=>Mn,Identifier:()=>Nn,MediaFeature:()=>Fn,MediaQuery:()=>_n,MediaQueryList:()=>jn,Nth:()=>qn,Number:()=>Yn,Operator:()=>Vn,Parentheses:()=>Qn,Percentage:()=>$n,PseudoClassSelector:()=>Jn,PseudoElementSelector:()=>to,Ratio:()=>no,Raw:()=>io,Rule:()=>so,Selector:()=>co,SelectorList:()=>po,String:()=>bo,StyleSheet:()=>yo,TypeSelector:()=>vo,UnicodeRange:()=>Ao,Url:()=>Do,Value:()=>No,WhiteSpace:()=>Mo});var Jr={};b(Jr,{generate:()=>gc,name:()=>fc,parse:()=>Zr,structure:()=>dc});var me=43,re=45,Zt=110,Ie=!0,mc=!1;function Jt(e,t){let r=this.tokenStart+e,n=this.charCodeAt(r);for((n===me||n===re)&&(t&&this.error("Number sign is not allowed"),r++);r<this.tokenEnd;r++)B(this.charCodeAt(r))||this.error("Integer is expected",r)}function Xe(e){return Jt.call(this,0,e)}function Ce(e,t){if(!this.cmpChar(this.tokenStart+e,t)){let r="";switch(t){case Zt:r="N is expected";break;case re:r="HyphenMinus is expected";break}this.error(r,this.tokenStart+e)}}function $r(){let e=0,t=0,r=this.tokenType;for(;r===13||r===25;)r=this.lookupType(++e);if(r!==10)if(this.isDelim(me,e)||this.isDelim(re,e)){t=this.isDelim(me,e)?me:re;do r=this.lookupType(++e);while(r===13||r===25);r!==10&&(this.skip(e),Xe.call(this,Ie))}else return null;return e>0&&this.skip(e),t===0&&(r=this.charCodeAt(this.tokenStart),r!==me&&r!==re&&this.error("Number sign is expected")),Xe.call(this,t!==0),t===re?"-"+this.consume(10):this.consume(10)}var fc="AnPlusB",dc={a:[String,null],b:[String,null]};function Zr(){let e=this.tokenStart,t=null,r=null;if(this.tokenType===10)Xe.call(this,mc),r=this.consume(10);else if(this.tokenType===1&&this.cmpChar(this.tokenStart,re))switch(t="-1",Ce.call(this,1,Zt),this.tokenEnd-this.tokenStart){case 2:this.next(),r=$r.call(this);break;case 3:Ce.call(this,2,re),this.next(),this.skipSC(),Xe.call(this,Ie),r="-"+this.consume(10);break;default:Ce.call(this,2,re),Jt.call(this,3,Ie),this.next(),r=this.substrToCursor(e+2)}else if(this.tokenType===1||this.isDelim(me)&&this.lookupType(1)===1){let n=0;switch(t="1",this.isDelim(me)&&(n=1,this.next()),Ce.call(this,0,Zt),this.tokenEnd-this.tokenStart){case 1:this.next(),r=$r.call(this);break;case 2:Ce.call(this,1,re),this.next(),this.skipSC(),Xe.call(this,Ie),r="-"+this.consume(10);break;default:Ce.call(this,1,re),Jt.call(this,2,Ie),this.next(),r=this.substrToCursor(e+n+1)}}else if(this.tokenType===12){let n=this.charCodeAt(this.tokenStart),o=n===me||n===re,i=this.tokenStart+o;for(;i<this.tokenEnd&&B(this.charCodeAt(i));i++);i===this.tokenStart+o&&this.error("Integer is expected",this.tokenStart+o),Ce.call(this,i-this.tokenStart,Zt),t=this.substring(e,i),i+1===this.tokenEnd?(this.next(),r=$r.call(this)):(Ce.call(this,i-this.tokenStart+1,re),i+2===this.tokenEnd?(this.next(),this.skipSC(),Xe.call(this,Ie),r="-"+this.consume(10)):(Jt.call(this,i-this.tokenStart+2,Ie),this.next(),r=this.substrToCursor(i+1)))}else this.error();return t!==null&&t.charCodeAt(0)===me&&(t=t.substr(1)),r!==null&&r.charCodeAt(0)===me&&(r=r.substr(1)),{type:"AnPlusB",loc:this.getLocation(e,this.tokenStart),a:t,b:r}}function gc(e){if(e.a){let t=e.a==="+1"&&"n"||e.a==="1"&&"n"||e.a==="-1"&&"-n"||e.a+"n";if(e.b){let r=e.b[0]==="-"||e.b[0]==="+"?e.b:"+"+e.b;this.tokenize(t+r)}else this.tokenize(t)}else this.tokenize(e.b)}var tn={};b(tn,{generate:()=>wc,name:()=>xc,parse:()=>en,structure:()=>kc,walkContext:()=>yc});function ga(e){return this.Raw(e,this.consumeUntilLeftCurlyBracketOrSemicolon,!0)}function bc(){for(let e=1,t;t=this.lookupType(e);e++){if(t===24)return!0;if(t===23||t===3)return!1}return!1}var xc="Atrule",yc="atrule",kc={name:String,prelude:["AtrulePrelude","Raw",null],block:["Block",null]};function en(){let e=this.tokenStart,t,r,n=null,o=null;switch(this.eat(3),t=this.substrToCursor(e+1),r=t.toLowerCase(),this.skipSC(),this.eof===!1&&this.tokenType!==23&&this.tokenType!==17&&(this.parseAtrulePrelude?n=this.parseWithFallback(this.AtrulePrelude.bind(this,t),ga):n=ga.call(this,this.tokenIndex),this.skipSC()),this.tokenType){case 17:this.next();break;case 23:hasOwnProperty.call(this.atrule,r)&&typeof this.atrule[r].block=="function"?o=this.atrule[r].block.call(this):o=this.Block(bc.call(this));break}return{type:"Atrule",loc:this.getLocation(e,this.tokenStart),name:t,prelude:n,block:o}}function wc(e){this.token(3,"@"+e.name),e.prelude!==null&&this.node(e.prelude),e.block?this.node(e.block):this.token(17,";")}var nn={};b(nn,{generate:()=>Ac,name:()=>vc,parse:()=>rn,structure:()=>Cc,walkContext:()=>Sc});var vc="AtrulePrelude",Sc="atrulePrelude",Cc={children:[[]]};function rn(e){let t=null;return e!==null&&(e=e.toLowerCase()),this.skipSC(),hasOwnProperty.call(this.atrule,e)&&typeof this.atrule[e].prelude=="function"?t=this.atrule[e].prelude.call(this):t=this.readSequence(this.scope.AtrulePrelude),this.skipSC(),this.eof!==!0&&this.tokenType!==23&&this.tokenType!==17&&this.error("Semicolon or block is expected"),{type:"AtrulePrelude",loc:this.getLocationFromList(t),children:t}}function Ac(e){this.children(e)}var sn={};b(sn,{generate:()=>Nc,name:()=>Dc,parse:()=>an,structure:()=>Oc});var Tc=36,ba=42,er=61,Ec=94,on=124,Lc=126;function Pc(){this.eof&&this.error("Unexpected end of input");let e=this.tokenStart,t=!1;return this.isDelim(ba)?(t=!0,this.next()):this.isDelim(on)||this.eat(1),this.isDelim(on)?this.charCodeAt(this.tokenStart+1)!==er?(this.next(),this.eat(1)):t&&this.error("Identifier is expected",this.tokenEnd):t&&this.error("Vertical line is expected"),{type:"Identifier",loc:this.getLocation(e,this.tokenStart),name:this.substrToCursor(e)}}function Ic(){let e=this.tokenStart,t=this.charCodeAt(e);return t!==er&&t!==Lc&&t!==Ec&&t!==Tc&&t!==ba&&t!==on&&this.error("Attribute selector (=, ~=, ^=, $=, *=, |=) is expected"),this.next(),t!==er&&(this.isDelim(er)||this.error("Equal sign is expected"),this.next()),this.substrToCursor(e)}var Dc="AttributeSelector",Oc={name:"Identifier",matcher:[String,null],value:["String","Identifier",null],flags:[String,null]};function an(){let e=this.tokenStart,t,r=null,n=null,o=null;return this.eat(19),this.skipSC(),t=Pc.call(this),this.skipSC(),this.tokenType!==20&&(this.tokenType!==1&&(r=Ic.call(this),this.skipSC(),n=this.tokenType===5?this.String():this.Identifier(),this.skipSC()),this.tokenType===1&&(o=this.consume(1),this.skipSC())),this.eat(20),{type:"AttributeSelector",loc:this.getLocation(e,this.tokenStart),name:t,matcher:r,value:n,flags:o}}function Nc(e){this.token(9,"["),this.node(e.name),e.matcher!==null&&(this.tokenize(e.matcher),this.node(e.value)),e.flags!==null&&this.token(1,e.flags),this.token(9,"]")}var cn={};b(cn,{generate:()=>_c,name:()=>Rc,parse:()=>ln,structure:()=>Bc,walkContext:()=>Fc});function ya(e){return this.Raw(e,null,!0)}function zc(){return this.parseWithFallback(this.Rule,ya)}function xa(e){return this.Raw(e,this.consumeUntilSemicolonIncluded,!0)}function Mc(){if(this.tokenType===17)return xa.call(this,this.tokenIndex);let e=this.parseWithFallback(this.Declaration,xa);return this.tokenType===17&&this.next(),e}var Rc="Block",Fc="block",Bc={children:[["Atrule","Rule","Declaration"]]};function ln(e){let t=e?Mc:zc,r=this.tokenStart,n=this.createList();this.eat(23);e:for(;!this.eof;)switch(this.tokenType){case 24:break e;case 13:case 25:this.next();break;case 3:n.push(this.parseWithFallback(this.Atrule,ya));break;default:n.push(t.call(this))}return this.eof||this.eat(24),{type:"Block",loc:this.getLocation(r,this.tokenStart),children:n}}function _c(e){this.token(23,"{"),this.children(e,t=>{t.type==="Declaration"&&this.token(17,";")}),this.token(24,"}")}var pn={};b(pn,{generate:()=>Hc,name:()=>Uc,parse:()=>un,structure:()=>jc});var Uc="Brackets",jc={children:[[]]};function un(e,t){let r=this.tokenStart,n=null;return this.eat(19),n=e.call(this,t),this.eof||this.eat(20),{type:"Brackets",loc:this.getLocation(r,this.tokenStart),children:n}}function Hc(e){this.token(9,"["),this.children(e),this.token(9,"]")}var mn={};b(mn,{generate:()=>Yc,name:()=>qc,parse:()=>hn,structure:()=>Wc});var qc="CDC",Wc=[];function hn(){let e=this.tokenStart;return this.eat(15),{type:"CDC",loc:this.getLocation(e,this.tokenStart)}}function Yc(){this.token(15,"-->")}var dn={};b(dn,{generate:()=>Kc,name:()=>Gc,parse:()=>fn,structure:()=>Vc});var Gc="CDO",Vc=[];function fn(){let e=this.tokenStart;return this.eat(14),{type:"CDO",loc:this.getLocation(e,this.tokenStart)}}function Kc(){this.token(14,"<!--")}var bn={};b(bn,{generate:()=>Zc,name:()=>Xc,parse:()=>gn,structure:()=>$c});var Qc=46,Xc="ClassSelector",$c={name:String};function gn(){return this.eatDelim(Qc),{type:"ClassSelector",loc:this.getLocation(this.tokenStart-1,this.tokenEnd),name:this.consume(1)}}function Zc(e){this.token(9,"."),this.token(1,e.name)}var yn={};b(yn,{generate:()=>ou,name:()=>ru,parse:()=>xn,structure:()=>nu});var Jc=43,ka=47,eu=62,tu=126,ru="Combinator",nu={name:String};function xn(){let e=this.tokenStart,t;switch(this.tokenType){case 13:t=" ";break;case 9:switch(this.charCodeAt(this.tokenStart)){case eu:case Jc:case tu:this.next();break;case ka:this.next(),this.eatIdent("deep"),this.eatDelim(ka);break;default:this.error("Combinator is expected")}t=this.substrToCursor(e);break}return{type:"Combinator",loc:this.getLocation(e,this.tokenStart),name:t}}function ou(e){this.tokenize(e.name)}var wn={};b(wn,{generate:()=>cu,name:()=>su,parse:()=>kn,structure:()=>lu});var iu=42,au=47,su="Comment",lu={value:String};function kn(){let e=this.tokenStart,t=this.tokenEnd;return this.eat(25),t-e+2>=2&&this.charCodeAt(t-2)===iu&&this.charCodeAt(t-1)===au&&(t-=2),{type:"Comment",loc:this.getLocation(e,this.tokenStart),value:this.substring(e+2,t)}}function cu(e){this.token(25,"/*"+e.value+"*/")}var Sn={};b(Sn,{generate:()=>wu,name:()=>xu,parse:()=>vn,structure:()=>ku,walkContext:()=>yu});var va=33,uu=35,pu=36,hu=38,mu=42,fu=43,wa=47;function du(e){return this.Raw(e,this.consumeUntilExclamationMarkOrSemicolon,!0)}function gu(e){return this.Raw(e,this.consumeUntilExclamationMarkOrSemicolon,!1)}function bu(){let e=this.tokenIndex,t=this.Value();return t.type!=="Raw"&&this.eof===!1&&this.tokenType!==17&&this.isDelim(va)===!1&&this.isBalanceEdge(e)===!1&&this.error(),t}var xu="Declaration",yu="declaration",ku={important:[Boolean,String],property:String,value:["Value","Raw"]};function vn(){let e=this.tokenStart,t=this.tokenIndex,r=vu.call(this),n=Rt(r),o=n?this.parseCustomProperty:this.parseValue,i=n?gu:du,s=!1,u;this.skipSC(),this.eat(16);let c=this.tokenIndex;if(n||this.skipSC(),o?u=this.parseWithFallback(bu,i):u=i.call(this,this.tokenIndex),n&&u.type==="Value"&&u.children.isEmpty){for(let a=c-this.tokenIndex;a<=0;a++)if(this.lookupType(a)===13){u.children.appendData({type:"WhiteSpace",loc:null,value:" "});break}}return this.isDelim(va)&&(s=Su.call(this),this.skipSC()),this.eof===!1&&this.tokenType!==17&&this.isBalanceEdge(t)===!1&&this.error(),{type:"Declaration",loc:this.getLocation(e,this.tokenStart),important:s,property:r,value:u}}function wu(e){this.token(1,e.property),this.token(16,":"),this.node(e.value),e.important&&(this.token(9,"!"),this.token(1,e.important===!0?"important":e.important))}function vu(){let e=this.tokenStart;if(this.tokenType===9)switch(this.charCodeAt(this.tokenStart)){case mu:case pu:case fu:case uu:case hu:this.next();break;case wa:this.next(),this.isDelim(wa)&&this.next();break}return this.tokenType===4?this.eat(4):this.eat(1),this.substrToCursor(e)}function Su(){this.eat(9),this.skipSC();let e=this.consume(1);return e==="important"?!0:e}var An={};b(An,{generate:()=>Eu,name:()=>Au,parse:()=>Cn,structure:()=>Tu});function Cu(e){return this.Raw(e,this.consumeUntilSemicolonIncluded,!0)}var Au="DeclarationList",Tu={children:[["Declaration"]]};function Cn(){let e=this.createList();e:for(;!this.eof;)switch(this.tokenType){case 13:case 25:case 17:this.next();break;default:e.push(this.parseWithFallback(this.Declaration,Cu))}return{type:"DeclarationList",loc:this.getLocationFromList(e),children:e}}function Eu(e){this.children(e,t=>{t.type==="Declaration"&&this.token(17,";")})}var En={};b(En,{generate:()=>Iu,name:()=>Lu,parse:()=>Tn,structure:()=>Pu});var Lu="Dimension",Pu={value:String,unit:String};function Tn(){let e=this.tokenStart,t=this.consumeNumber(12);return{type:"Dimension",loc:this.getLocation(e,this.tokenStart),value:t,unit:this.substring(e+t.length,this.tokenStart)}}function Iu(e){this.token(12,e.value+e.unit)}var Pn={};b(Pn,{generate:()=>zu,name:()=>Du,parse:()=>Ln,structure:()=>Nu,walkContext:()=>Ou});var Du="Function",Ou="function",Nu={name:String,children:[[]]};function Ln(e,t){let r=this.tokenStart,n=this.consumeFunctionName(),o=n.toLowerCase(),i;return i=t.hasOwnProperty(o)?t[o].call(this,t):e.call(this,t),this.eof||this.eat(22),{type:"Function",loc:this.getLocation(r,this.tokenStart),name:n,children:i}}function zu(e){this.token(2,e.name+"("),this.children(e),this.token(22,")")}var Dn={};b(Dn,{generate:()=>Bu,name:()=>Ru,parse:()=>In,structure:()=>Fu,xxx:()=>Mu});var Mu="XXX",Ru="Hash",Fu={value:String};function In(){let e=this.tokenStart;return this.eat(4),{type:"Hash",loc:this.getLocation(e,this.tokenStart),value:this.substrToCursor(e+1)}}function Bu(e){this.token(4,"#"+e.value)}var Nn={};b(Nn,{generate:()=>ju,name:()=>_u,parse:()=>On,structure:()=>Uu});var _u="Identifier",Uu={name:String};function On(){return{type:"Identifier",loc:this.getLocation(this.tokenStart,this.tokenEnd),name:this.consume(1)}}function ju(e){this.token(1,e.name)}var Mn={};b(Mn,{generate:()=>Wu,name:()=>Hu,parse:()=>zn,structure:()=>qu});var Hu="IdSelector",qu={name:String};function zn(){let e=this.tokenStart;return this.eat(4),{type:"IdSelector",loc:this.getLocation(e,this.tokenStart),name:this.substrToCursor(e+1)}}function Wu(e){this.token(9,"#"+e.name)}var Fn={};b(Fn,{generate:()=>Vu,name:()=>Yu,parse:()=>Rn,structure:()=>Gu});var Yu="MediaFeature",Gu={name:String,value:["Identifier","Number","Dimension","Ratio",null]};function Rn(){let e=this.tokenStart,t,r=null;if(this.eat(21),this.skipSC(),t=this.consume(1),this.skipSC(),this.tokenType!==22){switch(this.eat(16),this.skipSC(),this.tokenType){case 10:this.lookupNonWSType(1)===9?r=this.Ratio():r=this.Number();break;case 12:r=this.Dimension();break;case 1:r=this.Identifier();break;default:this.error("Number, dimension, ratio or identifier is expected")}this.skipSC()}return this.eat(22),{type:"MediaFeature",loc:this.getLocation(e,this.tokenStart),name:t,value:r}}function Vu(e){this.token(21,"("),this.token(1,e.name),e.value!==null&&(this.token(16,":"),this.node(e.value)),this.token(22,")")}var _n={};b(_n,{generate:()=>Xu,name:()=>Ku,parse:()=>Bn,structure:()=>Qu});var Ku="MediaQuery",Qu={children:[["Identifier","MediaFeature","WhiteSpace"]]};function Bn(){let e=this.createList(),t=null;this.skipSC();e:for(;!this.eof;){switch(this.tokenType){case 25:case 13:this.next();continue;case 1:t=this.Identifier();break;case 21:t=this.MediaFeature();break;default:break e}e.push(t)}return t===null&&this.error("Identifier or parenthesis is expected"),{type:"MediaQuery",loc:this.getLocationFromList(e),children:e}}function Xu(e){this.children(e)}var jn={};b(jn,{generate:()=>Ju,name:()=>$u,parse:()=>Un,structure:()=>Zu});var $u="MediaQueryList",Zu={children:[["MediaQuery"]]};function Un(){let e=this.createList();for(this.skipSC();!this.eof&&(e.push(this.MediaQuery()),this.tokenType===18);)this.next();return{type:"MediaQueryList",loc:this.getLocationFromList(e),children:e}}function Ju(e){this.children(e,()=>this.token(18,","))}var qn={};b(qn,{generate:()=>rp,name:()=>ep,parse:()=>Hn,structure:()=>tp});var ep="Nth",tp={nth:["AnPlusB","Identifier"],selector:["SelectorList",null]};function Hn(){this.skipSC();let e=this.tokenStart,t=e,r=null,n;return this.lookupValue(0,"odd")||this.lookupValue(0,"even")?n=this.Identifier():n=this.AnPlusB(),t=this.tokenStart,this.skipSC(),this.lookupValue(0,"of")&&(this.next(),r=this.SelectorList(),t=this.tokenStart),{type:"Nth",loc:this.getLocation(e,t),nth:n,selector:r}}function rp(e){this.node(e.nth),e.selector!==null&&(this.token(1,"of"),this.node(e.selector))}var Yn={};b(Yn,{generate:()=>ip,name:()=>np,parse:()=>Wn,structure:()=>op});var np="Number",op={value:String};function Wn(){return{type:"Number",loc:this.getLocation(this.tokenStart,this.tokenEnd),value:this.consume(10)}}function ip(e){this.token(10,e.value)}var Vn={};b(Vn,{generate:()=>lp,name:()=>ap,parse:()=>Gn,structure:()=>sp});var ap="Operator",sp={value:String};function Gn(){let e=this.tokenStart;return this.next(),{type:"Operator",loc:this.getLocation(e,this.tokenStart),value:this.substrToCursor(e)}}function lp(e){this.tokenize(e.value)}var Qn={};b(Qn,{generate:()=>pp,name:()=>cp,parse:()=>Kn,structure:()=>up});var cp="Parentheses",up={children:[[]]};function Kn(e,t){let r=this.tokenStart,n=null;return this.eat(21),n=e.call(this,t),this.eof||this.eat(22),{type:"Parentheses",loc:this.getLocation(r,this.tokenStart),children:n}}function pp(e){this.token(21,"("),this.children(e),this.token(22,")")}var $n={};b($n,{generate:()=>fp,name:()=>hp,parse:()=>Xn,structure:()=>mp});var hp="Percentage",mp={value:String};function Xn(){return{type:"Percentage",loc:this.getLocation(this.tokenStart,this.tokenEnd),value:this.consumeNumber(11)}}function fp(e){this.token(11,e.value+"%")}var Jn={};b(Jn,{generate:()=>xp,name:()=>dp,parse:()=>Zn,structure:()=>bp,walkContext:()=>gp});var dp="PseudoClassSelector",gp="function",bp={name:String,children:[["Raw"],null]};function Zn(){let e=this.tokenStart,t=null,r,n;return this.eat(16),this.tokenType===2?(r=this.consumeFunctionName(),n=r.toLowerCase(),hasOwnProperty.call(this.pseudo,n)?(this.skipSC(),t=this.pseudo[n].call(this),this.skipSC()):(t=this.createList(),t.push(this.Raw(this.tokenIndex,null,!1))),this.eat(22)):r=this.consume(1),{type:"PseudoClassSelector",loc:this.getLocation(e,this.tokenStart),name:r,children:t}}function xp(e){this.token(16,":"),e.children===null?this.token(1,e.name):(this.token(2,e.name+"("),this.children(e),this.token(22,")"))}var to={};b(to,{generate:()=>vp,name:()=>yp,parse:()=>eo,structure:()=>wp,walkContext:()=>kp});var yp="PseudoElementSelector",kp="function",wp={name:String,children:[["Raw"],null]};function eo(){let e=this.tokenStart,t=null,r,n;return this.eat(16),this.eat(16),this.tokenType===2?(r=this.consumeFunctionName(),n=r.toLowerCase(),hasOwnProperty.call(this.pseudo,n)?(this.skipSC(),t=this.pseudo[n].call(this),this.skipSC()):(t=this.createList(),t.push(this.Raw(this.tokenIndex,null,!1))),this.eat(22)):r=this.consume(1),{type:"PseudoElementSelector",loc:this.getLocation(e,this.tokenStart),name:r,children:t}}function vp(e){this.token(16,":"),this.token(16,":"),e.children===null?this.token(1,e.name):(this.token(2,e.name+"("),this.children(e),this.token(22,")"))}var no={};b(no,{generate:()=>Ep,name:()=>Ap,parse:()=>ro,structure:()=>Tp});var Sp=47,Cp=46;function Sa(){this.skipSC();let e=this.consume(10);for(let t=0;t<e.length;t++){let r=e.charCodeAt(t);!B(r)&&r!==Cp&&this.error("Unsigned number is expected",this.tokenStart-e.length+t)}return Number(e)===0&&this.error("Zero number is not allowed",this.tokenStart-e.length),e}var Ap="Ratio",Tp={left:String,right:String};function ro(){let e=this.tokenStart,t=Sa.call(this),r;return this.skipSC(),this.eatDelim(Sp),r=Sa.call(this),{type:"Ratio",loc:this.getLocation(e,this.tokenStart),left:t,right:r}}function Ep(e){this.token(10,e.left),this.token(9,"/"),this.token(10,e.right)}var io={};b(io,{generate:()=>Dp,name:()=>Pp,parse:()=>oo,structure:()=>Ip});function Lp(){return this.tokenIndex>0&&this.lookupType(-1)===13?this.tokenIndex>1?this.getTokenStart(this.tokenIndex-1):this.firstCharOffset:this.tokenStart}var Pp="Raw",Ip={value:String};function oo(e,t,r){let n=this.getTokenStart(e),o;return this.skipUntilBalanced(e,t||this.consumeUntilBalanceEnd),r&&this.tokenStart>n?o=Lp.call(this):o=this.tokenStart,{type:"Raw",loc:this.getLocation(n,o),value:this.substring(n,o)}}function Dp(e){this.tokenize(e.value)}var so={};b(so,{generate:()=>Rp,name:()=>Np,parse:()=>ao,structure:()=>Mp,walkContext:()=>zp});function Ca(e){return this.Raw(e,this.consumeUntilLeftCurlyBracket,!0)}function Op(){let e=this.SelectorList();return e.type!=="Raw"&&this.eof===!1&&this.tokenType!==23&&this.error(),e}var Np="Rule",zp="rule",Mp={prelude:["SelectorList","Raw"],block:["Block"]};function ao(){let e=this.tokenIndex,t=this.tokenStart,r,n;return this.parseRulePrelude?r=this.parseWithFallback(Op,Ca):r=Ca.call(this,e),n=this.Block(!0),{type:"Rule",loc:this.getLocation(t,this.tokenStart),prelude:r,block:n}}function Rp(e){this.node(e.prelude),this.node(e.block)}var co={};b(co,{generate:()=>_p,name:()=>Fp,parse:()=>lo,structure:()=>Bp});var Fp="Selector",Bp={children:[["TypeSelector","IdSelector","ClassSelector","AttributeSelector","PseudoClassSelector","PseudoElementSelector","Combinator","WhiteSpace"]]};function lo(){let e=this.readSequence(this.scope.Selector);return this.getFirstListNode(e)===null&&this.error("Selector is expected"),{type:"Selector",loc:this.getLocationFromList(e),children:e}}function _p(e){this.children(e)}var po={};b(po,{generate:()=>qp,name:()=>Up,parse:()=>uo,structure:()=>Hp,walkContext:()=>jp});var Up="SelectorList",jp="selector",Hp={children:[["Selector","Raw"]]};function uo(){let e=this.createList();for(;!this.eof;){if(e.push(this.Selector()),this.tokenType===18){this.next();continue}break}return{type:"SelectorList",loc:this.getLocationFromList(e),children:e}}function qp(e){this.children(e,()=>this.token(18,","))}var bo={};b(bo,{generate:()=>Gp,name:()=>Wp,parse:()=>go,structure:()=>Yp});var fo={};b(fo,{decode:()=>dt,encode:()=>mo});var ho=92,Aa=34,Ta=39;function dt(e){let t=e.length,r=e.charCodeAt(0),n=r===Aa||r===Ta?1:0,o=n===1&&t>1&&e.charCodeAt(t-1)===r?t-2:t-1,i="";for(let s=n;s<=o;s++){let u=e.charCodeAt(s);if(u===ho){if(s===o){s!==t-1&&(i=e.substr(s+1));break}if(u=e.charCodeAt(++s),$(ho,u)){let c=s-1,a=se(e,c);s=a-1,i+=Re(e.substring(c+1,a))}else u===13&&e.charCodeAt(s+1)===10&&s++}else i+=e[s]}return i}function mo(e,t){let r=t?"'":'"',n=t?Ta:Aa,o="",i=!1;for(let s=0;s<e.length;s++){let u=e.charCodeAt(s);if(u===0){o+="\uFFFD";continue}if(u<=31||u===127){o+="\\"+u.toString(16),i=!0;continue}u===n||u===ho?(o+="\\"+e.charAt(s),i=!1):(i&&(ee(u)||pe(u))&&(o+=" "),o+=e.charAt(s),i=!1)}return r+o+r}var Wp="String",Yp={value:String};function go(){return{type:"String",loc:this.getLocation(this.tokenStart,this.tokenEnd),value:dt(this.consume(5))}}function Gp(e){this.token(5,mo(e.value))}var yo={};b(yo,{generate:()=>$p,name:()=>Kp,parse:()=>xo,structure:()=>Xp,walkContext:()=>Qp});var Vp=33;function Ea(e){return this.Raw(e,null,!1)}var Kp="StyleSheet",Qp="stylesheet",Xp={children:[["Comment","CDO","CDC","Atrule","Rule","Raw"]]};function xo(){let e=this.tokenStart,t=this.createList(),r;e:for(;!this.eof;){switch(this.tokenType){case 13:this.next();continue;case 25:if(this.charCodeAt(this.tokenStart+2)!==Vp){this.next();continue}r=this.Comment();break;case 14:r=this.CDO();break;case 15:r=this.CDC();break;case 3:r=this.parseWithFallback(this.Atrule,Ea);break;default:r=this.parseWithFallback(this.Rule,Ea)}t.push(r)}return{type:"StyleSheet",loc:this.getLocation(e,this.tokenStart),children:t}}function $p(e){this.children(e)}var vo={};b(vo,{generate:()=>th,name:()=>Jp,parse:()=>wo,structure:()=>eh});var Zp=42,La=124;function ko(){this.tokenType!==1&&this.isDelim(Zp)===!1&&this.error("Identifier or asterisk is expected"),this.next()}var Jp="TypeSelector",eh={name:String};function wo(){let e=this.tokenStart;return this.isDelim(La)?(this.next(),ko.call(this)):(ko.call(this),this.isDelim(La)&&(this.next(),ko.call(this))),{type:"TypeSelector",loc:this.getLocation(e,this.tokenStart),name:this.substrToCursor(e)}}function th(e){this.tokenize(e.name)}var Ao={};b(Ao,{generate:()=>ah,name:()=>oh,parse:()=>Co,structure:()=>ih});var Pa=43,Ia=45,So=63;function gt(e,t){let r=0;for(let n=this.tokenStart+e;n<this.tokenEnd;n++){let o=this.charCodeAt(n);if(o===Ia&&t&&r!==0)return gt.call(this,e+r+1,!1),-1;ee(o)||this.error(t&&r!==0?"Hyphen minus"+(r<6?" or hex digit":"")+" is expected":r<6?"Hex digit is expected":"Unexpected input",n),++r>6&&this.error("Too many hex digits",n)}return this.next(),r}function tr(e){let t=0;for(;this.isDelim(So);)++t>e&&this.error("Too many question marks"),this.next()}function rh(e){this.charCodeAt(this.tokenStart)!==e&&this.error((e===Pa?"Plus sign":"Hyphen minus")+" is expected")}function nh(){let e=0;switch(this.tokenType){case 10:if(e=gt.call(this,1,!0),this.isDelim(So)){tr.call(this,6-e);break}if(this.tokenType===12||this.tokenType===10){rh.call(this,Ia),gt.call(this,1,!1);break}break;case 12:e=gt.call(this,1,!0),e>0&&tr.call(this,6-e);break;default:if(this.eatDelim(Pa),this.tokenType===1){e=gt.call(this,0,!0),e>0&&tr.call(this,6-e);break}if(this.isDelim(So)){this.next(),tr.call(this,5);break}this.error("Hex digit or question mark is expected")}}var oh="UnicodeRange",ih={value:String};function Co(){let e=this.tokenStart;return this.eatIdent("u"),nh.call(this),{type:"UnicodeRange",loc:this.getLocation(e,this.tokenStart),value:this.substrToCursor(e)}}function ah(e){this.tokenize(e.value)}var Do={};b(Do,{generate:()=>mh,name:()=>ph,parse:()=>Io,structure:()=>hh});var Po={};b(Po,{decode:()=>Eo,encode:()=>Lo});var sh=32,To=92,lh=34,ch=39,uh=40,Da=41;function Eo(e){let t=e.length,r=4,n=e.charCodeAt(t-1)===Da?t-2:t-1,o="";for(;r<n&&pe(e.charCodeAt(r));)r++;for(;r<n&&pe(e.charCodeAt(n));)n--;for(let i=r;i<=n;i++){let s=e.charCodeAt(i);if(s===To){if(i===n){i!==t-1&&(o=e.substr(i+1));break}if(s=e.charCodeAt(++i),$(To,s)){let u=i-1,c=se(e,u);i=c-1,o+=Re(e.substring(u+1,c))}else s===13&&e.charCodeAt(i+1)===10&&i++}else o+=e[i]}return o}function Lo(e){let t="",r=!1;for(let n=0;n<e.length;n++){let o=e.charCodeAt(n);if(o===0){t+="\uFFFD";continue}if(o<=31||o===127){t+="\\"+o.toString(16),r=!0;continue}o===sh||o===To||o===lh||o===ch||o===uh||o===Da?(t+="\\"+e.charAt(n),r=!1):(r&&ee(o)&&(t+=" "),t+=e.charAt(n),r=!1)}return"url("+t+")"}var ph="Url",hh={value:String};function Io(){let e=this.tokenStart,t;switch(this.tokenType){case 7:t=Eo(this.consume(7));break;case 2:this.cmpStr(this.tokenStart,this.tokenEnd,"url(")||this.error("Function name must be `url`"),this.eat(2),this.skipSC(),t=dt(this.consume(5)),this.skipSC(),this.eof||this.eat(22);break;default:this.error("Url or Function is expected")}return{type:"Url",loc:this.getLocation(e,this.tokenStart),value:t}}function mh(e){this.token(7,Lo(e.value))}var No={};b(No,{generate:()=>gh,name:()=>fh,parse:()=>Oo,structure:()=>dh});var fh="Value",dh={children:[[]]};function Oo(){let e=this.tokenStart,t=this.readSequence(this.scope.Value);return{type:"Value",loc:this.getLocation(e,this.tokenStart),children:t}}function gh(e){this.children(e)}var Mo={};b(Mo,{generate:()=>kh,name:()=>xh,parse:()=>zo,structure:()=>yh});var bh=Object.freeze({type:"WhiteSpace",loc:null,value:" "}),xh="WhiteSpace",yh={value:String};function zo(){return this.eat(13),bh}function kh(e){this.token(13,e.value)}var Oa={generic:!0,...da,node:bt};var Ro={};b(Ro,{AtrulePrelude:()=>za,Selector:()=>Ra,Value:()=>Ua});var wh=35,vh=42,Na=43,Sh=45,Ch=47,Ah=117;function xt(e){switch(this.tokenType){case 4:return this.Hash();case 18:return this.Operator();case 21:return this.Parentheses(this.readSequence,e.recognizer);case 19:return this.Brackets(this.readSequence,e.recognizer);case 5:return this.String();case 12:return this.Dimension();case 11:return this.Percentage();case 10:return this.Number();case 2:return this.cmpStr(this.tokenStart,this.tokenEnd,"url(")?this.Url():this.Function(this.readSequence,e.recognizer);case 7:return this.Url();case 1:return this.cmpChar(this.tokenStart,Ah)&&this.cmpChar(this.tokenStart+1,Na)?this.UnicodeRange():this.Identifier();case 9:{let t=this.charCodeAt(this.tokenStart);if(t===Ch||t===vh||t===Na||t===Sh)return this.Operator();t===wh&&this.error("Hex or identifier is expected",this.tokenStart+1);break}}}var za={getNode:xt};var Th=35,Eh=42,Lh=43,Ph=47,Ma=46,Ih=62,Dh=124,Oh=126;function Nh(e,t){t.last!==null&&t.last.type!=="Combinator"&&e!==null&&e.type!=="Combinator"&&t.push({type:"Combinator",loc:null,name:" "})}function zh(){switch(this.tokenType){case 19:return this.AttributeSelector();case 4:return this.IdSelector();case 16:return this.lookupType(1)===16?this.PseudoElementSelector():this.PseudoClassSelector();case 1:return this.TypeSelector();case 10:case 11:return this.Percentage();case 12:this.charCodeAt(this.tokenStart)===Ma&&this.error("Identifier is expected",this.tokenStart+1);break;case 9:{switch(this.charCodeAt(this.tokenStart)){case Lh:case Ih:case Oh:case Ph:return this.Combinator();case Ma:return this.ClassSelector();case Eh:case Dh:return this.TypeSelector();case Th:return this.IdSelector()}break}}}var Ra={onWhiteSpace:Nh,getNode:zh};function Fa(){return this.createSingleNodeList(this.Raw(this.tokenIndex,null,!1))}function Ba(){let e=this.createList();if(this.skipSC(),e.push(this.Identifier()),this.skipSC(),this.tokenType===18){e.push(this.Operator());let t=this.tokenIndex,r=this.parseCustomProperty?this.Value(null):this.Raw(this.tokenIndex,this.consumeUntilExclamationMarkOrSemicolon,!1);if(r.type==="Value"&&r.children.isEmpty){for(let n=t-this.tokenIndex;n<=0;n++)if(this.lookupType(n)===13){r.children.appendData({type:"WhiteSpace",loc:null,value:" "});break}}e.push(r)}return e}function _a(e){return e!==null&&e.type==="Operator"&&(e.value[e.value.length-1]==="-"||e.value[e.value.length-1]==="+")}var Ua={getNode:xt,onWhiteSpace(e,t){_a(e)&&(e.value=" "+e.value),_a(t.last)&&(t.last.value+=" ")},expression:Fa,var:Ba};var ja={parse:{prelude:null,block(){return this.Block(!0)}}};var Ha={parse:{prelude(){let e=this.createList();switch(this.skipSC(),this.tokenType){case 5:e.push(this.String());break;case 7:case 2:e.push(this.Url());break;default:this.error("String or url() is expected")}return(this.lookupNonWSType(0)===1||this.lookupNonWSType(0)===21)&&e.push(this.MediaQueryList()),e},block:null}};var qa={parse:{prelude(){return this.createSingleNodeList(this.MediaQueryList())},block(){return this.Block(!1)}}};var Wa={parse:{prelude(){return this.createSingleNodeList(this.SelectorList())},block(){return this.Block(!0)}}};function Mh(){return this.createSingleNodeList(this.Raw(this.tokenIndex,null,!1))}function Rh(){return this.skipSC(),this.tokenType===1&&this.lookupNonWSType(1)===16?this.createSingleNodeList(this.Declaration()):Ya.call(this)}function Ya(){let e=this.createList(),t;this.skipSC();e:for(;!this.eof;){switch(this.tokenType){case 25:case 13:this.next();continue;case 2:t=this.Function(Mh,this.scope.AtrulePrelude);break;case 1:t=this.Identifier();break;case 21:t=this.Parentheses(Rh,this.scope.AtrulePrelude);break;default:break e}e.push(t)}return e}var Ga={parse:{prelude(){let e=Ya.call(this);return this.getFirstListNode(e)===null&&this.error("Condition is expected"),e},block(){return this.Block(!1)}}};var Va={"font-face":ja,import:Ha,media:qa,page:Wa,supports:Ga};var De={parse(){return this.createSingleNodeList(this.SelectorList())}},Fh={parse(){return this.createSingleNodeList(this.Selector())}},Ka={parse(){return this.createSingleNodeList(this.Identifier())}},rr={parse(){return this.createSingleNodeList(this.Nth())}},Qa={dir:Ka,has:De,lang:Ka,matches:De,is:De,"-moz-any":De,"-webkit-any":De,where:De,not:De,"nth-child":rr,"nth-last-child":rr,"nth-last-of-type":rr,"nth-of-type":rr,slotted:Fh};var Fo={};b(Fo,{AnPlusB:()=>Zr,Atrule:()=>en,AtrulePrelude:()=>rn,AttributeSelector:()=>an,Block:()=>ln,Brackets:()=>un,CDC:()=>hn,CDO:()=>fn,ClassSelector:()=>gn,Combinator:()=>xn,Comment:()=>kn,Declaration:()=>vn,DeclarationList:()=>Cn,Dimension:()=>Tn,Function:()=>Ln,Hash:()=>In,IdSelector:()=>zn,Identifier:()=>On,MediaFeature:()=>Rn,MediaQuery:()=>Bn,MediaQueryList:()=>Un,Nth:()=>Hn,Number:()=>Wn,Operator:()=>Gn,Parentheses:()=>Kn,Percentage:()=>Xn,PseudoClassSelector:()=>Zn,PseudoElementSelector:()=>eo,Ratio:()=>ro,Raw:()=>oo,Rule:()=>ao,Selector:()=>lo,SelectorList:()=>uo,String:()=>go,StyleSheet:()=>xo,TypeSelector:()=>wo,UnicodeRange:()=>Co,Url:()=>Io,Value:()=>Oo,WhiteSpace:()=>zo});var Xa={parseContext:{default:"StyleSheet",stylesheet:"StyleSheet",atrule:"Atrule",atrulePrelude(e){return this.AtrulePrelude(e.atrule?String(e.atrule):null)},mediaQueryList:"MediaQueryList",mediaQuery:"MediaQuery",rule:"Rule",selectorList:"SelectorList",selector:"Selector",block(){return this.Block(!0)},declarationList:"DeclarationList",declaration:"Declaration",value:"Value"},scope:Ro,atrule:Va,pseudo:Qa,node:Fo};var $a={node:bt};var Za=Xr({...Oa,...Xa,...$a});var Zg="2.2.0";function Bo(e){let t={};for(let r in e){let n=e[r];n&&(Array.isArray(n)||n instanceof I?n=n.map(Bo):n.constructor===Object&&(n=Bo(n))),t[r]=n}return t}var es={};b(es,{decode:()=>Bh,encode:()=>_h});var Ja=92;function Bh(e){let t=e.length-1,r="";for(let n=0;n<e.length;n++){let o=e.charCodeAt(n);if(o===Ja){if(n===t)break;if(o=e.charCodeAt(++n),$(Ja,o)){let i=n-1,s=se(e,i);n=s-1,r+=Re(e.substring(i+1,s))}else o===13&&e.charCodeAt(n+1)===10&&n++}else r+=e[n]}return r}function _h(e){let t="";if(e.length===1&&e.charCodeAt(0)===45)return"\\-";for(let r=0;r<e.length;r++){let n=e.charCodeAt(r);if(n===0){t+="\uFFFD";continue}if(n<=31||n===127||n>=48&&n<=57&&(r===0||r===1&&e.charCodeAt(0)===45)){t+="\\"+n.toString(16)+" ";continue}Ne(n)?t+=e.charAt(r):t+="\\"+e.charAt(r)}return t}var{tokenize:ob,parse:ib,generate:ab,lexer:sb,createLexer:lb,walk:cb,find:ub,findLast:pb,findAll:hb,toPlainObject:mb,fromPlainObject:fb,fork:db}=Za;

return {Lexer:Ke,List:I,TokenStream:nt,clone:Bo,createLexer:lb,createSyntax:Xr,definitionSyntax:Qi,find:ub,findAll:hb,findLast:pb,fork:db,fromPlainObject:fb,generate:ab,ident:es,isCustomProperty:Rt,keyword:Mt,lexer:sb,parse:ib,property:vr,string:fo,toPlainObject:mb,tokenNames:Fe,tokenTypes:Ze,tokenize:ob,url:Po,vendorPrefix:_m,version:Zg,walk:cb};
},3:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2020-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

class ArglistParser {
    constructor(separatorChar = ',', mustQuote = false) {
        this.separatorChar = this.actualSeparatorChar = separatorChar;
        this.separatorCode = this.actualSeparatorCode = separatorChar.charCodeAt(0);
        this.mustQuote = mustQuote;
        this.quoteBeg = 0; this.quoteEnd = 0;
        this.argBeg = 0; this.argEnd = 0;
        this.separatorBeg = 0; this.separatorEnd = 0;
        this.transform = false;
        this.failed = false;
        this.reWhitespaceStart = /^\s+/;
        this.reWhitespaceEnd = /(?:^|\S)(\s+)$/;
        this.reOddTrailingEscape = /(?:^|[^\\])(?:\\\\)*\\$/;
        this.reTrailingEscapeChars = /\\+$/;
    }
    nextArg(pattern, beg = 0) {
        const len = pattern.length;
        this.quoteBeg = beg + this.leftWhitespaceCount(pattern.slice(beg));
        this.failed = false;
        const qc = pattern.charCodeAt(this.quoteBeg);
        if ( qc === 0x22 /* " */ || qc === 0x27 /* ' */ || qc === 0x60 /* ` */ ) {
            this.indexOfNextArgSeparator(pattern, qc);
            if ( this.argEnd !== len ) {
                this.quoteEnd = this.argEnd + 1;
                this.separatorBeg = this.separatorEnd = this.quoteEnd;
                this.separatorEnd += this.leftWhitespaceCount(pattern.slice(this.quoteEnd));
                if ( this.separatorEnd === len ) { return this; }
                if ( pattern.charCodeAt(this.separatorEnd) === this.separatorCode ) {
                    this.separatorEnd += 1;
                    return this;
                }
            }
        }
        this.indexOfNextArgSeparator(pattern, this.separatorCode);
        this.separatorBeg = this.separatorEnd = this.argEnd;
        if ( this.separatorBeg < len ) {
            this.separatorEnd += 1;
        }
        this.argEnd -= this.rightWhitespaceCount(pattern.slice(0, this.separatorBeg));
        this.quoteEnd = this.argEnd;
        if ( this.mustQuote ) {
            this.failed = true;
        }
        return this;
    }
    normalizeArg(s, char = '') {
        if ( char === '' ) { char = this.actualSeparatorChar; }
        let out = '';
        let pos = 0;
        while ( (pos = s.lastIndexOf(char)) !== -1 ) {
            out = s.slice(pos) + out;
            s = s.slice(0, pos);
            const match = this.reTrailingEscapeChars.exec(s);
            if ( match === null ) { continue; }
            const tail = (match[0].length & 1) !== 0
                ? match[0].slice(0, -1)
                : match[0];
            out = tail + out;
            s = s.slice(0, -match[0].length);
        }
        if ( out === '' ) { return s; }
        return s + out;
    }
    leftWhitespaceCount(s) {
        const match = this.reWhitespaceStart.exec(s);
        return match === null ? 0 : match[0].length;
    }
    rightWhitespaceCount(s) {
        const match = this.reWhitespaceEnd.exec(s);
        return match === null ? 0 : match[1].length;
    }
    indexOfNextArgSeparator(pattern, separatorCode) {
        this.argBeg = this.argEnd = separatorCode !== this.separatorCode
            ? this.quoteBeg + 1
            : this.quoteBeg;
        this.transform = false;
        if ( separatorCode !== this.actualSeparatorCode ) {
            this.actualSeparatorCode = separatorCode;
            this.actualSeparatorChar = String.fromCharCode(separatorCode);
        }
        while ( this.argEnd < pattern.length ) {
            const pos = pattern.indexOf(this.actualSeparatorChar, this.argEnd);
            if ( pos === -1 ) {
                return (this.argEnd = pattern.length);
            }
            if ( this.reOddTrailingEscape.test(pattern.slice(0, pos)) === false ) {
                return (this.argEnd = pos);
            }
            this.transform = true;
            this.argEnd = pos + 1;
        }
    }
}

return {ArglistParser:ArglistParser};
},4:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2025-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock

*/

/**
 * Implement the parsing of uBO-flavored JSON path queries.
 * 
 * Reference to original JSON path syntax:
 * https://www.rfc-editor.org/info/rfc9535/
 * 
 * uBO-flavored JSON path implementation differs as follow:
 *   - Array slice operator not supported
 *   - Selectors can be a `/`-delimited regex, i.e. `$./pattern/`
 *   - Onle a single filter selector is allowed in filter selector syntax
 * 
 * - uBO-flavored JSON path supports a limited set of filter selectors:
 *   set of expressions since unlike the official implementation, uBO can't use
 *   JS eval() to evaluate arbitrary JS expressions. The operand MUST be valid
 *   JSON. The currently supported expressions are:
 *   - ==: strict equality
 *   - !=: strict inequality
 *   -  <: less than
 *   - <=: less than or equal to
 *   -  >: greater than
 *   - >=: greater than or equal to
 *   - ^=: stringified value starts with 
 *   - $=: stringified value ends with
 *   - *=: stringified value includes
 *   - =/.../: true if the regular expression matches the stringified value
 * 
 * - uBO-flavored JSON path supports assignement operator:
 *   - =[any well-formed JSON value]
 *   - =repl(...): [to be documented] i.e. {"regex":"...","flags":"i","replacement":"..."}
 *   - =call(...): [to be documented] i.e. ["${obj}","setAttribute","${key}"]
 *  * 
 * - Examples (from "JSONPath examples" at reference link)
 *   - .store.book[*].author
 *   - ..author
 *   - .store.*
 *   - .store..price
 *   - ..book[2]
 *   - ..book[?(.isbn)]
 *   - ..book[?(.price<10)]
 *   - ..*
 * 
 * uBO-flavored syntax supports assigning a value to a resolved JSON path by
 * appending `=[value]` to the JSON path query. The assigned value MUST be
 * valid JSON. Examples:
 * - .store..price=0
 * - .store.book[*].author="redacted"
 *
 * A JSONPath instance can be use to compile a JSON path query, and the result
 * of the compilation can be applied to different objects. When a JSON path
 * query does not assign a value, the resolved property will be removed.
 * 
 * More capabilities can be added in the future as needed.
 * 
 * */

class JSONPath {
    static create(query) {
        const jsonp = new JSONPath();
        jsonp.compile(query);
        return jsonp;
    }
    static toJSON(obj, stringifier, ...args) {
        return (stringifier || JSON.stringify)(obj, ...args)
            .replace(/\//g, '\\/');
    }
    static keys = Object.keys;
    static entries = Object.entries;
    static hasOwn = Object.hasOwn;
    static Regex = RegExp;
    get value() {
        return this.#compiled && this.#compiled.rval;
    }
    set value(v) {
        if ( this.#compiled === undefined ) { return; }
        this.#compiled.rval = v;
    }
    get valid() {
        return this.#compiled !== undefined;
    }
    compile(query) {
        this.#compiled = undefined;
        this.v2 = query.startsWith('v2:');
        if ( this.v2 ) { query = query.slice(3); }
        const r = this.#compile(query, 0);
        if ( r === undefined ) { return; }
        if ( r.i !== query.length ) {
            let val;
            if ( query.startsWith('=', r.i) ) {
                const match = this.#reRval.exec(query.slice(r.i));
                if ( match ) {
                    r.modify = match[1];
                    val = match[2];
                } else {
                    val = query.slice(r.i+1);
                }
            } else if ( query.startsWith('+=', r.i) ) {
                r.modify = '+';
                val = query.slice(r.i+2);
            }
            try { r.rval = JSON.parse(val); }
            catch { return; }
        }
        r.v2 = this.v2;
        this.#compiled = r;
    }
    evaluate(root) {
        if ( this.valid === false ) { return []; }
        this.#root = { '$': root };
        const paths = this.#evaluate(this.#compiled.steps, []);
        this.#root = null;
        return paths;
    }
    apply(root) {
        if ( this.valid === false ) { return; }
        const { rval } = this.#compiled;
        this.#root = { '$': root };
        const paths = this.#evaluate(this.#compiled.steps, []);
        let i = paths.length
        if ( i === 0 ) { this.#root = null; return; }
        while ( i-- ) {
            const { obj, key } = this.#resolvePath(paths[i]);
            if ( obj === undefined ) { continue; }
            if ( rval !== undefined ) {
                this.#modifyVal(obj, key);
            } else if ( Array.isArray(obj) && typeof key === 'number' ) {
                obj.splice(key, 1);
            } else {
                delete obj[key];
            }
        }
        const result = this.#root['$'] ?? null;
        this.#root = null;
        return result;
    }
    dump() {
        return JSON.stringify(this.#compiled);
    }
    toJSON(obj, ...args) {
        return JSONPath.toJSON(obj, null, ...args)
    }
    get [Symbol.toStringTag]() {
        return 'JSONPath';
    }
    #UNDEFINED = 0;
    #ROOT = 1;
    #CURRENT = 2;
    #CHILDREN = 3;
    #DESCENDANTS = 4;
    #QUANTIFIER = 5;
    #reUnquotedIdentifier = /^[A-Za-z_][\w]*|^\*/;
    #reExpr = /^\s*([!=^$*]=|[<>]=?)\s*(.+?)\]/;
    #reIndice = /^-?\d+/;
    #reRval = /^=([a-z]+)\((.+)\)$/;
    #reQuantifier = /^\{(\d+|\d+,\d+|\d+,|,\d+)\};\$/;
    #root;
    #compiled;
    #compile(query, i) {
        if ( query.length === 0 ) { return; }
        const steps = [];
        let c = query.charCodeAt(i);
        if ( c === 0x24 /* $ */ ) {
            steps.push({ mv: this.#ROOT });
            i += 1;
        } else if ( c === 0x40 /* @ */ ) {
            steps.push({ mv: this.#CURRENT });
            i += 1;
        } else {
            steps.push({ mv: i === 0 ? this.#ROOT : this.#CURRENT });
        }
        let mv = this.#UNDEFINED;
        for (;;) {
            if ( i === query.length ) { break; }
            c = query.charCodeAt(i);
            if ( c === 0x20 /* whitespace */ ) {
                i += 1;
                continue;
            }
            // Dot accessor syntax
            if ( c === 0x2E /* . */ ) {
                if ( mv !== this.#UNDEFINED ) { return; }
                if ( query.startsWith('..', i) ) {
                    mv = this.#DESCENDANTS;
                    i += 2;
                } else {
                    mv = this.#CHILDREN;
                    i += 1;
                }
                continue;
            }
            if ( c === 0x3B /* ; */ ) {
                if ( query.startsWith(';$', i) === false ) { return; }
                steps.push(
                    { mv: this.#QUANTIFIER, min: 1, max: 1e6 },
                    { mv: this.#ROOT }
                );
                i += 2;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( c === 0x7B /* { */ ) {
                const match = this.#reQuantifier.exec(query.slice(i));
                if ( match === null ) { return; }
                const comma = match[1].indexOf(',');
                let min, max;
                if ( comma === -1 ) {
                    min = max = parseInt(match[1]);
                } else {
                    min = parseInt(match[1].slice(0, comma)) || 0;
                    max = parseInt(match[1].slice(comma+1)) || 1e6;
                }
                steps.push(
                    { mv: this.#QUANTIFIER, min, max },
                    { mv: this.#ROOT }
                );
                i += match[0].length;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( c !== 0x5B /* [ */ ) {
                if ( mv === this.#UNDEFINED ) {
                    const step = steps.at(-1);
                    if ( step === undefined ) { return; }
                    const j = this.#compileExpr(query, step, i);
                    if ( j ) { i = j; }
                    break;
                }
                const r = this.#consumeUnquotedIdentifier(query, i);
                if  ( r === undefined ) { return; }
                steps.push({ mv, k: r.s });
                i = r.i;
                mv = this.#UNDEFINED;
                continue;
            }
            // Bracket accessor syntax
            if ( mv === this.#CHILDREN ) { return; }
            if ( query.startsWith('[?', i) ) {
                const not = query.charCodeAt(i+2) === 0x21 /* ! */ ? 1 : 0;
                const j = i + 2 + not;
                const r = this.#compile(query, j);
                if ( r === undefined ) { return; }
                if ( query.startsWith(']', r.i) === false ) { return; }
                if ( not ) { r.steps.at(-1).not = true; }
                steps.push({ mv: mv || this.#CHILDREN, steps: r.steps });
                i = r.i + 1;
                mv = this.#UNDEFINED;
                continue;
            }
            if ( query.startsWith('[*]', i) ) {
                mv ||= this.#CHILDREN;
                steps.push({ mv, k: '*' });
                i += 3;
                mv = this.#UNDEFINED;
                continue;
            }
            const r = this.#consumeIdentifier(query, i+1);
            if ( r === undefined ) { return; }
            mv ||= this.#CHILDREN;
            steps.push({ mv, k: r.s });
            i = r.i + 1;
            mv = this.#UNDEFINED;
        }
        if ( steps.length === 0 ) { return; }
        if ( mv !== this.#UNDEFINED ) { return; }
        return { steps, i };
    }
    #evaluate(steps, pathin) {
        let resultset = [];
        if ( Array.isArray(steps) === false ) { return resultset; }
        for ( const step of steps ) {
            switch ( step.mv ) {
            case this.#ROOT:
                resultset = [ [ '$' ] ];
                break;
            case this.#CURRENT:
                if ( step.op ) {
                    const { obj, key } = this.#resolvePath(pathin);
                    if ( obj === undefined ) { return []; }
                    const outcome = this.#evaluateExpr(step, obj, key);
                    if ( outcome !== true ) { break; }
                }
                resultset = [ pathin ];
                break;
            case this.#CHILDREN:
            case this.#DESCENDANTS: {
                if ( resultset.length === 0 ) { break; }
                resultset = this.#getMatches(resultset, step);
                break;
            }
            case this.#QUANTIFIER: {
                const { length } = resultset;
                if ( length < step.min || length > step.max ) { return []; }
                resultset = [];
                break;
            }
            default:
                break;
            }
        }
        return resultset;
    }
    #getMatches(listin, step) {
        const listout = [];
        for ( const pathin of listin ) {
            const { value: owner } = this.#resolvePath(pathin);
            if ( owner === undefined ) { continue; }
            if ( step.steps ) {
                this.#getMatchesFromExpr(pathin, step, owner, listout);
                continue;
            }
            const iter = this.#expandKey(owner, step.k);
            if ( iter ) {
                for ( const k of iter ) {
                    const outcome = this.#evaluateExpr(step, owner, k);
                    if ( outcome !== true ) { continue; }
                    listout.push([ ...pathin, k ]);
                }
            }
            if ( step.mv !== this.#DESCENDANTS ) { continue; }
            for ( const { obj, key, path } of this.#getDescendants(owner, true) ) {
                const iter = this.#expandKey(obj[key], step.k);
                if ( iter === undefined ) { continue; }
                for ( const k of iter ) {
                    const outcome = this.#evaluateExpr(step, obj[key], k);
                    if ( outcome !== true ) { continue; }
                    listout.push([ ...pathin, ...path, k ]);
                }
            }
        }
        return listout;
    }
    #expandKey(owner, k) {
        if ( typeof owner !== 'object' || owner === null ) { return; }
        if ( Array.isArray(k) ) {
            const out = [];
            for ( const a of k ) {
                const iter = this.#expandKey(owner, a);
                if ( iter === undefined ) { continue; }
                out.push(...iter);
            }
            return out;
        }
        if ( typeof k === 'number' ) {
            if ( Array.isArray(owner) === false ) { return; }
            return [ k >= 0 ? k : owner.length + k ];
        }
        if ( k === '*' ) {
            if ( Array.isArray(owner) ) { return owner.keys(); }
            return JSONPath.keys(owner);
        }
        if ( k instanceof JSONPath.Regex ) {
            const out = [];
            for ( const key of JSONPath.keys(owner) ) {
                if ( k.test(key) === false ) { continue; }
                out.push(key);
            }
            return out;
        }
        return [ k ];
    }
    #getMatchesFromExpr(pathin, step, owner, out) {
        const recursive = step.mv === this.#DESCENDANTS;
        const v2 = this.#compiled.v2 || recursive || Array.isArray(owner);
        for ( const { path } of this.#getDescendants(owner, recursive) ) {
            const q = v2 ? [ ...pathin, ...path ] : pathin;
            const r = this.#evaluate(step.steps, q);
            if ( Boolean(r?.length) === false ) { continue; }
            out.push(q);
            if ( v2 === false ) { break; }
        }
    }
    #getDescendants(v, recursive) {
        const iterator = {
            next() {
                const n = this.stack.length;
                if ( n === 0 ) {
                    this.value = undefined;
                    this.done = true;
                    return this;
                }
                const details = this.stack[n-1];
                const entry = details.keys.next();
                if ( entry.done ) {
                    this.stack.pop();
                    this.path.pop();
                    return this.next();
                }
                this.path[n-1] = entry.value;
                this.value = {
                    obj: details.obj,
                    key: entry.value,
                    path: this.path.slice(),
                };
                const v = this.value.obj[this.value.key];
                if ( recursive ) {
                    if ( Array.isArray(v) ) {
                        this.stack.push({ obj: v, keys: v.keys() });
                    } else if ( typeof v === 'object' && v !== null ) {
                        this.stack.push({ obj: v, keys: JSONPath.keys(v).values() });
                    }
                }
                return this;
            },
            path: [],
            value: undefined,
            done: false,
            stack: [],
            [Symbol.iterator]() { return this; },
        };
        if ( Array.isArray(v) ) {
            iterator.stack.push({ obj: v, keys: v.keys() });
        } else if ( typeof v === 'object' && v !== null ) {
            iterator.stack.push({ obj: v, keys: JSONPath.keys(v).values() });
        }
        return iterator;
    }
    #consumeIdentifier(query, i) {
        const keys = [];
        let needIdentifier = true;
        while ( i < query.length ) {
            const c0 = query.charCodeAt(i);
            if ( c0 === 0x5D /* ] */ ) { break; }
            if ( c0 === 0x20 /* SPACE */ ) {
                i += 1;
                continue;
            }
            if ( c0 === 0x2C /* , */ ) {
                if ( needIdentifier ) { return; }
                i += 1;
                needIdentifier = true;
                continue;
            }
            if ( c0 === 0x22 /* " */ || c0 === 0x27 /* ' */ ) {
                const r = this.#untilChar(query, c0, i+1);
                if ( r === undefined ) { return; }
                keys.push(r.s);
                i = r.i;
                needIdentifier = false;
                continue;
            }
            if ( c0 === 0x2D /* - */ || c0 >= 0x30 && c0 <= 0x39 ) {
                const match = this.#reIndice.exec(query.slice(i));
                if ( match === null ) { return; }
                const indice = parseInt(query.slice(i), 10);
                keys.push(indice);
                i += match[0].length;
                needIdentifier = false;
                continue;
            }
            if ( this.v2 ) { return; }
            const r = this.#consumeUnquotedIdentifier(query, i);
            if ( r === undefined ) { return; }
            keys.push(r.s);
            i = r.i;
        }
        if ( needIdentifier ) { return; }
        return { s: keys.length === 1 ? keys[0] : keys, i };
    }
    #consumeUnquotedIdentifier(query, i) {
        if ( query.charCodeAt(i) === 0x2F /* / */ ) {
            const r = this.#untilChar(query, 0x2F, i+1);
            if ( r === undefined ) { return; }
            let re;
            try { re = new JSONPath.Regex(r.s); } catch { return; }
            return { s: re, i: r.i };
        }
        const match = this.#reUnquotedIdentifier.exec(query.slice(i));
        if ( match === null ) { return; }
        return { s: match[0], i: i + match[0].length };
    }
    #untilChar(query, targetCharCode, i) {
        const len = query.length;
        const parts = [];
        let beg = i, end = i;
        for (;;) {
            if ( end === len ) { return; }
            const c = query.charCodeAt(end);
            if ( c === targetCharCode ) {
                parts.push(query.slice(beg, end));
                end += 1;
                break;
            }
            if ( c === 0x5C /* \ */ && (end+1) < len ) {
                const d = query.charCodeAt(end+1);
                if ( d === targetCharCode ) {
                    parts.push(query.slice(beg, end));
                    end += 1;
                    beg = end;
                }
            }
            end += 1;
        }
        return { s: parts.join(''), i: end };
    }
    #compileExpr(query, step, i) {
        if ( query.startsWith('=/', i) ) {
            const r = this.#untilChar(query, 0x2F /* / */, i+2);
            if ( r === undefined ) { return i; }
            const match = /^[i]/.exec(query.slice(r.i));
            try {
                step.rval = new JSONPath.Regex(r.s, match && match[0] || undefined);
            } catch { return; }
            step.op = 're';
            if ( match ) { r.i += match[0].length; }
            return r.i;
        }
        const match = this.#reExpr.exec(query.slice(i));
        if ( match === null ) { return; }
        const op = match[1], rval = match[2];
        if ( rval.charCodeAt(0) === 0x27 /* ' */ ) {
            const r = this.#untilChar(rval, 0x27, 1);
            if ( r === undefined ) { return; }
            step.rval = r.s;
            step.op = op;
        } else {
            try {
                step.rval = JSON.parse(rval);
                step.op = op;
            } catch { return; }
        }
        return i + match[0].length - 1;
    }
    #resolvePath(path) {
        if ( path.length === 0 ) { return { value: this.#root }; }
        const key = path.at(-1);
        let obj = this.#root
        for ( let i = 0, n = path.length-1; i < n; i++ ) {
            obj = obj[path[i]];
            if ( obj instanceof Object === false ) { return {}; }
        }
        return { obj, key, value: obj[key] };
    }
    #evaluateExpr(step, owner, k) {
        if ( owner === undefined || owner === null ) { return; }
        const hasOwn = owner[k] !== undefined || JSONPath.hasOwn(owner, k);
        if ( step.op !== undefined && hasOwn === false ) { return; }
        const target = step.not !== true;
        const v = owner[k];
        switch ( step.op ) {
        case '==': return (v === step.rval) === target;
        case '!=': return (v !== step.rval) === target;
        case  '<': return (v < step.rval) === target;
        case '<=': return (v <= step.rval) === target;
        case  '>': return (v > step.rval) === target;
        case '>=': return (v >= step.rval) === target;
        case '^=': return `${v}`.startsWith(step.rval) === target;
        case '$=': return `${v}`.endsWith(step.rval) === target;
        case '*=': return `${v}`.includes(step.rval) === target;
        case 're': return step.rval.test(`${v}`);
        default: break;
        }
        return hasOwn === target;
    }
    #modifyVal(obj, key) {
        let { modify, rval } = this.#compiled;
        if ( typeof rval === 'string' ) {
            rval = rval.replace('${now}', `${Date.now()}`);
        }
        switch ( modify ) {
        case undefined:
            obj[key] = rval;
            break;
        case '+': {
            if ( rval instanceof Object === false ) { return; }
            const lval = obj[key];
            if ( lval instanceof Object === false ) { return; }
            if ( Array.isArray(lval) ) { return; }
            for ( const [ k, v ] of JSONPath.entries(rval) ) {
                lval[k] = v;
            }
            break;
        }
        case 'call': {
            const entries = rval.slice();
            if ( entries.length < 2 ) { break; }
            entries.forEach((a, i, aa) => {
                if ( a === '${obj}' ) { aa[i] = obj; }
                else if ( a === '${key}' ) { aa[i] = key; }
                else if ( a === '${val}' ) { aa[i] = obj[key]; }
            });
            const instance = entries[0] ?? self;
            instance[entries[1]](...entries.slice(2));
            break;
        }
        case 'repl': {
            const lval = obj[key];
            if ( typeof lval !== 'string' ) { return; }
            if ( this.#compiled.re === undefined ) {
                this.#compiled.re = null;
                try {
                    this.#compiled.re = rval.regex !== undefined
                        ? new JSONPath.Regex(rval.regex, rval.flags)
                        : new JSONPath.Regex(rval.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                } catch { }
            }
            if ( this.#compiled.re === null ) { return; }
            obj[key] = lval.replace(this.#compiled.re, rval.replacement);
            break;
        }
        default:
            break;
        }
    }
}

return {JSONPath:JSONPath};
},5:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

function queueTask(func, timeout = 5000) {
    if ( typeof requestIdleCallback === 'undefined' ) {
        return setTimeout(func, 1);
    }

    return requestIdleCallback(func, { timeout });
}

function dropTask(id) {
    if ( typeof cancelIdleCallback === 'undefined' ) {
        return clearTimeout(id);
    }

    return cancelIdleCallback(id);
}

return {queueTask:queueTask,dropTask:dropTask};
},6:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2020-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

// Depends on:
// https://github.com/foo123/RegexAnalyzer
const RegexAnalyzer = globalThis.Regex && globalThis.Regex.Analyzer || null;

function isRE2(reStr) {
    if ( RegexAnalyzer === null ) { return true; }
    try {
        return _isRE2(RegexAnalyzer(reStr, false).tree());
    } catch {
    }
    return false;
}

function tokenizableStrFromRegex(reStr) {
    return _literalStrFromRegex(reStr);
}

function literalStrFromRegex(reStr) {
    let literals = tokenizableStrFromRegex(reStr)
        .split(/[\x00\x01]+/)
        .sort((a, b) => b.length - a.length);
    if ( literals.length > 1 ) {
        literals = literals.filter(a => (/^(\.?com|\.?net|www\.?)$/).test(a) === false);
    }
    return literals[0] || '';
}

/******************************************************************************/

function _isRE2(node) {
    if ( node instanceof Object === false ) { return true; }
    if ( node.flags instanceof Object ) {
        if ( node.flags.LookAhead === 1 ) { return false; }
        if ( node.flags.NegativeLookAhead === 1 ) { return false; }
        if ( node.flags.LookBehind === 1 ) { return false; }
        if ( node.flags.NegativeLookBehind === 1 ) { return false; }
    }
    if ( Array.isArray(node.val) ) {
        for ( const entry of node.val ) {
            if ( _isRE2(entry) === false ) { return false; }
        }
    }
    if ( node.val instanceof Object ) {
        return _isRE2(node.val);
    }
    return true;
}

/******************************************************************************/

function _literalStrFromRegex(reStr) {
    if ( RegexAnalyzer === null ) { return ''; }
    let s = '';
    try {
        s = tokenizableStrFromNode(
            RegexAnalyzer(reStr, false).tree()
        );
    } catch {
    }
    // Process optional sequences
    const reOptional = /[\x02\x03]+/;
    for (;;) {
        const match = reOptional.exec(s);
        if ( match === null ) { break; }
        const left = s.slice(0, match.index);
        const middle = match[0];
        const right = s.slice(match.index + middle.length);
        s = left;
        s += firstCharCodeClass(right) === 1 || firstCharCodeClass(middle) === 1
            ? '\x01'
            : '\x00';
        s += lastCharCodeClass(left) === 1 || lastCharCodeClass(middle) === 1
            ? '\x01'
            : '\x00';
        s += right;
    }
    return s;
}

function firstCharCodeClass(s) {
    if ( s.length === 0 ) { return 0; }
    const c = s.charCodeAt(0);
    if ( c === 1 || c === 3 ) { return 1; }
    return reCharCodeClass.test(s.charAt(0)) ? 1 : 0;
}

function lastCharCodeClass(s) {
    const i = s.length - 1;
    if ( i === -1 ) { return 0; }
    const c = s.charCodeAt(i);
    if ( c === 1 || c === 3 ) { return 1; }
    return reCharCodeClass.test(s.charAt(i)) ? 1 : 0;
}

const reCharCodeClass = /[%0-9A-Za-z]/;

function tokenizableStrFromNode(node) {
    switch ( node.type ) {
    case 1: /* T_SEQUENCE, 'Sequence' */ {
        let s = '';
        for ( let i = 0; i < node.val.length; i++ ) {
            s += tokenizableStrFromNode(node.val[i]);
        }
        return s;
    }
    case 2: /* T_ALTERNATION, 'Alternation' */
    case 8: /* T_CHARGROUP, 'CharacterGroup' */ {
        if ( node.flags.NegativeMatch ) { return '\x01'; }
        let firstChar = 0;
        let lastChar = 0;
        for ( let i = 0; i < node.val.length; i++ ) {
            const s = tokenizableStrFromNode(node.val[i]);
            if ( firstChar === 0 && firstCharCodeClass(s) === 1 ) {
                firstChar = 1;
            }
            if ( lastChar === 0 && lastCharCodeClass(s) === 1 ) {
                lastChar = 1;
            }
            if ( firstChar === 1 && lastChar === 1 ) { break; }
        }
        return String.fromCharCode(firstChar, lastChar);
    }
    case 4: /* T_GROUP, 'Group' */ {
        if (
            node.flags.NegativeLookAhead === 1 ||
            node.flags.NegativeLookBehind === 1
        ) {
            return '';
        }
        return tokenizableStrFromNode(node.val);
    }
    case 16: /* T_QUANTIFIER, 'Quantifier' */ {
        if ( node.flags.max === 0 ) { return ''; }
        const s = tokenizableStrFromNode(node.val);
        const first = firstCharCodeClass(s);
        const last = lastCharCodeClass(s);
        if ( node.flags.min !== 0 ) {
            return String.fromCharCode(first, last);
        }
        return String.fromCharCode(first+2, last+2);
    }
    case 64: /* T_HEXCHAR, 'HexChar' */ {
        if (
            node.flags.Code === '01' ||
            node.flags.Code === '02' ||
            node.flags.Code === '03'
        ) {
            return '\x00';
        }
        return node.flags.Char;
    }
    case 128: /* T_SPECIAL, 'Special' */ {
        const flags = node.flags;
        if (
            flags.EndCharGroup === 1 || // dangling `]`
            flags.EndGroup === 1 ||     // dangling `)`
            flags.EndRepeats === 1      // dangling `}`
        ) {
            throw new Error('Unmatched bracket');
        }
        return flags.MatchEnd === 1 ||
               flags.MatchStart === 1 ||
               flags.MatchWordBoundary === 1
            ? '\x00'
            : '\x01';
    }
    case 256: /* T_CHARS, 'Characters' */ {
        for ( let i = 0; i < node.val.length; i++ ) {
            if ( firstCharCodeClass(node.val[i]) === 1 ) {
                return '\x01';
            }
        }
        return '\x00';
    }
    // Ranges are assumed to always involve token-related characters.
    case 512: /* T_CHARRANGE, 'CharacterRange' */ {
        return '\x01';
    }
    case 1024: /* T_STRING, 'String' */ {
        return node.val;
    }
    case 2048: /* T_COMMENT, 'Comment' */ {
        return '';
    }
    default:
        break;
    }
    return '\x01';
}

/******************************************************************************/

function toHeaderPattern(reStr) {
    if ( RegexAnalyzer === null ) { return; }
    try {
        return _toHeaderPattern(RegexAnalyzer(reStr, false).tree());
    } catch {
    }
}

function _toHeaderPattern(branch, depth = 0) {
    switch ( branch.type ) {
    case 1: /* T_SEQUENCE, 'Sequence' */ {
        let s = '';
        for ( const node of branch.val ) {
            const t = _toHeaderPattern(node, depth+1);
            if ( t === undefined ) { return; }
            s += t;
        }
        if ( depth === 0 && branch.val.length !== 0 ) {
            const first = branch.val[0];
            if ( first.type !== 128 || first.val !== '^' ) { s = `*${s}`; }
            const last = branch.val.at(-1);
            if ( last.type !== 128 || last.val !== '$' ) { s = `${s}*`; }
        }
        return s;
    }
    case 4: /* T_GROUP, 'Group' */ {
        if (
            branch.flags.NegativeLookAhead === 1 ||
            branch.flags.NegativeLookBehind === 1
        ) {
            return;
        }
        return _toHeaderPattern(branch.val, depth+1);
    }
    case 64: /* T_HEXCHAR, 'HexChar' */
        return branch.flags.Char;
    case 128: /* T_SPECIAL, 'Special' */ {
        if ( branch.val === '^' ) { return ''; }
        if ( branch.val === '$' ) { return ''; }
        return;
    }
    case 1024: /* T_STRING, 'String' */
        return branch.val;
    case 2048: /* T_COMMENT, 'Comment' */
        return '';
    default:
        break;
    }
}

return {isRE2:isRE2,tokenizableStrFromRegex:tokenizableStrFromRegex,literalStrFromRegex:literalStrFromRegex,toHeaderPattern:toHeaderPattern};
},7:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2019-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/*******************************************************************************

  A BidiTrieContainer is mostly a large buffer in which distinct but related
  tries are stored. The memory layout of the buffer is as follow:

      0-8192: haystack section
   8192-8195: number of significant characters in the haystack
   8196-8199: offset to start of trie data section (=> trie0)
   8200-8203: offset to end of trie data section (=> trie1)
   8204-8207: offset to start of character data section  (=> char0)
   8208-8211: offset to end of character data section (=> char1)
   8212-8215: offset to left index result (=> result_l)
   8216-8219: offset to right index result (=> result_r)
   8220-8223: offset to extra unit result (=> result_iu)
        8224: start of trie data section

                  +--------------+
  Normal cell:    | And          |  If "Segment info" matches:
  (aka CELL)      +--------------+      Goto "And"
                  | Or           |  Else
                  +--------------+      Goto "Or"
                  | Segment info |
                  +--------------+

                  +--------------+
  Boundary cell:  | Right And    |  "Right And" and/or "Left And"
  (aka BCELL)     +--------------+  can be 0 in last-segment condition.
                  | Left And     |
                  +--------------+
                  | 0            |
                  +--------------+

  Given following filters and assuming token is "ad" for all of them:

    -images/ad-
    /google_ad.
    /images_ad.
    _images/ad.

  We get the following internal representation:

  +-----------+     +-----------+     +---+
  |           |---->|           |---->| 0 |
  +-----------+     +-----------+     +---+     +-----------+
  | 0         |  +--|           |     |   |---->| 0         |
  +-----------+  |  +-----------+     +---+     +-----------+
  | ad        |  |  | -         |     | 0 |     | 0         |
  +-----------+  |  +-----------+     +---+     +-----------+
                 |                              | -images/  |
                 |  +-----------+     +---+     +-----------+
                 +->|           |---->| 0 |
                    +-----------+     +---+     +-----------+     +-----------+
                    | 0         |     |   |---->|           |---->| 0         |
                    +-----------+     +---+     +-----------+     +-----------+
                    | .         |     | 0 |  +--|           |  +--|           |
                    +-----------+     +---+  |  +-----------+  |  +-----------+
                                             |  | _         |  |  | /google   |
                                             |  +-----------+  |  +-----------+
                                             |                 |
                                             |                 |  +-----------+
                                             |                 +->| 0         |
                                             |                    +-----------+
                                             |                    | 0         |
                                             |                    +-----------+
                                             |                    | /images   |
                                             |                    +-----------+
                                             |
                                             |  +-----------+
                                             +->| 0         |
                                                +-----------+
                                                | 0         |
                                                +-----------+
                                                | _images/  |
                                                +-----------+

*/

const VERSION = 2;
const PAGE_SIZE = 65536*2;
const HAYSTACK_START = 0;
const HAYSTACK_SIZE = 8192;                         //   i32 /   i8
const HAYSTACK_SIZE_SLOT = HAYSTACK_SIZE >>> 2;     //  2048 / 8192
const TRIE0_SLOT     = HAYSTACK_SIZE_SLOT + 1;      //  2049 / 8196
const TRIE1_SLOT     = HAYSTACK_SIZE_SLOT + 2;      //  2050 / 8200
const CHAR0_SLOT     = HAYSTACK_SIZE_SLOT + 3;      //  2051 / 8204
const CHAR1_SLOT     = HAYSTACK_SIZE_SLOT + 4;      //  2052 / 8208
const RESULT_L_SLOT  = HAYSTACK_SIZE_SLOT + 5;      //  2053 / 8212
const RESULT_R_SLOT  = HAYSTACK_SIZE_SLOT + 6;      //  2054 / 8216
const RESULT_IU_SLOT = HAYSTACK_SIZE_SLOT + 7;      //  2055 / 8220
const TRIE0_START    = HAYSTACK_SIZE_SLOT + 8 << 2; //         8224

const CELL_BYTE_LENGTH = 12;
const MIN_FREE_CELL_BYTE_LENGTH = CELL_BYTE_LENGTH * 8;

const CELL_AND = 0;
const CELL_OR = 1;
const SEGMENT_INFO = 2;
const BCELL_NEXT_AND = 0;
const BCELL_ALT_AND = 1;
const BCELL_EXTRA = 2;
const BCELL_EXTRA_MAX = 0x00FFFFFF;

const toSegmentInfo = (aL, l, r) => ((r - l) << 24) | (aL + l);
const roundToPageSize = v => (v + PAGE_SIZE-1) & ~(PAGE_SIZE-1);

// http://www.cse.yorku.ca/~oz/hash.html#djb2
const i32Checksum = (buf32) => {
    const n = buf32.length;
    let hash = 177573 ^ n;
    for ( let i = 0; i < n; i++ ) {
        hash = (hash << 5) + hash ^ buf32[i];
    }
    return hash;
};

class BidiTrieContainer {

    constructor(extraHandler) {
        const len = PAGE_SIZE * 4;
        this.buf8 = new Uint8Array(len);
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.buf32[TRIE0_SLOT] = TRIE0_START;
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR0_SLOT] = len >>> 1;
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
        this.extraHandler = extraHandler;
        this.textDecoder = null;
        this.wasmMemory = null;

        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    getHaystackLen() {
        return this.buf32[HAYSTACK_SIZE_SLOT];
    }

    setHaystackLen(v) {
        if ( v > HAYSTACK_SIZE ) {
            v = HAYSTACK_SIZE;
        }
        this.buf32[HAYSTACK_SIZE_SLOT] = v;
        return v;
    }

    reset() {
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    createTrie() {
        // grow buffer if needed
        if ( (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) < CELL_BYTE_LENGTH ) {
            this.growBuf(CELL_BYTE_LENGTH, 0);
        }
        const iroot = this.buf32[TRIE1_SLOT] >>> 2;
        this.buf32[TRIE1_SLOT] += CELL_BYTE_LENGTH;
        this.buf32[iroot+CELL_OR] = 0;
        this.buf32[iroot+CELL_AND] = 0;
        this.buf32[iroot+SEGMENT_INFO] = 0;
        return iroot;
    }

    matches(icell, ai) {
        const buf32 = this.buf32;
        const buf8 = this.buf8;
        const char0 = buf32[CHAR0_SLOT];
        const aR = buf32[HAYSTACK_SIZE_SLOT];
        let al = ai, x = 0, y = 0;
        for (;;) {
            x = buf8[al];
            al += 1;
            // find matching segment
            for (;;) {
                y = buf32[icell+SEGMENT_INFO];
                let bl = char0 + (y & 0x00FFFFFF);
                if ( buf8[bl] === x ) {
                    y = (y >>> 24) - 1;
                    if ( y !== 0 ) {
                        x = al + y;
                        if ( x > aR ) { return 0; }
                        for (;;) {
                            bl += 1;
                            if ( buf8[bl] !== buf8[al] ) { return 0; }
                            al += 1;
                            if ( al === x ) { break; }
                        }
                    }
                    break;
                }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return 0; }
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            x = buf32[icell+BCELL_EXTRA];
            if ( x <= BCELL_EXTRA_MAX ) {
                if ( x !== 0 && this.matchesExtra(ai, al, x) !== 0 ) {
                    return 1;
                }
                x = buf32[icell+BCELL_ALT_AND];
                if ( x !== 0 && this.matchesLeft(x, ai, al) !== 0 ) {
                    return 1;
                }
                icell = buf32[icell+BCELL_NEXT_AND];
                if ( icell === 0 ) { return 0; }
            }
            if ( al === aR ) { return 0; }
        }
        return 0; // eslint-disable-line no-unreachable
    }

    matchesLeft(icell, ar, r) {
        const buf32 = this.buf32;
        const buf8 = this.buf8;
        const char0 = buf32[CHAR0_SLOT];
        let x = 0, y = 0;
        for (;;) {
            if ( ar === 0 ) { return 0; }
            ar -= 1;
            x = buf8[ar];
            // find first segment with a first-character match
            for (;;) {
                y = buf32[icell+SEGMENT_INFO];
                let br = char0 + (y & 0x00FFFFFF);
                y = (y >>> 24) - 1;
                br += y;
                if ( buf8[br] === x ) { // all characters in segment must match
                    if ( y !== 0 ) {
                        x = ar - y;
                        if ( x < 0 ) { return 0; }
                        for (;;) {
                            ar -= 1; br -= 1;
                            if ( buf8[ar] !== buf8[br] ) { return 0; }
                            if ( ar === x ) { break; }
                        }
                    }
                    break;
                }
                icell = buf32[icell+CELL_OR];
                if ( icell === 0 ) { return 0; }
            }
            // next segment
            icell = buf32[icell+CELL_AND];
            x = buf32[icell+BCELL_EXTRA];
            if ( x <= BCELL_EXTRA_MAX ) {
                if ( x !== 0 && this.matchesExtra(ar, r, x) !== 0 ) {
                    return 1;
                }
                icell = buf32[icell+BCELL_NEXT_AND];
                if ( icell === 0 ) { return 0; }
            }
        }
        return 0; // eslint-disable-line no-unreachable
    }

    matchesExtra(l, r, ix) {
        let iu = 0;
        if ( ix !== 1 ) {
            iu = this.extraHandler(l, r, ix);
            if ( iu === 0 ) { return 0; }
        } else {
            iu = -1;
        }
        this.buf32[RESULT_IU_SLOT] = iu;
        this.buf32[RESULT_L_SLOT] = l;
        this.buf32[RESULT_R_SLOT] = r;
        return 1;
    }

    get $l() { return this.buf32[RESULT_L_SLOT] | 0; }
    get $r() { return this.buf32[RESULT_R_SLOT] | 0; }
    get $iu() { return this.buf32[RESULT_IU_SLOT] | 0; }

    add(iroot, aL0, n, pivot = 0) {
        const aR = n;
        if ( aR === 0 ) { return 0; }
        // Grow buffer if needed. The characters are already in our character
        // data buffer, so we do not need to grow character data buffer.
        if (
            (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) <
                MIN_FREE_CELL_BYTE_LENGTH
        ) {
            this.growBuf(MIN_FREE_CELL_BYTE_LENGTH, 0);
        }
        const buf32 = this.buf32;
        const char0 = buf32[CHAR0_SLOT];
        let icell = iroot;
        let aL = char0 + aL0;
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = toSegmentInfo(aL0, pivot, aR);
            return this.addLeft(icell, aL0, pivot);
        }
        const buf8 = this.buf8;
        let al = pivot;
        let inext;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // length of segment
            const bR = binfo >>> 24;
            // skip boundary cells
            if ( bR === 0 ) {
                icell = buf32[icell+BCELL_NEXT_AND];
                continue;
            }
            let bl = char0 + (binfo & 0x00FFFFFF);
            // if first character is no match, move to next descendant
            if ( buf8[bl] !== buf8[aL+al] ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    inext = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
                    buf32[icell+CELL_OR] = inext;
                    return this.addLeft(inext, aL0, pivot);
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            let bi = 1;
            al += 1;
            // find 1st mismatch in rest of segment
            if ( bR !== 1 ) {
                for (;;) {
                    if ( bi === bR ) { break; }
                    if ( al === aR ) { break; }
                    if ( buf8[bl+bi] !== buf8[aL+al] ) { break; }
                    bi += 1;
                    al += 1;
                }
            }
            // all segment characters matched
            if ( bi === bR ) {
                // needle remainder: no
                if ( al === aR ) {
                    return this.addLeft(icell, aL0, pivot);
                }
                // needle remainder: yes
                inext = buf32[icell+CELL_AND];
                if ( buf32[inext+CELL_AND] !== 0 ) {
                    icell = inext;
                    continue;
                }
                // add needle remainder
                icell = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
                buf32[inext+CELL_AND] = icell;
                return this.addLeft(icell, aL0, pivot);
            }
            // some characters matched
            // split current segment
            bl -= char0;
            buf32[icell+SEGMENT_INFO] = bi << 24 | bl;
            inext = this.addCell(
                buf32[icell+CELL_AND], 0, bR - bi << 24 | bl + bi
            );
            buf32[icell+CELL_AND] = inext;
            // needle remainder: no = need boundary cell
            if ( al === aR ) {
                return this.addLeft(icell, aL0, pivot);
            }
            // needle remainder: yes = need new cell for remaining characters
            icell = this.addCell(0, 0, toSegmentInfo(aL0, al, aR));
            buf32[inext+CELL_OR] = icell;
            return this.addLeft(icell, aL0, pivot);
        }
    }

    addLeft(icell, aL0, pivot) {
        const buf32 = this.buf32;
        const char0 = buf32[CHAR0_SLOT];
        let aL = aL0 + char0;
        // fetch boundary cell
        let iboundary = buf32[icell+CELL_AND];
        // add boundary cell if none exist
        if (
            iboundary === 0 ||
            buf32[iboundary+SEGMENT_INFO] > BCELL_EXTRA_MAX
        ) {
            const inext = iboundary;
            iboundary = this.allocateCell();
            buf32[icell+CELL_AND] = iboundary;
            buf32[iboundary+BCELL_NEXT_AND] = inext;
            if ( pivot === 0 ) { return iboundary; }
        }
        // shortest match with no extra conditions will always win
        if ( buf32[iboundary+BCELL_EXTRA] === 1 ) {
            return iboundary;
        }
        // bail out if no left segment
        if ( pivot === 0 ) { return iboundary; }
        // fetch root cell of left segment
        icell = buf32[iboundary+BCELL_ALT_AND];
        if ( icell === 0 ) {
            icell = this.allocateCell();
            buf32[iboundary+BCELL_ALT_AND] = icell;
        }
        // special case: first node in trie
        if ( buf32[icell+SEGMENT_INFO] === 0 ) {
            buf32[icell+SEGMENT_INFO] = toSegmentInfo(aL0, 0, pivot);
            iboundary = this.allocateCell();
            buf32[icell+CELL_AND] = iboundary;
            return iboundary;
        }
        const buf8 = this.buf8;
        let ar = pivot, inext;
        // find a matching cell: move down
        for (;;) {
            const binfo = buf32[icell+SEGMENT_INFO];
            // skip boundary cells
            if ( binfo <= BCELL_EXTRA_MAX ) {
                inext = buf32[icell+CELL_AND];
                if ( inext !== 0 ) {
                    icell = inext;
                    continue;
                }
                iboundary = this.allocateCell();
                buf32[icell+CELL_AND] =
                    this.addCell(iboundary, 0, toSegmentInfo(aL0, 0, ar));
                // TODO: boundary cell might be last
                // add remainder + boundary cell
                return iboundary;
            }
            const bL = char0 + (binfo & 0x00FFFFFF);
            const bR = bL + (binfo >>> 24);
            let br = bR;
            // if first character is no match, move to next descendant
            if ( buf8[br-1] !== buf8[aL+ar-1] ) {
                inext = buf32[icell+CELL_OR];
                if ( inext === 0 ) {
                    iboundary = this.allocateCell();
                    inext = this.addCell(
                        iboundary, 0, toSegmentInfo(aL0, 0, ar)
                    );
                    buf32[icell+CELL_OR] = inext;
                    return iboundary;
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            br -= 1;
            ar -= 1;
            // find 1st mismatch in rest of segment
            if ( br !== bL ) {
                for (;;) {
                    if ( br === bL ) { break; }
                    if ( ar === 0 ) { break; }
                    if ( buf8[br-1] !== buf8[aL+ar-1] ) { break; }
                    br -= 1;
                    ar -= 1;
                }
            }
            // all segment characters matched
            // a:     ...vvvvvvv
            // b:        vvvvvvv
            if ( br === bL ) {
                inext = buf32[icell+CELL_AND];
                // needle remainder: no
                // a:        vvvvvvv
                // b:        vvvvvvv
                // r: 0 & vvvvvvv
                if ( ar === 0 ) {
                    // boundary cell already present
                    if ( buf32[inext+BCELL_EXTRA] <= BCELL_EXTRA_MAX ) {
                        return inext;
                    }
                    // need boundary cell
                    iboundary = this.allocateCell();
                    buf32[iboundary+CELL_AND] = inext;
                    buf32[icell+CELL_AND] = iboundary;
                    return iboundary;
                }
                // needle remainder: yes
                // a: yyyyyyyvvvvvvv
                // b:        vvvvvvv
                else {
                    if ( inext !== 0 ) {
                        icell = inext;
                        continue;
                    }
                    // TODO: we should never reach here because there will
                    // always be a boundary cell.
                    // eslint-disable-next-line no-debugger
                    debugger; // jshint ignore:line
                    // boundary cell + needle remainder
                    inext = this.addCell(0, 0, 0);
                    buf32[icell+CELL_AND] = inext;
                    buf32[inext+CELL_AND] =
                        this.addCell(0, 0, toSegmentInfo(aL0, 0, ar));
                }
            }
            // some segment characters matched
            // a:     ...vvvvvvv
            // b: yyyyyyyvvvvvvv
            else {
                // split current cell
                buf32[icell+SEGMENT_INFO] = (bR - br) << 24 | (br - char0);
                inext = this.addCell(
                    buf32[icell+CELL_AND],
                    0,
                    (br - bL) << 24 | (bL - char0)
                );
                // needle remainder: no = need boundary cell
                // a:        vvvvvvv
                // b: yyyyyyyvvvvvvv
                // r: yyyyyyy & 0 & vvvvvvv
                if ( ar === 0 ) {
                    iboundary = this.allocateCell();
                    buf32[icell+CELL_AND] = iboundary;
                    buf32[iboundary+CELL_AND] = inext;
                    return iboundary;
                }
                // needle remainder: yes = need new cell for remaining
                // characters
                // a:    wwwwvvvvvvv
                // b: yyyyyyyvvvvvvv
                // r: (0 & wwww | yyyyyyy) & vvvvvvv
                else {
                    buf32[icell+CELL_AND] = inext;
                    iboundary = this.allocateCell();
                    buf32[inext+CELL_OR] = this.addCell(
                        iboundary, 0, toSegmentInfo(aL0, 0, ar)
                    );
                    return iboundary;
                }
            }
            //debugger; // jshint ignore:line
        }
    }

    getExtra(iboundary) {
        return this.buf32[iboundary+BCELL_EXTRA];
    }

    setExtra(iboundary, v) {
        this.buf32[iboundary+BCELL_EXTRA] = v;
    }

    optimize() {
        this.shrinkBuf();
    }

    toSelfie() {
        const buf32 = this.buf32.subarray(0, this.buf32[CHAR1_SLOT] + 3 >>> 2);
        return {
            version: VERSION,
            buf32,
            checksum: i32Checksum(buf32),
        };
    }

    fromSelfie(selfie) {
        if ( typeof selfie !== 'object' || selfie === null ) { return false; }
        if ( selfie.version !== VERSION ) { return false; }
        if ( selfie.buf32 instanceof Uint32Array === false ) { return false; }
        if ( selfie.checksum !== i32Checksum(selfie.buf32) ) { return false; }
        const byteLength = selfie.buf32.length << 2;
        if ( byteLength === 0 ) { return false; }
        this.reallocateBuf(byteLength);
        this.buf32.set(selfie.buf32);
        return true;
    }

    storeString(s) {
        const n = s.length;
        if ( n === this.lastStoredLen && s === this.lastStored ) {
            return this.lastStoredIndex;
        }
        this.lastStored = s;
        this.lastStoredLen = n;
        if ( (this.buf8.length - this.buf32[CHAR1_SLOT]) < n ) {
            this.growBuf(0, n);
        }
        const offset = this.buf32[CHAR1_SLOT];
        this.buf32[CHAR1_SLOT] = offset + n;
        const buf8 = this.buf8;
        for ( let i = 0; i < n; i++ ) {
            buf8[offset+i] = s.charCodeAt(i);
        }
        return (this.lastStoredIndex = offset - this.buf32[CHAR0_SLOT]);
    }

    extractString(i, n) {
        if ( this.textDecoder === null ) {
            this.textDecoder = new TextDecoder();
        }
        const offset = this.buf32[CHAR0_SLOT] + i;
        return this.textDecoder.decode(
            this.buf8.subarray(offset, offset + n)
        );
    }

    // WASMable.
    startsWith(haystackLeft, haystackRight, needleLeft, needleLen) {
        if ( haystackLeft < 0 || (haystackLeft + needleLen) > haystackRight ) {
            return 0;
        }
        const charCodes = this.buf8;
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        while ( charCodes[haystackLeft] === charCodes[needleLeft] ) {
            needleLeft += 1;
            if ( needleLeft === needleRight ) { return 1; }
            haystackLeft += 1;
        }
        return 0;
    }

    // Find the left-most instance of substring in main string
    // WASMable.
    indexOf(haystackLeft, haystackEnd, needleLeft, needleLen) {
        if ( needleLen === 0 ) { return haystackLeft; }
        haystackEnd -= needleLen;
        if ( haystackEnd < haystackLeft ) { return -1; }
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        const charCodes = this.buf8;
        for (;;) {
            let i = haystackLeft;
            let j = needleLeft;
            while ( charCodes[i] === charCodes[j] ) {
                j += 1;
                if ( j === needleRight ) { return haystackLeft; }
                i += 1;
            }
            haystackLeft += 1;
            if ( haystackLeft > haystackEnd ) { break; }
        }
        return -1;
    }

    // Find the right-most instance of substring in main string.
    // WASMable.
    lastIndexOf(haystackBeg, haystackEnd, needleLeft, needleLen) {
        if ( needleLen === 0 ) { return haystackBeg; }
        let haystackLeft = haystackEnd - needleLen;
        if ( haystackLeft < haystackBeg ) { return -1; }
        needleLeft += this.buf32[CHAR0_SLOT];
        const needleRight = needleLeft + needleLen;
        const charCodes = this.buf8;
        for (;;) {
            let i = haystackLeft;
            let j = needleLeft;
            while ( charCodes[i] === charCodes[j] ) {
                j += 1;
                if ( j === needleRight ) { return haystackLeft; }
                i += 1;
            }
            if ( haystackLeft === haystackBeg ) { break; }
            haystackLeft -= 1;
        }
        return -1;
    }

    dumpTrie(iroot) {
        for ( const s of this.trieIterator(iroot) ) {
            console.log(s);
        }
    }

    trieIterator(iroot) {
        return {
            value: undefined,
            done: false,
            next() {
                if ( this.icell === 0 ) {
                    if ( this.forks.length === 0 ) {
                        this.value = undefined;
                        this.done = true;
                        return this;
                    }
                    this.pattern = this.forks.pop();
                    this.dir = this.forks.pop();
                    this.icell = this.forks.pop();
                }
                const buf32 = this.container.buf32;
                const buf8 = this.container.buf8;
                for (;;) {
                    const ialt = buf32[this.icell+CELL_OR];
                    const v = buf32[this.icell+SEGMENT_INFO];
                    const offset = v & 0x00FFFFFF;
                    let i0 = buf32[CHAR0_SLOT] + offset;
                    const len = v >>> 24;
                    for ( let i = 0; i < len; i++ ) {
                        this.charBuf[i] = buf8[i0+i];
                    }
                    if ( len !== 0 && ialt !== 0 ) {
                        this.forks.push(ialt, this.dir, this.pattern);
                    }
                    const inext = buf32[this.icell+CELL_AND];
                    if ( len !== 0 ) {
                        const s = this.textDecoder.decode(
                            new Uint8Array(this.charBuf.buffer, 0, len)
                        );
                        if ( this.dir > 0 ) {
                            this.pattern += s;
                        } else if ( this.dir < 0 ) {
                            this.pattern = s + this.pattern;
                        }
                    }
                    this.icell = inext;
                    if ( len !== 0 ) { continue; }
                    // boundary cell
                    if ( ialt !== 0 ) {
                        if ( inext === 0 ) {
                            this.icell = ialt;
                            this.dir = -1;
                        } else {
                            this.forks.push(ialt, -1, this.pattern);
                        }
                    }
                    if ( offset !== 0 ) {
                        this.value = { pattern: this.pattern, iextra: offset };
                        return this;
                    }
                }
            },
            container: this,
            icell: iroot,
            charBuf: new Uint8Array(256),
            pattern: '',
            dir: 1,
            forks: [],
            textDecoder: new TextDecoder(),
            [Symbol.iterator]() { return this; },
        };
    }

    async enableWASM(wasmModuleFetcher, path) {
        if ( typeof WebAssembly !== 'object' ) { return false; }
        if ( this.wasmMemory instanceof WebAssembly.Memory ) { return true; }
        const module = await getWasmModule(wasmModuleFetcher, path);
        if ( module instanceof WebAssembly.Module === false ) { return false; }
        const memory = new WebAssembly.Memory({
            initial: roundToPageSize(this.buf8.length) >>> 16
        });
        const instance = await WebAssembly.instantiate(module, {
            imports: { memory, extraHandler: this.extraHandler }
        });
        if ( instance instanceof WebAssembly.Instance === false ) {
            return false;
        }
        this.wasmMemory = memory;
        const curPageCount = memory.buffer.byteLength >>> 16;
        const newPageCount = roundToPageSize(this.buf8.byteLength) >>> 16;
        if ( newPageCount > curPageCount ) {
            memory.grow(newPageCount - curPageCount);
        }
        const buf8 = new Uint8Array(memory.buffer);
        buf8.set(this.buf8);
        this.buf8 = buf8;
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
        this.matches = instance.exports.matches;
        this.startsWith = instance.exports.startsWith;
        this.indexOf = instance.exports.indexOf;
        this.lastIndexOf = instance.exports.lastIndexOf;
        return true;
    }

    dumpInfo() {
        return [
            `Buffer size (Uint8Array): ${this.buf32[CHAR1_SLOT].toLocaleString('en')}`,
            `WASM: ${this.wasmMemory === null ? 'disabled' : 'enabled'}`,
        ].join('\n');
    }

    //--------------------------------------------------------------------------
    // Private methods
    //--------------------------------------------------------------------------

    allocateCell() {
        let icell = this.buf32[TRIE1_SLOT];
        this.buf32[TRIE1_SLOT] = icell + CELL_BYTE_LENGTH;
        icell >>>= 2;
        this.buf32[icell+0] = 0;
        this.buf32[icell+1] = 0;
        this.buf32[icell+2] = 0;
        return icell;
    }

    addCell(iand, ior, v) {
        const icell = this.allocateCell();
        this.buf32[icell+CELL_AND] = iand;
        this.buf32[icell+CELL_OR] = ior;
        this.buf32[icell+SEGMENT_INFO] = v;
        return icell;
    }

    growBuf(trieGrow, charGrow) {
        const char0 = Math.max(
            roundToPageSize(this.buf32[TRIE1_SLOT] + trieGrow),
            this.buf32[CHAR0_SLOT]
        );
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = Math.max(
            roundToPageSize(char1 + charGrow),
            this.buf8.length
        );
        if ( bufLen > this.buf8.length ) {
            this.reallocateBuf(bufLen);
        }
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf8.copyWithin(
                char0,
                this.buf32[CHAR0_SLOT],
                this.buf32[CHAR1_SLOT]
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char1;
        }
    }

    shrinkBuf() {
        const char0 = this.buf32[TRIE1_SLOT] + MIN_FREE_CELL_BYTE_LENGTH;
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = char1 + 256;
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf8.copyWithin(
                char0,
                this.buf32[CHAR0_SLOT],
                this.buf32[CHAR1_SLOT]
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char1;
        }
        if ( bufLen < this.buf8.length ) {
            this.reallocateBuf(bufLen);
        }
    }

    reallocateBuf(newSize) {
        newSize = roundToPageSize(newSize);
        if ( newSize === this.buf8.length ) { return; }
        if ( this.wasmMemory === null ) {
            const newBuf = new Uint8Array(newSize);
            newBuf.set(
                newBuf.length < this.buf8.length
                    ? this.buf8.subarray(0, newBuf.length)
                    : this.buf8
            );
            this.buf8 = newBuf;
        } else {
            const growBy =
                ((newSize + 0xFFFF) >>> 16) - (this.buf8.length >>> 16);
            if ( growBy <= 0 ) { return; }
            this.wasmMemory.grow(growBy);
            this.buf8 = new Uint8Array(this.wasmMemory.buffer);
        }
        this.buf32 = new Uint32Array(this.buf8.buffer);
        this.haystack = this.buf8.subarray(
            HAYSTACK_START,
            HAYSTACK_START + HAYSTACK_SIZE
        );
    }
}

/******************************************************************************/

// Code below is to attempt to load a WASM module which implements:
//
// - BidiTrieContainer.startsWith()
//
// The WASM module is entirely optional, the JS implementations will be
// used should the WASM module be unavailable for whatever reason.

const getWasmModule = (( ) => {
    let wasmModulePromise;

    return async function(wasmModuleFetcher, path) {
        if ( wasmModulePromise instanceof Promise ) {
            return wasmModulePromise;
        }

        if ( typeof WebAssembly !== 'object' ) { return; }

        // Soft-dependency on vAPI so that the code here can be used outside of
        // uBO (i.e. tests, benchmarks)
        if ( typeof vAPI === 'object' && vAPI.canWASM !== true ) { return; }

        // The wasm module will work only if CPU is natively little-endian,
        // as we use native uint32 array in our js code.
        const uint32s = new Uint32Array(1);
        const uint8s = new Uint8Array(uint32s.buffer);
        uint32s[0] = 1;
        if ( uint8s[0] !== 1 ) { return; }

        wasmModulePromise = wasmModuleFetcher(`${path}biditrie`).catch(reason => {
            console.info(reason);
        });

        return wasmModulePromise;
    };
})();

/******************************************************************************/

const __default = BidiTrieContainer;

return {default:__default};
},8:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

// https://www.reddit.com/r/uBlockOrigin/comments/oq6kt5/ubo_loads_generic_filter_instead_of_specific/
//   Ensure blocks of content are sorted in ascending id order, such that the
//   specific cosmetic filters will be found (and thus reported) before the
//   generic ones.

const serialize = JSON.stringify;
const unserialize = JSON.parse;

const blockStartPrefix = '#block-start-';  // ensure no special regex characters
const blockEndPrefix = '#block-end-';      // ensure no special regex characters

class CompiledListWriter {
    constructor() {
        this.blockId = undefined;
        this.block = undefined;
        this.blocks = new Map();
        this.properties = new Map();
    }
    push(args) {
        this.block.push(serialize(args));
    }
    pushMany(many) {
        for ( const args of many ) {
            this.block.push(serialize(args));
        }
    }
    last() {
        if ( Array.isArray(this.block) && this.block.length !== 0 ) {
            return this.block[this.block.length - 1];
        }
    }
    select(blockId) {
        if ( blockId === this.blockId ) { return; }
        this.blockId = blockId;
        this.block = this.blocks.get(blockId);
        if ( this.block === undefined ) {
            this.blocks.set(blockId, (this.block = []));
        }
        return this;
    }
    toString() {
        const result = [];
        const sortedBlocks =
            Array.from(this.blocks).sort((a, b) => a[0] - b[0]);
        for ( const [ id, lines ] of sortedBlocks ) {
            if ( lines.length === 0 ) { continue; }
            result.push(
                blockStartPrefix + id,
                lines.join('\n'),
                blockEndPrefix + id
            );
        }
        return result.join('\n');
    }
    static serialize(arg) {
        return serialize(arg);
    }
}

class CompiledListReader {
    constructor(raw, blockId) {
        this.block = '';
        this.len = 0;
        this.offset = 0;
        this.line = '';
        this.blocks = new Map();
        this.properties = new Map();
        const reBlockStart = new RegExp(`^${blockStartPrefix}([\\w:]+)\\n`, 'gm');
        let match = reBlockStart.exec(raw);
        while ( match !== null ) {
            const sectionId = match[1];
            const beg = match.index + match[0].length;
            const end = raw.indexOf(blockEndPrefix + sectionId, beg);
            this.blocks.set(sectionId, raw.slice(beg, end));
            reBlockStart.lastIndex = end;
            match = reBlockStart.exec(raw);
        }
        if ( blockId !== undefined ) {
            this.select(blockId);
        }
    }
    next() {
        if ( this.offset === this.len ) {
            this.line = '';
            return false;
        }
        let pos = this.block.indexOf('\n', this.offset);
        if ( pos !== -1 ) {
            this.line = this.block.slice(this.offset, pos);
            this.offset = pos + 1;
        } else {
            this.line = this.block.slice(this.offset);
            this.offset = this.len;
        }
        return true;
    }
    select(blockId) {
        this.block = this.blocks.get(blockId) || '';
        this.len = this.block.length;
        this.offset = 0;
        return this;
    }
    fingerprint() {
        return this.line;
    }
    args() {
        return unserialize(this.line);
    }
    static unserialize(arg) {
        return unserialize(arg);
    }
}

/******************************************************************************/



return {CompiledListReader:CompiledListReader,CompiledListWriter:CompiledListWriter};
},9:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2018-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

const {
    domainFromHostname,
    hostnameFromURI,
    originFromURI,
} = require(10);

/******************************************************************************/

// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType

// Long term, convert code wherever possible to work with integer-based type
// values -- the assumption being that integer operations are faster than
// string operations.

const NO_TYPE = 0;
const BEACON = 1 <<  0;
const CSP_REPORT = 1 <<  1;
const FONT = 1 <<  2;
const IMAGE = 1 <<  4;
const IMAGESET = 1 <<  4;
const MAIN_FRAME = 1 <<  5;
const MEDIA = 1 <<  6;
const OBJECT = 1 <<  7;
const OBJECT_SUBREQUEST = 1 <<  7;
const PING = 1 <<  8;
const SCRIPT = 1 <<  9;
const STYLESHEET = 1 << 10;
const SUB_FRAME = 1 << 11;
const WEBSOCKET = 1 << 12;
const XMLHTTPREQUEST = 1 << 13;
const INLINE_FONT = 1 << 14;
const INLINE_SCRIPT = 1 << 15;
const OTHER = 1 << 16;
const FRAME_ANY = MAIN_FRAME | SUB_FRAME | OBJECT;
const FONT_ANY = FONT | INLINE_FONT;
const INLINE_ANY = INLINE_FONT | INLINE_SCRIPT;
const PING_ANY = BEACON | CSP_REPORT | PING;
const SCRIPT_ANY = SCRIPT | INLINE_SCRIPT;

const typeStrToIntMap = {
           'no_type': NO_TYPE,
            'beacon': BEACON,
        'csp_report': CSP_REPORT,
              'font': FONT,
             'image': IMAGE,
          'imageset': IMAGESET,
        'main_frame': MAIN_FRAME,
             'media': MEDIA,
            'object': OBJECT,
 'object_subrequest': OBJECT_SUBREQUEST,
              'ping': PING,
            'script': SCRIPT,
        'stylesheet': STYLESHEET,
         'sub_frame': SUB_FRAME,
         'websocket': WEBSOCKET,
    'xmlhttprequest': XMLHTTPREQUEST,
       'inline-font': INLINE_FONT,
     'inline-script': INLINE_SCRIPT,
             'other': OTHER,
};

const METHOD_NONE = 0;
const METHOD_CONNECT = 1 << 1;
const METHOD_DELETE = 1 << 2;
const METHOD_GET = 1 << 3;
const METHOD_HEAD = 1 << 4;
const METHOD_OPTIONS = 1 << 5;
const METHOD_PATCH = 1 << 6;
const METHOD_POST = 1 << 7;
const METHOD_PUT = 1 << 8;

const methodStrToBitMap = {
           '': METHOD_NONE,
    'connect': METHOD_CONNECT,
     'delete': METHOD_DELETE,
        'get': METHOD_GET,
       'head': METHOD_HEAD,
    'options': METHOD_OPTIONS,
      'patch': METHOD_PATCH,
       'post': METHOD_POST,
        'put': METHOD_PUT,
    'CONNECT': METHOD_CONNECT,
     'DELETE': METHOD_DELETE,
        'GET': METHOD_GET,
       'HEAD': METHOD_HEAD,
    'OPTIONS': METHOD_OPTIONS,
      'PATCH': METHOD_PATCH,
       'POST': METHOD_POST,
        'PUT': METHOD_PUT,
};

const methodBitToStrMap = new Map([
    [ METHOD_NONE, '' ],
    [ METHOD_CONNECT, 'connect' ],
    [ METHOD_DELETE, 'delete' ],
    [ METHOD_GET, 'get' ],
    [ METHOD_HEAD, 'head' ],
    [ METHOD_OPTIONS, 'options' ],
    [ METHOD_PATCH, 'patch' ],
    [ METHOD_POST, 'post' ],
    [ METHOD_PUT, 'put' ],
]);

const reIPv4 = /^\d+\.\d+\.\d+\.\d+$/;

/******************************************************************************/

const FilteringContext = class {
    constructor(other) {
        if ( other instanceof FilteringContext ) {
            return this.fromFilteringContext(other);
        }
        this.tstamp = 0;
        this.realm = '';
        this.method = 0;
        this.itype = NO_TYPE;
        this.stype = undefined;
        this.url = undefined;
        this.aliasURL = undefined;
        this.hostname = undefined;
        this.domain = undefined;
        this.ipaddress = undefined;
        this.docId = -1;
        this.frameId = -1;
        this.docOrigin = undefined;
        this.docHostname = undefined;
        this.docDomain = undefined;
        this.tabId = undefined;
        this.tabOrigin = undefined;
        this.tabHostname = undefined;
        this.tabDomain = undefined;
        this.redirectURL = undefined;
        this.filter = undefined;
    }

    get type() {
        return this.stype;
    }

    set type(a) {
        this.itype = typeStrToIntMap[a] || NO_TYPE;
        this.stype = a;
    }

    isRootDocument() {
        return (this.itype & MAIN_FRAME) !== 0;
    }
    isDocument() {
        return (this.itype & FRAME_ANY) !== 0;
    }

    isFont() {
        return (this.itype & FONT_ANY) !== 0;
    }

    fromFilteringContext(other) {
        this.realm = other.realm;
        this.type = other.type;
        this.method = other.method;
        this.url = other.url;
        this.hostname = other.hostname;
        this.domain = other.domain;
        this.ipaddress = other.ipaddress;
        this.docId = other.docId;
        this.frameId = other.frameId;
        this.docOrigin = other.docOrigin;
        this.docHostname = other.docHostname;
        this.docDomain = other.docDomain;
        this.tabId = other.tabId;
        this.tabOrigin = other.tabOrigin;
        this.tabHostname = other.tabHostname;
        this.tabDomain = other.tabDomain;
        this.redirectURL = other.redirectURL;
        this.filter = undefined;
        return this;
    }

    fromDetails({ originURL, url, type }) {
        this.setDocOriginFromURL(originURL)
            .setURL(url)
            .setType(type);
        return this;
    }

    duplicate() {
        return (new FilteringContext(this));
    }

    setRealm(a) {
        this.realm = a;
        return this;
    }

    setType(a) {
        this.type = a;
        return this;
    }

    setURL(a) {
        if ( a !== this.url ) {
            this.hostname = this.domain = this.ipaddress = undefined;
            this.url = a;
        }
        return this;
    }

    getHostname() {
        if ( this.hostname === undefined ) {
            this.hostname = hostnameFromURI(this.url);
        }
        return this.hostname;
    }

    setHostname(a) {
        if ( a !== this.hostname ) {
            this.domain = undefined;
            this.hostname = a;
        }
        return this;
    }

    getDomain() {
        if ( this.domain === undefined ) {
            this.domain = domainFromHostname(this.getHostname());
        }
        return this.domain;
    }

    setDomain(a) {
        this.domain = a;
        return this;
    }

    getIPAddress() {
        if ( this.ipaddress !== undefined ) {
            return this.ipaddress;
        }
        const ipaddr = this.getHostname();
        const c0 = ipaddr.charCodeAt(0);
        if ( c0 === 0x5B /* [ */ ) {
            return (this.ipaddress = ipaddr.slice(1, -1));
        } else if ( c0 <= 0x39 && c0 >= 0x30 ) {
            if ( reIPv4.test(ipaddr) ) {
                return (this.ipaddress = ipaddr);
            }
        }
        return (this.ipaddress = '');
    }

    // Must always be called *after* setURL()
    setIPAddress(ipaddr) {
        this.ipaddress = ipaddr || undefined;
        return this;
    }

    getDocOrigin() {
        if ( this.docOrigin === undefined ) {
            this.docOrigin = this.tabOrigin;
        }
        return this.docOrigin;
    }

    setDocOrigin(a) {
        if ( a !== this.docOrigin ) {
            this.docHostname = this.docDomain = undefined;
            this.docOrigin = a;
        }
        return this;
    }

    setDocOriginFromURL(a) {
        return this.setDocOrigin(originFromURI(a));
    }

    getDocHostname() {
        if ( this.docHostname === undefined ) {
            this.docHostname = hostnameFromURI(this.getDocOrigin());
        }
        return this.docHostname;
    }

    setDocHostname(a) {
        if ( a !== this.docHostname ) {
            this.docDomain = undefined;
            this.docHostname = a;
        }
        return this;
    }

    getDocDomain() {
        if ( this.docDomain === undefined ) {
            this.docDomain = domainFromHostname(this.getDocHostname());
        }
        return this.docDomain;
    }

    setDocDomain(a) {
        this.docDomain = a;
        return this;
    }

    // The idea is to minimize the amount of work done to figure out whether
    // the resource is 3rd-party to the document.
    is3rdPartyToDoc() {
        let docDomain = this.getDocDomain();
        if ( docDomain === '' ) { docDomain = this.docHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== docDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(docDomain) === false ) { return true; }
        const i = hostname.length - docDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setTabId(a) {
        this.tabId = a;
        return this;
    }

    getTabOrigin() {
        return this.tabOrigin;
    }

    setTabOrigin(a) {
        if ( a !== this.tabOrigin ) {
            this.tabHostname = this.tabDomain = undefined;
            this.tabOrigin = a;
        }
        return this;
    }

    setTabOriginFromURL(a) {
        return this.setTabOrigin(originFromURI(a));
    }

    getTabHostname() {
        if ( this.tabHostname === undefined ) {
            this.tabHostname = hostnameFromURI(this.getTabOrigin());
        }
        return this.tabHostname;
    }

    setTabHostname(a) {
        if ( a !== this.tabHostname ) {
            this.tabDomain = undefined;
            this.tabHostname = a;
        }
        return this;
    }

    getTabDomain() {
        if ( this.tabDomain === undefined ) {
            this.tabDomain = domainFromHostname(this.getTabHostname());
        }
        return this.tabDomain;
    }

    setTabDomain(a) {
        this.docDomain = a;
        return this;
    }

    // The idea is to minimize the amount of work done to figure out whether
    // the resource is 3rd-party to the top document.
    is3rdPartyToTab() {
        let tabDomain = this.getTabDomain();
        if ( tabDomain === '' ) { tabDomain = this.tabHostname; }
        if ( this.domain !== undefined && this.domain !== '' ) {
            return this.domain !== tabDomain;
        }
        const hostname = this.getHostname();
        if ( hostname.endsWith(tabDomain) === false ) { return true; }
        const i = hostname.length - tabDomain.length;
        if ( i === 0 ) { return false; }
        return hostname.charCodeAt(i - 1) !== 0x2E /* '.' */;
    }

    setFilter(a) {
        this.filter = a;
        return this;
    }

    pushFilter(a) {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(a);
        } else {
            this.filter = [ this.filter, a ];
        }
        return this;
    }

    pushFilters(a) {
        if ( this.filter === undefined ) {
            return this.setFilter(a);
        }
        if ( Array.isArray(this.filter) ) {
            this.filter.push(...a);
        } else {
            this.filter = [ this.filter, ...a ];
        }
        return this;
    }

    setMethod(a) {
        this.method = methodStrToBitMap[a] || 0;
        return this;
    }

    getMethodName() {
        return FilteringContext.getMethodName(this.method);
    }

    static getMethod(a) {
        return methodStrToBitMap[a] || 0;
    }

    static getMethodName(a) {
        return methodBitToStrMap.get(a) || '';
    }

    BEACON = BEACON;
    CSP_REPORT = CSP_REPORT;
    FONT = FONT;
    IMAGE = IMAGE;
    IMAGESET = IMAGESET;
    MAIN_FRAME = MAIN_FRAME;
    MEDIA = MEDIA;
    OBJECT = OBJECT;
    OBJECT_SUBREQUEST = OBJECT_SUBREQUEST;
    PING = PING;
    SCRIPT = SCRIPT;
    STYLESHEET = STYLESHEET;
    SUB_FRAME = SUB_FRAME;
    WEBSOCKET = WEBSOCKET;
    XMLHTTPREQUEST = XMLHTTPREQUEST;
    INLINE_FONT = INLINE_FONT;
    INLINE_SCRIPT = INLINE_SCRIPT;
    OTHER = OTHER;
    FRAME_ANY = FRAME_ANY;
    FONT_ANY = FONT_ANY;
    INLINE_ANY = INLINE_ANY;
    PING_ANY = PING_ANY;
    SCRIPT_ANY = SCRIPT_ANY;
    METHOD_NONE = METHOD_NONE;
    METHOD_CONNECT = METHOD_CONNECT;
    METHOD_DELETE = METHOD_DELETE;
    METHOD_GET = METHOD_GET;
    METHOD_HEAD = METHOD_HEAD;
    METHOD_OPTIONS = METHOD_OPTIONS;
    METHOD_PATCH = METHOD_PATCH;
    METHOD_POST = METHOD_POST;
    METHOD_PUT = METHOD_PUT;

    static BEACON = BEACON;
    static CSP_REPORT = CSP_REPORT;
    static FONT = FONT;
    static IMAGE = IMAGE;
    static IMAGESET = IMAGESET;
    static MAIN_FRAME = MAIN_FRAME;
    static MEDIA = MEDIA;
    static OBJECT = OBJECT;
    static OBJECT_SUBREQUEST = OBJECT_SUBREQUEST;
    static PING = PING;
    static SCRIPT = SCRIPT;
    static STYLESHEET = STYLESHEET;
    static SUB_FRAME = SUB_FRAME;
    static WEBSOCKET = WEBSOCKET;
    static XMLHTTPREQUEST = XMLHTTPREQUEST;
    static INLINE_FONT = INLINE_FONT;
    static INLINE_SCRIPT = INLINE_SCRIPT;
    static OTHER = OTHER;
    static FRAME_ANY = FRAME_ANY;
    static FONT_ANY = FONT_ANY;
    static INLINE_ANY = INLINE_ANY;
    static PING_ANY = PING_ANY;
    static SCRIPT_ANY = SCRIPT_ANY;
    static METHOD_NONE = METHOD_NONE;
    static METHOD_CONNECT = METHOD_CONNECT;
    static METHOD_DELETE = METHOD_DELETE;
    static METHOD_GET = METHOD_GET;
    static METHOD_HEAD = METHOD_HEAD;
    static METHOD_OPTIONS = METHOD_OPTIONS;
    static METHOD_PATCH = METHOD_PATCH;
    static METHOD_POST = METHOD_POST;
    static METHOD_PUT = METHOD_PUT;
};

/******************************************************************************/

return {NO_TYPE:NO_TYPE,BEACON:BEACON,CSP_REPORT:CSP_REPORT,FONT:FONT,IMAGE:IMAGE,IMAGESET:IMAGESET,MAIN_FRAME:MAIN_FRAME,MEDIA:MEDIA,OBJECT:OBJECT,OBJECT_SUBREQUEST:OBJECT_SUBREQUEST,PING:PING,SCRIPT:SCRIPT,STYLESHEET:STYLESHEET,SUB_FRAME:SUB_FRAME,WEBSOCKET:WEBSOCKET,XMLHTTPREQUEST:XMLHTTPREQUEST,INLINE_FONT:INLINE_FONT,INLINE_SCRIPT:INLINE_SCRIPT,OTHER:OTHER,FRAME_ANY:FRAME_ANY,FONT_ANY:FONT_ANY,INLINE_ANY:INLINE_ANY,PING_ANY:PING_ANY,SCRIPT_ANY:SCRIPT_ANY,METHOD_NONE:METHOD_NONE,METHOD_CONNECT:METHOD_CONNECT,METHOD_DELETE:METHOD_DELETE,METHOD_GET:METHOD_GET,METHOD_HEAD:METHOD_HEAD,METHOD_OPTIONS:METHOD_OPTIONS,METHOD_PATCH:METHOD_PATCH,METHOD_POST:METHOD_POST,METHOD_PUT:METHOD_PUT,FilteringContext:FilteringContext};
},10:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

const publicSuffixList = require(11).default;
const punycode = require(13).default;

/******************************************************************************/

// Originally:
// https://github.com/gorhill/uBlock/blob/8b5733a58d3acf9fb62815e14699c986bd1c2fdc/src/js/uritools.js

const reHostnameFromCommonURL =
    /^https:\/\/[0-9a-z._-]+[0-9a-z]\//;
const reAuthorityFromURI =
    /^(?:[^:/?#]+:)?(\/\/[^/?#]+)/;
const reHostFromNakedAuthority =
    /^[0-9a-z._-]+[0-9a-z]$/i;
const reHostFromAuthority =
    /^(?:[^@]*@)?([^:]+)(?::\d*)?$/;
const reIPv6FromAuthority =
    /^(?:[^@]*@)?(\[[0-9a-f:]+\])(?::\d*)?$/i;
const reMustNormalizeHostname =
    /[^0-9a-z._-]/;
const reOriginFromURI =
    /^[^:/?#]+:\/\/[^/?#]+/;
const reHostnameFromNetworkURL =
    /^(?:http|ws|ftp)s?:\/\/([0-9a-z_][0-9a-z._-]*[0-9a-z])(?::\d+)?\//;
const reIPAddressNaive =
    /^\d+\.\d+\.\d+\.\d+$|^\[[\da-zA-Z:]+\]$/;
const reNetworkURI =
    /^(?:ftps?|https?|wss?):\/\//;

// For performance purpose, as simple tests as possible
const reIPv4VeryCoarse = /\.\d+$/;
const reHostnameVeryCoarse = /[g-z_-]/;

/******************************************************************************/

function domainFromHostname(hostname) {
    return reIPAddressNaive.test(hostname)
        ? hostname
        : publicSuffixList.getDomain(hostname);
}

function domainFromURI(uri) {
    if ( !uri ) { return ''; }
    return domainFromHostname(hostnameFromURI(uri));
}

function entityFromDomain(domain) {
    const pos = domain.indexOf('.');
    return pos !== -1 ? domain.slice(0, pos) + '.*' : '';
}

function entityFromHostname(hostname, domain) {
    if ( domain === undefined ) {
        domain = domainFromHostname(hostname);
    }
    const entity = entityFromDomain(domain);
    if ( entity === '' ) { return ''; }
    return `${hostname.slice(0, -domain.length)}${entity}`
}

function hostnameFromURI(uri) {
    let match = reHostnameFromCommonURL.exec(uri);
    if ( match !== null ) { return match[0].slice(8, -1); }
    match = reAuthorityFromURI.exec(uri);
    if ( match === null ) { return ''; }
    const authority = match[1].slice(2);
    if ( reHostFromNakedAuthority.test(authority) ) {
        return authority.toLowerCase();
    }
    match = reHostFromAuthority.exec(authority);
    if ( match === null ) {
        match = reIPv6FromAuthority.exec(authority);
        if ( match === null ) { return ''; }
    }
    let hostname = match[1];
    while ( hostname.endsWith('.') ) {
        hostname = hostname.slice(0, -1);
    }
    if ( reMustNormalizeHostname.test(hostname) ) {
        hostname = punycode.toASCII(hostname.toLowerCase());
    }
    return hostname;
}

function hostnameFromNetworkURL(url) {
    const matches = reHostnameFromNetworkURL.exec(url);
    return matches !== null ? matches[1] : '';
}

function originFromURI(uri) {
    let match = reHostnameFromCommonURL.exec(uri);
    if ( match !== null ) { return match[0].slice(0, -1); }
    match = reOriginFromURI.exec(uri);
    return match !== null ? match[0].toLowerCase() : '';
}

function isNetworkURI(uri) {
    return reNetworkURI.test(uri);
}

/******************************************************************************/

function toBroaderHostname(hostname) {
    const pos = hostname.indexOf('.');
    if ( pos !== -1 ) {
        return hostname.slice(pos + 1);
    }
    return hostname !== '*' && hostname !== '' ? '*' : '';
}

function toBroaderIPv4Address(ipaddress) {
    if ( ipaddress === '*' || ipaddress === '' ) { return ''; }
    const pos = ipaddress.lastIndexOf('.');
    if ( pos === -1 ) { return '*'; }
    return ipaddress.slice(0, pos);
}

function toBroaderIPv6Address(ipaddress) {
    return ipaddress !== '*' && ipaddress !== '' ? '*' : '';
}

function decomposeHostname(hostname, out) {
    if ( out.length !== 0 && out[0] === hostname ) {
        return out;
    }
    let broadenFn;
    if ( reHostnameVeryCoarse.test(hostname) === false ) {
        if ( reIPv4VeryCoarse.test(hostname) ) {
            broadenFn = toBroaderIPv4Address;
        } else if ( hostname.startsWith('[') ) {
            broadenFn = toBroaderIPv6Address;
        }
    }
    if ( broadenFn === undefined ) {
        broadenFn = toBroaderHostname;
    }
    out[0] = hostname;
    let i = 1;
    for (;;) {
        hostname = broadenFn(hostname);
        if ( hostname === '' ) { break; }
        out[i++] = hostname;
    }
    out.length = i;
    return out;
}

/******************************************************************************/



return {decomposeHostname:decomposeHostname,domainFromHostname:domainFromHostname,domainFromURI:domainFromURI,entityFromDomain:entityFromDomain,entityFromHostname:entityFromHostname,hostnameFromNetworkURL:hostnameFromNetworkURL,hostnameFromURI:hostnameFromURI,isNetworkURI:isNetworkURI,originFromURI:originFromURI};
},11:function(require){const publicSuffixList = require(12).default; const __default = publicSuffixList;
return {default:__default};
},12:function(require){/*******************************************************************************

    publicsuffixlist.js - an efficient javascript implementation to deal with
    Mozilla Foundation's Public Suffix List <http://publicsuffix.org/list/>

    Copyright (C) 2013-present Raymond Hill

    License: pick the one which suits you:
      GPL v3 see <https://www.gnu.org/licenses/gpl.html>
      APL v2 see <http://www.apache.org/licenses/LICENSE-2.0>

*/

/*! Home: https://github.com/gorhill/publicsuffixlist.js -- GPLv3 APLv2 */

'use strict';

/*******************************************************************************

    Reference:
    https://publicsuffix.org/list/

    Excerpt:

    > Algorithm
    > 
    > 1. Match domain against all rules and take note of the matching ones.
    > 2. If no rules match, the prevailing rule is "*".
    > 3. If more than one rule matches, the prevailing rule is the one which
         is an exception rule.
    > 4. If there is no matching exception rule, the prevailing rule is the
         one with the most labels.
    > 5. If the prevailing rule is a exception rule, modify it by removing
         the leftmost label.
    > 6. The public suffix is the set of labels from the domain which match
         the labels of the prevailing rule, using the matching algorithm above.
    > 7. The registered or registrable domain is the public suffix plus one
         additional label.

*/

/******************************************************************************/

const __default = (function() {
// >>>>>>>> start of anonymous namespace

/*******************************************************************************

    Tree encoding in array buffer:
    
     Node:
     +  u8: length of char data
     +  u8: flags => bit 0: is_publicsuffix, bit 1: is_exception
     + u16: length of array of children
     + u32: char data or offset to char data
     + u32: offset to array of children
     = 12 bytes

    More bits in flags could be used; for example:
    - to distinguish private suffixes

*/

                                    // i32 /  i8
const HOSTNAME_SLOT         = 0;    // jshint ignore:line
const LABEL_INDICES_SLOT    = 256;  //  -- / 256 (256/2 => 128 labels max)
const RULES_PTR_SLOT        = 100;  // 100 / 400 (400-256=144 => 144>128)
const SUFFIX_NOT_FOUND_SLOT = 399;  //  -- / 399 (safe, see above)
const CHARDATA_PTR_SLOT     = 101;  // 101 / 404
const EMPTY_STRING          = '';
const SELFIE_MAGIC          = 3;

let wasmMemory;
let pslBuffer32;
let pslBuffer8;
let pslByteLength = 0;
let hostnameArg = EMPTY_STRING;

/******************************************************************************/

const fireChangedEvent = function() {
    if ( typeof window !== 'object' ) { return; }
    if ( window instanceof Object === false ) { return; }
    if ( window.dispatchEvent instanceof Function === false ) { return; }
    if ( window.CustomEvent instanceof Function === false ) { return; }
    window.dispatchEvent(new CustomEvent('publicSuffixListChanged'));
};

/******************************************************************************/

const allocateBuffers = function(byteLength) {
    pslByteLength = byteLength + 3 & ~3;
    if (
        pslBuffer32 !== undefined &&
        pslBuffer32.byteLength >= pslByteLength
    ) {
        return;
    }
    if ( wasmMemory !== undefined ) {
        const newPageCount = pslByteLength + 0xFFFF >>> 16;
        const curPageCount = wasmMemory.buffer.byteLength >>> 16;
        const delta = newPageCount - curPageCount;
        if ( delta > 0 ) {
            wasmMemory.grow(delta);
            pslBuffer32 = new Uint32Array(wasmMemory.buffer);
            pslBuffer8 = new Uint8Array(wasmMemory.buffer);
        }
    } else {
        pslBuffer8 = new Uint8Array(pslByteLength);
        pslBuffer32 = new Uint32Array(pslBuffer8.buffer);
    }
    hostnameArg = EMPTY_STRING;
    pslBuffer8[LABEL_INDICES_SLOT] = 0;
};

/******************************************************************************/

// Parse and set a UTF-8 text-based suffix list. Format is same as found at:
// http://publicsuffix.org/list/
//
// `toAscii` is a converter from unicode to punycode. Required since the
// Public Suffix List contains unicode characters.
// Suggestion: use <https://github.com/bestiejs/punycode.js>

const parse = function(text, toAscii) {
    // Use short property names for better minifying results
    const rootRule = {
        l: EMPTY_STRING,    // l => label
        f: 0,               // f => flags
        c: undefined        // c => children
    };

    // Tree building
    {
        const compareLabels = function(a, b) {
            let n = a.length;
            let d = n - b.length;
            if ( d !== 0 ) { return d; }
            for ( let i = 0; i < n; i++ ) {
                d = a.charCodeAt(i) - b.charCodeAt(i);
                if ( d !== 0 ) { return d; }
            }
            return 0;
        };

        const addToTree = function(rule, exception) {
            let node = rootRule;
            let end = rule.length;
            while ( end > 0 ) {
                const beg = rule.lastIndexOf('.', end - 1);
                const label = rule.slice(beg + 1, end);
                end = beg;

                if ( Array.isArray(node.c) === false ) {
                    const child = { l: label, f: 0, c: undefined };
                    node.c = [ child ];
                    node = child;
                    continue;
                }

                let left = 0;
                let right = node.c.length;
                while ( left < right ) {
                    const i = left + right >>> 1;
                    const d = compareLabels(label, node.c[i].l);
                    if ( d < 0 ) {
                        right = i;
                        if ( right === left ) {
                            const child = {
                                l: label,
                                f: 0,
                                c: undefined
                            };
                            node.c.splice(left, 0, child);
                            node = child;
                            break;
                        }
                        continue;
                    }
                    if ( d > 0 ) {
                        left = i + 1;
                        if ( left === right ) {
                            const child = {
                                l: label,
                                f: 0,
                                c: undefined
                            };
                            node.c.splice(right, 0, child);
                            node = child;
                            break;
                        }
                        continue;
                    }
                    /* d === 0 */
                    node = node.c[i];
                    break;
                }
            }
            node.f |= 0b01;
            if ( exception ) {
                node.f |= 0b10;
            }
        };

        // 2. If no rules match, the prevailing rule is "*".
        addToTree('*', false);

        const mustPunycode = /[^a-z0-9.-]/;
        const textEnd = text.length;
        let lineBeg = 0;

        while ( lineBeg < textEnd ) {
            let lineEnd = text.indexOf('\n', lineBeg);
            if ( lineEnd === -1 ) {
                lineEnd = text.indexOf('\r', lineBeg);
                if ( lineEnd === -1 ) {
                    lineEnd = textEnd;
                }
            }
            let line = text.slice(lineBeg, lineEnd).trim();
            lineBeg = lineEnd + 1;

            // Ignore comments
            const pos = line.indexOf('//');
            if ( pos !== -1 ) {
                line = line.slice(0, pos);
            }

            // Ignore surrounding whitespaces
            line = line.trim();
            if ( line.length === 0 ) { continue; }

            const exception = line.charCodeAt(0) === 0x21 /* '!' */;
            if ( exception ) {
                line = line.slice(1);
            }

            if ( mustPunycode.test(line) ) {
                line = toAscii(line.toLowerCase());
            }

            addToTree(line, exception);
        }
    }

    {
        const labelToOffsetMap = new Map();
        const treeData = [];
        const charData = [];

        const allocate = function(n) {
            const ibuf = treeData.length;
            for ( let i = 0; i < n; i++ ) {
                treeData.push(0);
            }
            return ibuf;
        };

        const storeNode = function(ibuf, node) {
            const nChars = node.l.length;
            const nChildren = node.c !== undefined
                ? node.c.length
                : 0;
            treeData[ibuf+0] = nChildren << 16 | node.f << 8 | nChars;
            // char data
            if ( nChars <= 4 ) {
                let v = 0;
                if ( nChars > 0 ) {
                    v |= node.l.charCodeAt(0);
                    if ( nChars > 1 ) {
                        v |= node.l.charCodeAt(1) << 8;
                        if ( nChars > 2 ) {
                            v |= node.l.charCodeAt(2) << 16;
                            if ( nChars > 3 ) {
                                v |= node.l.charCodeAt(3) << 24;
                            }
                        }
                    }
                }
                treeData[ibuf+1] = v;
            } else {
                let offset = labelToOffsetMap.get(node.l);
                if ( offset === undefined ) {
                    offset = charData.length;
                    for ( let i = 0; i < nChars; i++ ) {
                        charData.push(node.l.charCodeAt(i));
                    }
                    labelToOffsetMap.set(node.l, offset);
                }
                treeData[ibuf+1] = offset;
            }
            // child nodes
            if ( Array.isArray(node.c) === false ) {
                treeData[ibuf+2] = 0;
                return;
            }
            
            const iarray = allocate(nChildren * 3);
            treeData[ibuf+2] = iarray;
            for ( let i = 0; i < nChildren; i++ ) {
                storeNode(iarray + i * 3, node.c[i]);
            }
        };

        // First 512 bytes are reserved for internal use
        allocate(512 >> 2);

        const iRootRule = allocate(3);
        storeNode(iRootRule, rootRule);
        treeData[RULES_PTR_SLOT] = iRootRule;

        const iCharData = treeData.length << 2;
        treeData[CHARDATA_PTR_SLOT] = iCharData;

        const byteLength = (treeData.length << 2) + (charData.length + 3 & ~3);
        allocateBuffers(byteLength);
        pslBuffer32.set(treeData);
        pslBuffer8.set(charData, treeData.length << 2);
    }

    fireChangedEvent();
};

/******************************************************************************/

const setHostnameArg = function(hostname) {
    const buf = pslBuffer8;
    if ( hostname === hostnameArg ) { return buf[LABEL_INDICES_SLOT]; }
    if ( hostname === null || hostname.length === 0 ) {
        hostnameArg = EMPTY_STRING;
        return (buf[LABEL_INDICES_SLOT] = 0);
    }
    hostname = hostname.toLowerCase();
    hostnameArg = hostname;
    let n = hostname.length;
    if ( n > 255 ) { n = 255; }
    buf[LABEL_INDICES_SLOT] = n;
    let i = n;
    let j = LABEL_INDICES_SLOT + 1;
    while ( i-- ) {
        const c = hostname.charCodeAt(i);
        if ( c === 0x2E /* '.' */ ) {
            buf[j+0] = i + 1;
            buf[j+1] = i;
            j += 2;
        }
        buf[i] = c;
    }
    buf[j] = 0;
    return n;
};

/******************************************************************************/

// Returns an offset to the start of the public suffix.
//
// WASM-able, because no information outside the buffer content is required.

const getPublicSuffixPosJS = function() {
    const buf8 = pslBuffer8;
    const buf32 = pslBuffer32;
    const iCharData = buf32[CHARDATA_PTR_SLOT];

    let iNode = pslBuffer32[RULES_PTR_SLOT];
    let cursorPos = -1;
    let iLabel = LABEL_INDICES_SLOT;

    // Label-lookup loop
    for (;;) {
        // Extract label indices
        const labelBeg = buf8[iLabel+1];
        const labelLen = buf8[iLabel+0] - labelBeg;
        // Match-lookup loop: binary search
        let r = buf32[iNode+0] >>> 16;
        if ( r === 0 ) { break; }
        const iCandidates = buf32[iNode+2];
        let l = 0;
        let iFound = 0;
        while ( l < r ) {
            const iCandidate = l + r >>> 1;
            const iCandidateNode = iCandidates + iCandidate + (iCandidate << 1);
            const candidateLen = buf32[iCandidateNode+0] & 0x000000FF;
            let d = labelLen - candidateLen;
            if ( d === 0 ) {
                const iCandidateChar = candidateLen <= 4
                    ? iCandidateNode + 1 << 2
                    : iCharData + buf32[iCandidateNode+1];
                for ( let i = 0; i < labelLen; i++ ) {
                    d = buf8[labelBeg+i] - buf8[iCandidateChar+i];
                    if ( d !== 0 ) { break; }
                }
            }
            if ( d < 0 ) {
                r = iCandidate;
            } else if ( d > 0 ) {
                l = iCandidate + 1;
            } else /* if ( d === 0 ) */ {
                iFound = iCandidateNode;
                break;
            }
        }
        // 2. If no rules match, the prevailing rule is "*".
        if ( iFound === 0 ) {
            if ( buf32[iCandidates + 1] !== 0x2A /* '*' */ ) { break; }
            buf8[SUFFIX_NOT_FOUND_SLOT] = 1;
            iFound = iCandidates;
        }
        iNode = iFound;
        // 5. If the prevailing rule is a exception rule, modify it by
        //    removing the leftmost label.
        if ( (buf32[iNode+0] & 0x00000200) !== 0 ) {
            if ( iLabel > LABEL_INDICES_SLOT ) {
                return iLabel - 2;
            }
            break;
        }
        if ( (buf32[iNode+0] & 0x00000100) !== 0 ) {
            cursorPos = iLabel;
        }
        if ( labelBeg === 0 ) { break; }
        iLabel += 2;
    }

    return cursorPos;
};

let getPublicSuffixPosWASM;
let getPublicSuffixPos = getPublicSuffixPosJS;

/******************************************************************************/

const getPublicSuffix = function(hostname) {
    if ( pslBuffer32 === undefined ) { return EMPTY_STRING; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return EMPTY_STRING;
    }

    const cursorPos = getPublicSuffixPos();
    if ( cursorPos === -1 ) {
        return EMPTY_STRING;
    }

    const beg = buf8[cursorPos + 1];
    return beg === 0 ? hostnameArg : hostnameArg.slice(beg);
};

/******************************************************************************/

const getDomain = function(hostname) {
    if ( pslBuffer32 === undefined ) { return EMPTY_STRING; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return EMPTY_STRING;
    }

    const cursorPos = getPublicSuffixPos();
    if ( cursorPos === -1 || buf8[cursorPos + 1] === 0 ) {
        return EMPTY_STRING;
    }

    // 7. The registered or registrable domain is the public suffix plus one
    //    additional label.
    const beg = buf8[cursorPos + 3];
    return beg === 0 ? hostnameArg : hostnameArg.slice(beg);
};

/******************************************************************************/

const suffixInPSL = function(hostname) {
    if ( pslBuffer32 === undefined ) { return false; }

    const hostnameLen = setHostnameArg(hostname);
    const buf8 = pslBuffer8;
    if ( hostnameLen === 0 || buf8[0] === 0x2E /* '.' */ ) {
        return false;
    }

    buf8[SUFFIX_NOT_FOUND_SLOT] = 0;
    const cursorPos = getPublicSuffixPos();
    return cursorPos !== -1 &&
           buf8[cursorPos + 1] === 0 &&
           buf8[SUFFIX_NOT_FOUND_SLOT] !== 1;
};

/******************************************************************************/

const toSelfie = function(encoder) {
    if ( pslBuffer8 === undefined ) { return ''; }
    if ( encoder instanceof Object ) {
        const bufferStr = encoder.encode(pslBuffer8.buffer, pslByteLength);
        return `${SELFIE_MAGIC}\t${bufferStr}`;
    }
    return {
        magic: SELFIE_MAGIC,
        buf32: pslBuffer32.subarray(0, pslByteLength >> 2),
    };
};

const fromSelfie = function(selfie, decoder) {
    let byteLength = 0;
    if (
        typeof selfie === 'string' &&
        selfie.length !== 0 &&
        decoder instanceof Object
    ) {
        const pos = selfie.indexOf('\t');
        if ( pos === -1 || selfie.slice(0, pos) !== `${SELFIE_MAGIC}` ) {
            return false;
        }
        const bufferStr = selfie.slice(pos + 1);
        byteLength = decoder.decodeSize(bufferStr);
        if ( byteLength === 0 ) { return false; }
        allocateBuffers(byteLength);
        decoder.decode(bufferStr, pslBuffer8.buffer);
    } else if (
        selfie instanceof Object &&
        selfie.magic === SELFIE_MAGIC &&
        selfie.buf32 instanceof Uint32Array
    ) {
        byteLength = selfie.buf32.length << 2;
        allocateBuffers(byteLength);
        pslBuffer32.set(selfie.buf32);
    } else {
        return false;
    }

    // Important!
    hostnameArg = EMPTY_STRING;
    pslBuffer8[LABEL_INDICES_SLOT] = 0;

    fireChangedEvent();

    return true;
};

/******************************************************************************/

// The WASM module is entirely optional, the JS implementation will be
// used should the WASM module be unavailable for whatever reason.

const enableWASM = (( ) => {
    let wasmPromise;

    const getWasmInstance = async function(wasmModuleFetcher, path) {
        if ( typeof WebAssembly !== 'object' ) { return false; }
        // The wasm code will work only if CPU is natively little-endian,
        // as we use native uint32 array in our js code.
        const uint32s = new Uint32Array(1);
        const uint8s = new Uint8Array(uint32s.buffer);
        uint32s[0] = 1;
        if ( uint8s[0] !== 1 ) { return false; }

        try {
            const module = await wasmModuleFetcher(`${path}publicsuffixlist`);
            if (  module instanceof WebAssembly.Module === false ) {
                return false;
            }
            const pageCount = pslBuffer8 !== undefined
                ? pslBuffer8.byteLength + 0xFFFF >>> 16
                : 1;
            const memory = new WebAssembly.Memory({ initial: pageCount });
            const instance = await WebAssembly.instantiate(module, {
                imports: { memory }
            });
            if (  instance instanceof WebAssembly.Instance === false ) {
                return false;
            }
            const curPageCount = memory.buffer.byteLength >>> 16;
            const newPageCount = pslBuffer8 !== undefined
                ? pslBuffer8.byteLength + 0xFFFF >>> 16
                : 0;
            if ( newPageCount > curPageCount ) {
                memory.grow(newPageCount - curPageCount);
            }
            if ( pslBuffer32 !== undefined ) {
                const buf8 = new Uint8Array(memory.buffer);
                const buf32 = new Uint32Array(memory.buffer);
                buf32.set(pslBuffer32);
                pslBuffer8 = buf8;
                pslBuffer32 = buf32;
            }
            wasmMemory = memory;
            getPublicSuffixPosWASM = instance.exports.getPublicSuffixPos;
            getPublicSuffixPos = getPublicSuffixPosWASM;
            return true;
        } catch(reason) {
            console.info(reason);
        }
        return false;
    };

    return async function(wasmModuleFetcher, path) {
        if ( getPublicSuffixPosWASM instanceof Function ) { return true; }
        if ( wasmPromise instanceof Promise === false ) {
            wasmPromise = getWasmInstance(wasmModuleFetcher, path);
        }
        return wasmPromise;
    };
})();

const disableWASM = function() {
    if ( getPublicSuffixPosWASM instanceof Function ) {
        getPublicSuffixPos = getPublicSuffixPosJS;
        getPublicSuffixPosWASM = undefined;
    }
    if ( wasmMemory === undefined ) { return; }
    if ( pslBuffer32 !== undefined ) {
        const buf8 = new Uint8Array(pslByteLength);
        const buf32 = new Uint32Array(buf8.buffer);
        buf32.set(pslBuffer32);
        pslBuffer8 = buf8;
        pslBuffer32 = buf32;
    }
    wasmMemory = undefined;
};

/******************************************************************************/

return ({
    version: '2.0',
    parse,
    getDomain,
    suffixInPSL,
    getPublicSuffix,
    toSelfie, fromSelfie,
    disableWASM, enableWASM,
});

/******************************************************************************/

// <<<<<<<< end of anonymous namespace
})();

return {default:__default};
},13:function(require){/*! https://mths.be/punycode v1.3.2 by @mathias */
const __default = (function() {
	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * http://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.3.2',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	return punycode;
})();

return {default:__default};
},14:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2017-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/*******************************************************************************

  The original prototype was to develop an idea I had about using jump indices
  in a TypedArray for quickly matching hostnames (or more generally strings)[1].
  Once I had a working, un-optimized prototype, I realized I had ended up
  with something formally named a "trie": <https://en.wikipedia.org/wiki/Trie>,
  hence the name. I have no idea whether the implementation here or one
  resembling it has been done elsewhere.

  "HN" in HNTrieContainer stands for "HostName", because the trie is
  specialized to deal with matching hostnames -- which is a bit more
  complicated than matching plain strings.

  For example, `www.abc.com` is deemed matching `abc.com`, because the former
  is a subdomain of the latter. The opposite is of course not true.

  The resulting read-only tries created as a result of using HNTrieContainer
  are simply just typed arrays filled with integers. The matching algorithm is
  just a matter of reading/comparing these integers, and further using them as
  indices in the array as a way to move around in the trie.

  [1] To solve <https://github.com/gorhill/uBlock/issues/3193>

  Since this trie is specialized for matching hostnames, the stored
  strings are reversed internally, because of hostname comparison logic:

  Correct matching:
    index      0123456
               abc.com
                     |
           www.abc.com
    index  01234567890

  Incorrect matching (typically used for plain strings):
    index  0123456
           abc.com
           |
           www.abc.com
    index  01234567890

  ------------------------------------------------------------------------------

  1st iteration:
    - https://github.com/gorhill/uBlock/blob/ff58107dac3a32607f8113e39ed5015584506813/src/js/hntrie.js
    - Suitable for small to medium set of hostnames
    - One buffer per trie

  2nd iteration: goal was to make matches() method wasm-able
    - https://github.com/gorhill/uBlock/blob/c3b0fd31f64bd7ffecdd282fb1208fe07aac3eb0/src/js/hntrie.js
    - Suitable for small to medium set of hostnames
    - Distinct tries all share same buffer:
      - Reduced memory footprint
        - https://stackoverflow.com/questions/45803829/memory-overhead-of-typed-arrays-vs-strings/45808835#45808835
      - Reusing needle character lookups for all tries
        - This significantly reduce the number of String.charCodeAt() calls
    - Slightly improved creation time

  This is the 3rd iteration: goal was to make add() method wasm-able and
  further improve memory/CPU efficiency.

  This 3rd iteration has the following new traits:
    - Suitable for small to large set of hostnames
    - Support multiple trie containers (instanciable)
    - Designed to hold large number of hostnames
    - Hostnames can be added at any time (instead of all at once)
      - This means pre-sorting is no longer a requirement
    - The trie is always compact
      - There is no longer a need for a `vacuum` method
      - This makes the add() method wasm-able
    - It can return the exact hostname which caused the match
    - serializable/unserializable available for fast loading
    - Distinct trie reference support the iteration protocol, thus allowing
      to extract all the hostnames in the trie

  Its primary purpose is to replace the use of Set() as a mean to hold
  large number of hostnames (ex. FilterHostnameDict in static filtering
  engine).

  A HNTrieContainer is mostly a large buffer in which distinct but related
  tries are stored. The memory layout of the buffer is as follow:

    0-254: needle being processed
      255: length of needle
  256-259: offset to start of trie data section (=> trie0)
  260-263: offset to end of trie data section (=> trie1)
  264-267: offset to start of character data section  (=> char0)
  268-271: offset to end of character data section (=> char1)
      272: start of trie data section

*/

const PAGE_SIZE   = 65536;
//                                             i32 /  i8
const TRIE0_SLOT  = 256 >>> 2;              //  64 / 256
const TRIE1_SLOT  = TRIE0_SLOT + 1;         //  65 / 260
const CHAR0_SLOT  = TRIE0_SLOT + 2;         //  66 / 264
const CHAR1_SLOT  = TRIE0_SLOT + 3;         //  67 / 268
const TRIE0_START = TRIE0_SLOT + 4 << 2;    //       272

const roundToPageSize = v => (v + PAGE_SIZE-1) & ~(PAGE_SIZE-1);

// http://www.cse.yorku.ca/~oz/hash.html#djb2
const i32Checksum = (buf32) => {
    const n = buf32.length;
    let hash = 177573 ^ n;
    for ( let i = 0; i < n; i++ ) {
        hash = (hash << 5) + hash ^ buf32[i];
    }
    return hash;
};

class HNTrieContainer {

    constructor() {
        const len = PAGE_SIZE * 2;
        this.buf = new Uint8Array(len);
        this.buf32 = new Uint32Array(this.buf.buffer);
        this.needle = '';
        this.buf32[TRIE0_SLOT] = TRIE0_START;
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR0_SLOT] = len >>> 1;
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];
        this.wasmMemory = null;

        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    //--------------------------------------------------------------------------
    // Public methods
    //--------------------------------------------------------------------------

    reset(details) {
        if (
            details instanceof Object &&
            typeof details.byteLength === 'number' &&
            typeof details.char0 === 'number'
        ) {
            if ( details.byteLength > this.buf.byteLength ) {
                this.reallocateBuf(details.byteLength);
            }
            this.buf32[CHAR0_SLOT] = details.char0;
        }
        this.buf32[TRIE1_SLOT] = this.buf32[TRIE0_SLOT];
        this.buf32[CHAR1_SLOT] = this.buf32[CHAR0_SLOT];

        this.lastStored = '';
        this.lastStoredLen = this.lastStoredIndex = 0;
    }

    setNeedle(needle) {
        if ( needle !== this.needle ) {
            const buf = this.buf;
            let i = needle.length;
            if ( i > 255 ) { i = 255; }
            buf[255] = i;
            while ( i-- ) {
                buf[i] = needle.charCodeAt(i);
            }
            this.needle = needle;
        }
        return this;
    }

    matchesJS(iroot) {
        const buf32 = this.buf32;
        const buf8 = this.buf;
        const char0 = buf32[CHAR0_SLOT];
        let ineedle = buf8[255];
        let icell = buf32[iroot+0];
        if ( icell === 0 ) { return -1; }
        let c = 0, v = 0, i0 = 0, n = 0;
        for (;;) {
            if ( ineedle === 0 ) { return -1; }
            ineedle -= 1;
            c = buf8[ineedle];
            // find first segment with a first-character match
            for (;;) {
                v = buf32[icell+2];
                i0 = char0 + (v >>> 8);
                if ( buf8[i0] === c ) { break; }
                icell = buf32[icell+0];
                if ( icell === 0 ) { return -1; }
            }
            // all characters in segment must match
            n = v & 0x7F;
            if ( n > 1 ) {
                n -= 1;
                if ( n > ineedle ) { return -1; }
                i0 += 1;
                const i1 = i0 + n;
                do {
                    ineedle -= 1;
                    if ( buf8[i0] !== buf8[ineedle] ) { return -1; }
                    i0 += 1;
                } while ( i0 < i1 );
            }
            // boundary at end of segment?
            if ( (v & 0x80) !== 0 ) {
                if ( ineedle === 0 || buf8[ineedle-1] === 0x2E /* '.' */ ) {
                    return ineedle;
                }
            }
            // next segment
            icell = buf32[icell+1];
            if ( icell === 0 ) { break; }
        }
        return -1;
    }

    createTrie() {
        // grow buffer if needed
        if ( (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) < 12 ) {
            this.growBuf(12, 0);
        }
        const iroot = this.buf32[TRIE1_SLOT] >>> 2;
        this.buf32[TRIE1_SLOT] += 12;
        this.buf32[iroot+0] = 0;
        this.buf32[iroot+1] = 0;
        this.buf32[iroot+2] = 0;
        return iroot;
    }

    createTrieFromIterable(hostnames) {
        const itrie = this.createTrie();
        for ( const hn of hostnames ) {
            if ( hn === '' ) { continue; }
            this.setNeedle(hn).add(itrie);
        }
        return itrie;
    }

    createTrieFromStoredDomainOpt(i, n) {
        const itrie = this.createTrie();
        const jend = i + n;
        let j = i, offset = 0, k = 0, c = 0;
        while ( j !== jend ) {
            offset = this.buf32[CHAR0_SLOT]; // Important
            k = 0;
            for (;;) {
                if ( j === jend ) { break; }
                c = this.buf[offset+j];
                j += 1;
                if ( c === 0x7C /* '|' */ ) { break; }
                if ( k === 255 ) { continue; }
                this.buf[k] = c;
                k += 1;
            }
            if ( k !== 0 ) {
                this.buf[255] = k;
                this.add(itrie);
            }
        }
        this.needle = '';   // Important
        this.buf[255] = 0;  // Important
        return itrie;
    }

    dumpTrie(iroot) {
        let hostnames = Array.from(this.trieIterator(iroot));
        if ( String.prototype.padStart instanceof Function ) {
            const maxlen = Math.min(
                hostnames.reduce((maxlen, hn) => Math.max(maxlen, hn.length), 0),
                64
            );
            hostnames = hostnames.map(hn => hn.padStart(maxlen));
        }
        for ( const hn of hostnames ) {
            console.log(hn);
        }
    }

    trieIterator(iroot) {
        return {
            value: undefined,
            done: false,
            next() {
                if ( this.icell === 0 ) {
                    if ( this.forks.length === 0 ) {
                        this.value = undefined;
                        this.done = true;
                        return this;
                    }
                    this.charPtr = this.forks.pop();
                    this.icell = this.forks.pop();
                }
                for (;;) {
                    const idown = this.container.buf32[this.icell+0];
                    if ( idown !== 0 ) {
                        this.forks.push(idown, this.charPtr);
                    }
                    const v = this.container.buf32[this.icell+2];
                    let i0 = this.container.buf32[CHAR0_SLOT] + (v >>> 8);
                    const i1 = i0 + (v & 0x7F);
                    while ( i0 < i1 ) {
                        this.charPtr -= 1;
                        this.charBuf[this.charPtr] = this.container.buf[i0];
                        i0 += 1;
                    }
                    this.icell = this.container.buf32[this.icell+1];
                    if ( (v & 0x80) !== 0 ) {
                        return this.toHostname();
                    }
                }
            },
            toHostname() {
                this.value = this.textDecoder.decode(
                    new Uint8Array(this.charBuf.buffer, this.charPtr)
                );
                return this;
            },
            container: this,
            icell: this.buf32[iroot],
            charBuf: new Uint8Array(256),
            charPtr: 256,
            forks: [],
            textDecoder: new TextDecoder(),
            [Symbol.iterator]() { return this; },
        };
    }

    // TODO:
    //   Rework code to add from a string already present in the character
    //   buffer, i.e. not having to go through setNeedle() when adding a new
    //   hostname to a trie. This will require much work though, and probably
    //   changing the order in which string segments are stored in the
    //   character buffer.
    addJS(iroot) {
        let lhnchar = this.buf[255];
        if ( lhnchar === 0 ) { return 0; }
        // grow buffer if needed
        if (
            (this.buf32[CHAR0_SLOT] - this.buf32[TRIE1_SLOT]) < 24 ||
            (this.buf.length - this.buf32[CHAR1_SLOT]) < 256
        ) {
            this.growBuf(24, 256);
        }
        let icell = this.buf32[iroot+0];
        // special case: first node in trie
        if ( icell === 0 ) {
            this.buf32[iroot+0] = this.addLeafCell(lhnchar);
            return 1;
        }
        //
        const char0 = this.buf32[CHAR0_SLOT];
        let isegchar, lsegchar, boundaryBit, inext;
        // find a matching cell: move down
        for (;;) {
            const v = this.buf32[icell+2];
            let isegchar0 = char0 + (v >>> 8);
            // if first character is no match, move to next descendant
            if ( this.buf[isegchar0] !== this.buf[lhnchar-1] ) {
                inext = this.buf32[icell+0];
                if ( inext === 0 ) {
                    this.buf32[icell+0] = this.addLeafCell(lhnchar);
                    return 1;
                }
                icell = inext;
                continue;
            }
            // 1st character was tested
            isegchar = 1;
            lhnchar -= 1;
            // find 1st mismatch in rest of segment
            lsegchar = v & 0x7F;
            if ( lsegchar !== 1 ) {
                for (;;) {
                    if ( isegchar === lsegchar ) { break; }
                    if ( lhnchar === 0 ) { break; }
                    if ( this.buf[isegchar0+isegchar] !== this.buf[lhnchar-1] ) { break; }
                    isegchar += 1;
                    lhnchar -= 1;
                }
            }
            boundaryBit = v & 0x80;
            // all segment characters matched
            if ( isegchar === lsegchar ) {
                // needle remainder: no
                if ( lhnchar === 0 ) {
                    // boundary: yes, already present
                    if ( boundaryBit !== 0 ) { return 0; }
                    // boundary: no, mark as boundary
                    this.buf32[icell+2] = v | 0x80;
                }
                // needle remainder: yes
                else {
                    // remainder is at label boundary? if yes, no need to add
                    // the rest since the shortest match is always reported
                    if ( boundaryBit !== 0 ) {
                        if ( this.buf[lhnchar-1] === 0x2E /* '.' */ ) { return -1; }
                    }
                    inext = this.buf32[icell+1];
                    if ( inext !== 0 ) {
                        icell = inext;
                        continue;
                    }
                    // add needle remainder
                    this.buf32[icell+1] = this.addLeafCell(lhnchar);
                }
            }
            // some segment characters matched
            else {
                // split current cell
                isegchar0 -= char0;
                this.buf32[icell+2] = isegchar0 << 8 | isegchar;
                inext = this.addCell(
                    0,
                    this.buf32[icell+1],
                    isegchar0 + isegchar << 8 | boundaryBit | lsegchar - isegchar
                );
                this.buf32[icell+1] = inext;
                // needle remainder: yes, need new cell for remaining characters
                if ( lhnchar !== 0 ) {
                    this.buf32[inext+0] = this.addLeafCell(lhnchar);
                }
                // needle remainder: no, need boundary cell
                else {
                    this.buf32[icell+2] |= 0x80;
                }
            }
            return 1;
        }
    }

    optimize() {
        this.shrinkBuf();
        return {
            byteLength: this.buf.byteLength,
            char0: this.buf32[CHAR0_SLOT],
        };
    }

    toSelfie() {
        const buf32 = this.buf32.subarray(0, this.buf32[CHAR1_SLOT] + 3 >>> 2);
        return { buf32, checksum: i32Checksum(buf32) };
    }

    fromSelfie(selfie) {
        if ( typeof selfie !== 'object' || selfie === null ) { return false; }
        if ( selfie.buf32 instanceof Uint32Array === false ) { return false; }
        if ( selfie.checksum !== i32Checksum(selfie.buf32) ) { return false; }
        this.needle = '';
        let byteLength = selfie.buf32.length << 2;
        if ( byteLength === 0 ) { return false; }
        byteLength = roundToPageSize(byteLength);
        if ( this.wasmMemory !== null ) {
            const pageCountBefore = this.buf.length >>> 16;
            const pageCountAfter = byteLength >>> 16;
            if ( pageCountAfter > pageCountBefore ) {
                this.wasmMemory.grow(pageCountAfter - pageCountBefore);
                this.buf = new Uint8Array(this.wasmMemory.buffer);
                this.buf32 = new Uint32Array(this.buf.buffer);
            }
            this.buf32.set(selfie.buf32);
        } else {
            this.buf32 = selfie.buf32;
            this.buf = new Uint8Array(this.buf32.buffer);
        }
        // https://github.com/uBlockOrigin/uBlock-issues/issues/2925
        this.buf[255] = 0;
        return true;
    }

    // The following *Hostname() methods can be used to store hostname strings
    // outside the trie. This is useful to store/match hostnames which are
    // not part of a collection, and yet still benefit from storing the strings
    // into a trie container's character buffer.
    // TODO: WASM version of matchesHostname()

    storeHostname(hn) {
        let n = hn.length;
        if ( n > 255 ) {
            hn = hn.slice(-255);
            n = 255;
        }
        if ( n === this.lastStoredLen && hn === this.lastStored ) {
            return this.lastStoredIndex;
        }
        this.lastStored = hn;
        this.lastStoredLen = n;
        if ( (this.buf.length - this.buf32[CHAR1_SLOT]) < n ) {
            this.growBuf(0, n);
        }
        const offset = this.buf32[CHAR1_SLOT];
        this.buf32[CHAR1_SLOT] = offset + n;
        const buf8 = this.buf;
        for ( let i = 0; i < n; i++ ) {
            buf8[offset+i] = hn.charCodeAt(i);
        }
        return (this.lastStoredIndex = offset - this.buf32[CHAR0_SLOT]);
    }

    extractHostname(i, n) {
        const textDecoder = new TextDecoder();
        const offset = this.buf32[CHAR0_SLOT] + i;
        return textDecoder.decode(this.buf.subarray(offset, offset + n));
    }

    storeDomainOpt(s) {
        let n = s.length;
        if ( n === this.lastStoredLen && s === this.lastStored ) {
            return this.lastStoredIndex;
        }
        this.lastStored = s;
        this.lastStoredLen = n;
        if ( (this.buf.length - this.buf32[CHAR1_SLOT]) < n ) {
            this.growBuf(0, n);
        }
        const offset = this.buf32[CHAR1_SLOT];
        this.buf32[CHAR1_SLOT] = offset + n;
        const buf8 = this.buf;
        for ( let i = 0; i < n; i++ ) {
            buf8[offset+i] = s.charCodeAt(i);
        }
        return (this.lastStoredIndex = offset - this.buf32[CHAR0_SLOT]);
    }

    extractDomainOpt(i, n) {
        const textDecoder = new TextDecoder();
        const offset = this.buf32[CHAR0_SLOT] + i;
        return textDecoder.decode(this.buf.subarray(offset, offset + n));
    }

    matchesHostname(hn, i, n) {
        this.setNeedle(hn);
        const buf8 = this.buf;
        const hr = buf8[255];
        if ( n > hr ) { return false; }
        const hl = hr - n;
        const nl = this.buf32[CHAR0_SLOT] + i;
        for ( let j = 0; j < n; j++ ) {
            if ( buf8[nl+j] !== buf8[hl+j] ) { return false; }
        }
        return n === hr || hn.charCodeAt(hl-1) === 0x2E /* '.' */;
    }

    async enableWASM(wasmModuleFetcher, path) {
        if ( typeof WebAssembly === 'undefined' ) { return false; }
        if ( this.wasmMemory instanceof WebAssembly.Memory ) { return true; }
        const module = await getWasmModule(wasmModuleFetcher, path);
        if ( module instanceof WebAssembly.Module === false ) { return false; }
        const memory = new WebAssembly.Memory({ initial: 2 });
        const instance = await WebAssembly.instantiate(module, {
            imports: {
                memory,
                growBuf: this.growBuf.bind(this, 24, 256)
            }
        });
        if ( instance instanceof WebAssembly.Instance === false ) { return false; }
        this.wasmMemory = memory;
        const curPageCount = memory.buffer.byteLength >>> 16;
        const newPageCount = roundToPageSize(this.buf.byteLength) >>> 16;
        if ( newPageCount > curPageCount ) {
            memory.grow(newPageCount - curPageCount);
        }
        const buf = new Uint8Array(memory.buffer);
        buf.set(this.buf);
        this.buf = buf;
        this.buf32 = new Uint32Array(this.buf.buffer);
        this.matches = this.matchesWASM = instance.exports.matches;
        this.add = this.addWASM = instance.exports.add;
        return true;
    }

    dumpInfo() {
        return [
            `Buffer size (Uint8Array): ${this.buf32[CHAR1_SLOT].toLocaleString('en')}`,
            `  Char segment size: ${(this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT]).toLocaleString('en')}`,
            `WASM: ${this.wasmMemory === null ? 'disabled' : 'enabled'}`,
        ].join('\n');
    }

    //--------------------------------------------------------------------------
    // Private methods
    //--------------------------------------------------------------------------

    addCell(idown, iright, v) {
        let icell = this.buf32[TRIE1_SLOT];
        this.buf32[TRIE1_SLOT] = icell + 12;
        icell >>>= 2;
        this.buf32[icell+0] = idown;
        this.buf32[icell+1] = iright;
        this.buf32[icell+2] = v;
        return icell;
    }

    addLeafCell(lsegchar) {
        const r = this.buf32[TRIE1_SLOT] >>> 2;
        let i = r;
        while ( lsegchar > 127 ) {
            this.buf32[i+0] = 0;
            this.buf32[i+1] = i + 3;
            this.buf32[i+2] = this.addSegment(lsegchar, lsegchar - 127);
            lsegchar -= 127;
            i += 3;
        }
        this.buf32[i+0] = 0;
        this.buf32[i+1] = 0;
        this.buf32[i+2] = this.addSegment(lsegchar, 0) | 0x80;
        this.buf32[TRIE1_SLOT] = i + 3 << 2;
        return r;
    }

    addSegment(lsegchar, lsegend) {
        if ( lsegchar === 0 ) { return 0; }
        let char1 = this.buf32[CHAR1_SLOT];
        const isegchar = char1 - this.buf32[CHAR0_SLOT];
        let i = lsegchar;
        do {
            this.buf[char1++] = this.buf[--i];
        } while ( i !== lsegend );
        this.buf32[CHAR1_SLOT] = char1;
        return isegchar << 8 | lsegchar - lsegend;
    }

    growBuf(trieGrow, charGrow) {
        const char0 = Math.max(
            roundToPageSize(this.buf32[TRIE1_SLOT] + trieGrow),
            this.buf32[CHAR0_SLOT]
        );
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = Math.max(
            roundToPageSize(char1 + charGrow),
            this.buf.length
        );
        this.resizeBuf(bufLen, char0);
    }

    shrinkBuf() {
        // Can't shrink WebAssembly.Memory
        if ( this.wasmMemory !== null ) { return; }
        const char0 = this.buf32[TRIE1_SLOT] + 24;
        const char1 = char0 + this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        const bufLen = char1 + 256;
        this.resizeBuf(bufLen, char0);
    }

    resizeBuf(bufLen, char0) {
        bufLen = roundToPageSize(bufLen);
        if ( bufLen === this.buf.length && char0 === this.buf32[CHAR0_SLOT] ) {
            return;
        }
        const charDataLen = this.buf32[CHAR1_SLOT] - this.buf32[CHAR0_SLOT];
        if ( this.wasmMemory !== null ) {
            const pageCount = (bufLen >>> 16) - (this.buf.byteLength >>> 16);
            if ( pageCount > 0 ) {
                this.wasmMemory.grow(pageCount);
                this.buf = new Uint8Array(this.wasmMemory.buffer);
                this.buf32 = new Uint32Array(this.wasmMemory.buffer);
            }
        } else if ( bufLen !== this.buf.length ) {
            const newBuf = new Uint8Array(bufLen);
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    0,
                    this.buf32[TRIE1_SLOT]
                ),
                0
            );
            newBuf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf = newBuf;
            this.buf32 = new Uint32Array(this.buf.buffer);
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char0 + charDataLen;
        }
        if ( char0 !== this.buf32[CHAR0_SLOT] ) {
            this.buf.set(
                new Uint8Array(
                    this.buf.buffer,
                    this.buf32[CHAR0_SLOT],
                    charDataLen
                ),
                char0
            );
            this.buf32[CHAR0_SLOT] = char0;
            this.buf32[CHAR1_SLOT] = char0 + charDataLen;
        }
    }

    reallocateBuf(newSize) {
        newSize = roundToPageSize(newSize);
        if ( newSize === this.buf.length ) { return; }
        if ( this.wasmMemory === null ) {
            const newBuf = new Uint8Array(newSize);
            newBuf.set(
                newBuf.length < this.buf.length
                    ? this.buf.subarray(0, newBuf.length)
                    : this.buf
            );
            this.buf = newBuf;
        } else {
            const growBy =
                ((newSize + 0xFFFF) >>> 16) - (this.buf.length >>> 16);
            if ( growBy <= 0 ) { return; }
            this.wasmMemory.grow(growBy);
            this.buf = new Uint8Array(this.wasmMemory.buffer);
        }
        this.buf32 = new Uint32Array(this.buf.buffer);
    }
}

HNTrieContainer.prototype.matches = HNTrieContainer.prototype.matchesJS;
HNTrieContainer.prototype.matchesWASM = null;

HNTrieContainer.prototype.add = HNTrieContainer.prototype.addJS;
HNTrieContainer.prototype.addWASM = null;

/******************************************************************************/

// Code below is to attempt to load a WASM module which implements:
//
// - HNTrieContainer.add()
// - HNTrieContainer.matches()
//
// The WASM module is entirely optional, the JS implementations will be
// used should the WASM module be unavailable for whatever reason.

const getWasmModule = (( ) => {
    let wasmModulePromise;

    return async function(wasmModuleFetcher, path) {
        if ( wasmModulePromise instanceof Promise ) {
            return wasmModulePromise;
        }

        // The wasm module will work only if CPU is natively little-endian,
        // as we use native uint32 array in our js code.
        const uint32s = new Uint32Array(1);
        const uint8s = new Uint8Array(uint32s.buffer);
        uint32s[0] = 1;
        if ( uint8s[0] !== 1 ) { return; }

        wasmModulePromise = wasmModuleFetcher(`${path}hntrie`).catch(reason => {
            console.info(reason);
        });

        return wasmModulePromise;
    };
})();

/******************************************************************************/

const __default = HNTrieContainer;

return {default:__default};
},15:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2022-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/**
 * @trustedOption urlskip
 * 
 * @description
 * Extract a URL from another URL according to one or more transformation steps,
 * thereby skipping over intermediate network request(s) to remote servers.
 * Requires a trusted source.
 * 
 * @param steps
 * A serie of space-separated directives representing the transformation steps
 * to perform to extract the final URL to which a network request should be
 * redirected.
 * 
 * Supported directives:
 * 
 * `?name`: extract the value of parameter `name` as the current string.
 * 
 * `&i`: extract the name of the parameter at position `i` as the current
 *   string. The position is 1-based.
 * 
 * `#`: extract the hash as the current string.
 * 
 * `/.../`: extract the first capture group of a regex as the current string.
 * 
 * `+https`: prepend the current string with `https://`.
 * 
 * `-base64`: decode the current string as a base64-encoded string.
 * 
 * `-safebase64`: decode the current string as a safe base64-encoded string.
 * 
 * `-uricomponent`: decode the current string as a URI encoded string.
 * 
 * `-blocked`: allow the redirection of blocked requests. By default, blocked
 *  requests can't by urlskip'ed.
 * 
 * At any given step, the currently extracted string may not necessarily be
 * a valid URL, and more transformation steps may be needed to obtain a valid
 * URL once all the steps are applied.
 * 
 * An unsupported step or a failed step will abort the transformation and no
 * redirection will be performed.
 * 
 * The final step is expected to yield a valid URL. If the result is not a
 * valid URL, no redirection will be performed.
 * 
 * @example
 * ||example.com/path/to/tracker$urlskip=?url
 * ||example.com/path/to/tracker$urlskip=?url ?to
 * ||pixiv.net/jump.php?$urlskip=&1
 * ||podtrac.com/pts/redirect.mp3/$urlskip=/\/redirect\.mp3\/(.*?\.mp3\b)/ +https
 * 
 * */

function urlSkip(url, blocked, steps) {
    try {
        let redirectBlocked = false;
        let urlout = url;
        for ( const step of steps ) {
            const urlin = urlout;
            const c0 = step.charCodeAt(0);
            // Extract from hash
            if ( c0 === 0x23 && step === '#' ) { // #
                const pos = urlin.indexOf('#');
                urlout = pos !== -1 ? urlin.slice(pos+1) : '';
                continue;
            }
            // Extract from URL parameter name at position i
            if ( c0 === 0x26 ) { // &
                const i = (parseInt(step.slice(1)) || 0) - 1;
                if ( i < 0 ) { return; }
                const url = new URL(urlin);
                if ( i >= url.searchParams.size ) { return; }
                const params = Array.from(url.searchParams.keys());
                urlout = decodeURIComponent(params[i]);
                continue;
            }
            // Enforce https
            if ( c0 === 0x2B && step === '+https' ) { // +
                const s = urlin.replace(/^https?:\/\//, '');
                if ( /^[\w-]:\/\//.test(s) ) { return; }
                urlout = `https://${s}`;
                continue;
            }
            // Decode
            if ( c0 === 0x2D ) { // -
                // Base64
                if ( step === '-base64' ) {
                    urlout = self.atob(urlin);
                    continue;
                }
                // Safe Base64
                if ( step === '-safebase64' ) {
                    if ( urlSkip.safeBase64Replacer === undefined ) {
                        urlSkip.safeBase64Map = { '-': '+', '_': '/' };
                        urlSkip.safeBase64Replacer = s => urlSkip.safeBase64Map[s];
                    }
                    urlout = urlin.replace(/[-_]/g, urlSkip.safeBase64Replacer);
                    urlout = self.atob(urlout);
                    continue;
                }
                // URI component
                if ( step === '-uricomponent' ) {
                    urlout = decodeURIComponent(urlin);
                    continue;
                }
                // Enable skip of blocked requests
                if ( step === '-blocked' ) {
                    redirectBlocked = true;
                    continue;
                }
            }
            // Regex extraction from first capture group
            if ( c0 === 0x2F ) { // /
                const re = new RegExp(step.slice(1, -1));
                const match = re.exec(urlin);
                if ( match === null ) { return; }
                if ( match.length <= 1 ) { return; }
                urlout = match[1];
                continue;
            }
            // Extract from URL parameter
            if ( c0 === 0x3F ) { // ?
                urlout = (new URL(urlin)).searchParams.get(step.slice(1));
                if ( urlout === null ) { return; }
                if ( urlout.includes(' ') ) {
                    urlout = urlout.replace(/ /g, '%20');
                }
                continue;
            }
            // Unknown directive
            return;
        }
        const urlfinal = new URL(urlout);
        if ( urlfinal.protocol !== 'https:' ) {
            if ( urlfinal.protocol !== 'http:' ) { return; }
        }
        if ( blocked && redirectBlocked !== true ) { return; }
        return urlout;
    } catch {
    }
}

return {urlSkip:urlSkip};
},16:function(require){/**
*
*   Regex
*   @version: 1.2.0
*
*   A simple & generic Regular Expression Analyzer & Composer for PHP, Python, Javascript
*   https://github.com/foo123/RegexAnalyzer
*
**/
const __default = (function(root, name, factory) {
"use strict";
var __version__ = "1.2.0",

    PROTO = 'prototype', OP = Object[PROTO], AP = Array[PROTO],
    Keys = Object.keys, to_string = OP.toString, HAS = OP.hasOwnProperty,
    fromCharCode = String.fromCharCode,
    fromCodePoint = String.fromCodePoint || String.fromCharCode,
    CHAR = 'charAt', CHARCODE = 'charCodeAt',
    CODEPOINT = String.prototype.codePointAt ? 'codePointAt' : CHARCODE,
    toJSON = JSON.stringify,
    INF = Infinity, ESC = '\\',
    specialChars = {
        "." : "MatchAnyChar",
        "|" : "MatchEither",
        "?" : "MatchZeroOrOne",
        "*" : "MatchZeroOrMore",
        "+" : "MatchOneOrMore",
        "^" : "MatchStart",
        "$" : "MatchEnd",
        "{" : "StartRepeats",
        "}" : "EndRepeats",
        "(" : "StartGroup",
        ")" : "EndGroup",
        "[" : "StartCharGroup",
        "]" : "EndCharGroup"
    },
    /*
        http://www.javascriptkit.com/javatutors/redev2.shtml

        \f matches form-feed.
        \r matches carriage return.
        \n matches linefeed.
        \t matches horizontal tab.
        \v matches vertical tab.
        \0 matches NUL character.
        [\b] matches backspace.
        \s matches whitespace (short for [\f\n\r\t\v\u00A0\u2028\u2029]).
        \S matches anything but a whitespace (short for [^\f\n\r\t\v\u00A0\u2028\u2029]).
        \w matches any alphanumerical character (word characters) including underscore (short for [a-zA-Z0-9_]).
        \W matches any non-word characters (short for [^a-zA-Z0-9_]).
        \d matches any digit (short for [0-9]).
        \D matches any non-digit (short for [^0-9]).
        \b matches a word boundary (the position between a word and a space).
        \B matches a non-word boundary (short for [^\b]).
        \cX matches a control character. E.g: \cm matches control-M.
        \xhh matches the character with two characters of hexadecimal code hh.
        \uhhhh matches the Unicode character with four characters of hexadecimal code hhhh.
    */
    specialCharsEscaped = {
        "\\" : "ESC",
        "/" : "/",
        "0" : "NULChar",
        "f" : "FormFeed",
        "n" : "LineFeed",
        "r" : "CarriageReturn",
        "t" : "HorizontalTab",
        "v" : "VerticalTab",
        "b" : "MatchWordBoundary",
        "B" : "MatchNonWordBoundary",
        "s" : "MatchSpaceChar",
        "S" : "MatchNonSpaceChar",
        "w" : "MatchWordChar",
        "W" : "MatchNonWordChar",
        "d" : "MatchDigitChar",
        "D" : "MatchNonDigitChar"
    },
    T_SEQUENCE = 1,
    T_ALTERNATION = 2,
    T_GROUP = 4,
    T_CHARGROUP = 8,
    T_QUANTIFIER = 16,
    T_UNICODECHAR = 32,
    T_HEXCHAR = 64,
    T_SPECIAL = 128,
    T_CHARS = 256,
    T_CHARRANGE = 512,
    T_STRING = 1024,
    T_COMMENT = 2048
;

function is_array(x)
{
    return (x instanceof Array) || ('[object Array]' === to_string.call(x));
}
function is_string(x)
{
    return (x instanceof String) || ('[object String]' === to_string.call(x));
}
function is_regexp(x)
{
    return (x instanceof RegExp) || ('[object RegExp]' === to_string.call(x));
}
function array(x)
{
    return is_array(x) ? x : [x];
}
function clone(obj, cloned)
{
    cloned = cloned || {};
    for (var p in obj) if (HAS.call(obj,p)) cloned[p] = obj[p];
    return cloned;
}
function RE_OBJ(re, flags, flavor)
{
    var self = this;
    self.re = re;
    self.flags = flags;
    self.flavor = flavor;
    self.len = re.length;
    self.pos = 0;
    self.index = 0;
    self.groupIndex = 0;
    self.group = {};
    self.inGroup = 0;
}
RE_OBJ[PROTO] = {
     constructor: RE_OBJ
    ,re: null
    ,flags: null
    ,flavor: ''
    ,len: null
    ,pos: null
    ,index: null
    ,groupIndex: null
    ,inGroup: null
    ,groups: null
    ,dispose: function() {
        var self = this;
        self.re = null;
        self.flags = null;
        self.flavor = null;
        self.len = null;
        self.pos = null;
        self.index = null;
        self.groupIndex = null;
        self.group = null;
        self.inGroup = null;
    }
};
function Node(type, value, flags)
{
    var self = this;
    if (!(self instanceof Node)) return new Node(type, value, flags);
    self.type = type;
    self.val = value;
    self.flags = flags || {};
    switch (type)
    {
        case T_SEQUENCE:
            self.typeName = "Sequence"; break;
        case T_ALTERNATION:
            self.typeName = "Alternation"; break;
        case T_GROUP:
            self.typeName = "Group"; break;
        case T_CHARGROUP:
            self.typeName = "CharacterGroup"; break;
        case T_CHARS:
            self.typeName = "Characters"; break;
        case T_CHARRANGE:
            self.typeName = "CharacterRange"; break;
        case T_STRING:
            self.typeName = "String"; break;
        case T_QUANTIFIER:
            self.typeName = "Quantifier"; break;
        case T_UNICODECHAR:
            self.typeName = "UnicodeChar"; break;
        case T_HEXCHAR:
            self.typeName = "HexChar"; break;
        case T_SPECIAL:
            self.typeName = "Special"; break;
        case T_COMMENT:
            self.typeName = "Comment"; break;
        default:
            self.typeName = "unspecified"; break;
    }
};
Node.toObjectStatic = function toObject(v) {
    if (v instanceof Node)
    {
        return v.flags && Object.keys(v.flags).length ? {
            type: v.typeName,
            value: toObject(v.val),
            flags: v.flags
        } : {
            type: v.typeName,
            value: toObject(v.val)
        };
    }
    else if (is_array(v))
    {
        return v.map(toObject);
    }
    return v;
};
Node[PROTO] = {
    constructor: Node
    ,type: null
    ,typeName: null
    ,val: null
    ,flags: null
    ,dispose: function() {
        var self = this;
        self.val = null;
        self.flags = null;
        self.type = null;
        self.typeName = null;
        return self;
    }
    ,toObject: function() {
        return Node.toObjectStatic(this);
    }
};

var rnd = function(a, b) {return Math.round((b-a)*Math.random()+a);},
    RE = function(re, fl) {return new RegExp(re, fl||'');},
    slice = function(a) {return AP.slice.apply(a, AP.slice.call(arguments, 1));},
    flatten = function(a) {
        var r = [], i = 0;
        while (i < a.length) r = r.concat(a[i++]);
        return r;
    },
    getArgs = function(args, asArray) {
        /*var a = slice(args);
        if ( asArray && a[0] &&
            ( a[0] instanceof Array || '[object Array]' == to_string.call(a[0]) )
        )
            a = a[0];*/
        return flatten(slice(args)); //a;
    },
    esc_re = function(s, esc, chargroup) {
        var es = '', l = s.length, i=0, c;
        //escaped_re = /([.*+?^${}()|[\]\/\\\-])/g
        if (chargroup)
        {
            while (i < l)
            {
                c = s[CHAR](i++);
                es += (/*('?' === c) || ('*' === c) || ('+' === c) ||*/
                        ('-' === c) || /*('.' === c) ||*/ ('^' === c) || ('$' === c) || ('|' === c) ||
                        ('{' === c) || ('}' === c) || ('(' === c) || (')' === c) ||
                        ('[' === c) || (']' === c) || ('/' === c) || (esc === c) ? esc : '') + c;
            }
        }
        else
        {
            while (i < l)
            {
                c = s[CHAR](i++);
                es += (('?' === c) || ('*' === c) || ('+' === c) ||
                    /*('-' === c) ||*/ ('.' === c) || ('^' === c) || ('$' === c) || ('|' === c) ||
                    ('{' === c) || ('}' === c) || ('(' === c) || (')' === c) ||
                    ('[' === c) || (']' === c) || ('/' === c) || (esc === c) ? esc : '') + c;
            }
        }
        return es;
    },
    pad = function(s, n, z) {
        var ps = String(s);
        z = z || '0';
        while (ps.length < n) ps = z + ps;
        return ps;
    },
    char_code = function(c) {return c[CODEPOINT](0);},
    char_code_range = function(s) {return [s[CODEPOINT](0), s[CODEPOINT](s.length-1)];},
    //char_codes = function( s_or_a ) { return (s_or_a.substr ? s_or_a.split("") : s_or_a).map( char_code ); },
    // http://stackoverflow.com/questions/12376870/create-an-array-of-characters-from-specified-range
    character_range = function(first, last) {
        if (first && is_array(first)) {last = first[1]; first = first[0];}
        var ch, chars, start = first[CODEPOINT](0), end = last[CODEPOINT](0);

        if (end === start) return [fromCodePoint(start)];

        chars = [];
        for (ch = start; ch <= end; ++ch) chars.push(fromCodePoint(ch));
        return chars;
    },
    concat = function(p1, p2) {
        if (p2)
        {
            var p, l;
            if (is_array(p2))
            {
                for (p=0,l=p2.length; p<l; ++p) p1[p2[p]] = 1;
            }
            else
            {
                for (p in p2) if (HAS.call(p2, p)) p1[p] = 1;
            }
        }
        return p1;
    },

    BSPACES = "\r\n", SPACES = " \t\v", PUNCTS = "~!@#$%^&*()-+=[]{}\\|;:,./<>?",
    DIGITS = "0123456789", DIGITS_RANGE = char_code_range(DIGITS),
    HEXDIGITS_RANGES = [DIGITS_RANGE, [char_code("a"), char_code("f")], [char_code("A"), char_code("F")]],
    ALPHAS = "_"+(character_range("a", "z").join(""))+(character_range("A", "Z").join("")),
    ALL = SPACES+PUNCTS+DIGITS+ALPHAS, ALL_ARY = ALL.split(""),

    match_chars = function(CHARS, s, pos, minlen, maxlen) {
        pos = pos || 0;
        minlen = minlen || 1;
        maxlen = maxlen || INF;
        var lp = pos, l = 0, sl = s.length, ch;
        while ((lp < sl) && (l <= maxlen) && -1 < CHARS.indexOf(ch=s[CHAR](lp)))
        {
            ++lp; ++l;
        }
        return l >= minlen ? l : false;
    },
    match_char_range = function(RANGE, s, pos, minlen, maxlen) {
        pos = pos || 0;
        minlen = minlen || 1;
        maxlen = maxlen || INF;
        var lp = pos, l = 0, sl = s.length, ch;
        while ((lp < sl) && (l <= maxlen) && ((ch=s[CHARCODE](lp)) >= RANGE[0] && ch <= RANGE[1]))
        {
            ++lp; ++l;
        }
        return l >= minlen ? l : false;
    },
    match_char_ranges = function(RANGES, s, pos, minlen, maxlen) {
        pos = pos || 0;
        minlen = minlen || 1;
        maxlen = maxlen || INF;
        var lp = pos, l = 0, sl = s.length, ch,
            i, Rl = RANGES.length, RANGE, found = true;
        while ((lp < sl) && (l <= maxlen) && found)
        {
            ch = s[CHARCODE](lp); found = false;
            for (i=0; i<Rl; ++i)
            {
                RANGE = RANGES[i];
                if (ch >= RANGE[0] && ch <= RANGE[1])
                {
                    ++lp; ++l; found = true;
                    break;
                }
            }
        }
        return l >= minlen ? l : false;
    },

    punct = function() {
        return PUNCTS[CHAR](rnd(0, PUNCTS.length-1));
    },
    space = function(positive) {
        return false !== positive
            ? SPACES[CHAR](rnd(0, SPACES.length-1))
            : (punct()+digit()+alpha())[CHAR](rnd(0, 2))
        ;
    },
    digit = function(positive) {
        return false !== positive
            ? DIGITS[CHAR](rnd(0, DIGITS.length-1))
            : (punct()+space()+alpha())[CHAR](rnd(0, 2))
        ;
    },
    alpha = function(positive) {
        return false !== positive
            ? ALPHAS[CHAR](rnd(0, ALPHAS.length-1))
            : (punct()+space()+digit())[CHAR](rnd(0, 2))
        ;
    },
    word = function(positive) {
        return false !== positive
            ? (ALPHAS+DIGITS)[CHAR](rnd(0, ALPHAS.length+DIGITS.length-1))
            : (punct()+space())[CHAR](rnd(0, 1))
        ;
    },
    any = function() {
        return ALL[CHAR](rnd(0, ALL.length-1));
    },
    character = function(chars, positive) {
        if (false !== positive) return chars.length ? chars[rnd(0, chars.length-1)] : '';
        var choices = ALL_ARY.filter(function(c) {return 0 > chars.indexOf(c);});
        return choices.length ? choices[rnd(0, choices.length-1)] : '';
    },
    random_upper_or_lower = function(c) {return 0.5 < Math.random() ? c.toLowerCase() : c.toUpperCase();},
    case_insensitive = function(chars, asArray) {
        if (asArray)
        {
            if (chars[CHAR]) chars = chars.split('');
            chars = chars.map(random_upper_or_lower);
            //if ( !asArray ) chars = chars.join('');
            return chars;
        }
        else
        {
            return random_upper_or_lower(chars);
        }
    },

    walk = function walk(ret, node, state) {
        if ((null == node) || !state) return ret;

        var i, l, r, type = node instanceof Node ? node.type : null;

        // walk the tree
        if (null === type)
        {
            // custom, let reduce handle it
            ret = state.reduce(ret, node, state);
        }

        else if (state.IGNORE & type)
        {
            /* nothing */
        }

        else if (state.MAP & type)
        {
            r = state.map(ret, node, state);
            if (null != state.ret)
            {
                ret = state.reduce(ret, node, state);
                state.ret = null;
            }
            else if (null != r)
            {
                r = array(r);
                for (i=0,l=r?r.length:0; i<l; ++i)
                {
                    state.node = node;
                    ret = walk(ret, r[i], state);
                    if (state.stop)
                    {
                        state.stop = null;
                        return ret;
                    }
                }
            }
        }

        else if (state.REDUCE & type)
        {
            ret = state.reduce(ret, node, state);
        }

        state.node = null;
        return ret;
    },
    /*map_all = function map_all( ret, node, state ) {
        return node.val;
    },*/
    map_src = function map_src(ret, node, state) {
        var type = node.type;
        if (T_ALTERNATION === type)
        {
            var r = [];
            for (var i=0,l=node.val.length-1; i<l; ++i) r.push(node.val[i], '|');
            r.push(node.val[l]);
            return r;
        }
        else if (T_CHARGROUP === type)
        {
            return [].concat('['+(node.flags.NegativeMatch?'^':'')).concat(array(node.val)).concat(']');
        }
        else if (T_QUANTIFIER === type)
        {
            var q = '';
            if (node.flags.MatchZeroOrOne) q = '?';
            else if (node.flags.MatchZeroOrMore) q = '*';
            else if (node.flags.MatchOneOrMore) q = '+';
            else q = node.flags.min === node.flags.max ? ('{'+node.flags.min+'}') : ('{'+node.flags.min+','+(-1===node.flags.max?'':node.flags.max)+'}');
            if ((node.flags.min !== node.flags.max) && !node.flags.isGreedy) q += '?';
            return [].concat(array(node.val)).concat(q);
        }
        else if (T_GROUP === type)
        {
            var g = null;
            if (node.flags.NotCaptured)
            {
                g = [].concat('(?:').concat(array(node.val)).concat(')');
            }
            else if (node.flags.LookAhead)
            {
                g = [].concat('(?=').concat(array(node.val)).concat(')');
            }
            else if (node.flags.NegativeLookAhead)
            {
                g = [].concat('(?!').concat(array(node.val)).concat(')');
            }
            else if (node.flags.LookBehind)
            {
                g = [].concat('(?<=').concat(array(node.val)).concat(')');
            }
            else if (node.flags.NegativeLookBehind)
            {
                g = [].concat('(?<!').concat(array(node.val)).concat(')');
            }
            else if (node.flags.NamedGroup && !state.compatibility)
            {
                g = [].concat('(?<'+node.flags.GroupName+'>').concat(array(node.val)).concat(')');
            }
            else
            {
                g = [].concat('(').concat(array(node.val)).concat(')');
            }
            if (null != node.flags.GroupIndex)
            {
                ret.group[node.flags.GroupIndex] = node.flags.GroupIndex;
                if (node.flags.GroupName) ret.group[node.flags.GroupName] = node.flags.GroupIndex;
            }
            return g;
        }
        return node.val;
    },
    map_any = function map_any(ret, node, state) {
        var type = node.type;
        if ((T_ALTERNATION === type) || (T_CHARGROUP === type))
        {
            return node.val.length ? node.val[rnd(0, node.val.length-1)] : null;
        }
        else if (T_QUANTIFIER === type)
        {
            var numrepeats, mmin, mmax, repeats;
            if (ret.length >= state.maxLength)
            {
                numrepeats = node.flags.min;
            }
            else
            {
                mmin = node.flags.min;
                mmax = -1 === node.flags.max ? (mmin+1+2*state.maxLength) : node.flags.max;
                numrepeats = rnd(mmin, mmax);
            }
            if (numrepeats)
            {
                repeats = new Array(numrepeats);
                for (var i=0; i<numrepeats; ++i) repeats[i] = node.val;
                return repeats;
            }
            else
            {
                return null;
            }
        }
        else if ((T_GROUP === type) && node.flags.GroupIndex)
        {
            var sample = walk('', node.val, state);
            state.group[node.flags.GroupIndex] = sample;
            state.ret = sample;
            return null;
        }
        else
        {
            return node.val;
        }
    },
    map_min = function map_min(ret, node, state) {
        var type = node.type;
        if (T_ALTERNATION === type)
        {
            var i, l = node.val.length, cur,
                min = l ? walk(0, node.val[0], state) : 0;
            for (i=1; i<l; ++i)
            {
                cur = walk(0, node.val[i], state);
                if (cur < min) min = cur;
            }
            if (l) state.ret = min;
            return null;
        }
        else if (T_CHARGROUP === type)
        {
            return node.val.length ? node.val[0] : null;
        }
        else if (T_QUANTIFIER === type)
        {
            if (0 === node.flags.min) return null;
            var i, nrepeats = node.flags.min, repeats = new Array(nrepeats);
            for (i=0; i<nrepeats; ++i) repeats[i] = node.val;
            return repeats;
        }
        else if ((T_GROUP === type) && node.flags.GroupIndex)
        {
            var min = walk(0, node.val, state);
            state.group[node.flags.GroupIndex] = min;
            state.ret = min;
            return null;
        }
        else
        {
            return node.val;
        }
    },
    map_max = function map_max(ret, node, state) {
        var type = node.type;
        if (T_ALTERNATION === type)
        {
            var i, l = node.val.length, cur, max = l ? walk(0, node.val[0], state) : 0;
            if (-1 !== max)
            {
                for (i=1; i<l; ++i)
                {
                    cur = walk(0, node.val[i], state);
                    if (-1 === cur)
                    {
                        max = -1;
                        break;
                    }
                    else if (cur > max)
                    {
                        max = cur;
                    }
                }
            }
            if (l) state.ret = max;
            return null;
        }
        else if (T_CHARGROUP === type)
        {
            return node.val.length ? node.val[0] : null;
        }
        else if (T_QUANTIFIER === type)
        {
            max = walk(0, node.val, state);
            if (-1 === max)
            {
                state.ret = -1;
            }
            else if (0 < max)
            {
                if (-1 === node.flags.max)
                {
                    state.ret = -1;
                }
                else if (0 < node.flags.max)
                {
                    state.ret = node.flags.max*max;
                }
                else
                {
                    state.ret = max;
                }
            }
            return null;
        }
        else if ((T_GROUP === type) && node.flags.GroupIndex)
        {
            var max = walk(0, node.val, state);
            state.group[node.flags.GroupIndex] = max;
            state.ret = max;
            return null;
        }
        else
        {
            return node.val;
        }
    },
    map_1st = function map_1st(ret, node, state) {
        var type = node.type;
        if (T_SEQUENCE === type)
        {
            var seq=[], i=0, l=node.val.length, n;
            for (i=0; i<l; ++i)
            {
                n = node.val[i];
                seq.push( n );
                if ((T_QUANTIFIER === n.type) && (0 === n.flags.min))
                    continue;
                else if ((T_SPECIAL === n.type) && (n.flags.MatchStart || n.flags.MatchEnd))
                    continue;
                break;
            }
            return seq.length ? seq : null;
        }
        else
        {
            return node.val;
        }
    },
    reduce_len = function reduce_len(ret, node, state) {
        if (null != state.ret)
        {
            if (-1 === state.ret) ret = -1;
            else ret += state.ret;
            return ret;
        }
        if (-1 === ret) return ret;

        if (node === +node)
        {
            ret += node;
            return ret;
        }

        if ((T_SPECIAL === node.type) && node.flags.MatchEnd)
        {
            state.stop = 1;
            return ret;
        }
        var type = node.type;

        if (
            (T_CHARS === type) || (T_CHARRANGE === type) ||
            (T_UNICODECHAR === type) || (T_HEXCHAR === type) ||
            ((T_SPECIAL === type) && !node.flags.MatchStart && !node.flags.MatchEnd)
        )
        {
            ret += node.flags.BackReference ? state.group[node.flags.GroupIndex]||0 : 1;
        }
        else if (T_STRING === type)
        {
            ret += node.val.length;
        }

        return ret;
    },
    reduce_str = function reduce_str(ret, node, state) {
        if (null != state.ret)
        {
            ret += state.ret;
            return ret;
        }

        if (is_string(node))
        {
            ret += node;
            return ret;
        }

        if ((T_SPECIAL === node.type) && node.flags.MatchEnd)
        {
            state.stop = 1;
            return ret;
        }
        var type = node.type, sample = null;

        if (T_CHARS === type)
        {
            sample = node.val;
        }
        else if (T_CHARRANGE === type)
        {
            var range = [node.val[0], node.val[1]];
            if (T_UNICODECHAR === range[0].type || T_HEXCHAR === range[0].type) range[0] = range[0].flags.Char;
            if (T_UNICODECHAR === range[1].type || T_HEXCHAR === range[1].type) range[1] = range[1].flags.Char;
            sample = character_range(range);
        }
        else if ((T_UNICODECHAR === type) || (T_HEXCHAR === type))
        {
            sample = [node.flags.Char];
        }
        else if ((T_SPECIAL === type) && !node.flags.MatchStart && !node.flags.MatchEnd)
        {
            var part = node.val;
            if (node.flags.BackReference)
            {
                part = node.flags.GroupIndex;
                ret += HAS.call(state.group, part) ? state.group[part] : '';
                return ret;
            }
            else if ('D' === part)
            {
                sample = [digit(false)];
            }
            else if ('W' === part)
            {
                sample = [word(false)];
            }
            else if ('S' === part)
            {
                sample = [space(false)];
            }
            else if ('d' === part)
            {
                sample = [digit()];
            }
            else if ('w' === part)
            {
                sample = [word()];
            }
            else if ('s' === part)
            {
                sample = [space()];
            }
            else if (('.' === part) && node.flags.MatchAnyChar)
            {
                sample = [any()];
            }
            else
            {
                sample = [ESC + part];
            }
        }
        else if (T_STRING === type)
        {
            sample = node.val;
        }

        if (sample)
        {
            ret += T_STRING === type ?
            (state.isCaseInsensitive ? case_insensitive(sample) : sample) :
            (character(state.isCaseInsensitive ? case_insensitive(sample, true) : sample, !state.node || !state.node.flags.NegativeMatch))
            ;
        }

        return ret;
    },
    reduce_src = function reduce_src(ret, node, state) {
        if (null != state.ret)
        {
            if (state.ret.src) ret.src += state.ret.src;
            if (state.ret.group) ret.group = clone(state.ret.group, ret.group);
            return ret;
        }

        if (is_string(node))
        {
            ret.src += node;
            return ret;
        }

        var type = node.type;
        if (T_CHARS === type)
        {
            ret.src += state.escaped ? esc_re(node.val.join(''), ESC, 1) : node.val.join('');
        }
        else if (T_CHARRANGE === type)
        {
            var range = [node.val[0], node.val[1]];
            if (state.escaped)
            {
                if (T_UNICODECHAR === range[0].type) range[0] = range[0].flags.UnicodePoint ? ESC+'u{'+range[0].flags.Code+'}' : ESC+'u'+pad(range[0].flags.Code,4);
                else if (T_HEXCHAR === range[0].type) range[0] = ESC+'x'+pad(range[0].flags.Code,2);
                else range[0] = esc_re(range[0], ESC, 1);
                if (T_UNICODECHAR === range[1].type) range[1] = range[1].flags.UnicodePoint ? ESC+'u{'+range[1].flags.Code+'}' : ESC+'u'+pad(range[1].flags.Code,4);
                else if (T_HEXCHAR === range[1].type) range[1] = ESC+'x'+pad(range[1].flags.Code,2);
                else range[1] = esc_re(range[1], ESC, 1);
            }
            else
            {
                if (T_UNICODECHAR === range[0].type || T_HEXCHAR === range[0].type) range[0] = range[0].flags.Char;
                if (T_UNICODECHAR === range[1].type || T_HEXCHAR === range[1].type) range[1] = range[1].flags.Char;
            }
            ret.src += range[0]+'-'+range[1];
        }
        else if (T_UNICODECHAR === type)
        {
            ret.src += node.flags.UnicodePoint ? ESC+'u{'+node.flags.Code+'}' : (state.escaped ? ESC+'u'+pad(node.flags.Code,4) : node.flags.Char);
        }
        else if (T_HEXCHAR === type)
        {
            ret.src += state.escaped ? ESC+'x'+pad(node.flags.Code,2) : node.flags.Char;
        }
        else if (T_SPECIAL === type)
        {
            if (node.flags.BackReference)
            {
                if (state.compatibility || (node.flags.GroupIndex === node.flags.GroupName))
                {
                    ret.src += ESC+node.flags.GroupIndex;
                }
                else
                {
                    ret.src += ESC+'k<'+node.flags.GroupName+'>';
                }
            }
            else
            {
                ret.src += node.flags.MatchAnyChar || node.flags.MatchStart || node.flags.MatchEnd ? (''+node.val) : (ESC+node.val);
            }
        }
        else if (T_STRING === type)
        {
            ret.src += state.escaped ? esc_re(node.val, ESC) : node.val;
        }

        return ret;
    },
    reduce_peek = function reduce_peek(ret, node, state) {
        if (null != state.ret)
        {
            ret.positive = concat(ret.positive, state.ret.positive);
            ret.negative = concat(ret.negative, state.ret.negative);
            return ret;
        }
        if ((T_SPECIAL === node.type) && node.flags.MatchEnd)
        {
            state.stop = 1;
            return ret;
        }

        var type = node.type, inCharGroup = state.node && (T_CHARGROUP === state.node.type),
            inNegativeCharGroup = inCharGroup && state.node.flags.NegativeMatch,
            peek = inNegativeCharGroup ? "negative" : "positive";

        if (T_CHARS === type)
        {
            ret[peek] = concat(ret[peek], node.val);
        }
        else if (T_CHARRANGE === type)
        {
            var range = [node.val[0],node.val[1]];
            if (T_UNICODECHAR === range[0].type || T_HEXCHAR === range[0].type) range[0] = range[0].flags.Char;
            if (T_UNICODECHAR === range[1].type || T_HEXCHAR === range[1].type) range[1] = range[1].flags.Char;
            ret[peek] = concat(ret[peek], character_range(range));
        }
        else if ((T_UNICODECHAR === type) || (T_HEXCHAR === type))
        {
            ret[peek][node.flags.Char] = 1;
        }
        else if ((T_SPECIAL === type) && !node.flags.BackReference && !node.flags.MatchStart && !node.flags.MatchEnd)
        {
            var part = node.val;
            if ('D' === part)
            {
                ret[inNegativeCharGroup?"positive":"negative"][ '\\d' ] = 1;
            }
            else if ('W' === part)
            {
                ret[inNegativeCharGroup?"positive":"negative"][ '\\w' ] = 1;
            }
            else if ('S' === part)
            {
                ret[inNegativeCharGroup?"positive":"negative"][ '\\s' ] = 1;
            }
            else if ('B' === part)
            {
                ret[inNegativeCharGroup?"positive":"negative"][ '\\b' ] = 1;
            }
            else
            {
                ret[peek][ESC + part] = 1;
            }
        }
        else if (T_STRING === type)
        {
            ret["positive"][node.val[CHAR](0)] = 1;
        }

        return ret;
    },

    match_hex = function(s) {
        var m = false;
        if ((s.length > 2) && ('x' === s[CHAR](0)))
        {
            if (match_char_ranges(HEXDIGITS_RANGES, s, 1, 2, 2)) return [m=s.slice(0,3), m.slice(1)];
        }
        return false;
    },
    match_unicode = function(s, flags) {
        var m = false, l;
        if ((s.length > 3) && ('u' === s[CHAR](0)))
        {
            if (flags.u && '{' === s[CHAR](1) && (l=match_char_ranges(HEXDIGITS_RANGES, s, 2, 1, 6)) && '}' === s[CHAR](l+2))
            {
                return [m=s.slice(0,l+3), m.slice(2, -1), 1];
            }
            else if (l=match_char_ranges(HEXDIGITS_RANGES, s, 1, 4, 4))
            {
                return [m=s.slice(0,l+1), m.slice(1), 0];
            }
        }
        return false;
    },
    match_repeats = function(s) {
        var l, sl = s.length, pos = 0, m = false, hasComma = false;
        if ((sl > 2) && ('{' === s[CHAR](pos)))
        {
            m = ['', '', null];
            ++pos;
            if (l=match_chars(SPACES, s, pos)) pos += l;
            if (l=match_char_range(DIGITS_RANGE, s, pos))
            {
                m[1] = s.slice(pos, pos+l);
                pos += l;
            }
            else
            {
                return false;
            }
            if (l=match_chars(SPACES, s, pos)) pos += l;
            if ((pos < sl) && (',' === s[CHAR](pos))) {pos += 1; hasComma = true;}
            if (l=match_chars(SPACES, s, pos)) pos += l;
            if (l=match_char_range(DIGITS_RANGE, s, pos))
            {
                m[2] = s.slice(pos, pos+l);
                pos += l;
            }
            if (l=match_chars(SPACES, s, pos)) pos += l;
            if ((pos < sl) && ('}' === s[CHAR](pos)))
            {
                pos++;
                m[0] = s.slice(0, pos);
                if (!hasComma) m[2] = m[1];
                return m;
            }
            else
            {
                return false;
            }
        }
        return false;
    },
    chargroup = function chargroup(re_obj) {
        var sequence = [], chars = [], allchars = [], flags = {}, flag, ch, lre,
        prevch = null, range, isRange = false, m, isUnicode, isHex, isSpecial, escaped = false;

        if ('^' === re_obj.re[CHAR](re_obj.pos))
        {
            flags["NegativeMatch"] = 1;
            ++re_obj.pos;
        }

        lre = re_obj.len;
        while (re_obj.pos < lre)
        {
            isUnicode = false;
            isHex = false;
            isSpecial = false;
            m = null;
            prevch = ch;
            ch = re_obj.re[CHAR](re_obj.pos++);

            escaped = ESC === ch;
            if (escaped) ch = re_obj.re[CHAR](re_obj.pos++);

            if (escaped)
            {
                // unicode character
                if ('u' === ch)
                {
                    m = match_unicode(re_obj.re.substr(re_obj.pos-1), re_obj.flags);
                    if (m)
                    {
                        re_obj.pos += m[0].length-1;
                        ch = Node(T_UNICODECHAR, m[0], {"Char": m[2] ? fromCodePoint(parseInt(m[1], 16)) : fromCharCode(parseInt(m[1], 16)), "Code": m[1], "UnicodePoint": !!m[2]});
                        isUnicode = true; isHex = false;
                    }
                }

                // hex character
                else if ('x' === ch)
                {
                    m = match_hex(re_obj.re.substr(re_obj.pos-1));
                    if (m)
                    {
                        re_obj.pos += m[0].length-1;
                        ch = Node(T_HEXCHAR, m[0], {"Char": fromCharCode(parseInt(m[1], 16)), "Code": m[1]});
                        isUnicode = true; isHex = true;
                    }
                }

                // special character
                else if (HAS.call(specialCharsEscaped, ch) && ('/' !== ch))
                {
                    isSpecial = true;
                    flag = {};
                    flag[specialCharsEscaped[ch]] = 1;
                    ch = Node(T_SPECIAL, ch, flag);
                }
            }

            if (isRange)
            {
                if (
                    (ch instanceof Node) &&
                    (ch.type === T_SPECIAL) &&
                    (-1 !== ['s','S','d','D','w','W'].indexOf(ch.val))
                )
                {
                    if (range[0] instanceof Node)
                    {
                        sequence.push(range[0]);
                    }
                    else
                    {
                        chars.push(range[0]);
                    }
                    chars.push('-');
                    sequence.push(ch);
                }
                else
                {
                    if (chars.length)
                    {
                        allchars = allchars.concat(chars);
                        chars = [];
                    }
                    range[1] = ch;
                    sequence.push(Node(T_CHARRANGE, range));
                }
                isRange = false;
            }
            else
            {
                if (escaped)
                {
                    if (isUnicode)
                    {
                        if (chars.length)
                        {
                            allchars = allchars.concat(chars);
                            chars = [];
                        }
                        sequence.push(ch);
                    }

                    else if (isSpecial)
                    {
                        if (chars.length)
                        {
                            allchars = allchars.concat(chars);
                            chars = [];
                        }
                        sequence.push(ch);
                    }

                    else
                    {
                        chars.push(ch);
                    }
                }

                else
                {
                    // end of char group
                    if (']' === ch)
                    {
                        if (chars.length)
                        {
                            allchars = allchars.concat(chars);
                            chars = [];
                        }
                        // map all chars into one node
                        if (allchars.length) sequence.push(Node(T_CHARS, allchars));
                        return Node(T_CHARGROUP, sequence, flags);
                    }

                    else if ('-' === ch)
                    {
                        if (
                            null == prevch ||
                            ']' === re_obj.re[CHAR](re_obj.pos) ||
                            (
                            (prevch instanceof Node) &&
                            (prevch.type === T_SPECIAL) &&
                            (-1 !== ['s','S','d','D','w','W'].indexOf(prevch.val))
                            )
                        )
                        {
                            // take it as literal
                            // https://github.com/foo123/RegexAnalyzer/issues/5
                            chars.push(ch);
                        }
                        else
                        {
                            range = [prevch, ''];
                            if (prevch instanceof Node) sequence.pop(); else chars.pop();
                            isRange = true;
                        }
                    }

                    else
                    {
                        chars.push(ch);
                    }
                }
            }
        }
        if (chars.length)
        {
            allchars = allchars.concat(chars);
            chars = [];
        }
        // map all chars into one node
        if (allchars.length) sequence.push(Node(T_CHARS, allchars));
        return Node(T_CHARGROUP, sequence, flags);
    },

    analyze_re = function analyze_re(re_obj) {
        var lre, ch, m, word = '', wordlen = 0,
            alternation = [], sequence = [], flags = {},
            flag, escaped = false, pre, pre3, captured;

        if (re_obj.inGroup > 0)
        {
            pre = re_obj.re.substr(re_obj.pos, 2);
            pre3 = re_obj.re.substr(re_obj.pos, 3);
            captured = 1;

            if ("?P=" === pre3)
            {
                flags["BackReference"] = 1;
                flags["GroupName"] = '';
                re_obj.pos += 3;
                lre = re_obj.len;
                while (re_obj.pos < lre)
                {
                    ch = re_obj.re[CHAR](re_obj.pos++);
                    if (")" === ch) break;
                    flags["GroupName"] += ch;
                }
                flags["GroupIndex"] = HAS.call(re_obj.group, flags["GroupName"]) ? re_obj.group[flags["GroupName"]] : null;
                return Node(T_SPECIAL, flags["GroupName"], flags);
            }

            else if ("?#" === pre)
            {
                flags["Comment"] = 1;
                re_obj.pos += 2;
                word = '';
                lre = re_obj.len;
                while (re_obj.pos < lre)
                {
                    ch = re_obj.re[CHAR](re_obj.pos++);
                    if (")" === ch) break;
                    word += ch;
                }
                return Node(T_COMMENT, word);
            }

            else if ("?:" === pre)
            {
                flags["NotCaptured"] = 1;
                re_obj.pos += 2;
                captured = 0;
            }

            else if ("?=" === pre)
            {
                flags["LookAhead"] = 1;
                re_obj.pos += 2;
                captured = 0;
            }

            else if ("?!" === pre)
            {
                flags["NegativeLookAhead"] = 1;
                re_obj.pos += 2;
                captured = 0;
            }

            else if ("?<=" === pre3)
            {
                flags["LookBehind"] = 1;
                re_obj.pos += 3;
                captured = 0;
            }

            else if ("?<!" === pre3)
            {
                flags["NegativeLookBehind"] = 1;
                re_obj.pos += 3;
                captured = 0;
            }

            else if (("?<" === pre) || ("?P<" === pre3))
            {
                // https://github.com/foo123/RegexAnalyzer/issues/6
                flags["NamedGroup"] = 1;
                flags["GroupName"] = '';
                re_obj.pos += "?<" === pre ? 2 : 3;
                lre = re_obj.len;
                while (re_obj.pos < lre)
                {
                    ch = re_obj.re[CHAR](re_obj.pos++);
                    if (">" === ch) break;
                    flags["GroupName"] += ch;
                }
            }

            ++re_obj.index;
            if (captured)
            {
                ++re_obj.groupIndex;
                flags["GroupIndex"] = re_obj.groupIndex;
                re_obj.group[flags["GroupIndex"]] = flags["GroupIndex"];
                if (flags["GroupName"]) re_obj.group[flags["GroupName"]] = flags["GroupIndex"];
            }
        }

        lre = re_obj.len;
        while (re_obj.pos < lre)
        {
            ch = re_obj.re[CHAR](re_obj.pos++);

            //   \\abc
            escaped = ESC === ch;
            if (escaped) ch = re_obj.re[CHAR](re_obj.pos++);

            if (escaped)
            {
                // unicode character
                if ('u' === ch)
                {
                    m = match_unicode(re_obj.re.substr(re_obj.pos-1), re_obj.flags);
                    if (m)
                    {
                        if (wordlen)
                        {
                            sequence.push(Node(T_STRING, word));
                            word = '';
                            wordlen = 0;
                        }
                        re_obj.pos += m[0].length-1;
                        sequence.push(Node(T_UNICODECHAR, m[0], {"Char": m[2] ? fromCodePoint(parseInt(m[1], 16)) : fromCharCode(parseInt(m[1], 16)), "Code": m[1], "UnicodePoint": !!m[2]}));
                    }
                    else
                    {
                        word += ch;
                        wordlen += 1;
                    }
                }

                // hex character
                else if ('x' === ch)
                {
                    m = match_hex(re_obj.re.substr(re_obj.pos-1));
                    if (m)
                    {
                        if (wordlen)
                        {
                            sequence.push(Node(T_STRING, word));
                            word = '';
                            wordlen = 0;
                        }
                        re_obj.pos += m[0].length-1;
                        sequence.push(Node(T_HEXCHAR, m[0], {"Char": fromCharCode(parseInt(m[1], 16)), "Code": m[1]}));
                    }
                    else
                    {
                        word += ch;
                        wordlen += 1;
                    }
                }

                // js back-reference
                else if ('k' === ch && '<' === re_obj.re[CHAR](re_obj.pos))
                {
                    // https://github.com/foo123/RegexAnalyzer/issues/6
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    re_obj.pos++;
                    word = '';
                    while (re_obj.pos < lre)
                    {
                        ch = re_obj.re[CHAR](re_obj.pos);
                        if ('>' === ch) {re_obj.pos++; break;}
                        else {word += ch; re_obj.pos++;}
                    }
                    flag = {};
                    flag["BackReference"] = 1;
                    flag["GroupName"] = word;
                    flag["GroupIndex"] = HAS.call(re_obj.group, word) ? re_obj.group[word] : null;
                    sequence.push(Node(T_SPECIAL, word, flag));
                    word = '';
                }

                else if (HAS.call(specialCharsEscaped, ch) && ('/' !== ch))
                {
                    if (wordlen)
                    {
                        sequence.push( Node(T_STRING, word) );
                        word = '';
                        wordlen = 0;
                    }
                    flag = {};
                    flag[ specialCharsEscaped[ch] ] = 1;
                    sequence.push( Node(T_SPECIAL, ch, flag) );
                }

                else if (('1' <= ch) && ('9' >= ch))
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    word = ch;
                    while (re_obj.pos < lre)
                    {
                        ch = re_obj.re[CHAR](re_obj.pos);
                        if (('0' <= ch) && ('9' >= ch)) {word += ch; re_obj.pos++;}
                        else break;
                    }
                    flag = {};
                    flag['BackReference'] = 1;
                    flag['GroupName'] = word;
                    flag['GroupIndex'] = parseInt(word, 10);
                    sequence.push(Node(T_SPECIAL, word, flag));
                    word = '';
                }

                else
                {
                    word += ch;
                    wordlen += 1;
                }
            }

            else
            {
                // group end
                if ((re_obj.inGroup > 0) && (')' === ch))
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    if (alternation.length)
                    {
                        alternation.push(Node(T_SEQUENCE, sequence));
                        sequence = [];
                        flag = {};
                        flag[specialChars['|']] = 1;
                        return Node(T_GROUP, Node(T_ALTERNATION, alternation, flag), flags);
                    }
                    else
                    {
                        return Node(T_GROUP, Node(T_SEQUENCE, sequence), flags);
                    }
                }

                // parse alternation
                else if ('|' === ch)
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    alternation.push(Node(T_SEQUENCE, sequence));
                    sequence = [];
                }

                // parse character group
                else if ('[' === ch)
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    sequence.push(chargroup(re_obj));
                }

                // parse sub-group
                else if ('(' === ch)
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    re_obj.inGroup += 1;
                    sequence.push(analyze_re(re_obj));
                    re_obj.inGroup -= 1;
                }

                // parse num repeats
                else if ('{' === ch)
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    m = match_repeats(re_obj.re.substr(re_obj.pos-1));
                    re_obj.pos += m[0].length-1;
                    flag = {val: m[0], "MatchMinimum": m[1], "MatchMaximum": m[2] || "unlimited", "min": parseInt(m[1],10), "max": m[2] ? parseInt(m[2],10) : -1};
                    flag[specialChars[ch]] = 1;
                    if ((re_obj.pos < lre) && ('?' === re_obj.re[CHAR](re_obj.pos)))
                    {
                        flag["isGreedy"] = 0;
                        re_obj.pos++;
                    }
                    else
                    {
                        flag["isGreedy"] = 1;
                    }
                    var prev = sequence.pop();
                    if ((T_STRING === prev.type) && (prev.val.length > 1))
                    {
                        sequence.push(Node(T_STRING, prev.val.slice(0, -1)));
                        prev.val = prev.val.slice(-1);
                    }
                    sequence.push(Node(T_QUANTIFIER, prev, flag));
                }

                // quantifiers
                else if (('*' === ch) || ('+' === ch) || ('?' === ch))
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    flag = {};
                    flag[specialChars[ch]] = 1;
                    flag["min"] = '+' === ch ? 1 : 0;
                    flag["max"] = '?' === ch ? 1 : -1;
                    if ((re_obj.pos < lre) && ('?' === re_obj.re[CHAR](re_obj.pos)))
                    {
                        flag["isGreedy"] = 0;
                        re_obj.pos++;
                    }
                    else
                    {
                        flag["isGreedy"] = 1;
                    }
                    var prev = sequence.pop();
                    if ((T_STRING === prev.type) && (prev.val.length > 1))
                    {
                        sequence.push(Node(T_STRING, prev.val.slice(0, -1)));
                        prev.val = prev.val.slice(-1);
                    }
                    sequence.push(Node(T_QUANTIFIER, prev, flag));
                }

                // special characters like ^, $, ., etc..
                else if (HAS.call(specialChars,ch))
                {
                    if (wordlen)
                    {
                        sequence.push(Node(T_STRING, word));
                        word = '';
                        wordlen = 0;
                    }
                    flag = {};
                    flag[specialChars[ch]] = 1;
                    sequence.push(Node(T_SPECIAL, ch, flag));
                }

                else
                {
                    word += ch;
                    wordlen += 1;
                }
            }
        }

        if (wordlen)
        {
            sequence.push(Node(T_STRING, word));
            word = '';
            wordlen = 0;
        }

        if (alternation.length)
        {
            alternation.push(Node(T_SEQUENCE, sequence));
            sequence = [];
            flag = {};
            flags[specialChars['|']] = 1;
            return Node(T_ALTERNATION, alternation, flag);
        }
        return Node(T_SEQUENCE, sequence);
    }
;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
// https://docs.python.org/3/library/re.html
// http://php.net/manual/en/reference.pcre.pattern.syntax.php
// A simple regular expression analyzer
function Analyzer(re, delim, flavor)
{
    if (!(this instanceof Analyzer)) return new Analyzer(re, delim, flavor);
    if (re) this.input(re, delim, flavor);
}
Analyzer.VERSION = __version__;
Analyzer[PROTO] = {

    constructor: Analyzer,

    ast: null,
    flavor: '',
    re: null,
    fl: null,
    src: null,
    grp: null,
    min: null,
    max: null,
    ch: null,
    bc: true,

    dispose: function() {
        var self = this;
        self.ast = null;
        self.flavor = null;
        self.re = null;
        self.fl = null;
        self.src = null;
        self.grp = null;
        self.min = null;
        self.max = null;
        self.ch = null;
        return self;
    },

    reset: function() {
        var self = this;
        self.ast = null;
        self.src = null;
        self.grp = null;
        self.min = null;
        self.max = null;
        self.ch = null;
        return self;
    },

    backwardsCompatible: function(enable) {
        this.bc = !!enable;
        return this;
    },

    input: function(re, delim, flavor) {
        var self = this;
        if (!arguments.length) return self.re;
        if (re)
        {
            delim = false === delim ? false : (delim || '/');
            var l, ch, fl = {};
            re = re.toString();
            l = re.length;

            if (delim)
            {
                // parse re flags, if any
                while (0 < l)
                {
                    ch = re[CHAR](l-1);
                    if (delim === ch) break;
                    else {fl[ch] = 1; --l;}
                }

                if (0 < l)
                {
                    // remove re delimiters
                    if ((delim === re[CHAR](0)) && (delim === re[CHAR](l-1))) re = re.slice(1, l-1);
                    else re = re.slice(0, l);
                }
                else
                {
                    re = '';
                }
            }

            // re is different, reset the ast, etc
            if (self.re !== re) self.reset();
            self.re = re; self.fl = fl; self.flavor = String(flavor || '');
        }
        return self;
    },

    analyze: function() {
        var self = this;
        if ((null != self.re) && (null === self.ast))
        {
            var re = new RE_OBJ(self.re, self.fl, self.flavor);
            self.ast = analyze_re(re);
            re.dispose();
        }
        return self;
    },

    synthesize: function(escaped) {
        var self = this, state, re;
        if (null == self.re) return self;
        if (null === self.ast)
        {
            self.analyze();
            self.src = null;
            self.grp = null;
        }
        if (null === self.src)
        {
            state = {
                MAP                 : T_SEQUENCE|T_ALTERNATION|T_GROUP|T_CHARGROUP|T_QUANTIFIER,
                REDUCE              : T_UNICODECHAR|T_HEXCHAR|T_SPECIAL|T_CHARS|T_CHARRANGE|T_STRING,
                IGNORE              : T_COMMENT,
                map                 : map_src,
                reduce              : reduce_src,
                escaped             : false !== escaped,
                compatibility       : self.bc,
                group               : {}
            };
            re = walk({src:'',group:{}}, self.ast, state);
            self.src = re.src; self.grp = re.group;
        }
        return self;
    },

    source: function() {
        var self = this;
        if (null == self.re) return null;
        if (null === self.src) self.synthesize();
        return self.src;
    },

    groups: function(raw) {
        var self = this;
        if (null == self.re) return null;
        if (null === self.grp) self.synthesize();
        return true === raw ? sel.grp : clone(self.grp);
    },

    compile: function(flags, notBackwardsCompatible) {
        var self = this;
        if (null == self.re) return null;
        flags = flags || self.fl || {};
        return new RegExp(self.source(), (flags.g||flags.G?'g':'')+(flags.i||flags.I?'i':'')+(flags.m||flags.M?'m':'')+(flags.y||flags.Y?'y':'')+(flags.u?'u':'')+(flags.d?'d':'')+(flags.s?'s':''));
    },

    tree: function(flat) {
        var self = this;
        if (null == self.re) return null;
        if (null === self.ast) self.analyze();
        return true===flat ? self.ast.toObject() : self.ast;
    },

    // experimental feature
    sample: function(maxlen, numsamples) {
        var self = this, state;
        if (null == self.re) return null;
        if (null === self.ast) self.analyze();
        state = {
            MAP                 : T_SEQUENCE|T_ALTERNATION|T_GROUP|T_CHARGROUP|T_QUANTIFIER,
            REDUCE              : T_UNICODECHAR|T_HEXCHAR|T_SPECIAL|T_CHARS|T_CHARRANGE|T_STRING,
            IGNORE              : T_COMMENT,
            map                 : map_any,
            reduce              : reduce_str,
            maxLength           : (maxlen|0) || 1,
            isCaseInsensitive   : null != self.fl.i,
            group               : {}
        };
        numsamples = (numsamples|0) || 1;
        if (1 < numsamples)
        {
            var samples = new Array(numsamples);
            for (var i=0; i<numsamples; ++i) samples[i] = walk('', self.ast, state);
            return samples;
        }
        return walk('', self.ast, state);
    },

    // experimental feature
    minimum: function() {
        var self = this, state;
        if (null == self.re) return 0;
        if (null === self.ast)
        {
            self.analyze( );
            self.min = null;
        }
        if (null === self.min)
        {
            state = {
                MAP                 : T_SEQUENCE|T_ALTERNATION|T_GROUP|T_CHARGROUP|T_QUANTIFIER,
                REDUCE              : T_UNICODECHAR|T_HEXCHAR|T_SPECIAL|T_CHARS|T_CHARRANGE|T_STRING,
                IGNORE              : T_COMMENT,
                map                 : map_min,
                reduce              : reduce_len,
                group               : {}
            };
            self.min = walk(0, self.ast, state)|0;
        }
        return self.min;
    },

    // experimental feature
    maximum: function() {
        var self = this, state;
        if (null == self.re) return 0;
        if (null === self.ast)
        {
            self.analyze();
            self.max = null;
        }
        if (null === self.max)
        {
            state = {
                MAP                 : T_SEQUENCE|T_ALTERNATION|T_GROUP|T_CHARGROUP|T_QUANTIFIER,
                REDUCE              : T_UNICODECHAR|T_HEXCHAR|T_SPECIAL|T_CHARS|T_CHARRANGE|T_STRING,
                IGNORE              : T_COMMENT,
                map                 : map_max,
                reduce              : reduce_len,
                group               : {}
            };
            self.max = walk(0, self.ast, state);
        }
        return self.max;
    },

    // experimental feature
    peek: function() {
        var self = this, state, isCaseInsensitive, peek, n, c, p, cases;
        if (null == self.re) return null;
        if (null === self.ast)
        {
            self.analyze();
            self.ch = null;
        }
        if (null === self.ch)
        {
            state = {
                MAP                 : T_SEQUENCE|T_ALTERNATION|T_GROUP|T_CHARGROUP|T_QUANTIFIER,
                REDUCE              : T_UNICODECHAR|T_HEXCHAR|T_SPECIAL|T_CHARS|T_CHARRANGE|T_STRING,
                IGNORE              : T_COMMENT,
                map                 : map_1st,
                reduce              : reduce_peek,
                group               : {},
            };
            self.ch = walk({positive:{},negative:{}}, self.ast, state);
        }
        peek = {positive:clone(self.ch.positive), negative:clone(self.ch.negative)};
        isCaseInsensitive = null != self.fl.i;
        for (n in peek)
        {
            cases = {};
            // either positive or negative
            p = peek[n];
            for (c in p)
            {
                if ('\\d' === c)
                {
                    delete p[c];
                    cases = concat(cases, character_range('0', '9'));
                }

                else if ('\\s' === c)
                {
                    delete p[c];
                    cases = concat(cases, ['\f','\n','\r','\t','\v','\u00A0','\u2028','\u2029']);
                }

                else if ('\\w' === c)
                {
                    delete p[c];
                    cases = concat(cases, ['_'].concat(character_range('0', '9')).concat(character_range('a', 'z')).concat(character_range('A', 'Z')));
                }

                else if ('\\b' === c)
                {
                    delete p[c];
                    cases[ specialChars['b'] ] = 1;
                }

                else if ('\\.' === c)
                {
                    delete p[c];
                    cases[ specialChars['.'] ] = 1;
                }

                /*else if ('\\^' === c)
                {
                    delete p[c];
                    cases[ specialChars['^'] ] = 1;
                }

                else if ('\\$' === c)
                {
                    delete p[c];
                    cases[ specialChars['$'] ] = 1;
                }*/

                else if ( (ESC !== c[CHAR](0)) && isCaseInsensitive )
                {
                    cases[ c.toLowerCase() ] = 1;
                    cases[ c.toUpperCase() ] = 1;
                }

                else if ( ESC === c[CHAR](0) )
                {
                    delete p[c];
                }
            }
            peek[n] = concat(p, cases);
        }
        return peek;
    }
};
// alias
Analyzer[PROTO].set = Analyzer[PROTO].input;
/*
// custom method to access named groups feature, if any
RegExp[PROTO].$group = null;
RegExp[PROTO].group = function( group ){
    group = group || 0;
    return this.$group && this.$group.hasOwnProperty(group) ? this.$group[group] : group;
};
*/

// A simple regular expression composer
function Composer()
{
    var self = this;
    if (!(self instanceof Composer)) return new Composer();
    self.re = null;
    self.reset();
}
Composer.VERSION = __version__;
Composer[PROTO] = {

    constructor: Composer,

    re: null,
    g: 0,
    grp: null,
    level: 0,
    ast: null,

    dispose: function() {
        var self = this;
        self.re = null;
        self.g = null;
        self.grp = null;
        self.level = null;
        self.ast = null;
        return self;
    },

    reset: function() {
        var self = this;
        self.g = 0;
        self.grp = {};
        self.level = 0;
        self.ast = [{node: [], type: T_SEQUENCE, flag: ''}];
        return self;
    },

    compose: function(/* flags */) {
        var self = this,
            fl = slice(arguments).join(''),
            src = self.ast[0].node.join('');
        self.re = {
            source  : src,
            flags   : fl,
            groups  : self.grp,
            pattern : RE(src, fl)
        };
        self.reset();
        return self.re;
    },

    partial: function(reset) {
        var self = this, re = self.ast[0].node.join('');
        if (false !== reset) self.reset();
        return re;
    },

    token: function(token, escaped) {
        var self = this;
        if (null != token)
            self.ast[self.level].node.push(escaped ? esc_re(String(token), ESC) : String(token));
        return self;
    },

    literal: function(literal) {
        return this.token(String(literal), true);
    },

    regexp: function(re) {
        return this.token(String(re), false);
    },

    SOL: function() {
        var self = this;
        self.ast[self.level].node.push('^');
        return self;
    },

    SOF: function() {
        return this.SOL();
    },

    EOL: function() {
        var self = this;
        self.ast[self.level].node.push('$');
        return self;
    },

    EOF: function() {
        return this.EOL();
    },

    LF: function() {
        var self = this;
        self.ast[self.level].node.push(ESC+'n');
        return self;
    },

    CR: function() {
        var self = this;
        self.ast[self.level].node.push(ESC+'r');
        return self;
    },

    TAB: function() {
        var self = this;
        self.ast[self.level].node.push(ESC+'t');
        return self;
    },

    CTRL: function(code) {
        var self = this;
        self.ast[self.level].node.push(ESC+'c'+(code||0));
        return self;
    },

    HEX: function(code) {
        var self = this;
        self.ast[self.level].node.push(ESC+'x'+pad(code||0, 2));
        return self;
    },

    UNICODE: function(code, uni) {
        var self = this;
        self.ast[self.level].node.push(true === uni ? ESC+'u{'+String(code||0)+'}' : ESC+'u'+pad(code||0, 4));
        return self;
    },

    backSpace: function() {
        var self = this;
        self.ast[self.level].node.push('['+ESC+'b]');
        return self;
    },

    any: function(multiline) {
        var self = this;
        self.ast[self.level].node.push(multiline ? '['+ESC+'s'+ESC+'S]' : '.');
        return self;
    },

    space: function(positive) {
        var self = this;
        if (arguments.length < 1) positive = true;
        self.ast[self.level].node.push(!positive ? ESC+'S' : ESC+'s');
        return self;
    },

    digit: function(positive) {
        var self = this;
        if (arguments.length < 1) positive = true;
        self.ast[self.level].node.push(!positive ? ESC+'D' : ESC+'d');
        return self;
    },

    word: function(positive) {
        var self = this;
        if (arguments.length < 1) positive = true;
        self.ast[self.level].node.push(!positive ? ESC+'W' : ESC+'w');
        return self;
    },

    boundary: function(positive) {
        var self = this;
        if (arguments.length < 1) positive = true;
        self.ast[self.level].node.push(!positive ? ESC+'B' : ESC+'b');
        return self;
    },

    characters: function() {
        var self = this;
        if (T_CHARGROUP === self.ast[self.level].type)
            self.ast[self.level].node.push(getArgs(arguments,1).map(function(c){ return esc_re(String(c), ESC, 1); }).join(''));
        return self;
    },

    range: function(start, end) {
        var self = this;
        if (null != start && null != end && T_CHARGROUP === self.ast[self.level].type)
            self.ast[self.level].node.push(esc_re(String(start), ESC, 1)+'-'+esc_re(String(end), ESC, 1));
        return self;
    },

    backReference: function(n) {
        var self = this;
        self.ast[self.level].node.push(ESC+(HAS.call(self.grp, n) ? self.grp[n] : n|0));
        return self;
    },

    repeat: function(min, max, greedy) {
        var self = this;
        if (null == min) return self;
        if (arguments.length < 3) greedy = true;
        var repeat = (null==max || min===max ? ('{'+String(min)+'}') : ('{'+String(min)+','+String(max)+'}')) + (!greedy ? '?' : '');
        self.ast[self.level].node[self.ast[self.level].node.length-1] += repeat;
        return self;
    },

    zeroOrOne: function(greedy) {
        var self = this;
        if (arguments.length < 1) greedy = true;
        self.ast[self.level].node[self.ast[self.level].node.length-1] += (!greedy ? '??' : '?');
        return self;
    },

    zeroOrMore: function(greedy) {
        var self = this;
        if (arguments.length < 1) greedy = true;
        self.ast[self.level].node[self.ast[self.level].node.length-1] += (!greedy ? '*?' : '*');
        return self;
    },

    oneOrMore: function(greedy) {
        var self = this;
        if (arguments.length < 1) greedy = true;
        self.ast[self.level].node[self.ast[self.level].node.length-1] += (!greedy ? '+?' : '+');
        return self;
    },

    alternate: function() {
        var self = this;
        self.level++;
        self.ast.push({node: [], type: T_ALTERNATION, flag: '', sequences: []});
        return self;
    },

    either: function() {
        return this.alternate();
    },

    or_: function() {
        var self = this, ast = self.ast[self.level];
        if ((T_ALTERNATION === ast.type) && ast.node.length)
        {
            ast.sequences.push(ast.node.join(''));
            ast.node = [];
        }
        return self;
    },

    group: function(opts, v) {
        var self = this, type = T_GROUP, fl = '';
        if (is_string(opts))
        {
            fl = opts; opts = {};
            opts[fl] = v; fl = '';
        }
        else
        {
            opts = opts || {};
        }
        if (!!opts['name'] || !!opts['named'])
        {
            self.g++;
            self.grp[self.g] = self.g;
            self.grp[opts.name||opts.named] = self.g;
        }
        else if ((true === opts['lookahead']) || (false === opts['lookahead']))
        {
            fl = false === opts['lookahead'] ? '?!' : '?=';
        }
        else if ((true === opts['lookbehind']) || (false === opts['lookbehind']))
        {
            fl = false === opts['lookbehind'] ? '?<!' : '?<=';
        }
        else if (true === opts['nocapture'])
        {
            fl = '?:';
        }
        else if ((true === opts['characters']) || (false === opts['characters']))
        {
            type = T_CHARGROUP;
            fl = false === opts['characters'] ? '^' : '';
        }
        else
        {
            self.g++;
            self.grp[self.g] = self.g;
        }
        self.level++;
        self.ast.push({node: [], type: type, flag: fl});
        return self;
    },

    subGroup: function(opts) {
        return this.group(opts);
    },

    characterGroup: function(positive) {
        return this.group({'characters':false!==positive});
    },

    namedGroup: function(name) {
        return this.group({'name':name});
    },

    nonCaptureGroup: function() {
        return this.group({'nocapture':true});
    },

    lookAheadGroup: function(positive) {
        return this.group({'lookahead':false!==positive});
    },

    lookBehindGroup: function(positive) {
        return this.group({'lookbehind':false!==positive});
    },

    end: function(n) {
        var self = this, prev, type, flag, part, sequences;
        n = (arguments.length ? n|0 : 1) || 1;
        // support ending multiple blocks at once
        while (n--)
        {
            prev = self.ast.length ? self.ast.pop() : null;
            type = prev ? prev.type : 0;
            flag = prev ? prev.flag : '';
            part = prev ? prev.node : [];
            if (T_ALTERNATION === type)
            {
                sequences = prev ? prev.sequences : [];
                part = !part.length ? sequences : sequences.concat(part.join(''));
            }
            if (0 < self.level)
            {
                --self.level;
                if (T_ALTERNATION === type)
                    self.ast[self.level].node.push(part.join('|'));
                else if (T_GROUP === type)
                    self.ast[self.level].node.push('('+flag+part.join('')+')');
                else if (T_CHARGROUP === type)
                    self.ast[self.level].node.push('['+flag+part.join('')+']');
                else
                    self.ast[self.level].node.push(part.join(''));
            }
        }
        return self;
    }
};
// aliases
var CP = Composer[PROTO];
CP.startOfLine = CP.SOL;
CP.endOfLine = CP.EOL;
CP.startOfInput = CP.SOF;
CP.endOfInput = CP.EOF;
CP.match = CP.token;
CP.sub = CP.regexp;
CP.lineFeed = CP.LF;
CP.carriageReturn = CP.CR;
CP.tabulate = CP.TAB;
CP.wordBoundary = CP.boundary;
CP.chars = CP.characters;
CP.charGroup = CP.characterGroup;
CP.namedSubGroup = CP.namedGroup;
CP.nonCaptureSubGroup = CP.nonCaptureGroup;
CP.lookAheadSubGroup = CP.lookAheadGroup;
CP.lookBehindSubGroup = CP.lookBehindGroup;

var Regex = {
    VERSION     : __version__,
    Node        : Node,
    Analyzer    : Analyzer,
    Composer    : Composer
};
/* Add as global value */
if ( globalThis ) {
    globalThis.Regex = Regex;
}
/* export the module */
return Regex;
})();

return {default:__default};
},17:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-2018 Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

const {
    decomposeHostname,
    domainFromHostname,
} = require(10);
const { LineIterator } = require(18);
const punycode = require(13).default;

/******************************************************************************/

// Object.create(null) is used below to eliminate worries about unexpected
// property names in prototype chain -- and this way we don't have to use
// Object.hasOwn() to avoid this.

const supportedDynamicTypes = Object.create(null);
Object.assign(supportedDynamicTypes, {
           '3p': true,
        'image': true,
'inline-script': true,
    '1p-script': true,
    '3p-script': true,
     '3p-frame': true
});

const typeBitOffsets = Object.create(null);
Object.assign(typeBitOffsets, {
            '*':  0,
'inline-script':  2,
    '1p-script':  4,
    '3p-script':  6,
     '3p-frame':  8,
        'image': 10,
           '3p': 12
});

const nameToActionMap = Object.create(null);
Object.assign(nameToActionMap, {
    'block': 1,
    'allow': 2,
     'noop': 3
});

const intToActionMap = new Map([
    [ 1, 'block' ],
    [ 2, 'allow' ],
    [ 3, 'noop' ]
]);

// For performance purpose, as simple tests as possible
const reBadHostname = /[^0-9a-z_.[\]:%-]/;
const reNotASCII = /[^\x20-\x7F]/;
const decomposedSource = [];
const decomposedDestination = [];

/******************************************************************************/

function is3rdParty(srcHostname, desHostname) {
    // If at least one is party-less, the relation can't be labelled
    // "3rd-party"
    if ( desHostname === '*' || srcHostname === '*' || srcHostname === '' ) {
        return false;
    }

    // No domain can very well occurs, for examples:
    // - localhost
    // - file-scheme
    // etc.
    const srcDomain = domainFromHostname(srcHostname) || srcHostname;

    if ( desHostname.endsWith(srcDomain) === false ) {
        return true;
    }
    // Do not confuse 'example.com' with 'anotherexample.com'
    return desHostname.length !== srcDomain.length &&
           desHostname.charAt(desHostname.length - srcDomain.length - 1) !== '.';
}

/******************************************************************************/

class DynamicHostRuleFiltering {

    constructor() {
        this.reset();
    }

    reset() {
        this.r = 0;
        this.type = '';
        this.y = '';
        this.z = '';
        this.rules = new Map();
        this.changed = false;
    }

    assign(other) {
        // Remove rules not in other
        for ( const k of this.rules.keys() ) {
            if ( other.rules.has(k) === false ) {
                this.rules.delete(k);
                this.changed = true;
            }
        }
        // Add/change rules in other
        for ( const entry of other.rules ) {
            if ( this.rules.get(entry[0]) !== entry[1] ) {
                this.rules.set(entry[0], entry[1]);
                this.changed = true;
            }
        }
    }

    copyRules(from, srcHostname, desHostnames) {
        // Specific types
        let thisBits = this.rules.get('* *');
        let fromBits = from.rules.get('* *');
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set('* *', fromBits);
            } else {
                this.rules.delete('* *');
            }
            this.changed = true;
        }

        let key = `${srcHostname} *`;
        thisBits = this.rules.get(key);
        fromBits = from.rules.get(key);
        if ( fromBits !== thisBits ) {
            if ( fromBits !== undefined ) {
                this.rules.set(key, fromBits);
            } else {
                this.rules.delete(key);
            }
            this.changed = true;
        }

        // Specific destinations
        for ( const desHostname in desHostnames ) {
            key = `* ${desHostname}`;
            thisBits = this.rules.get(key);
            fromBits = from.rules.get(key);
            if ( fromBits !== thisBits ) {
                if ( fromBits !== undefined ) {
                    this.rules.set(key, fromBits);
                } else {
                    this.rules.delete(key);
                }
                this.changed = true;
            }
            key = `${srcHostname} ${desHostname}` ;
            thisBits = this.rules.get(key);
            fromBits = from.rules.get(key);
            if ( fromBits !== thisBits ) {
                if ( fromBits !== undefined ) {
                    this.rules.set(key, fromBits);
                } else {
                    this.rules.delete(key);
                }
                this.changed = true;
            }
        }

        return this.changed;
    }

    // - *    *  type
    // - from *  type
    // - *    to *
    // - from to *

    hasSameRules(other, srcHostname, desHostnames) {
        // Specific types
        let key = '* *';
        if ( this.rules.get(key) !== other.rules.get(key) ) { return false; }
        key = `${srcHostname} *`;
        if ( this.rules.get(key) !== other.rules.get(key) ) { return false; }
        // Specific destinations
        for ( const desHostname in desHostnames ) {
            key = `* ${desHostname}`;
            if ( this.rules.get(key) !== other.rules.get(key) ) {
                return false;
            }
            key = `${srcHostname} ${desHostname}`;
            if ( this.rules.get(key) !== other.rules.get(key) ) {
                return false;
            }
        }
        return true;
    }

    setCell(srcHostname, desHostname, type, state) {
        const bitOffset = typeBitOffsets[type];
        const k = `${srcHostname} ${desHostname}`;
        const oldBitmap = this.rules.get(k) || 0;
        const newBitmap = oldBitmap & ~(3 << bitOffset) | (state << bitOffset);
        if ( newBitmap === oldBitmap ) { return false; }
        if ( newBitmap === 0 ) {
            this.rules.delete(k);
        } else {
            this.rules.set(k, newBitmap);
        }
        this.changed = true;
        return true;
    }

    unsetCell(srcHostname, desHostname, type) {
        this.evaluateCellZY(srcHostname, desHostname, type);
        if ( this.r === 0 ) { return false; }
        this.setCell(srcHostname, desHostname, type, 0);
        this.changed = true;
        return true;
    }

    evaluateCell(srcHostname, desHostname, type) {
        const key = `${srcHostname} ${desHostname}`;
        const bitmap = this.rules.get(key);
        if ( bitmap === undefined ) { return 0; }
        return bitmap >> typeBitOffsets[type] & 3;
    }

    clearRegisters() {
        this.r = 0;
        this.type = this.y = this.z = '';
        return this;
    }

    evaluateCellZ(srcHostname, desHostname, type) {
        decomposeHostname(srcHostname, decomposedSource);
        this.type = type;
        const bitOffset = typeBitOffsets[type];
        for ( const srchn of decomposedSource ) {
            this.z = srchn;
            let v = this.rules.get(`${srchn} ${desHostname}`);
            if ( v === undefined ) { continue; }
            v = v >>> bitOffset & 3;
            if ( v === 0 ) { continue; }
            return (this.r = v);
        }
        // srcHostname is '*' at this point
        this.r = 0;
        return 0;
    }

    evaluateCellZY(srcHostname, desHostname, type) {
        // Pathological cases.
        if ( desHostname === '' ) {
            this.r = 0;
            return 0;
        }

        // Precedence: from most specific to least specific

        // Specific-destination, any party, any type
        decomposeHostname(desHostname, decomposedDestination);
        for ( const deshn of decomposedDestination ) {
            if ( deshn === '*' ) { break; }
            this.y = deshn;
            if ( this.evaluateCellZ(srcHostname, deshn, '*') !== 0 ) {
                return this.r;
            }
        }

        const thirdParty = is3rdParty(srcHostname, desHostname);

        // Any destination
        this.y = '*';

        // Specific party
        if ( thirdParty ) {
            // 3rd-party, specific type
            if ( type === 'script' ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p-script') !== 0 ) {
                    return this.r;
                }
            } else if ( type === 'sub_frame' || type === 'object' ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p-frame') !== 0 ) {
                    return this.r;
                }
            }
            // 3rd-party, any type
            if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) {
                return this.r;
            }
        } else if ( type === 'script' ) {
            // 1st party, specific type
            if ( this.evaluateCellZ(srcHostname, '*', '1p-script') !== 0 ) {
                return this.r;
            }
        }

        // Any destination, any party, specific type
        if ( supportedDynamicTypes[type] !== undefined ) {
            if ( this.evaluateCellZ(srcHostname, '*', type) !== 0 ) {
                return this.r;
            }
            if ( type.startsWith('3p-') ) {
                if ( this.evaluateCellZ(srcHostname, '*', '3p') !== 0 ) {
                    return this.r;
                }
            }
        }

        // Any destination, any party, any type
        if ( this.evaluateCellZ(srcHostname, '*', '*') !== 0 ) {
            return this.r;
        }

        this.type = '';
        return 0;
    }

    mustAllowCellZY(srcHostname, desHostname, type) {
        return this.evaluateCellZY(srcHostname, desHostname, type) === 2;
    }

    mustBlockOrAllow() {
        return this.r === 1 || this.r === 2;
    }

    mustBlock() {
        return this.r === 1;
    }

    mustAbort() {
        return this.r === 3;
    }

    lookupRuleData(src, des, type) {
        const r = this.evaluateCellZY(src, des, type);
        if ( r === 0 ) { return; }
        return `${this.z} ${this.y} ${this.type} ${r}`;
    }

    toLogData() {
        if ( this.r === 0  || this.type === '' ) { return; }
        return {
            source: 'dynamicHost',
            result: this.r,
            raw: `${this.z} ${this.y} ${this.type} ${intToActionMap.get(this.r)}`
        };
    }

    srcHostnameFromRule(rule) {
        return rule.slice(0, rule.indexOf(' '));
    }

    desHostnameFromRule(rule) {
        return rule.slice(rule.indexOf(' ') + 1);
    }

    toArray() {
        const out = [];
        for ( const key of this.rules.keys() ) {
            const srchn = this.srcHostnameFromRule(key);
            const deshn = this.desHostnameFromRule(key);
            const srchnPretty = srchn.includes('xn--') && punycode
                ? punycode.toUnicode(srchn)
                : srchn;
            const deshnPretty = deshn.includes('xn--') && punycode
                ? punycode.toUnicode(deshn)
                : deshn;
            for ( const type in typeBitOffsets ) {
                if ( typeBitOffsets[type] === undefined ) { continue; }
                const val = this.evaluateCell(srchn, deshn, type);
                if ( val === 0 ) { continue; }
                const action = intToActionMap.get(val);
                if ( action === undefined ) { continue; }
                out.push(`${srchnPretty} ${deshnPretty} ${type} ${action}`);
            }
        }
        return out;
    }

    toString() {
        return this.toArray().join('\n');
    }

    fromString(text, append) {
        const lineIter = new LineIterator(text);
        if ( append !== true ) { this.reset(); }
        while ( lineIter.eot() === false ) {
            this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
        }
    }

    validateRuleParts(parts) {
        if ( parts.length < 4 ) { return; }

        // Ignore hostname-based switch rules
        if ( parts[0].endsWith(':') ) { return; }

        // Ignore URL-based rules
        if ( parts[1].includes('/') ) { return; }

        if ( typeBitOffsets[parts[2]] === undefined ) { return; }

        if ( nameToActionMap[parts[3]] === undefined ) { return; }

        // https://github.com/chrisaljoudi/uBlock/issues/840
        //   Discard invalid rules
        if ( parts[1] !== '*' && parts[2] !== '*' ) { return; }

        // Performance: avoid punycoding when only ASCII chars
        if ( punycode !== undefined ) {
            if ( reNotASCII.test(parts[0]) ) {
                parts[0] = punycode.toASCII(parts[0]);
            }
            if ( reNotASCII.test(parts[1]) ) {
                parts[1] = punycode.toASCII(parts[1]);
            }
        }

        // https://github.com/chrisaljoudi/uBlock/issues/1082
        //   Discard rules with invalid hostnames
        if (
            (parts[0] !== '*' && reBadHostname.test(parts[0])) ||
            (parts[1] !== '*' && reBadHostname.test(parts[1]))
        ) {
            return;
        }

        return parts;
    }

    addFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
            return true;
        }
        return false;
    }

    removeFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setCell(parts[0], parts[1], parts[2], 0);
            return true;
        }
        return false;
    }

    export1stPartyRules() {
        const out = [];
        const bitoffset = typeBitOffsets['*'];
        for ( const [ srcdes, bits ] of this.rules ) {
            const match = /^(\S+) (\S+)/.exec(srcdes);
            if ( match === null ) { continue; }
            if ( match[1] !== match[2] && match[2] !== '*' ) { continue; }
            const value = (bits >>> bitoffset) & 0b11;
            if  ( value === 0 ) { continue; }
            out.push([ match[1], value === 2 ]);
        }
        return out;
    }

    toSelfie() {
        return {
            magicId: this.magicId,
            rules: Array.from(this.rules)
        };
    }

    fromSelfie(selfie) {
        if ( selfie.magicId !== this.magicId ) { return false; }
        this.rules = new Map(selfie.rules);
        this.changed = true;
        return true;
    }
}

DynamicHostRuleFiltering.prototype.magicId = 1;

/******************************************************************************/

const __default = DynamicHostRuleFiltering;

/******************************************************************************/

return {default:__default};
},18:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2014-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

/******************************************************************************/

// https://bugs.chromium.org/p/v8/issues/detail?id=2869
//   orphanizeString is to work around String.slice() potentially causing
//   the whole raw filter list to be held in memory just because we cut out
//   the title as a substring.

function orphanizeString(s) {
    return JSON.parse(JSON.stringify(s));
}

/******************************************************************************/

class LineIterator {
    constructor(text, offset) {
        this.text = text;
        this.textLen = this.text.length;
        this.offset = offset || 0;
    }
    next(offset) {
        if ( offset !== undefined ) {
            this.offset += offset;
        }
        let lineEnd = this.text.indexOf('\n', this.offset);
        if ( lineEnd === -1 ) {
            lineEnd = this.text.indexOf('\r', this.offset);
            if ( lineEnd === -1 ) {
                lineEnd = this.textLen;
            }
        }
        const line = this.text.slice(this.offset, lineEnd);
        this.offset = lineEnd + 1;
        return line;
    }
    peek(n) {
        const offset = this.offset;
        return this.text.slice(offset, offset + n);
    }
    charCodeAt(offset) {
        return this.text.charCodeAt(this.offset + offset);
    }
    eot() {
        return this.offset >= this.textLen;
    }
}

/******************************************************************************/

// The field iterator is less CPU-intensive than when using native
// String.split().

class FieldIterator {
    constructor(sep) {
        this.text = '';
        this.sep = sep;
        this.sepLen = sep.length;
        this.offset = 0;
    }
    first(text) {
        this.text = text;
        this.offset = 0;
        return this.next();
    }
    next() {
        let end = this.text.indexOf(this.sep, this.offset);
        if ( end === -1 ) {
            end = this.text.length;
        }
        const field = this.text.slice(this.offset, end);
        this.offset = end + this.sepLen;
        return field;
    }
    remainder() {
        return this.text.slice(this.offset);
    }
}

/******************************************************************************/



return {FieldIterator:FieldIterator,LineIterator:LineIterator,orphanizeString:orphanizeString};
},19:function(require){/*******************************************************************************

    uBlock Origin - a comprehensive, efficient content blocker
    Copyright (C) 2015-present Raymond Hill

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see {http://www.gnu.org/licenses/}.

    Home: https://github.com/gorhill/uBlock
*/

const { LineIterator } = require(18);
const { decomposeHostname } = require(10);

/*******************************************************************************

    The purpose of log filtering is to create ad hoc filtering rules, to
    diagnose and assist in the creation of custom filters.

    buckets: map of [hostname + type]
         bucket: array of rule entries, sorted from shorter to longer url
    rule entry: { url, action }

*******************************************************************************/

const actionToNameMap = {
    1: 'block',
    2: 'allow',
    3: 'noop'
};

const nameToActionMap = Object.create(null);
Object.assign(nameToActionMap, {
    'block': 1,
    'allow': 2,
     'noop': 3
});

const knownInvalidTypes = new Set([
    'doc',
    'main_frame',
]);

const intToActionMap = new Map([
    [ 1, ' block' ],
    [ 2, ' allow' ],
    [ 3, ' noop' ]
]);

const decomposedSource = [];

/******************************************************************************/

class RuleEntry {
    constructor(url, action) {
        this.url = url;
        this.action = action;
    }
}

/******************************************************************************/

function indexOfURL(entries, url) {
    // TODO: binary search -- maybe, depends on common use cases
    const urlLen = url.length;
    // URLs must be ordered by increasing length.
    for ( let i = 0; i < entries.length; i++ ) {
        const entry = entries[i];
        if ( entry.url.length > urlLen ) { break; }
        if ( entry.url === url ) { return i; }
    }
    return -1;
}

/******************************************************************************/

function indexOfMatch(entries, url) {
    const urlLen = url.length;
    let i = entries.length;
    while ( i-- ) {
        if ( entries[i].url.length <= urlLen ) {
            break;
        }
    }
    if ( i !== -1 ) {
        do {
            if ( url.startsWith(entries[i].url) ) {
                return i;
            }
        } while ( i-- );
    }
    return -1;
}

/******************************************************************************/

function indexFromLength(entries, len) {
    // TODO: binary search -- maybe, depends on common use cases
    // URLs must be ordered by increasing length.
    for ( let i = 0; i < entries.length; i++ ) {
        if ( entries[i].url.length > len ) { return i; }
    }
    return -1;
}

/******************************************************************************/

function addRuleEntry(entries, url, action) {
    const entry = new RuleEntry(url, action);
    const i = indexFromLength(entries, url.length);
    if ( i === -1 ) {
        entries.push(entry);
    } else {
        entries.splice(i, 0, entry);
    }
}

/******************************************************************************/

class DynamicURLRuleFiltering {
    constructor() {
        this.reset();
    }

    reset() {
        this.rules = new Map();
        // registers, filled with result of last evaluation
        this.context = '';
        this.url = '';
        this.type = '';
        this.r = 0;
        this.changed = false;
    }

    assign(other) {
        // Remove rules not in other
        for ( const key of this.rules.keys() ) {
            if ( other.rules.has(key) === false ) {
                this.rules.delete(key);
            }
        }
        // Add/change rules in other
        for ( const entry of other.rules ) {
            this.rules.set(entry[0], entry[1].slice());
        }
        this.changed = true;
    }

    setRule(srcHostname, url, type, action) {
        if ( action === 0 ) {
            return this.removeRule(srcHostname, url, type);
        }
        const bucketKey = srcHostname + ' ' + type;
        let entries = this.rules.get(bucketKey);
        if ( entries === undefined ) {
            entries = [];
            this.rules.set(bucketKey, entries);
        }
        const i = indexOfURL(entries, url);
        if ( i !== -1 ) {
            const entry = entries[i];
            if ( entry.action === action ) { return false; }
            entry.action = action;
        } else {
            addRuleEntry(entries, url, action);
        }
        this.changed = true;
        return true;
    }

    removeRule(srcHostname, url, type) {
        const bucketKey = srcHostname + ' ' + type;
        const entries = this.rules.get(bucketKey);
        if ( entries === undefined ) { return false; }
        const i = indexOfURL(entries, url);
        if ( i === -1 ) { return false; }
        entries.splice(i, 1);
        if ( entries.length === 0 ) {
            this.rules.delete(bucketKey);
        }
        this.changed = true;
        return true;
    }

    evaluateZ(context, target, type) {
        this.r = 0;
        if ( this.rules.size === 0 ) { return 0; }
        decomposeHostname(context, decomposedSource);
        for ( const srchn of decomposedSource ) {
            this.context = srchn;
            let entries = this.rules.get(`${srchn} ${type}`);
            if ( entries !== undefined ) {
                const i = indexOfMatch(entries, target);
                if ( i !== -1 ) {
                    const entry = entries[i];
                    this.url = entry.url;
                    this.type = type;
                    this.r = entry.action;
                    return this.r;
                }
            }
            entries = this.rules.get(`${srchn} *`);
            if ( entries !== undefined ) {
                const i = indexOfMatch(entries, target);
                if ( i !== -1 ) {
                    const entry = entries[i];
                    this.url = entry.url;
                    this.type = '*';
                    this.r = entry.action;
                    return this.r;
                }
            }
        }
        return 0;
    }

    mustAllowCellZ(context, target, type) {
        return this.evaluateZ(context, target, type).r === 2;
    }

    mustBlockOrAllow() {
        return this.r === 1 || this.r === 2;
    }

    toLogData() {
        if ( this.r === 0 ) { return; }
        const { context, url, type } = this;
        return {
            source: 'dynamicUrl',
            result: this.r,
            rule: [ context, url, type, intToActionMap.get(this.r) ],
            raw: `${context} ${url} ${type} ${intToActionMap.get(this.r)}`,
        };
    }

    copyRules(other, context, urls, type) {
        let i = urls.length;
        while ( i-- ) {
            const url = urls[i];
            other.evaluateZ(context, url, type);
            const otherOwn = other.r !== 0 &&
                             other.context === context &&
                             other.url === url &&
                             other.type === type;
            this.evaluateZ(context, url, type);
            const thisOwn  = this.r !== 0 &&
                             this.context === context &&
                             this.url === url &&
                             this.type === type;
            if ( otherOwn && !thisOwn || other.r !== this.r ) {
                this.setRule(context, url, type, other.r);
                this.changed = true;
            }
            if ( !otherOwn && thisOwn ) {
                this.removeRule(context, url, type);
                this.changed = true;
            }
        }
        return this.changed;
    }

    toArray() {
        const out = [];
        for ( const [ key, entries ] of this.rules ) {
            let pos = key.indexOf(' ');
            const hn = key.slice(0, pos);
            pos = key.lastIndexOf(' ');
            const type = key.slice(pos + 1);
            for ( const { url, action } of entries ) {
                out.push(`${hn} ${url} ${type} ${actionToNameMap[action]}`);
            }
        }
        return out;
    }

    toString() {
        return this.toArray().sort().join('\n');
    }

    fromString(text) {
        this.reset();
        const lineIter = new LineIterator(text);
        while ( lineIter.eot() === false ) {
            this.addFromRuleParts(lineIter.next().trim().split(/\s+/));
        }
    }

    validateRuleParts(parts) {
        if ( parts.length !== 4 ) { return; }
        if ( parts[1].indexOf('://') <= 0 ) { return; }
        if (
            /[^a-z_-]/.test(parts[2]) && parts[2] !== '*' ||
            knownInvalidTypes.has(parts[2])
        ) {
            return;
        }
        if ( nameToActionMap[parts[3]] === undefined ) { return; }
        return parts;
    }

    addFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.setRule(parts[0], parts[1], parts[2], nameToActionMap[parts[3]]);
            return true;
        }
        return false;
    }

    removeFromRuleParts(parts) {
        if ( this.validateRuleParts(parts) !== undefined ) {
            this.removeRule(parts[0], parts[1], parts[2]);
            return true;
        }
        return false;
    }
}

/******************************************************************************/

const __default = DynamicURLRuleFiltering;

/******************************************************************************/

return {default:__default};
}};const cache={};function require(id){return cache[id]||(cache[id]=modules[id](require));}const snfe=require(0).default;const HostEngine=require(17).default;const URLEngine=require(19).default;const {FilteringContext}=require(9);const {CompiledListReader,CompiledListWriter}=require(8);const {AstFilterParser,utils}=require(1);const psl=require(12).default;const punycode=require(13).default;
// tvOSofaBrowse host adapter. Upstream engines remain unmodified.
const firewall = new HostEngine(), urls = new URLEngine();
let ready = false, installedHostRules, installedURLRules;
globalThis.browserCompileNetwork = function(lists, cached, suffixes) {
    psl.parse(suffixes, punycode.toASCII);
    snfe.reset();
    const stats = {};
    let compiled = cached || '';
    if (!cached) {
        const writer = new CompiledListWriter(), compiler = snfe.createCompiler();
        compiler.start(writer);
        for (const list of lists) {
            writer.properties.set('name', list.id);
            const parser = new AstFilterParser({trustedSource:list.trusted === true, maxTokenLength:snfe.MAX_TOKEN_LENGTH});
            const counts = stats[list.id] = {accepted:0, rejected:0};
            const slices = utils.preparser.splitter(list.text, ['ublock','safari','mobile']);
            for (let i=0; i<slices.length-1; i+=2) {
                const lines = list.text.slice(slices[i],slices[i+1]).split(/\r?\n/);
                for (let index=0; index<lines.length; index++) {
                    let raw = lines[index].trim();
                    while (raw.endsWith(' \\') && index+1<lines.length && lines[index+1].startsWith('    '))
                        raw = raw.slice(0,-2).trim() + lines[++index].trim();
                    if (!raw || /^[!\[]/.test(raw)) continue;
                    const hosts = /^(?:0\.0\.0\.0|127\.0\.0\.1|::1)\s+(.+)/.exec(raw);
                    const filters = hosts ? hosts[1].replace(/#.*/, '').trim().split(/\s+/) : [raw];
                    for (const filter of filters) {
                        if (!filter || filter === 'localhost' || filter === 'localhost.localdomain') continue;
                        parser.parse(filter);
                        if (!parser.isNetworkFilter()) continue;
                        if (!parser.hasError() && compiler.compile(parser, writer)) counts.accepted++;
                        else counts.rejected++;
                    }
                }
            }
            parser.finish();
        }
        compiler.finish(writer);
        compiled = writer.toString();
    }
    snfe.fromCompiled(new CompiledListReader(compiled));
    snfe.freeze();
    ready = true;
    return {compiled,stats,count:snfe.getFilterCount(),cached:!!cached};
};
globalThis.browserSetDynamicNetwork = function(hostRules, urlRules) {
    hostRules ||= ''; urlRules ||= '';
    if (hostRules !== installedHostRules) { firewall.fromString(hostRules); installedHostRules = hostRules; }
    if (urlRules !== installedURLRules) { urls.fromString(urlRules); installedURLRules = urlRules; }
};
globalThis.browserMatchNetwork = function(details) {
    if (!ready) return {action:0,engine:'unavailable'};
    const context = new FilteringContext().fromDetails(details);
    context.setTabOriginFromURL(details.topURL || details.originURL);
    if (details.method) context.setMethod(String(details.method).toLowerCase());
    const source = context.getTabHostname();
    let action = urls.evaluateZ(source, details.url, details.type);
    let engine = 'dynamic-url';
    if (action === 0) {
        action = firewall.evaluateCellZY(source, context.getHostname(), details.type);
        engine = 'dynamic-host';
    }
    if (action === 0 || action === 3) { action = snfe.matchRequest(context); engine = 'static'; }
    return {action,engine};
};

})();
