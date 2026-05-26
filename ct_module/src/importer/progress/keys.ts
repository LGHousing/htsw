import type { Importable } from "htsw/types";

import { trustPlanKey } from "../../importCache/trust";

/**
 * Canonicalize the path component so the same file referenced as
 * `C:\foo\bar.htsl` and `C:/foo/bar.htsl` produces the same key.
 * Mirrors `gui/lib/pathDisplay.normalizeHtswPath`'s slash handling at
 * the level this layer cares about (slash direction only — the importer
 * doesn't need the GUI's htsw-relative collapsing).
 */
export function importProgressKey(
    type: Importable["type"],
    identity: string,
    sourcePath: string
): string {
    return `${sourcePath.split("\\").join("/")}|${trustPlanKey(type, identity)}`;
}
