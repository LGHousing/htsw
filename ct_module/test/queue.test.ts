import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueue,
    clearQueue,
    getQueue,
    type ImportQueueItem,
} from "../src/gui/right-panel/import-tab/queue";

function functionItem(sourcePath: string, identity: string): ImportQueueItem {
    return {
        operation: "import",
        kind: "importable",
        sourcePath,
        type: "FUNCTION",
        identity,
        label: identity,
    };
}

afterEach(clearQueue);

describe("import queue work identity", () => {
    it("rejects the same Housing target arriving through another project root", () => {
        expect(addToQueue(functionItem("C:/projects/root/import.json", "HPK Regions"))).toBe(true);
        expect(addToQueue(functionItem("C:/projects/nested/import.json", "HPK Regions"))).toBe(false);

        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0]).toMatchObject({
            sourcePath: "C:/projects/root/import.json",
            identity: "HPK Regions",
        });
    });

    it("still allows distinct Housing targets", () => {
        expect(addToQueue(functionItem("C:/projects/root/import.json", "HPK Regions"))).toBe(true);
        expect(addToQueue(functionItem("C:/projects/root/import.json", "HPK Completion"))).toBe(true);

        expect(getQueue()).toHaveLength(2);
    });
});
