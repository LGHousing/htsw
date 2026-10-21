// Client module: declared here, implemented by the client (ct_module/src/runtimeDebug/importFailureUpload.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.

export declare function uploadDiagnosticsFile(
    path: string,
    options?: { chatUploadedId?: boolean }
): void;
