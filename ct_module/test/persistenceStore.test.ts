import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/filesystem", () => ({
    atomicWriteText: (path: string, value: string) => {
        try {
            FileLib.write(path, value, true);
            return true;
        } catch (_e) {
            return false;
        }
    },
}));

const SETTINGS_DIR = "./htsw/.settings";

describe("persistence store", () => {
    let files: Map<string, string>;

    beforeEach(() => {
        vi.resetModules();
        files = new Map();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: (path: string, value: string) => files.set(path, value),
            delete: (path: string) => files.delete(path),
        });
    });

    it("returns fallbacks when no file exists and persists on set", async () => {
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json" });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        expect(flag.get()).toBe(true);
        expect(flag.set(false)).toBe(true);
        expect(flag.get()).toBe(false);
        expect(JSON.parse(files.get(`${SETTINGS_DIR}/t.json`)!)).toEqual({ on: false });
    });

    it("falls back per key, so one bad value cannot take the document with it", async () => {
        files.set(`${SETTINGS_DIR}/t.json`, JSON.stringify({ a: "nope", b: false }));
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json" });
        const a = defineValue(doc, { key: "a", fallback: true, parse: asBoolean });
        const b = defineValue(doc, { key: "b", fallback: true, parse: asBoolean });

        expect(a.get()).toBe(true);
        expect(b.get()).toBe(false);
    });

    it("refuses to overwrite a document it could not parse", async () => {
        files.set(`${SETTINGS_DIR}/t.json`, "not json");
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json", onReadError: "refuse" });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        expect(flag.get()).toBe(true);
        expect(flag.set(false)).toBe(false);
        // The unreadable original is still there — not replaced by an empty one.
        expect(files.get(`${SETTINGS_DIR}/t.json`)).toBe("not json");
    });

    it("resets and stays writable under the defaults policy", async () => {
        files.set(`${SETTINGS_DIR}/t.json`, "not json");
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json", onReadError: "defaults" });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        expect(flag.get()).toBe(true);
        expect(flag.set(false)).toBe(true);
        expect(JSON.parse(files.get(`${SETTINGS_DIR}/t.json`)!)).toEqual({ on: false });
    });

    it("rolls the in-memory value back when the write fails", async () => {
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json" });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: () => {
                throw new Error("read-only");
            },
            delete: (path: string) => files.delete(path),
        });

        expect(flag.set(false)).toBe(false);
        expect(flag.get()).toBe(true);
    });

    it("increments revision only after a successful set", async () => {
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json" });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        expect(flag.revision()).toBe(0);
        expect(flag.set(false)).toBe(true);
        expect(flag.revision()).toBe(1);

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files.has(path),
            read: (path: string) => files.get(path) ?? null,
            write: () => {
                throw new Error("read-only");
            },
            delete: (path: string) => files.delete(path),
        });

        expect(flag.set(true)).toBe(false);
        expect(flag.revision()).toBe(1);
    });

    it("migrates a document from a legacy path and removes the old copy", async () => {
        const legacy = "./config/ChatTriggers/modules/HTSW/gui-t.json";
        files.set(legacy, JSON.stringify({ on: false }));
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json", legacyPaths: [legacy] });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        expect(flag.get()).toBe(false);
        expect(JSON.parse(files.get(`${SETTINGS_DIR}/t.json`)!)).toEqual({ on: false });
        expect(files.has(legacy)).toBe(false);
    });

    it("runs a migrate hook before any value is parsed", async () => {
        files.set(`${SETTINGS_DIR}/t.json`, JSON.stringify({ old: true }));
        const { defineDoc, defineValue, asBoolean } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({
            file: "t.json",
            migrate(data) {
                if (data.old === undefined) return;
                data.renamed = data.old;
                delete data.old;
            },
        });
        const value = defineValue(doc, {
            key: "renamed",
            fallback: false,
            parse: asBoolean,
        });

        expect(value.get()).toBe(true);
    });

    it("coalesces debounced writes until flushed", async () => {
        const { defineDoc, defineValue, asBoolean, flushPersistence } = await import(
            "../src/persistence/store"
        );
        const doc = defineDoc({ file: "t.json", debounceMs: 5000 });
        const flag = defineValue(doc, { key: "on", fallback: true, parse: asBoolean });

        flag.set(false);
        expect(files.has(`${SETTINGS_DIR}/t.json`)).toBe(false);

        flushPersistence(true);
        expect(JSON.parse(files.get(`${SETTINGS_DIR}/t.json`)!)).toEqual({ on: false });
    });

    it("stores a root document as a bare value and round-trips a Set", async () => {
        const { defineRootDoc, asStringSetValue, serializeStringSet } = await import(
            "../src/persistence/store"
        );
        const value = defineRootDoc<Set<string>>({
            file: "r.json",
            fallback: new Set<string>(),
            parse: asStringSetValue,
            serialize: serializeStringSet,
        });

        value.set(new Set(["b", "a"]));
        // Sorted on write so the file diffs cleanly.
        expect(JSON.parse(files.get(`${SETTINGS_DIR}/r.json`)!)).toEqual(["a", "b"]);
        expect(Array.from(value.get()).sort()).toEqual(["a", "b"]);
    });

    it("re-reads a TTL document after it expires", async () => {
        files.set(`${SETTINGS_DIR}/r.json`, JSON.stringify(["a"]));
        const { defineRootDoc, asStringSetValue } = await import(
            "../src/persistence/store"
        );
        const value = defineRootDoc<Set<string>>({
            file: "r.json",
            ttlMs: 1,
            fallback: new Set<string>(),
            parse: asStringSetValue,
        });

        expect(Array.from(value.get())).toEqual(["a"]);

        // Simulate a hand-edit while the game runs.
        files.set(`${SETTINGS_DIR}/r.json`, JSON.stringify(["a", "b"]));
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now + 1000);

        expect(Array.from(value.get()).sort()).toEqual(["a", "b"]);
        vi.restoreAllMocks();
    });

    it("increments revision only when a TTL re-read finds changed contents", async () => {
        files.set(`${SETTINGS_DIR}/r.json`, JSON.stringify(["a"]));
        const { defineRootDoc, asStringSetValue } = await import(
            "../src/persistence/store"
        );
        const value = defineRootDoc<Set<string>>({
            file: "r.json",
            ttlMs: 1,
            fallback: new Set<string>(),
            parse: asStringSetValue,
        });

        expect(Array.from(value.get())).toEqual(["a"]);
        expect(value.revision()).toBe(0);

        const now = Date.now();
        const dateNow = vi.spyOn(Date, "now");
        files.set(`${SETTINGS_DIR}/r.json`, JSON.stringify(["a", "b"]));
        dateNow.mockReturnValue(now + 1000);

        expect(Array.from(value.get()).sort()).toEqual(["a", "b"]);
        expect(value.revision()).toBe(1);

        dateNow.mockReturnValue(now + 2000);
        expect(Array.from(value.get()).sort()).toEqual(["a", "b"]);
        expect(value.revision()).toBe(1);
        vi.restoreAllMocks();
    });
});
