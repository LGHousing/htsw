import type { GlobalCtxt } from "../context";
import type { Importable } from "../types";
import { checkActionContext } from "./passes/checkScope";
import { checkNbt } from "./passes/checkNbt";
import { checkItems } from "./passes/checkItems";
import { checkLimits } from "./passes/checkLimits";
import { checkStringValues } from "./passes/checkStringValues";
import { checkDuplicateDefinitions } from "./passes/checkDuplicateDefinitions";

type Pass = (ctx: GlobalCtxt, checkableImportables: Importable[]) => void;

const PASSES: Pass[] = [
    checkActionContext,
    checkLimits,
    checkItems,
    checkNbt,
    checkStringValues,
    checkDuplicateDefinitions,
];

export function check(gcx: GlobalCtxt, importables: Importable[] = gcx.importables) {
    for (const pass of PASSES) {
        pass(gcx, importables);
    }
}
