// Client module: declared here, implemented by the client (ct_module/src/trace/jsonl.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.

export type JsonlTrace = {
    start(options?: { clear?: boolean }): string;
    stop(): string;
    isEnabled(): boolean;
    path(): string;
    elapsed(now?: number): number;
    write(record: Record<string, unknown>): void;
};

export declare function createJsonlTrace(path: string): JsonlTrace;
