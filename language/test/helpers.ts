import { readdirSync } from "node:fs";
import { readFileSync } from "fs";
import type { Importable } from "../src/types/importables";

export function assertImportable<T extends Importable["type"]>(
    importable: Importable,
    type: T
): asserts importable is Extract<Importable, { type: T }> {
    if (importable.type !== type) {
        throw new Error(
            `Expected ${type} importable, got ${importable.type}`
        );
    }
}

export function readCases(path: string): { name: string; source: string }[] {
    const files = readdirSync(path);

    const entries: {
        name: string;
        source: string;
    }[] = [];

    for (const file of files) {
        if (!file.endsWith(".htsl")) continue;
        const name = file.substring(0, file.length - 5).replaceAll("_", " ");
        const source = readFileSync(path + `/${file}`)
            .toString()
            .replaceAll("\r", "");
        entries.push({ name, source });
    }

    return entries;
}
