import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";
import { markGuiDirty } from "../../lib/dirty";

// File-level row types: what `enumerateForSource` returns. Each row is a
// file the Importables tree displays directly. Importables themselves are no
// longer flattened into this list — they live as expansion children of
// `ResultImport` rows now (see `ResultImport.importables`).
export type ResultImport = {
    type: "import";
    /** Path relative to the source root. */
    path: string;
    /** Absolute, forward-slashed path. */
    fullPath: string;
    /** Importables parsed out of this import.json (empty if parse failed). */
    importables: Importable[];
    parsePending: boolean;
    /** The parse result this row's importables came from. Lets callers
     * resolve `imp` through `importableSourcePath(imp, parse)` against the
     * correct source map — without it, the WeakMap lookup misses and we
     * fall back to the import.json instead of the htsl/snbt. */
    parse: ImportablesParseResult | null;
    parseError?: string;
};
type ResultScript = { type: "script"; path: string; fullPath: string };
type ResultItem = { type: "item"; path: string; fullPath: string };
export type Result = ResultImport | ResultScript | ResultItem;

// The colored bar shown on each importable row, by importable kind.
export const IMPORTABLE_TYPE_COLORS: { [k in Importable["type"]]: number } = {
    FUNCTION: 0xff67a7e8 | 0,
    EVENT: 0xffce7be0 | 0,
    REGION: 0xff5cb85c | 0,
    ITEM: 0xffe5bc4b | 0,
    MENU: 0xffe87a4b | 0,
    TEAM: 0xff4aa3a8 | 0,
    GROUP: 0xffb695e8 | 0,
    COMMAND: 0xffe8e06a | 0,
    HOUSE_NAME: 0xffd9d1a3 | 0,
};

// Structure revision for the Importables tree. The tree's row DESCRIPTORS
// (which rows exist, not their per-frame content) are cached across frames;
// any interaction that changes the row set — expansion toggles, search,
// filter, sort, source add/remove — must bump this so the next frame
// rebuilds immediately. A short TTL on the cache covers async changes
// (reparses, enumeration refreshes) and any missed bump site.
let treeRevision = 0;
export function bumpTreeRevision(): void {
    treeRevision++;
    markGuiDirty();
}
export function getTreeRevision(): number {
    return treeRevision;
}

export const ACTIVE_BG = 0xff2d4d2d | 0;
export const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
export const ROW_BG = 0xff2d333d | 0;
export const ROW_HOVER_BG = 0xff3a4350 | 0;
