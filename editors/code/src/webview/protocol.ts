export type SoundVersionId = "1.8.9" | "1.21.1";

export type ImportTarget = {
    fsPath: string;
    label: string;
};

export type ItemEditorForm = {
    itemName: string;
    count: number;
    metadata: number | null;
    displayName: string;
    lore: string[];
    enchants: ItemEditorEnchant[];
    entryName: string;
    importJsonPath: string;
    createLeftClickActions: boolean;
    createRightClickActions: boolean;
};

export type ItemEditorEnchant = {
    name: string;
    level: number;
};

export type SoundEntry = {
    name: string;
    path: string;
    mapped1_21: string | null;
};

/** A nested file reachable from an importable: a region's enter/exit actions,
 * an item's or npc's click actions, npc armor, or a menu slot's item/actions. */
export type ProjectImportableSub = {
    label: string;
    fsPath: string;
    /** Drives the row glyph: `actions` = htsl action list, `item` = snbt item. */
    kind: "actions" | "item";
    errors?: number;
    warnings?: number;
};

export type ProjectImportableSummary = {
    /** Stable key for expand state: `${importJsonPath}|${type}|${identity}`. */
    id: string;
    label: string;
    type: "function" | "event" | "region" | "item" | "menu" | "command" | "npc";
    typeLabel: string;
    openPath?: string;
    /** Minecraft item id powering the row icon, e.g. "minecraft:clock" — a
     * function's declared `icon.item` or the `id` read from an item's snbt. */
    iconItem?: string;
    iconMeta?: number;
    iconCount?: number;
    /** Diagnostics in this importable's own source file (htsl/snbt). */
    errors?: number;
    warnings?: number;
    /** Nested action lists / item refs, shown as expandable child rows. */
    subEntries?: ProjectImportableSub[];
};

export type ProjectImportJsonNode = {
    fsPath: string;
    label: string;
    name: string;
    importableCount: number;
    importables: ProjectImportableSummary[];
    missing?: boolean;
    cycle?: boolean;
    children: ProjectImportJsonNode[];
    /** Diagnostics aggregated across this node's whole subtree (like a folder badge). */
    errors?: number;
    warnings?: number;
};

export type ProjectToHostMessage =
    | { type: "requestProjectTree" }
    | { type: "openProjectFile"; fsPath: string; preview: boolean }
    | { type: "createIncludedImportJson"; parentImportJsonPath: string; folderPath: string }
    | {
          type: "addImportable";
          importJsonPath: string;
          kind: ProjectImportableSummary["type"];
          identity: string;
      };

export type ProjectFromHostMessage =
    | { type: "projectTree"; roots: ProjectImportJsonNode[]; workspaceName?: string }
    | { type: "projectResult"; ok: true; message: string; createdPath?: string }
    | { type: "projectResult"; ok: false; error: string };

export type ItemEditorToHostMessage =
    | { type: "requestImportTargets" }
    | { type: "submitItem"; form: ItemEditorForm };

export type ItemEditorFromHostMessage =
    | { type: "importTargets"; targets: ImportTarget[] }
    | { type: "submitResult"; ok: true; files: string[] }
    | { type: "submitResult"; ok: false; error: string };

export type SoundPreviewToHostMessage =
    | { type: "ready" }
    | { type: "requestPlay"; version: SoundVersionId; soundPath: string }
    | { type: "copyPath"; soundPath: string }
    | { type: "saveSettings"; version: SoundVersionId; pitch: number; volume: number };

export type SoundPreviewFromHostMessage =
    | {
          type: "init";
          sounds: SoundEntry[];
          settings: { version: SoundVersionId; pitch: number; volume: number };
      }
    | {
          type: "playState";
          ok: true;
          version: SoundVersionId;
          soundPath: string;
          uri: string;
          variants: string[];
      }
    | {
          type: "playState";
          ok: false;
          version: SoundVersionId;
          soundPath: string;
          error: string;
      }
    | { type: "copyResult"; ok: true }
    | { type: "copyResult"; ok: false; error: string };
