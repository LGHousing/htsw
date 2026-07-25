import type { Tag } from "htsw/nbt";

export type SoundVersionId = "1.8.9" | "1.21.1";

export type GitDecoration = {
    badge: string;
    color: "modified" | "untracked" | "added" | "deleted" | "renamed" | "conflicting";
};

export type ImportTarget = {
    fsPath: string;
    label: string;
    rootImportJsonPath: string;
};

export type ItemEditorForm = {
    itemName: string;
    count: number;
    metadata: number | null;
    displayName: string;
    lore: string[];
    enchants: ItemEditorEnchant[];
    customTags: ItemEditorCustomTag[];
    entryName: string;
    importJsonPath: string;
    createLeftClickActions: boolean;
    createRightClickActions: boolean;
};

type ItemEditorEnchant = {
    name: string;
    level: number;
};

type ItemEditorCustomTag = {
    name: string;
    value: Tag;
};

/** Enough of a parsed item to render its in-game sprite and hover tooltip.
 * Display name and lore keep their `&` codes. */
export type ItemPreviewData = {
    /** Item id, e.g. "clock" or "minecraft:clock" — the renderer normalizes. */
    itemId: string;
    metadata: number;
    count: number;
    displayName: string;
    lore: string[];
    enchants: ItemEditorEnchant[];
};

export type SoundEntry = {
    name: string;
    path: string;
    mapped1_8: string | null;
    mapped1_21: string | null;
};

/** A nested file reachable from an importable: a region's enter/exit actions,
 * an item's or npc's click actions, npc armor, or a menu slot's item/actions. */
export type ProjectImportableSub = {
    label: string;
    fsPath: string;
    /** Drives the row glyph: `actions` = htsl action list, `item` = snbt item. */
    kind: "actions" | "item";
    /** For `item` subs: the parsed item, so the row shows its sprite and a
     * hover preview instead of a generic glyph. */
    item?: ItemPreviewData;
    errors?: number;
    warnings?: number;
    git?: GitDecoration;
};

export type ProjectImportableMetadata = {
    label: string;
    value: string;
    jsonPath: string[];
};

export type ProjectTextSpan = {
    start: number;
    end: number;
};

export type ProjectImportableSummary = {
    /** Stable key for expand state: `${importJsonPath}|${type}|${identity}`. */
    id: string;
    /** The declared name (or event name / NPC position triple) — what
     * import.json mutations key on. */
    identity: string;
    label: string;
    type: "function" | "event" | "region" | "item" | "menu" | "command" | "npc" | "team" | "group";
    typeLabel: string;
    sourcePath?: string;
    declarationSpan?: ProjectTextSpan;
    /** Minecraft item id powering the row icon, e.g. "minecraft:clock" — a
     * function's declared `icon.item` or the `id` read from an item's snbt. */
    iconItem?: string;
    iconMeta?: number;
    iconCount?: number;
    repeatTicks?: number;
    /** For `item` importables: the parsed item, powering the row sprite and a
     * hover preview. (Functions use the icon fields above instead.) */
    item?: ItemPreviewData;
    /** Diagnostics in this importable's own source file (htsl/snbt). */
    errors?: number;
    warnings?: number;
    git?: GitDecoration;
    /** Nested action lists / item refs, shown as expandable child rows. */
    subEntries?: ProjectImportableSub[];
    metadataEntries?: ProjectImportableMetadata[];
};

export type ProjectImportableReveal = {
    importJsonPath: string;
    kind: ProjectImportableSummary["type"];
    identity: string;
};

export type ProjectImportJsonNode = {
    fsPath: string;
    parentFsPath?: string;
    label: string;
    name: string;
    importableCount: number;
    importables: ProjectImportableSummary[];
    missing?: boolean;
    cycle?: boolean;
    /**
     * A repeat include of an import.json whose contents are already shown under
     * its first appearance in the tree. Rendered as an unexpandable jump
     * link; counts/diagnostics mirror the home node but are not re-summed
     * into ancestors.
     */
    reference?: boolean;
    children: ProjectImportJsonNode[];
    /** Diagnostics aggregated across this node's whole subtree (like a folder badge). */
    errors?: number;
    warnings?: number;
    git?: GitDecoration;
    gitRollup?: boolean;
};

export type ProjectToHostMessage =
    | { type: "requestProjectTree"; fresh?: boolean }
    | { type: "openProjectFile"; fsPath: string; preview: boolean }
    | {
          type: "openImportableDeclaration";
          importJsonPath: string;
          kind: ProjectImportableSummary["type"];
          identity: string;
          fieldPath?: string[];
          declarationSpan?: ProjectTextSpan;
          preview: boolean;
      }
    | { type: "createIncludedImportJson"; parentImportJsonPath: string; folderPath: string }
    | { type: "createProjectImportJson"; rootImportJsonPath: string }
    | {
          type: "addImportable";
          importJsonPath: string;
          kind: ProjectImportableSummary["type"];
          identity: string;
      }
    | {
          type: "moveImportable";
          importJsonPath: string;
          kind: ProjectImportableSummary["type"];
          identity: string;
      }
    | { type: "openItemInEditor"; snbtPath: string };

export type ProjectFromHostMessage =
    | { type: "projectTree"; roots: ProjectImportJsonNode[]; workspaceName?: string }
    | { type: "projectResult"; ok: true; message: string; createdPath?: string }
    | { type: "projectResult"; ok: false; error: string }
    | { type: "projectImportJsonCreated"; createdPath?: string }
    | ({ type: "revealProjectImportable" } & ProjectImportableReveal);

export type ItemEditorToHostMessage =
    | { type: "requestImportTargets" }
    | { type: "createItemImportJson"; rootImportJsonPath: string }
    | { type: "submitItem"; form: ItemEditorForm }
    | { type: "saveItem"; snbtPath: string; tag: unknown };

export type ItemEditorFromHostMessage =
    | { type: "importTargets"; targets: ImportTarget[] }
    | { type: "itemImportJsonCreated"; createdPath?: string }
    | { type: "submitResult"; ok: true; files: string[] }
    | { type: "submitResult"; ok: false; error: string }
    | { type: "saveResult"; ok: true; snbtPath: string }
    | { type: "saveResult"; ok: false; error: string }
    /** Host parsed an existing `.snbt`; the shell switches to the Item tab and
     * loads it for editing. `tag` is the original parsed NBT, kept so a save
     * preserves keys the editor doesn't manage. */
    | { type: "loadItem"; snbtPath: string; label: string; item: ItemPreviewData; tag: unknown };

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
    | { type: "soundCatalog"; sounds: SoundEntry[] }
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
