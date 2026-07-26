export type ImportConflictPolicy = "prompt" | "cancel";

export function parseImportCommandArgs(args: readonly string[]): {
    pathArgs: string[];
    onConflict: ImportConflictPolicy;
} {
    const pathArgs: string[] = [];
    let onConflict: ImportConflictPolicy = "prompt";
    for (const arg of args) {
        if (arg === "--on-conflict=cancel") {
            onConflict = "cancel";
        } else {
            pathArgs.push(arg);
        }
    }
    return { pathArgs, onConflict };
}
