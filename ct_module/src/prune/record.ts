import type { Importable } from "htsw/types";

import { ensureParentDirs } from "../utils/filesystem";
import type { PruneTarget } from "./types";

const RECORD_DIR = "./htsw/pruned";
const RECORD_SCHEMA_VERSION = 1;

export type PruneRecordEntry = {
    type: PruneTarget["type"];
    identity: string;
    method: PruneTarget["method"];
    /** Whether house.lock recorded this as something a previous import made. */
    previouslyImported: boolean;
    /** Content as htsw last verified it, or null when it had never read the object. */
    content: Importable | null;
};

/**
 * Writes down what a prune is about to remove. Not an import.json — actions are
 * inline rather than in .htsl files — but complete enough to rebuild from.
 */
export function writePruneRecord(
    manifestPath: string,
    housingUuid: string,
    entries: readonly PruneRecordEntry[]
): string {
    const timestamp = new Date().toISOString();
    const path = unusedRecordPath(timestamp.replace(/[:.]/g, "-"));
    ensureParentDirs(path);
    const recovered = entries.filter((entry) => entry.content !== null).length;
    FileLib.write(
        path,
        JSON.stringify(
            {
                schemaVersion: RECORD_SCHEMA_VERSION,
                prunedAt: timestamp,
                manifest: manifestPath,
                houseUuid: housingUuid,
                note:
                    "Verified content is inline. content: null means htsw removed " +
                    "the object without ever having read it.",
                removedCount: entries.length,
                recoveredContentCount: recovered,
                removed: entries,
            },
            null,
            2
        ),
        true
    );
    return path;
}

// Two prunes inside the same millisecond would otherwise share a path, and the
// second would overwrite the first's record.
function unusedRecordPath(stamp: string): string {
    const base = `${RECORD_DIR}/pruned-${stamp}`;
    if (!FileLib.exists(`${base}.json`)) return `${base}.json`;
    for (let suffix = 2; suffix < 100; suffix++) {
        const candidate = `${base}-${suffix}.json`;
        if (!FileLib.exists(candidate)) return candidate;
    }
    return `${base}-overflow.json`;
}
