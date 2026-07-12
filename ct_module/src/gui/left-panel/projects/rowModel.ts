import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";
import type { Element } from "../../lib/layout";
import { Container, Icon } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import { markGuiDirty } from "../../lib/dirty";
import type { Section } from "../../../project/importJsonMutations";

// File-level row types: what `enumerateForSource` returns. Each row is a
// file the Projects tree displays directly. Importables themselves are no
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
    /** The parse result this row's importables came from. Still needed for
     * what the importable itself can't answer: which import.json declared it
     * (`importableDeclaringPath`), diagnostic bucketing, and the include
     * `fileTree`. Null when the parse failed. */
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
    NPC: 0xff6fd38f | 0,
    TEAM: 0xff4aa3a8 | 0,
    GROUP: 0xffb695e8 | 0,
    COMMAND: 0xffe8e06a | 0,
};

// Structure revision for the Projects tree. The tree's row DESCRIPTORS
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

const CONTROL_W = 26;

export function caretButton(expanded: boolean, onToggle: () => void, width: number = CONTROL_W): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "px", value: width },
            height: { kind: "grow" },
            align: "center",
            justify: "center",
            hoverBackground: ROW_HOVER_BG,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            onToggle();
        },
        children: [
            Icon({
                name: expanded ? Icons.chevronDown : Icons.chevronRight,
            }),
        ],
    });
}

// The import.json section each importable type declares under.
export const SECTION_BY_TYPE: Partial<{ [k in Importable["type"]]: Section }> = {
    FUNCTION: "functions",
    EVENT: "events",
    REGION: "regions",
    ITEM: "items",
    MENU: "menus",
    NPC: "npcs",
    TEAM: "teams",
    GROUP: "groups",
    COMMAND: "commands",
};
