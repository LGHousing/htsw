import { fileExists, readText, writeText } from "./path";

export type FunctionImportJsonEntry = {
    name: string;
    actions: string;
    repeatTicks?: number;
};

export type ImportJsonObject = Record<string, any> & {
    functions?: FunctionImportJsonEntry[];
};

export function loadImportJson(path: string): ImportJsonObject {
    if (!fileExists(path)) {
        throw new Error(`import.json does not exist at: ${path}`);
    }

    const raw = readText(path);
    if (!raw || raw.trim().length === 0) {
        return {};
    }

    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Failed to parse import.json: ${e}`);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Expected import.json root to be an object");
    }

    return parsed as ImportJsonObject;
}

export function upsertFunctionEntries(
    importJson: ImportJsonObject,
    entries: FunctionImportJsonEntry[]
): ImportJsonObject {
    const root: ImportJsonObject = { ...importJson };
    const existing = Array.isArray(root.functions) ? root.functions : [];

    const byName = new Map<string, FunctionImportJsonEntry>();
    for (const item of existing) {
        if (item && typeof item.name === "string") {
            byName.set(item.name, { ...item });
        }
    }

    for (const entry of entries) {
        const merged = {
            ...(byName.get(entry.name) ?? {}),
            name: entry.name,
            actions: entry.actions,
        } as FunctionImportJsonEntry;

        if (entry.repeatTicks !== undefined) {
            merged.repeatTicks = entry.repeatTicks;
        } else {
            delete merged.repeatTicks;
        }

        byName.set(entry.name, merged);
    }

    root.functions = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return root;
}

export function saveImportJson(path: string, value: ImportJsonObject): void {
    writeText(path, `${JSON.stringify(value, null, 4)}\n`, true);
}

