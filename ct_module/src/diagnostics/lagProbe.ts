/// <reference types="../../CTAutocomplete" />

import { getImportProgress } from "../gui/right-panel/import-tab/importProgress";
import { getParsePerfStats } from "../gui/parsing/parses";
import { TaskManager } from "../tasks/manager";
import { getEventContainerCounts } from "../tasks/specifics/waitFor";

type WaiterCounts = {
    [k: string]: number;
};

type LagSample = {
    at: number;
    gapMs: number;
    screen: string;
    importing: boolean;
    taskRunning: boolean;
    waiters: WaiterCounts;
    lastParse: string;
};

const STALL_MS = 250;
const MAX_SAMPLES = 16;

let lastStepAt = Date.now();
const samples: LagSample[] = [];

function screenName(): string {
    try {
        const screen = (Client.getMinecraft() as any).field_71462_r;
        if (screen === null || screen === undefined) return "none";
        const name = String(screen.getClass().getName());
        const dot = name.lastIndexOf(".");
        return dot >= 0 ? name.substring(dot + 1) : name;
    } catch (_e) {
        return "unknown";
    }
}

function shortPath(path: string): string {
    const norm = path.replace(/\\/g, "/");
    const parts = norm.split("/").filter((p) => p.length > 0);
    if (parts.length <= 3) return norm;
    return ".../" + parts.slice(parts.length - 3).join("/");
}

function lastParseSummary(): string {
    const parses = getParsePerfStats();
    if (parses.length === 0) return "none";
    const p = parses[parses.length - 1];
    const age = Math.max(0, Math.round((Date.now() - p.at) / 1000));
    return `${p.source} ${p.ms}ms ${age}s ago ${shortPath(p.path)}`;
}

function record(gapMs: number): void {
    samples.push({
        at: Date.now(),
        gapMs,
        screen: screenName(),
        importing: getImportProgress() !== null,
        taskRunning: TaskManager.hasRunningTasks(),
        waiters: getEventContainerCounts(),
        lastParse: lastParseSummary(),
    });
    if (samples.length > MAX_SAMPLES) samples.shift();
}

register("step", () => {
    const now = Date.now();
    const gap = now - lastStepAt;
    lastStepAt = now;
    if (gap >= STALL_MS) record(gap);
}).setFps(60);

export function getLagProbeSamples(): LagSample[] {
    return samples.slice();
}

export function clearLagProbeSamples(): void {
    samples.length = 0;
    lastStepAt = Date.now();
}
