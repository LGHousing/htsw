import type { ImportConflict } from "./conflicts";

function distinctConflictImportableCount(
    conflicts: readonly ImportConflict[]
): number {
    const keys = new Set<string>();
    for (const conflict of conflicts) {
        keys.add(`${conflict.type}\u0000${conflict.identity}`);
    }
    return keys.size;
}

export function conflictAwaitingConfirmationMessage(
    conflicts: readonly ImportConflict[]
): string {
    return (
        `[htsw] Import conflict: ${distinctConflictImportableCount(conflicts)} importables changed in Housing — awaiting confirmation\n` +
        conflicts
            .map(
                (conflict) =>
                    `[htsw] Conflict: ${conflict.type} "${conflict.identity}" · ${conflict.basePath}`
            )
            .join("\n")
    );
}
