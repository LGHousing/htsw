import * as json from "jsonc-parser";

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
 * the key. Inserted as the first key so the binding reads like a header.
 * Returns false when the file doesn't exist (nothing to bind).
 */
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
    const edits = json.modify(text, ["houseUuid"], houseUuid ?? undefined, {
        formattingOptions: FORMATTING,
        getInsertionIndex: () => 0,
    });
    let next = json.applyEdits(text, edits);
    if (!next.endsWith("\n")) next += "\n";
    FileLib.write(importJsonPath, next, true);
    return true;
}

/**
 * Surgical single-field update: change one field on an importable entry.
 * Pass `undefined` as value to remove the field. Returns true on success.
 */
export function updateImportableField(
    importJsonPath: string,
    section: Section,
    identity: string,
    field: string | string[],
    value: unknown
): boolean {
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
 * Surgical rename: change just the identity field of one entry in the
 * given section. Preserves every other field (and surrounding comments
 * / formatting) untouched. Returns true on success, false when no entry
 * with `oldIdentity` was found.
 */
export function renameImportableEntry(
    importJsonPath: string,
    section: Section,
    oldIdentity: string,
    newIdentity: string
): boolean {
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
