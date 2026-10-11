/*******************************************************************************

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

/* global browser */

/******************************************************************************/


// Pinned upstream strict-document decision helpers. Host supplies snfe only.
const staticNetFilteringEngine = snfe;
function shouldStrictBlock(fctxt, loggerEnabled) {
    const snfe = staticNetFilteringEngine;

    // Explicit filtering: `document` option
    const rs = snfe.matchRequest(fctxt, 0b0011);
    const is = rs === 1 && snfe.isBlockImportant();
    let lds;
    if ( rs !== 0 || loggerEnabled ) {
        lds = snfe.toLogData();
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   rg   |   rs   |   x    |   rs   |
    //    rg   |   1    |   rg   |   rs   |   x    |   rs   |
    //         |   1i   |   rg   |   rg   |   x    |   rg   |
    //         |   2    |   rg   |   rg   |   x    |   rs   |
    // --------+--------+--------+--------+--------+--------+
    if ( rs === 1 && is ) {
        return { result: rs, logData: lds };
    }

    // Implicit filtering: no `document` option
    fctxt.type = 'no_type';
    let rg = snfe.matchRequest(fctxt, 0b0011);
    fctxt.type = 'main_frame';
    const ig = rg === 1 && snfe.isBlockImportant();
    let ldg;
    if ( rg !== 0 || loggerEnabled ) {
        ldg = snfe.toLogData();
        if ( rg === 1 && validateStrictBlock(fctxt, ldg) === false ) {
            rg = 0; ldg = undefined;
        }
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   x    |   rs   |   -    |   rs   |
    //    rg   |   1    |   x    |   rs   |   -    |   rs   |
    //         |   1i   |   x    |   x    |   -    |   x    |
    //         |   2    |   x    |   x    |   -    |   rs   |
    // --------+--------+--------+--------+--------+--------+
    if ( rs === 0 || rg === 1 && ig || rg === 2 && rs !== 2 ) {
        return { result: rg, logData: ldg };
    }

    //                  |                rs                 |
    //                  +--------+--------+--------+--------|
    //                  |   0    |   1    |   1i   |   2    |
    // --------+--------+--------+--------+--------+--------|
    //         |   0    |   -    |   x    |   -    |   x    |
    //    rg   |   1    |   -    |   x    |   -    |   x    |
    //         |   1i   |   -    |   -    |   -    |   -    |
    //         |   2    |   -    |   -    |   -    |   x    |
    // --------+--------+--------+--------+--------+--------+
    return { result: rs, logData: lds };
}

/******************************************************************************/

// https://github.com/gorhill/uBlock/issues/3208
//   Mind case insensitivity.
// https://github.com/uBlockOrigin/uBlock-issues/issues/1147
//   Do not strict-block if the filter pattern does not contain at least one
//   token character.

function validateStrictBlock(fctxt, logData) {
    if ( typeof logData.regex !== 'string' ) { return false; }
    if ( typeof logData.raw === 'string' && /\w/.test(logData.raw) === false ) {
        return false;
    }
    const url = fctxt.url;
    const re = new RegExp(logData.regex, 'i');
    const match = re.exec(url.toLowerCase());
    if ( match === null ) { return false; }

    // https://github.com/chrisaljoudi/uBlock/issues/1128
    // https://github.com/chrisaljoudi/uBlock/issues/1212
    //   Verify that the end of the match is anchored to the end of the
    //   hostname.
    // https://github.com/uBlockOrigin/uAssets/issues/7619#issuecomment-653010310
    //   Also match FQDN.
    const hostname = fctxt.getHostname();
    const hnpos = url.indexOf(hostname);
    const hnlen = hostname.length;
    const end = match.index + match[0].length - hnpos - hnlen;
    return end === 0 || end === 1 ||
           end === 2 && url.charCodeAt(hnpos + hnlen) === 0x2E /* '.' */;
}

