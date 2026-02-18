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
        
        expect(result.diagnostics.length).toBe(0);
        expect(result.value.length).toBe(2);
        
        // Test first item (only rightClickActions)
        const item1 = result.value[0];
        expect(item1.type).toBe("ITEM");
        
        if (item1.type === "ITEM") {
            expect(item1.key?.value).toBe("my_item");
            expect(item1.snbt?.value).toContain("minecraft:diamond_sword");
            expect(item1.rightClickActions?.value).toBeDefined();
            expect(item1.rightClickActions?.value.length).toBeGreaterThan(0);
            expect(item1.leftClickActions).toBeUndefined();
        }
        
        // Test second item (both leftClickActions and rightClickActions)
        const item2 = result.value[1];
        expect(item2.type).toBe("ITEM");
        
        if (item2.type === "ITEM") {
            expect(item2.key?.value).toBe("full_item");
            expect(item2.snbt?.value).toContain("minecraft:diamond_sword");
            expect(item2.leftClickActions?.value).toBeDefined();
            expect(item2.leftClickActions?.value.length).toBeGreaterThan(0);
            expect(item2.rightClickActions?.value).toBeDefined();
            expect(item2.rightClickActions?.value.length).toBeGreaterThan(0);
        }
    });
    
    test("should unwrap IR to plain importables", () => {
        const testDir = "/tmp/test_items";
        const fileLoader = new TestFileLoader(testDir);
        
        const importJsonPath = path.join(testDir, "import.json");
        const importables = htsw.parseImportables(fileLoader, importJsonPath);
        
        expect(importables.length).toBe(2);
        
        const item1 = importables[0];
        expect(item1.type).toBe("ITEM");
        
        if (item1.type === "ITEM") {
            expect(item1.key).toBe("my_item");
            expect(item1.snbt).toContain("minecraft:diamond_sword");
            expect(item1.rightClickActions).toBeDefined();
            expect(Array.isArray(item1.rightClickActions)).toBe(true);
            expect(item1.leftClickActions).toBeUndefined();
        }
    });

    test("should validate SNBT file extension", () => {
        const testDir = "/tmp/test_items_invalid";
        fs.mkdirSync(testDir, { recursive: true });
        
        // Create an import.json with wrong file extension
        const importJson = {
            items: [{
                key: "bad_item",
                nbt: "not_snbt.txt",
                rightClickActions: "actions.htsl"
            }]
        };
        
        fs.writeFileSync(
            path.join(testDir, "import.json"),
            JSON.stringify(importJson, null, 2)
        );
        
        const fileLoader = new TestFileLoader(testDir);
        const importJsonPath = path.join(testDir, "import.json");
        const result = htsw.parseIrImportables(
            new htsw.SourceMap(fileLoader), 
            importJsonPath
        );
        
        // Should have an error diagnostic
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(result.diagnostics[0].message).toContain(".snbt");
        
        // Clean up
        fs.rmSync(testDir, { recursive: true, force: true });
    });
});
