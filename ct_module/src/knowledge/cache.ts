import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { importableHash, listHashes } from "./hash";
import { cachePathFor, cachePathForId } from "./paths";

/**
 * Schema version for the knowledge cache format. Bump this when the
 * shape of `KnowledgeEntry` changes in a way that prior readers would
 * mis-interpret. `readKnowledge` rejects entries with a different
 * version so stale caches don't poison a future trust-mode.
 */
export const KNOWLEDGE_SCHEMA_VERSION = 1;

export type KnowledgeWriter = "exporter" | "importer";

export type KnowledgeEntry = {
    schemaVersion: typeof KNOWLEDGE_SCHEMA_VERSION;
    /** ISO 8601 instant the entry was last written. Informational only. */
    writtenAt: string;
    /** Which subsystem populated the cache last. */
    writer: KnowledgeWriter;
    /** The full importable, canonical-shaped (sorted keys, no undefined). */
    importable: Importable;
    /** `importableHash(importable)` at write time. */
    hash: string;
    /**
     * Per-action-list hashes keyed by dotted path (`"actions"`,
     * `"actions[3].ifActions"`, ...). Used by future trust-mode to
     * validate sub-trees cheaply.
     */
    lists: Record<string, string[]>;
};

/**
 * Build a fresh cache entry for the given importable. Pure: no I/O.
 */
export function buildKnowledgeEntry(
    importable: Importable,
    writer: KnowledgeWriter
): KnowledgeEntry {
    return {
        schemaVersion: KNOWLEDGE_SCHEMA_VERSION,
        writtenAt: new Date().toISOString(),
        writer,
        importable,
        hash: importableHash(importable),
        lists: listHashes(importable),
    };
}

/**
 * Persist a knowledge entry to disk. Best-effort: filesystem failures
 * are surfaced to chat as warnings but never abort the parent task —
 * the importer/exporter has already done its real work and the cache
 * is just a hint.
 */
export function writeKnowledge(
    ctx: TaskContext,
    housingUuid: string,
    importable: Importable,
    writer: KnowledgeWriter
): void {
    const path = cachePathFor(housingUuid, importable);
    const entry = buildKnowledgeEntry(importable, writer);
    try {
        FileLib.write(path, JSON.stringify(entry, null, 4), true);
    } catch (error) {
        ctx.displayMessage(`&7[knowledge] &eFailed to write cache at ${path}: ${error}`);
    }
}

/**
 * Load a knowledge entry, or null if the file is missing, unreadable,
 * malformed, or schema-mismatched. Never throws — callers treat null
 * as "no trusted state".
 */
export function readKnowledge(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): KnowledgeEntry | null {
    const path = cachePathForId(housingUuid, type, identity);
    if (!FileLib.exists(path)) return null;

    let raw: string | null;
    try {
        raw = FileLib.read(path);
    } catch {
        return null;
    }
    if (raw === null) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw));
    } catch {
        return null;
    }

    if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { schemaVersion?: unknown }).schemaVersion !== KNOWLEDGE_SCHEMA_VERSION
    ) {
        return null;
    }
    return parsed as KnowledgeEntry;
}

/** Remove a knowledge entry. No-op if it doesn't exist. */
export function deleteKnowledge(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): void {
    const path = cachePathForId(housingUuid, type, identity);
    if (!FileLib.exists(path)) return;
    try {
        FileLib.delete(path);
    } catch {
        // best-effort
    }
}
