import type { Importable } from "htsw/types";
import type { CacheStatusRow } from "../../importCache/status";

import { buildCacheStatusRow } from "../../importCache/status";
import { appendCacheStatusRows, setCacheStatusRows } from "./rows";

const SLICE_BUDGET_MS = 8;

const PROGRESSIVE_TARGET_TICKS = 40;

type BuildJob = {
    generation: number;
    uuid: string;
    importables: readonly Importable[];
    index: number;
    rows: CacheStatusRow[];
    progressive: boolean;
};

let generation = 0;
let activeJob: BuildJob | null = null;

export function rebuildCacheStatusRows(
    uuid: string,
    importables: readonly Importable[],
    progressive: boolean
): void {
    generation++;
    if (importables.length === 0) {
        activeJob = null;
        setCacheStatusRows([]);
        return;
    }
    if (progressive) setCacheStatusRows([]);
    activeJob = { generation, uuid, importables, index: 0, rows: [], progressive };
    stepCacheStatusBuild();
}

export function stepCacheStatusBuild(): void {
    const job = activeJob;
    if (job === null) return;

    const start = Date.now();
    const perStep = job.progressive
        ? Math.max(1, Math.ceil(job.importables.length / PROGRESSIVE_TARGET_TICKS))
        : Infinity;
    const slice: CacheStatusRow[] = [];
    while (
        job.index < job.importables.length &&
        slice.length < perStep &&
        Date.now() - start < SLICE_BUDGET_MS
    ) {
        slice.push(buildCacheStatusRow(job.uuid, job.importables[job.index]));
        job.index++;
    }

    if (activeJob !== job || job.generation !== generation) return;

    const done = job.index >= job.importables.length;
    if (job.progressive) {
        appendCacheStatusRows(slice);
    } else {
        for (let i = 0; i < slice.length; i++) job.rows.push(slice[i]);
        if (done) setCacheStatusRows(job.rows);
    }
    if (done) activeJob = null;
}
