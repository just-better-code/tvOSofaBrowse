(function(){const modules={0:function(require){/*******************************************************************************

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

const cssTree = require(1);
const { ArglistParser } = require(2);
const { JSONPath } = require(3);

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
},1:function(require){/**
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
},2:function(require){/*******************************************************************************

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
},3:function(require){/*******************************************************************************

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
}};const cache={};function require(id){return cache[id]||(cache[id]=modules[id](require));}const {AstFilterParser,utils}=require(0);
// Native adapter: input is list text with explicit source/trust metadata.
// JSCore has no URL constructor; hostname normalization is supplied by Foundation.
globalThis.URL = class {
    constructor() { this._hostname = ''; }
    set hostname(value) { this._hostname = browserNormalizeHostname(value); }
    get hostname() { return this._hostname; }
};
globalThis.browserPreprocessUBlock = function(text) {
    const slices = utils.preparser.splitter(text, ['ublock', 'safari', 'mobile']);
    let out = '';
    for (let i = 0; i < slices.length - 1; i++) {
        const part = text.slice(slices[i], slices[i+1]);
        out += i % 2 === 0 ? part : part.replace(/[^\n]/g, ' ');
    }
    return out;
};
globalThis.browserCompileUBlock = function(lists, library) {
    const resources = new Map(), aliases = new Map();
    for (const entry of library) {
        resources.set(entry.name, entry);
        for (const alias of entry.aliases) aliases.set(alias, entry.name);
    }
    const parser = new AstFilterParser({ nativeCssHas: false });
    const records = [], stats = {}, rejected = {};
    for (const list of lists) {
        const counts = { cosmetic:0, scriptlet:0, unsupported:0, network:0 };
        stats[list.id] = counts;
        let lineNumber = 0;
        for (const raw of browserPreprocessUBlock(list.text).split(/\r?\n/)) {
            lineNumber++;
            if (raw.trim() === '' || /^[!\[]/.test(raw)) continue;
            // Preprocessor/include directives must not leak inactive branches.
            // Lists passed here are preprocessed by the native adapter below.
            parser.parse(raw);
            if (parser.isNetworkFilter()) { counts.network++; continue; }
            if (!parser.isExtendedFilter()) continue;
            const reject = reason => { counts.unsupported++; rejected[reason] = (rejected[reason] || 0) + 1; };
            if (parser.hasError() || parser.isUnsupported()) { reject('syntax'); continue; }
            const domains = parser.hasOptions() ? Array.from(parser.getExtFilterDomainIterator(), d => ({host:d.hn, exclude:d.not})) : [];
            const record = { domains, source:list.id, line:lineNumber, exception:parser.isException() };
            if (parser.isScriptletFilter()) {
                const args = parser.getScriptletArgs();
                if (args.length === 0 && record.exception) {
                    record.kind='scriptlet'; record.key='*'; record.args=[]; records.push(record); continue;
                }
                const token = args[0]?.endsWith('.js') ? args[0] : `${args[0]}.js`;
                const entry = resources.get(aliases.get(token) || token);
                if (!entry || !entry.name.endsWith('.js')) { reject('scriptlet-name'); continue; }
                if (entry.trusted && list.trusted !== true && !record.exception) { reject('untrusted-scriptlet'); continue; }
                record.kind='scriptlet'; record.name=entry.name; record.args=args.slice(1);
                record.world=entry.world; record.key=JSON.stringify([entry.name,...record.args]);
                counts.scriptlet++;
            } else if (parser.isCosmeticFilter()) {
                const compiled = parser.result.compiled;
                if (typeof compiled !== 'string' || compiled === '') { reject('cosmetic'); continue; }
                record.kind='cosmetic'; record.key=parser.result.raw;
                record.compiled=compiled.startsWith('{') ? JSON.parse(compiled) : compiled;
                counts.cosmetic++;
            } else { reject('response-filter'); continue; }
            records.push(record);
        }
    }
    return {records, stats, rejected};
};

})();
