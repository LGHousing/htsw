import type { Importable } from "htsw/types";

import type TaskContext from "../tasks/context";
import { importableIdentity } from "../importables/identity";
import { importableHash } from "./hash";
import { houseLockEntryFor, readHouseLock } from "./houseLock";
import { writeImportableCache } from "./cache";

export type AcceptHouseLockResult =
    | { ok: false; reason: "missing-lock" }
    | { ok: false; reason: "unbound-lock" }
    | {
          ok: true;
          housingUuid: string;
          accepted: Importable[];
          skipped: number;
          failed: number;
      };

export function acceptHouseLockAsCurrent(
    ctx: TaskContext,
    importJsonPath: string,
    importables: readonly Importable[]
): AcceptHouseLockResult {
    const lock = readHouseLock(importJsonPath);
    if (lock === null) return { ok: false, reason: "missing-lock" };
    if (lock.houseUuid === null) return { ok: false, reason: "unbound-lock" };
    const housingUuid = lock.houseUuid;

    const accepted: Importable[] = [];
    let skipped = 0;
    let failed = 0;
    for (const importable of importables) {
        const entry = houseLockEntryFor(
            lock,
            importable.type,
            importableIdentity(importable)
        );
        if (entry === null || entry.hash !== importableHash(importable)) {
            skipped++;
            continue;
        }
        if (writeImportableCache(ctx, housingUuid, importable, "project-lock", true)) {
            accepted.push(importable);
        } else {
            failed++;
        }
    }

    return { ok: true, housingUuid, accepted, skipped, failed };
}
