import * as htsw from "../src/index.js";
import { describe, test, expect } from "vitest";
import path from "path";
import fs from "fs";

class TestFileLoader implements htsw.FileLoader {
    basePath: string;

    constructor(basePath: string) {
        this.basePath = basePath;
    }

    fileExists(filePath: string): boolean {
        try {
            return fs.existsSync(filePath);
        } catch (e) {
            return false;
        }
    }

    readFile(filePath: string): string {
        return fs.readFileSync(filePath, "utf-8");
    }

    resolvePath(base: string, relative: string): string {
        return path.resolve(base, relative);
    }

    getParentPath(filePath: string): string {
        return path.dirname(filePath);
    }
}

describe("Import JSON Items", () => {
    test("should parse items from import.json", () => {
        const testDir = "/tmp/test_items";
        const fileLoader = new TestFileLoader(testDir);
        
        const importJsonPath = path.join(testDir, "import.json");
        const result = htsw.parseIrImportables(
            new htsw.SourceMap(fileLoader), 
            importJsonPath
        );
        
        // Log diagnostics for debugging
        console.log("Diagnostics:", result.diagnostics);
        
        expect(result.diagnostics.length).toBe(0);
        expect(result.value.length).toBe(1);
        
        const item = result.value[0];
        expect(item.type).toBe("ITEM");
        
        if (item.type === "ITEM") {
            expect(item.key?.value).toBe("my_item");
            expect(item.snbt?.value).toContain("minecraft:diamond_sword");
            expect(item.rightClickActions?.value).toBeDefined();
            expect(item.rightClickActions?.value.length).toBeGreaterThan(0);
        }
    });
});
