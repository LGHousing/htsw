// Client module: declared here, implemented by the client (ct_module/src/runtime/parsing/realPath.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.

export declare function resolveCanonicalPath(p: string): string;
export declare function resolveCanonicalPaths(fingerprint: { [path: string]: number }): {
    [path: string]: string;
};
