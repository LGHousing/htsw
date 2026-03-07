import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Action } from "../src/types";
import type { ScanFunctionDetailsDeps } from "../../ct_module/src/exporter/scanFunctionDetails";

let scanFunctionDetails!: (
    ctx: any,
    functionName: string,
    repeatTicks?: number
) => Promise<any>;
let SCAN_FUNCTION_DETAILS_DEPS!: ScanFunctionDetailsDeps;
let ORIGINAL_DEPS!: ScanFunctionDetailsDeps;

beforeAll(async () => {
    (globalThis as any).Java = { type: () => class { } };
    (globalThis as any).register = () => ({});

    const module = await import("../../ct_module/src/exporter/scanFunctionDetails");
    scanFunctionDetails = module.scanFunctionDetails;
    SCAN_FUNCTION_DETAILS_DEPS = module.SCAN_FUNCTION_DETAILS_DEPS;
    ORIGINAL_DEPS = { ...module.SCAN_FUNCTION_DETAILS_DEPS };
});

function restoreScanDeps(): void {
    SCAN_FUNCTION_DETAILS_DEPS.readFunctionNote = ORIGINAL_DEPS.readFunctionNote;
    SCAN_FUNCTION_DETAILS_DEPS.openFunctionEditor = ORIGINAL_DEPS.openFunctionEditor;
    SCAN_FUNCTION_DETAILS_DEPS.readActionList = ORIGINAL_DEPS.readActionList;
}

afterEach(() => {
    restoreScanDeps();
});

describe("scanFunctionDetails orchestration", () => {
    it("returns a not-found scan error when the function note cannot be read", async () => {
        let openCalls = 0;

        SCAN_FUNCTION_DETAILS_DEPS.readFunctionNote = async () => ({
            exists: false,
            noteText: null,
            malformedWatermark: false,
        });
        SCAN_FUNCTION_DETAILS_DEPS.openFunctionEditor = async () => {
            openCalls++;
            return true;
        };

        const result = await scanFunctionDetails({} as any, "missing_fn", 15);
        expect(result).toEqual({
            name: "missing_fn",
            repeatTicks: 15,
            scanError: "Function does not exist in house",
        });
        expect(openCalls).toBe(0);
    });

    it("returns watermark and open-editor error when the function editor does not open", async () => {
        let actionListCalls = 0;

        SCAN_FUNCTION_DETAILS_DEPS.readFunctionNote = async () => ({
            exists: true,
            noteText: "note",
            watermarkHash: "abc123",
            watermarkUpdatedAt: "2026-03-01T00:00:00.000Z",
            malformedWatermark: false,
        });
        SCAN_FUNCTION_DETAILS_DEPS.openFunctionEditor = async () => false;
        SCAN_FUNCTION_DETAILS_DEPS.readActionList = async () => {
            actionListCalls++;
            return [];
        };

        const result = await scanFunctionDetails({} as any, "my_fn");
        expect(result).toEqual({
            name: "my_fn",
            repeatTicks: undefined,
            watermark: {
                hash: "abc123",
                updatedAt: "2026-03-01T00:00:00.000Z",
            },
            scanError: "Failed to open function editor",
        });
        expect(actionListCalls).toBe(0);
    });

    it("stringifies unexpected scan errors", async () => {
        SCAN_FUNCTION_DETAILS_DEPS.readFunctionNote = async () => ({
            exists: true,
            noteText: "note",
            malformedWatermark: false,
        });
        SCAN_FUNCTION_DETAILS_DEPS.openFunctionEditor = async () => true;
        SCAN_FUNCTION_DETAILS_DEPS.readActionList = async () => {
            throw new Error("boom");
        };

        const result = await scanFunctionDetails({} as any, "broken_fn");
        expect(result.name).toBe("broken_fn");
        expect(result.scanError).toContain("boom");
    });

    it("returns actions and watermark on success", async () => {
        const actions: Action[] = [{ type: "EXIT" }];

        SCAN_FUNCTION_DETAILS_DEPS.readFunctionNote = async () => ({
            exists: true,
            noteText: "note",
            watermarkHash: "deadbeef",
            watermarkUpdatedAt: "2026-03-02T00:00:00.000Z",
            malformedWatermark: false,
        });
        SCAN_FUNCTION_DETAILS_DEPS.openFunctionEditor = async () => true;
        SCAN_FUNCTION_DETAILS_DEPS.readActionList = async () => actions;

        const result = await scanFunctionDetails({} as any, "good_fn", 5);
        expect(result).toEqual({
            name: "good_fn",
            repeatTicks: 5,
            actions,
            watermark: {
                hash: "deadbeef",
                updatedAt: "2026-03-02T00:00:00.000Z",
            },
        });
    });
});
