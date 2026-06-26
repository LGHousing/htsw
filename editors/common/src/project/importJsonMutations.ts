import * as json from "jsonc-parser";
import { findDeclaringImportJson } from "./includeWalk";
import type { ProjectFs } from "./fs";

const FORMATTING: json.FormattingOptions = {
    tabSize: 4,
    insertSpaces: true,
    eol: "\n",
};

export type Section =
    | "functions"
    | "events"
    | "regions"
    | "items"
    | "menus"
    | "teams"
    | "groups"
    | "commands"
    | "npcs";

export function identityField(section: Section): "name" | "event" {
    return section === "events" ? "event" : "name";
}

export function resolveImportableFile(
    fs: ProjectFs,
    entryPath: string,
    section: Section,
    identity: string
): string {
    return (
        findDeclaringImportJson(fs, entryPath, section, identityField(section), identity) ??
        entryPath
    );
}

export function upsertImportableEntry(
    fs: ProjectFs,
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

    const existing = fs.exists(importJsonPath) ? fs.readFile(importJsonPath) : null;
    if (existing === null || existing.trim() === "") {
        fs.writeFile(importJsonPath, `${JSON.stringify({ [section]: [entry] }, null, 4)}\n`);
        return;
    }

    let next = existing;
    const tree = json.parseTree(next);
    if (!tree) {
        throw new Error(
            `upsertImportableEntry: ${importJsonPath} is not valid JSON/JSONC; refusing to overwrite it`
        );
    }

    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") {
        next = json.applyEdits(next, json.modify(next, [section], [entry], {
            formattingOptions: FORMATTING,
        }));
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
            next = json.applyEdits(next, json.modify(next, [section, items.length], entry, {
                formattingOptions: FORMATTING,
                isArrayInsertion: true,
            }));
        } else {
            next = json.applyEdits(next, json.modify(next, [section, matchIndex], entry, {
                formattingOptions: FORMATTING,
            }));
        }
    }

    fs.writeFile(importJsonPath, ensureTrailingNewline(next));
}

const HOUSE_UUID_KEY_RE = /("houseUuid"\s*:\s*)"[^"]*"/;
const HOUSE_UUID_REMOVE_RES = [
    /\r?\n?[ \t]*"houseUuid"\s*:\s*"[^"]*"\s*,/,
    /,\s*"houseUuid"\s*:\s*"[^"]*"/,
    /[ \t]*"houseUuid"\s*:\s*"[^"]*"/,
];

export function setHouseUuidKey(
    fs: ProjectFs,
    importJsonPath: string,
    houseUuid: string | null
): boolean {
    if (!fs.exists(importJsonPath)) return false;
    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") {
        if (houseUuid === null) return true;
        fs.writeFile(importJsonPath, `${JSON.stringify({ houseUuid }, null, 4)}\n`);
        return true;
    }

    let next: string | null = null;
    if (houseUuid !== null) {
        if (HOUSE_UUID_KEY_RE.test(text)) {
            next = text.replace(HOUSE_UUID_KEY_RE, `$1"${houseUuid}"`);
        }
        // No existing key -> the jsonc-parser insert below adds it, finding the
        // root object without tripping on a "{" inside a leading comment.
    } else {
        for (let i = 0; i < HOUSE_UUID_REMOVE_RES.length; i++) {
            if (HOUSE_UUID_REMOVE_RES[i].test(text)) {
                next = text.replace(HOUSE_UUID_REMOVE_RES[i], "");
                break;
            }
        }
        if (next === null) return true;
    }

    if (next === null) {
        next = json.applyEdits(text, json.modify(text, ["houseUuid"], houseUuid ?? undefined, {
            formattingOptions: FORMATTING,
            getInsertionIndex: () => 0,
        }));
    }
    fs.writeFile(importJsonPath, ensureTrailingNewline(next));
    return true;
}

export function updateImportableField(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string,
    field: string | string[],
    value: unknown
): boolean {
    const importJsonPath = resolveImportableFile(fs, entryJsonPath, section, identity);
    const match = findEntry(fs, importJsonPath, section, identity);
    if (match === null) return false;

    const basePath: json.JSONPath = [section, match.index];
    const fieldParts = typeof field === "string" ? [field] : field;
    for (let i = 0; i < fieldParts.length; i++) basePath.push(fieldParts[i]);
    const next = json.applyEdits(match.text, json.modify(match.text, basePath, value, {
        formattingOptions: FORMATTING,
    }));
    fs.writeFile(importJsonPath, ensureTrailingNewline(next));
    return true;
}

export function removeImportableEntry(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    identity: string
): boolean {
    const importJsonPath = resolveImportableFile(fs, entryJsonPath, section, identity);
    const match = findEntry(fs, importJsonPath, section, identity);
    if (match === null) return false;

    const next = json.applyEdits(match.text, json.modify(
        match.text,
        [section, match.index],
        undefined,
        { formattingOptions: FORMATTING }
    ));
    fs.writeFile(importJsonPath, ensureTrailingNewline(next));
    return true;
}

export function renameImportableEntry(
    fs: ProjectFs,
    entryJsonPath: string,
    section: Section,
    oldIdentity: string,
    newIdentity: string
): boolean {
    const importJsonPath = resolveImportableFile(fs, entryJsonPath, section, oldIdentity);
    const match = findEntry(fs, importJsonPath, section, oldIdentity);
    if (match === null) return false;

    const next = json.applyEdits(match.text, json.modify(
        match.text,
        [section, match.index, identityField(section)],
        newIdentity,
        { formattingOptions: FORMATTING }
    ));
    fs.writeFile(importJsonPath, ensureTrailingNewline(next));
    return true;
}

type EntryMatch = {
    text: string;
    index: number;
};

function findEntry(
    fs: ProjectFs,
    importJsonPath: string,
    section: Section,
    identity: string
): EntryMatch | null {
    if (!fs.exists(importJsonPath)) return null;
    const text = fs.readFile(importJsonPath);
    if (text.trim() === "") return null;
    const tree = json.parseTree(text);
    if (!tree) return null;
    const sectionNode = json.findNodeAtLocation(tree, [section]);
    if (!sectionNode || sectionNode.type !== "array") return null;

    const idField = identityField(section);
    const items = sectionNode.children ?? [];
    for (let i = 0; i < items.length; i++) {
        const idNode = json.findNodeAtLocation(items[i], [idField]);
        if (idNode && idNode.type === "string" && idNode.value === identity) {
            return { text, index: i };
        }
    }
    return null;
}

function ensureTrailingNewline(text: string): string {
    return text.endsWith("\n") ? text : `${text}\n`;
}
