// Client module: declared here, implemented by the client (ct_module/src/utils/fileLoaders.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { FileLoader } from "htsw";

/** Loads project files from the client's working directory. */
export declare const FileSystemFileLoader: new () => FileLoader;
/** Serves one string as every file. */
export declare const StringFileLoader: new (src: string) => FileLoader;
