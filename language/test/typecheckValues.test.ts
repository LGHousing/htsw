import { describe, expect, it } from "vitest";
import { Long } from "../src/long";
import { TyCtxt } from "../src/htsl/typecheck/context";
import { longConst } from "../src/htsl/typecheck/state";
import { parseValue } from "../src/htsl/typecheck/values";

const numericGlobal = longConst(Long.fromNumber(5000));
const tcx = {
    hasState: () => true,
    getState: () => numericGlobal,
} as unknown as TyCtxt;

describe("typecheck values", () => {
    it("preserves bare placeholder types but treats quoted placeholders as strings", () => {
        expect(parseValue(tcx, "%var.global/dayNight/ticks 0%")?.type).toBe("long");
        expect(parseValue(tcx, "\"%var.global/dayNight/ticks 0%\"")?.type).toBe("string");
    });
});
