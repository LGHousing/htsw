import { describe, expect, it } from "vitest";
import * as htsw from "../src";

class ItemFileLoader implements htsw.FileLoader {
    constructor(private readonly snbt: string) {}

    fileExists(path: string): boolean {
        return path === "/project/import.json" || path === "/project/item.snbt";
    }

    readFile(path: string): string {
        if (path === "/project/import.json") {
            return JSON.stringify({ items: [{ name: "Test Item", nbt: "item.snbt" }] });
        }
        if (path === "/project/item.snbt") return this.snbt;
        throw new Error(`File not found: ${path}`);
    }

    getParentPath(path: string): string {
        return path.slice(0, path.lastIndexOf("/"));
    }

    resolvePath(base: string, other: string): string {
        return `${base}/${other}`;
    }
}

class FunctionFileLoader implements htsw.FileLoader {
    fileExists(path: string): boolean {
        return path === "/project/import.json";
    }

    readFile(path: string): string {
        if (path === "/project/import.json") {
            return JSON.stringify({ functions: [{ name: "Test Function", icon: { item: "minecraft:mob_spawner", count: 1 } }] });
        }
        throw new Error(`File not found: ${path}`);
    }

    getParentPath(path: string): string {
        return path.slice(0, path.lastIndexOf("/"));
    }

    resolvePath(base: string, other: string): string {
        return `${base}/${other}`;
    }
}

function errorsFor(snbt: string): string[] {
    const sourceMap = new htsw.SourceMap(new ItemFileLoader(snbt));
    return htsw
        .parseImportablesResult(sourceMap, "/project/import.json")
        .diagnostics.filter((diagnostic) => diagnostic.level === "error")
        .map((diagnostic) => diagnostic.message);
}

describe("Housing interaction data validation", () => {
    it("rejects embedded interact_data", () => {
        const snbt =
            '{id: "minecraft:stone", Count: 1b, tag: {ExtraAttributes: {interact_data: {actions: []}}}}';

        expect(errorsFor(snbt)).toContain(
            "Remove interaction data from this item. Define its clicks with 'leftClickActions' or 'rightClickActions' instead."
        );
    });

    it("does not reject unrelated ExtraAttributes", () => {
        const snbt =
            '{id: "minecraft:stone", Count: 1b, tag: {ExtraAttributes: {id: "example"}}}';

        expect(errorsFor(snbt)).toEqual([]);
    });
});

describe("unspawnable item validation", () => {
    it("rejects an unspawnable item import", () => {
        expect(errorsFor('{id: "minecraft:mob_spawner", Count: 1b}')).toEqual([
            "Hypixel refuses to spawn this item, so it can't be imported."
        ]);
    });

    it("allows a spawnable item import", () => {
        expect(errorsFor('{id: "minecraft:stone", Count: 1b}')).toEqual([]);
    });

    it("rejects an unspawnable function icon", () => {
        const sourceMap = new htsw.SourceMap(new FunctionFileLoader());
        const errors = htsw
            .parseImportablesResult(sourceMap, "/project/import.json")
            .diagnostics.filter((diagnostic) => diagnostic.level === "error")
            .map((diagnostic) => diagnostic.message);

        expect(errors).toEqual([
            "Hypixel refuses to spawn this item, so it can't be used as an icon."
        ]);
    });
});
