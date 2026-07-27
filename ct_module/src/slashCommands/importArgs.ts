export type ImportConflictPolicy = "prompt" | "cancel";

export function parseImportCommandArgs(args: readonly string[]): {
    pathArgs: string[];
    onConflict: ImportConflictPolicy;
    fresh: boolean;
} {
    const pathArgs: string[] = [];
    let onConflict: ImportConflictPolicy = "prompt";
    let fresh = false;
    for (const arg of args) {
        if (arg === "--on-conflict=cancel") {
            onConflict = "cancel";
        } else if (arg === "--fresh") {
            fresh = true;
        } else {
            pathArgs.push(arg);
        }
    }
    return { pathArgs, onConflict, fresh };
}
