import { describe, expect, it } from "vitest";
import * as htsw from "../src";
import Long from "long";

class StringFileLoader implements htsw.FileLoader {
    private readonly files = new Map<string, string>();

    constructor(files: Record<string, string>) {
        for (const [path, src] of Object.entries(files)) {
            this.files.set(path, src);
        }
    }

    fileExists(path: string): boolean {
        return this.files.has(path);
    }

    readFile(path: string): string {
        const src = this.files.get(path);
        if (src === undefined) throw new Error(`File not found: ${path}`);
        return src;
    }

    getParentPath(base: string): string {
        const idx = base.lastIndexOf("/");
        return idx === -1 ? "" : base.slice(0, idx);
    }

    resolvePath(base: string, other: string): string {
        if (other.startsWith("/")) return other;
        if (!base) return other;
        return `${base}/${other}`;
    }
}

function parseSnbt(src: string) {
    const path = "/test.snbt";
    const sm = new htsw.SourceMap(new StringFileLoader({ [path]: src }));
    const gcx = new htsw.GlobalCtxt(sm, path);
    const value = htsw.nbt.parseSnbt(gcx, path);
    return { value, diagnostics: gcx.diagnostics };
}

describe("SNBT parser tags", () => {
    it("parses scalar tag kinds", () => {
        expect(parseSnbt("1b").value).toEqual({ type: "byte", value: 1 });
        expect(parseSnbt("2s").value).toEqual({ type: "short", value: 2 });
        expect(parseSnbt("3").value).toEqual({ type: "int", value: 3 });
        expect(parseSnbt("4l").value).toEqual({ type: "long", value: Long.fromInt(4) });
        expect(parseSnbt("1.5f").value).toEqual({ type: "float", value: 1.5 });
        expect(parseSnbt("2.5").value).toEqual({ type: "double", value: 2.5 });
        expect(parseSnbt('"x"').value).toEqual({ type: "string", value: "x" });
    });

    it("parses compounds and typed lists", () => {
        const parsed = parseSnbt('{foo: 1b, bar: "hello", list: [1, 2, 3]}').value;
        expect(parsed).toEqual({
            type: "compound",
            value: {
                foo: { type: "byte", value: 1 },
                bar: { type: "string", value: "hello" },
                list: {
                    type: "list",
                    value: {
                        type: "int",
                        value: [1, 2, 3],
                    },
                },
            },
        });
    });

    it("parses typed arrays", () => {
        expect(parseSnbt("[B;1b,-2b]").value).toEqual({
            type: "byte_array",
            value: [1, -2],
        });
        expect(parseSnbt("[S;1s,2s]").value).toEqual({
            type: "short_array",
            value: [1, 2],
        });
        expect(parseSnbt("[I;1,2i]").value).toEqual({
            type: "int_array",
            value: [1, 2],
        });
        expect(parseSnbt("[L;1l,2l]").value).toEqual({
            type: "long_array",
            value: [
                Long.fromInt(1),
                Long.fromInt(2),
            ],
        });
    });

    it("reports diagnostics for invalid syntax", () => {
        const result = parseSnbt("{foo: [1, 2}");
        expect(result.value).toBeUndefined();
        expect(result.diagnostics.length).toBe(1);
        expect(result.diagnostics[0].level).toBe("error");
    });
});
