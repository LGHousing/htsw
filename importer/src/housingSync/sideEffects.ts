// Client module: declared here, implemented by the client (ct_module/src/housingSync/sideEffects.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type TaskContext from "../tasks/context";

export declare function gmcOnImportStart(ctx: TaskContext): Promise<void>;
export declare function ensureCreativeFlight(ctx: TaskContext): Promise<boolean>;
export declare function waitForCreativeMode(ctx: TaskContext): Promise<boolean>;
export declare function playImportSuccessSound(): void;
