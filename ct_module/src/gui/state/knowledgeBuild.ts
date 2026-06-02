import type { Importable } from "htsw/types";
import type { CacheStatusRow } from "../../importCache/status";

import { buildCacheStatusRow } from "../../importCache/status";
import { appendKnowledgeRows, setKnowledgeRows } from "./index";

// Knowledge rows are built on the Minecraft main thread, so doing all ~200
// importables in one call freezes the game for the full hash time. Instead we
// slice the work across ticks under a small time budget. `stepKnowledgeBuild`
// is pumped from the overlay tick (~20/s).
const SLICE_BUDGET_MS = 8;

// During a progressive fill, cap how many dots appear per tick so they
// cascade smoothly instead of arriving in big jerky groups (the per-row hash
// is cheap once seeded from the snapshot, so the time budget alone would let a
// tick churn through dozens). Scaled so even a large project finishes the fill
// in roughly this many ticks (~2s at 20/s); a small one fills ~1 dot/tick.
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

/**
 * Rebuild the per-importable knowledge dots.
 *
 * `progressive` chooses the visual: on a fresh load (nothing meaningful on
 * screen) clear and let dots fill in as they're built. On a reparse (an
 * edit) keep the existing rows up and swap the freshly-built set in
 * atomically when done — clearing first would blank every dot to "unknown"
 * (red) for the whole sliced build, a full-red flash on every edit.
 */
export function rebuildKnowledgeRows(
    uuid: string,
    importables: readonly Importable[],
    progressive: boolean
): void {
    generation++;
    if (importables.length === 0) {
        activeJob = null;
        setKnowledgeRows([]);
        return;
    }
    if (progressive) setKnowledgeRows([]);
    activeJob = { generation, uuid, importables, index: 0, rows: [], progressive };
    stepKnowledgeBuild();
}

/** Process as many importables as fit in one tick's time budget. No-op when
 * idle. A newer rebuild bumps `generation`, abandoning any in-flight job. */
export function stepKnowledgeBuild(): void {
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
        appendKnowledgeRows(slice);
    } else {
        for (let i = 0; i < slice.length; i++) job.rows.push(slice[i]);
        if (done) setKnowledgeRows(job.rows);
    }
    if (done) activeJob = null;
}
