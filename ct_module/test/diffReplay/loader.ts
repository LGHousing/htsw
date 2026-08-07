/// <reference types="node" />

import { readFileSync } from "node:fs";

import type { Action } from "htsw/types";

import type { CurrentActionListEntry } from "../../src/housingSync/actions/diff/types";

export type DiffInputCapture = {
    kind: "diffInput";
    tMs: number;
    label: string;
    current: CurrentActionListEntry[];
    desired: Action[];
    hadItemDiff: boolean;
    planningPath?: "hydrated" | "known";
    trustMode?: boolean;
};

export function loadDiffCapture(path: string): DiffInputCapture[] {
    return parseDiffCapture(readFileSync(path, "utf8"));
}

export function parseDiffCapture(jsonl: string): DiffInputCapture[] {
    const records: DiffInputCapture[] = [];
    for (const [index, line] of jsonl.split(/\r?\n/).entries()) {
        if (line.trim() === "") continue;
        const value: unknown = JSON.parse(line);
        if (!isDiffInputCapture(value)) {
            throw new Error(`Invalid diff capture record on line ${index + 1}.`);
        }
        records.push(value);
    }
    return records;
}

function isDiffInputCapture(value: unknown): value is DiffInputCapture {
    if (typeof value !== "object" || value === null) return false;
    const record = value as Partial<DiffInputCapture>;
    return (
        record.kind === "diffInput" &&
        typeof record.tMs === "number" &&
        typeof record.label === "string" &&
        Array.isArray(record.current) &&
        Array.isArray(record.desired) &&
        typeof record.hadItemDiff === "boolean"
    );
}
