import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import { buildCacheStatusRows } from "../../importCache/status";
import { setKnowledgeRows } from "./index";

/**
 * Incremental, tick-driven knowledge-row rebuild.
 *
 * Building all rows for a large import.json means a cache read + hash per
 * importable (hundreds of them). Doing that synchronously froze the client for
 * ~a second on every GUI open / lobby swap; doing it through `setTimeout`
 * batches stalled for *minutes* because CT's timer backs up under load. So we
 * spread it across real game ticks: a fixed batch per tick, then publish once.
 * The latest request supersedes any in-flight build (uuid/source changed).
 */
type PendingBuild = {
    uuid: string;
    importables: readonly Importable[];
    index: number;
    rows: CacheStatusRow[];
    onDone: (() => void) | null;
};

let pending: PendingBuild | null = null;
let tickRegistered = false;
const BATCH_PER_TICK = 30;

export function scheduleKnowledgeBuild(
    uuid: string,
    importables: readonly Importable[],
    onDone?: () => void
): void {
    pending = { uuid, importables, index: 0, rows: [], onDone: onDone ?? null };
    if (importables.length === 0) {
        flush();
        return;
    }
    if (!tickRegistered) {
        tickRegistered = true;
        register("tick", processBatch);
    }
}

function flush(): void {
    if (pending === null) return;
    setKnowledgeRows(pending.rows);
    const onDone = pending.onDone;
    pending = null;
    if (onDone !== null) onDone();
}

function processBatch(): void {
    const p = pending;
    if (p === null) return;
    const end = Math.min(p.importables.length, p.index + BATCH_PER_TICK);
    const built = buildCacheStatusRows(p.uuid, p.importables.slice(p.index, end));
    for (let i = 0; i < built.length; i++) p.rows.push(built[i]);
    p.index = end;
    if (p.index >= p.importables.length) flush();
}
