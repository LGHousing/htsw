import type { Importable } from "htsw/types";

import { importableKey } from "../../importables/identity";

/**
 * Canonicalize slash direction so the same queue path referenced as
 * `C:\foo\bar.htsl` and `C:/foo/bar.htsl` produces the same key.
 */
export function queueRowKey(
    type: Importable["type"],
    identity: string,
    queuePath: string
): string {
    return `${queuePath.split("\\").join("/")}|${importableKey(type, identity)}`;
}
