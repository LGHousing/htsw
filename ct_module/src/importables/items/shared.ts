import type { ImportableItem } from "htsw/types";

export function hasItemClickActions(importable: ImportableItem): boolean {
    return (
        (importable.leftClickActions?.length ?? 0) > 0 ||
        (importable.rightClickActions?.length ?? 0) > 0
    );
}

export function itemShellMatchesCached(
    cached: ImportableItem,
    desired: ImportableItem
): boolean {
    return stableStringify(itemShell(cached)) === stableStringify(itemShell(desired));
}

function itemShell(importable: ImportableItem): object {
    return {
        type: importable.type,
        name: importable.name,
        nbt: importable.nbt,
    };
}

function stableStringify(value: unknown): string {
    if (value === null) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }

    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
        const v = record[key];
        if (v === undefined) continue;
        parts.push(JSON.stringify(key) + ":" + stableStringify(v));
    }
    return "{" + parts.join(",") + "}";
}
