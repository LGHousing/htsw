/// <reference types="../../CTAutocomplete" />

import { ensureParentDirs } from "../utils/filesystem";

export type JsonlTrace = {
    start(): string;
    stop(): string;
    isEnabled(): boolean;
    path(): string;
    elapsed(now?: number): number;
    write(record: Record<string, unknown>): void;
};

export function createJsonlTrace(path: string): JsonlTrace {
    let enabled = false;
    let buffer = "";
    let startedAt = 0;

    return {
        start(): string {
            enabled = true;
            buffer = "";
            startedAt = Date.now();
            try {
                ensureParentDirs(path);
                FileLib.write(path, "", true);
            } catch (_e) {}
            return path;
        },

        stop(): string {
            enabled = false;
            return path;
        },

        isEnabled(): boolean {
            return enabled;
        },

        path(): string {
            return path;
        },

        elapsed(now?: number): number {
            return (now ?? Date.now()) - startedAt;
        },

        write(record: Record<string, unknown>): void {
            if (!enabled) return;
            const now = Date.now();
            buffer +=
                JSON.stringify({ at: now, tMs: now - startedAt, ...record }) + "\n";
            try {
                FileLib.write(path, buffer, true);
            } catch (_e) {}
        },
    };
}
