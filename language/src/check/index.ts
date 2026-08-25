import type { GlobalCtxt } from "../context";
import type { ImportJsonParseMetadata } from "../importjson/metadata";
import type { Importable } from "../types";
import { checkActionContext } from "./passes/checkScope";
import { checkNbt } from "./passes/checkNbt";
import { checkItems } from "./passes/checkItems";
import { checkLimits } from "./passes/checkLimits";
import { checkStringValues } from "./passes/checkStringValues";
import { checkDuplicateDefinitions } from "./passes/checkDuplicateDefinitions";
import { checkUndeclaredReferences } from "./passes/checkUndeclaredReferences";

export type CheckOptions = {
    /**
     * Entry-file parse metadata, when the check runs over a whole import.json.
     * Passes that apply to a project as a whole read its declarations from here.
     */
    importJson?: ImportJsonParseMetadata;
};

type Pass = (
    ctx: GlobalCtxt,
    checkableImportables: Importable[],
    options: CheckOptions
) => void;

const PASSES: Pass[] = [
    checkActionContext,
    checkLimits,
    checkItems,
    checkNbt,
    checkStringValues,
    checkDuplicateDefinitions,
    // Only meaningful for a manifest that claims its whole house.
    (gcx, importables, options) => {
        if (options.importJson?.dangerouslyDeleteEverythingNotInThisFile !== true) {
            return;
        }
        checkUndeclaredReferences(gcx, importables);
    },
];

export function check(
    gcx: GlobalCtxt,
    importables: Importable[] = gcx.importables,
    options: CheckOptions = {}
) {
    for (const pass of PASSES) {
        pass(gcx, importables, options);
    }
}
