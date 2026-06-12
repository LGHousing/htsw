import * as json from "jsonc-parser";
import { findDeclaringImportJson } from "./includeWalk";

/**
 * Surgical edits to an `import.json` file: preserves comments, trailing
 * commas, indentation, and unrelated entries by routing every change
 * through `jsonc-parser`'s `modify` + `applyEdits` instead of a naive
 * `JSON.parse` + `JSON.stringify` round trip.
 *
 * If the file doesn't exist yet, we write a fresh canonical document
 * with the new entry inside the appropriate section.
 *
 * If the file exists but doesn't have the section, the section is added
 * with the new entry as its sole member.
 *
 * If the section exists and an entry with the same identifying field is
 * already there, that entry is replaced wholesale (so all fields on the
 * new value win — including dropping fields that disappeared, which is
 * the expected behavior of a re-export).
 *
 * Include awareness: a project's entries can live in INCLUDED files, not
 * just the file the GUI knows as the project. `updateImportableField`,
 * `removeImportableEntry`, and `renameImportableEntry` resolve the
 * declaring file themselves (their edits carry no file-relative paths, so
 * retargeting is always safe). `upsertImportableEntry` does NOT — its
 * entry values can carry refs like `actions`/`nbt` that are relative to
 * the file they're written into, so the CALLER must compute the target
 * (and any refs) together: see `htslTargetFor*Export` /
 * `snbtTargetForItemExport` in paths.ts, or `resolveImportableFile`.
 */

const FORMATTING: json.FormattingOptions = {
    tabSize: 4,
    insertSpaces: true,
    eol: "\n",
};

export type Section = "functions" | "events" | "regions" | "items" | "menus" | "npcs";

/**
 * The field that uniquely identifies an entry within its section.
 * Functions/regions/items use `name`; events use `event` (the event
 * constant) since they're singletons per type.
 */
function identityField(section: Section): "name" | "event" {
    return section === "events" ? "event" : "name";
}

/**
 * The file in `entryPath`'s include tree that declares `identity` — the
 * entry file itself when nothing does (new entries are created there).
 */
export function resolveImportableFile(
    entryPath: string,
    section: Section,
    identity: string
): string {
    return (
        findDeclaringImportJson(entryPath, section, identityField(section), identity) ??
        entryPath
    );
}

/**
 * Insert or update an entry in the given section. The entry must include
 * the section's identity field with a string value.
 */
export function upsertImportableEntry(
    importJsonPath: string,
    section: Section,
    entry: Record<string, unknown>
): void {
    const idField = identityField(section);
    const idValue = entry[idField];
    if (typeof idValue !== "string") {
        throw new Error(
            `upsertImportableEntry: entry is missing string "${idField}" field`
        );
    }

    const existing = FileLib.exists(importJsonPath)
        ? String(FileLib.read(importJsonPath) ?? "")
        : null;

    if (existing === null || existing.trim() === "") {
        const fresh = `${JSON.stringify({ [section]: [entry] }, null, 4)}\n`;
        FileLib.write(importJsonPath, fresh, true);
        return;
    }

    let next = existing;
    const tree = json.parseTree(next);

    if (!tree) {
        const fresh = `${JSON.stringify({ [section]: [entry] }, null, 4)}\n`;
        FileLib.write(importJsonPath, fresh, true);
        return;
    }

    const sectionNode = json.findNodeAtLocation(tree, [section]);

    if (!sectionNode) {
        const edits = json.modify(next, [section], [entry], {
            formattingOptions: FORMATTING,
        });
        next = json.applyEdits(next, edits);
    } else if (sectionNode.type !== "array") {
        const edits = json.modify(next, [section], [entry], {
            formattingOptions: FORMATTING,
        });
        next = json.applyEdits(next, edits);
    } else {
        const items = sectionNode.children ?? [];
        let matchIndex = -1;
        for (let i = 0; i < items.length; i++) {
            const idNode = json.findNodeAtLocation(items[i], [idField]);
            if (idNode && idNode.type === "string" && idNode.value === idValue) {
                matchIndex = i;
                break;
            }
        }

        if (matchIndex === -1) {
            const edits = json.modify(next, [section, items.length], entry, {
                formattingOptions: FORMATTING,
                isArrayInsertion: true,
            });
            next = json.applyEdits(next, edits);
        } else {
            const edits = json.modify(next, [section, matchIndex], entry, {
                formattingOptions: FORMATTING,
            });
            next = json.applyEdits(next, edits);
        }
    }

    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
}

/**
 * Set or remove the file's top-level "houseUuid" binding. `null` removes
 * the key. Returns false when the file doesn't exist (nothing to bind).
 *
 * Edits at the STRING level instead of through jsonc-parser: `json.modify`
 * re-parses the whole document, which on Rhino freezes the client for big
 * import.jsons, and this edit is one top-level key whose name can't legally
 * appear anywhere else (the schema rejects unknown keys, so a clean file has
 * no nested "houseUuid"). jsonc remains the fallback for shapes the string
 * paths don't confidently match.
 */
const HOUSE_UUID_KEY_RE = /("houseUuid"\s*:\s*)"[^"]*"/;
// Removal variants: key-with-trailing-comma (anywhere but last), then
// comma-then-key (last entry), then a lone key (only entry).
const HOUSE_UUID_REMOVE_RES = [
    /\r?\n?[ \t]*"houseUuid"\s*:\s*"[^"]*"\s*,/,
    /,\s*"houseUuid"\s*:\s*"[^"]*"/,
    /[ \t]*"houseUuid"\s*:\s*"[^"]*"/,
];

export function setHouseUuidKey(
    importJsonPath: string,
    houseUuid: string | null
): boolean {
    if (!FileLib.exists(importJsonPath)) return false;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") {
        if (houseUuid === null) return true;
        FileLib.write(
            importJsonPath,
            `${JSON.stringify({ houseUuid }, null, 4)}\n`,
            true
        );
        return true;
    }

    let next: string | null = null;
    if (houseUuid !== null) {
        if (HOUSE_UUID_KEY_RE.test(text)) {
            next = text.replace(HOUSE_UUID_KEY_RE, `$1"${houseUuid}"`);
        } else {
            const brace = text.indexOf("{");
            // Only insert with a trailing comma when another key follows.
            const hasOtherKeys = brace !== -1 && text.indexOf('"', brace) !== -1;
            if (brace !== -1) {
                const comma = hasOtherKeys ? "," : "";
                next =
                    text.substring(0, brace + 1) +
                    `\n    "houseUuid": "${houseUuid}"${comma}` +
                    text.substring(brace + 1);
            }
        }
    } else {
        for (let i = 0; i < HOUSE_UUID_REMOVE_RES.length; i++) {
            if (HOUSE_UUID_REMOVE_RES[i].test(text)) {
                next = text.replace(HOUSE_UUID_REMOVE_RES[i], "");
                break;
            }
        }
        if (next === null) return true; // no key present — nothing to remove
    }

    if (next === null) {
        // Fallback: the slow-but-correct jsonc edit.
        const edits = json.modify(text, ["houseUuid"], houseUuid ?? undefined, {
            formattingOptions: FORMATTING,
            getInsertionIndex: () => 0,
        });
        next = json.applyEdits(text, edits);
    }
    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
    return true;
}

/**
 * Surgical single-field update: change one field on an importable entry.
 * Pass `undefined` as value to remove the field. Returns true on success.
 */
export function updateImportableField(
    entryJsonPath: string,
    section: Section,
    identity: string,
    field: string | string[],
    value: unknown
): boolean {
    const importJsonPath = resolveImportableFile(entryJsonPath, section, identity);
    const idField = identityField(section);
    if (!FileLib.exists(importJsonPath)) return false;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return false;
    const tree = json.parseTree(text);
    if (!tree) return false;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return false;
    const items = sectionNode.children ?? [];
    let matchIndex = -1;
    for (let i = 0; i < items.length; i++) {
        const idNode = json.findNodeAtLocation(items[i], [idField]);
        if (idNode && idNode.type === "string" && idNode.value === identity) {
            matchIndex = i;
            break;
        }
    }
    if (matchIndex === -1) return false;
    const basePath: json.JSONPath = [section, matchIndex];
    const fieldParts = typeof field === "string" ? [field] : field;
    for (let i = 0; i < fieldParts.length; i++) basePath.push(fieldParts[i]);
    const edits = json.modify(text, basePath, value, {
        formattingOptions: FORMATTING,
    });
    let next = json.applyEdits(text, edits);
    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
    return true;
}

/**
 * Remove one entry from its section. Returns false when the file, section,
 * or entry isn't there.
 */
export function removeImportableEntry(
    entryJsonPath: string,
    section: Section,
    identity: string
): boolean {
    const importJsonPath = resolveImportableFile(entryJsonPath, section, identity);
    const idField = identityField(section);
    if (!FileLib.exists(importJsonPath)) return false;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return false;
    const tree = json.parseTree(text);
    if (!tree) return false;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return false;
    const items = sectionNode.children ?? [];
    let matchIndex = -1;
    for (let i = 0; i < items.length; i++) {
        const idNode = json.findNodeAtLocation(items[i], [idField]);
        if (idNode && idNode.type === "string" && idNode.value === identity) {
            matchIndex = i;
            break;
        }
    }
    if (matchIndex === -1) return false;
    const edits = json.modify(text, [section, matchIndex], undefined, {
        formattingOptions: FORMATTING,
    });
    let next = json.applyEdits(text, edits);
    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
    return true;
}

/**
 * Surgical rename: change just the identity field of one entry in the
 * given section. Preserves every other field (and surrounding comments
 * / formatting) untouched. Returns true on success, false when no entry
 * with `oldIdentity` was found.
 */
export function renameImportableEntry(
    entryJsonPath: string,
    section: Section,
    oldIdentity: string,
    newIdentity: string
): boolean {
    const importJsonPath = resolveImportableFile(entryJsonPath, section, oldIdentity);
    const idField = identityField(section);
    if (!FileLib.exists(importJsonPath)) return false;
    const text = String(FileLib.read(importJsonPath) ?? "");
    if (text.trim() === "") return false;
    const tree = json.parseTree(text);
    if (!tree) return false;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return false;
    const items = sectionNode.children ?? [];
    let matchIndex = -1;
    for (let i = 0; i < items.length; i++) {
        const idNode = json.findNodeAtLocation(items[i], [idField]);
        if (idNode && idNode.type === "string" && idNode.value === oldIdentity) {
            matchIndex = i;
            break;
        }
    }
    if (matchIndex === -1) return false;
    const edits = json.modify(text, [section, matchIndex, idField], newIdentity, {
        formattingOptions: FORMATTING,
    });
    let next = json.applyEdits(text, edits);
    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
    return true;
}
