export type ImportConflictPolicy = "prompt" | "cancel" | "skip";
export const IMPORT_USAGE =
    "import <import.json|actions.htsl> [--on-conflict=cancel|skip] [--accept TYPE:name[:basePath]] [--fresh]";

export function parseImportCommandArgs(args: readonly string[]): {
    pathArgs: string[];
    onConflict: ImportConflictPolicy;
    accepts: string[];
    fresh: boolean;
    error?: string;
} {
    const pathArgs: string[] = [];
    const accepts: string[] = [];
    let onConflict: ImportConflictPolicy = "prompt";
    let fresh = false;
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--on-conflict=cancel") {
            onConflict = "cancel";
        } else if (arg === "--on-conflict=skip") {
            onConflict = "skip";
        } else if (arg.startsWith("--on-conflict=")) {
            return {
                pathArgs,
                onConflict,
                accepts,
                fresh,
                error: `Invalid --on-conflict value: ${arg.substring("--on-conflict=".length)}`,
            };
        } else if (arg === "--accept") {
            if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
                return {
                    pathArgs,
                    onConflict,
                    accepts,
                    fresh,
                    error: "--accept requires TYPE:name or TYPE:name:basePath",
                };
            }
            const identifier = args[++i];
            accepts.push(identifier);
        } else if (arg === "--fresh") {
            fresh = true;
        } else {
            pathArgs.push(arg);
        }
    }
    return { pathArgs, onConflict, accepts, fresh };
}
