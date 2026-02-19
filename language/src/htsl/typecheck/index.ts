import type { GlobalCtxt } from "../../context";
import { check } from "./check";
import { TyCtxt } from "./context";

export function checkTypeflow(gcx: GlobalCtxt) {
    const tcx = TyCtxt.fromGlobalCtxt(gcx);
    check(tcx, []);
}