/*****************************************************************************
 * Minimal, namespaced VLC 3 core ABI declarations for the Debug experiment.
 * Derived from include/vlc_common.h, vlc_variables.h and vlc_objects.h at
 * 79128878ddb2c280bbb6c89c76a46b31a80ade1c. These declarations are unchanged
 * in VLC 3.0.23 (578d28f6c9f2379164516e689418f92ac74a3445).
 * Copyright (C) 1998-2011 VLC authors and VideoLAN
 * Copyright (C) 2002-2004 VLC authors and VideoLAN (variables)
 * Copyright (C) 2002-2008 VLC authors and VideoLAN (objects)
 * Authors: Samuel Hocevar, Vincent Seguin, Gildas Bazin, Rémi Denis-Courmont
 *
 * This program is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston MA 02110-1301, USA.
 *****************************************************************************/

#ifndef BrowserVLCCoreCompat_h
#define BrowserVLCCoreCompat_h
#if DEBUG

#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>

typedef struct BrowserVLCObject BrowserVLCObject;
typedef struct BrowserVLCList BrowserVLCList;
typedef union {
    int64_t i_int;
    bool b_bool;
    float f_float;
    char *psz_string;
    void *p_address;
    BrowserVLCList *p_list;
    struct { int32_t x; int32_t y; } coords;
} BrowserVLCValue;

struct BrowserVLCList {
    int i_type;
    int i_count;
    BrowserVLCValue *p_values;
};

enum {
    BrowserVLCVariableTypeMask = 0x00ff,
    BrowserVLCVariableInteger = 0x0030,
    BrowserVLCVariableString = 0x0040,
    BrowserVLCVariableFloat = 0x0050,
};

_Static_assert(sizeof(void *) == 8, "The experiment supports only the inspected 64-bit slices");
_Static_assert(sizeof(BrowserVLCValue) == 8, "VLC 3 value ABI");
_Static_assert(sizeof(BrowserVLCList) == 16 && offsetof(BrowserVLCList, p_values) == 8, "VLC 3 list ABI");

typedef struct {
    int (*create)(BrowserVLCObject *, const char *, int);
    int (*type)(BrowserVLCObject *, const char *);
    int (*set)(BrowserVLCObject *, const char *, int, BrowserVLCValue);
    int (*get)(BrowserVLCObject *, const char *, int, BrowserVLCValue *);
    BrowserVLCList *(*children)(BrowserVLCObject *);
    void (*releaseList)(BrowserVLCList *);
} BrowserVLCCore;

#endif
#endif
