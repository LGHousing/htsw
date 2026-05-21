import type { Importable } from "htsw/types";

import { trustPlanKey } from "../../importCache/trust";

export function importProgressKey(
    type: Importable["type"],
    identity: string,
    sourcePath: string
): string {
    return `${sourcePath}|${trustPlanKey(type, identity)}`;
}
