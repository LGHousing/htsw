import type { Importable } from "htsw/types";

import type { KnowledgeEntry } from "./cache";
import { importableHash } from "./hash";
import { importableIdentity } from "./paths";
import { readKnowledge } from "./cache";

export type KnowledgeState = "current" | "stale" | "missing";

export type KnowledgeStatusRow = {
    importable: Importable;
    identity: string;
    hash: string;
    state: KnowledgeState;
    entry: KnowledgeEntry | null;
};

export function sameHashList(
    left: readonly string[] | undefined,
    right: readonly string[] | undefined
): boolean {
    if (left === undefined || right === undefined) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

export function buildKnowledgeStatusRows(
    housingUuid: string,
    importables: readonly Importable[]
): KnowledgeStatusRow[] {
    return importables.map((importable) => {
        const identity = importableIdentity(importable);
        const hash = importableHash(importable);
        const entry = readKnowledge(housingUuid, importable.type, identity);
        const state =
            entry === null ? "missing" : entry.hash === hash ? "current" : "stale";
        return {
            importable,
            identity,
            hash,
            state,
            entry,
        };
    });
}
