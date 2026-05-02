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

type Section = "functions" | "events" | "regions" | "items" | "menus";

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
