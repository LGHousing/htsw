// Client module: declared here, implemented by the client (ct_module/src/utils/filesystem.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.

export declare function readTextFileOrNull(path: string): string | null;
export declare function ensureParentDirs(path: string): void;
export declare function atomicWriteText(
    path: string,
    content: string,
    options?: { replaceExisting?: boolean }
): boolean;
export declare function getMtimeMs(path: string): number;
export declare function pathExists(path: string): boolean;
