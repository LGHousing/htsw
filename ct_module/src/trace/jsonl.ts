/// <reference types="../../CTAutocomplete" />

import { ensureParentDirs } from "../utils/filesystem";
import { javaType, runtimeString } from "../utils/java";

export type JsonlTrace = {
    start(options?: { clear?: boolean }): string;
    stop(): string;
    isEnabled(): boolean;
    path(): string;
    elapsed(now?: number): number;
    write(record: Record<string, unknown>): void;
};

export function createJsonlTrace(path: string): JsonlTrace {
    let enabled = false;
    let startedAt = 0;

    return {
        start(options?: { clear?: boolean }): string {
            enabled = true;
            startedAt = Date.now();
            if (options?.clear !== false) {
                try {
                    ensureParentDirs(path);
                    FileLib.write(path, "", true);
                } catch (_e) {}
            } else {
                ensureParentDirs(path);
            }
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
            let line: string;
            try {
                line = JSON.stringify({ at: now, tMs: now - startedAt, ...record }) + "\n";
            } catch (error) {
                line = JSON.stringify({
                    at: now,
                    tMs: now - startedAt,
                    kind: "traceWriteError",
                    originalKind: String(record.kind),
                    error: String(error),
                }) + "\n";
            }
            try {
                appendLine(path, line);
            } catch (_e) {}
        },
    };
}

function appendLine(path: string, line: string): void {
    const Files = javaType("java.nio.file.Files");
    const Paths = javaType("java.nio.file.Paths");
    const StandardOpenOption = javaType("java.nio.file.StandardOpenOption");
    const StandardCharsets = javaType("java.nio.charset.StandardCharsets");
    const JString = javaType("java.lang.String");
    Files.write(
        Paths.get(runtimeString(path)),
        new JString(runtimeString(line)).getBytes(StandardCharsets.UTF_8),
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND
    );
}
