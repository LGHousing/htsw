// Client module: declared here, implemented by the client (ct_module/src/runtimeDebug/importFailureLog.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.

export type TaskFailureDetails = {
    phase: string;
    sourcePath: string;
    housingUuid: string;
    importableType?: string;
    identity?: string;
    rowIndex?: number;
};

export declare function writeTaskFailureLog(
    context: TaskFailureDetails,
    error: unknown
): string;
