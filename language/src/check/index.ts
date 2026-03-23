import type { GlobalCtxt } from "../context";
import { checkActionContext } from "./passes/checkScope";
import { checkNestedConditionals } from "./passes/checkNestedConditionals";
import { checkNbt } from "./passes/checkNbt";

type Pass = (ctx: GlobalCtxt) => void;

const PASSES: Pass[] = [
    checkActionContext,
    checkNestedConditionals,
    checkNbt
]

export function check(gcx: GlobalCtxt) {
    for (const pass of PASSES) {
        pass(gcx);
    }
}