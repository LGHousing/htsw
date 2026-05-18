import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

// File-level row types: what `enumerateForSource` returns. Each row is a
// file the Explore tree displays directly. Importables themselves are no
// longer flattened into this list — they live as expansion children of
// `ResultImport` rows now (see `ResultImport.importables`).
export const ALL_TYPES = ["import", "script", "item"] as const;
export type ResultType = (typeof ALL_TYPES)[number];

export type ResultImport = {
    type: "import";
    /** Path relative to the source root. */
    path: string;
    /** Absolute, forward-slashed path. */
    fullPath: string;
    /** Importables parsed out of this import.json (empty if parse failed). */
    importables: Importable[];
    /** The parse result this row's importables came from. Lets callers
     * resolve `imp` through `importableSourcePath(imp, parse)` against the
     * correct source map — without it, the WeakMap lookup misses and we
     * fall back to the import.json instead of the htsl/snbt. */
    parse: ParseResult<Importable[]> | null;
    parseError?: string;
};
type ResultScript = { type: "script"; path: string; fullPath: string };
type ResultItem = { type: "item"; path: string; fullPath: string };
export type Result = ResultImport | ResultScript | ResultItem;

export const TYPE_COLORS: { [k in ResultType]: number } = {
    import: 0xff67a7e8 | 0,
    script: 0xff62d26f | 0,
    item: 0xffe5bc4b | 0,
};

// Per-importable type colors. Mirrors the swatch the old Importables tab
// painted next to each row so file kinds (above) stay visually distinct
// from importable kinds.
export const IMPORTABLE_TYPE_COLORS: { [k in Importable["type"]]: number } = {
    FUNCTION: 0xff67a7e8 | 0,
    EVENT: 0xffce7be0 | 0,
    REGION: 0xff5cb85c | 0,
    ITEM: 0xffe5bc4b | 0,
    MENU: 0xffe87a4b | 0,
    NPC: 0xff7be0c0 | 0,
};

export const ACTIVE_BG = 0xff2d4d2d | 0;
export const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
export const ROW_BG = 0xff2d333d | 0;
export const ROW_HOVER_BG = 0xff3a4350 | 0;
