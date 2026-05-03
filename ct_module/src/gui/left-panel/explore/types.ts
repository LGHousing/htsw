export const ALL_TYPES = ["import", "script", "item"] as const;

export type ResultType = (typeof ALL_TYPES)[number];

export type ImportEntryFunction = {
    type: "FUNCTION";
    name: string;
    actionsPath?: string;
};
export type ImportEntryEvent = {
    type: "EVENT";
    event: string;
    actionsPath?: string;
};
export type ImportEntryItem = {
    type: "ITEM";
    name: string;
    nbtPath?: string;
};
export type ImportEntryRegion = { type: "REGION"; name: string };
export type ImportEntryMenu = { type: "MENU"; name: string };
export type ImportEntryNpc = { type: "NPC"; name: string };

export type ImportEntry =
    | ImportEntryFunction
    | ImportEntryEvent
    | ImportEntryItem
    | ImportEntryRegion
    | ImportEntryMenu
    | ImportEntryNpc;

export type ResultImport = {
    type: "import";
    path: string;
    fullPath: string;
    entries: ImportEntry[];
    parseError?: string;
};
export type ResultScript = { type: "script"; path: string; fullPath: string };
export type ResultItem = { type: "item"; path: string; fullPath: string };
export type Result = ResultImport | ResultScript | ResultItem;

export const TYPE_COLORS: { [k in ResultType]: number } = {
    import: 0xff67a7e8 | 0,
    script: 0xff62d26f | 0,
    item: 0xffe5bc4b | 0,
};

export const ACTIVE_BG = 0xff2d4d2d | 0;
export const ACTIVE_HOVER_BG = 0xff3a5d3a | 0;
export const ROW_BG = 0xff2d333d | 0;
export const ROW_HOVER_BG = 0xff3a4350 | 0;
