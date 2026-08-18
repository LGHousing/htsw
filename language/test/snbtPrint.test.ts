import { describe, expect, it } from "vitest";
import * as htsw from "../src";
import type { Tag } from "../src/nbt";

class StringFileLoader implements htsw.FileLoader {
    private readonly files = new Map<string, string>();
    constructor(files: Record<string, string>) {
        for (const [path, src] of Object.entries(files)) {
            this.files.set(path, src);
        }
    }
    fileExists(path: string): boolean { return this.files.has(path); }
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

function parse(src: string): Tag {
    const path = "/test.snbt";
    const sm = new htsw.SourceMap(new StringFileLoader({ [path]: src }));
    const gcx = new htsw.GlobalCtxt(sm, path);
    const value = htsw.nbt.parseSnbt(gcx, path);
    if (value === undefined) {
        throw new Error("Parse failed: " + JSON.stringify(gcx.diagnostics.map(d => d.message)));
    }
    return value;
}

function tagsEqual(a: Tag, b: Tag): boolean {
    if (a.type !== b.type) return false;
    if (a.type === "compound" && b.type === "compound") {
        const aKeys = Object.keys(a.value).filter(k => a.value[k] !== undefined).sort();
        const bKeys = Object.keys(b.value).filter(k => b.value[k] !== undefined).sort();
        if (aKeys.length !== bKeys.length) return false;
        for (let i = 0; i < aKeys.length; i++) {
            if (aKeys[i] !== bKeys[i]) return false;
            if (!tagsEqual(a.value[aKeys[i]] as Tag, b.value[bKeys[i]] as Tag)) return false;
        }
        return true;
    }
    if (a.type === "list" && b.type === "list") {
        if (a.value.type !== b.value.type) return false;
        if (a.value.value.length !== b.value.value.length) return false;
        for (let i = 0; i < a.value.value.length; i++) {
            const av = { type: a.value.type, value: a.value.value[i] } as Tag;
            const bv = { type: b.value.type, value: b.value.value[i] } as Tag;
            if (!tagsEqual(av, bv)) return false;
        }
        return true;
    }
    if (a.type === "byte_array" || a.type === "short_array" || a.type === "int_array") {
        if (b.type !== a.type) return false;
        const av = a.value;
        const bv = b.value;
        if (av.length !== bv.length) return false;
        for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return false;
        return true;
    }
    if (a.type === "long_array" && b.type === "long_array") {
        if (a.value.length !== b.value.length) return false;
        for (let i = 0; i < a.value.length; i++) {
            if (a.value[i].toString() !== b.value[i].toString()) return false;
        }
        return true;
    }
    if (a.type === "long" && b.type === "long") {
        return a.value.toString() === b.value.toString();
    }
    return (a as any).value === (b as any).value;
}

function roundTrip(src: string, options?: { pretty?: boolean }): string {
    const tag = parse(src);
    const printed = htsw.nbt.printSnbt(tag, options);
    const reparsed = parse(printed);
    if (!tagsEqual(tag, reparsed)) {
        throw new Error(`Round-trip mismatch.\nOriginal: ${src}\nPrinted: ${printed}`);
    }
    return printed;
}

function printString(value: string): string {
    return htsw.nbt.printSnbt({ type: "string", value });
}

describe("SNBT printer", () => {
    it("prints empty compound", () => {
        expect(htsw.nbt.printSnbt({ type: "compound", value: {} })).toBe("{}");
    });

    it("round-trips scalars compact", () => {
        roundTrip('{a:1b,b:2s,c:3,d:4L,e:1.5f,f:2.5d,g:"hi"}');
    });

    it("pretty mode adds indentation", () => {
        const out = roundTrip(
            '{tag:{display:{Name:"Foo"},Count:1b}}',
            { pretty: true }
        );
        expect(out).toContain("\n");
        expect(out).toContain("    ");
    });

    it("round-trips typed arrays", () => {
        roundTrip("{bytes:[B;1b,2b,3b],ints:[I;1,2,3],longs:[L;1L,2L,3L]}");
    });

    it("round-trips list of compounds pretty", () => {
        roundTrip('{lore:[{text:"a"},{text:"b"}]}', { pretty: true });
    });

    it("escapes strings safely", () => {
        const tag: Tag = { type: "string", value: 'a"b\\c\nd' };
        const printed = htsw.nbt.printSnbt(tag);
        const reparsed = parse(printed);
        expect(reparsed).toEqual(tag);
    });

    it("uses the short escape forms", () => {
        expect(printString("a\bb")).toBe('"a\\bb"');
        expect(printString("a\fb")).toBe('"a\\fb"');
        expect(printString("a\nb")).toBe('"a\\nb"');
        expect(printString("a\rb")).toBe('"a\\rb"');
        expect(printString("a\tb")).toBe('"a\\tb"');
    });

    it("uses \\xHH for the remaining control characters", () => {
        expect(printString(`a${String.fromCharCode(0x00)}b`)).toBe('"a\\x00b"');
        expect(printString(`a${String.fromCharCode(0x1f)}b`)).toBe('"a\\x1fb"');
        expect(printString(`a${String.fromCharCode(0x7f)}b`)).toBe('"a\\x7fb"');
    });

    it("escapes unpaired surrogates but leaves real text alone", () => {
        expect(printString("a\ud83db")).toBe('"a\\ud83db"');
        expect(printString("a\ude00b")).toBe('"a\\ude00b"');
        expect(printString("hi \u{1f600}")).toBe('"hi \u{1f600}"');
        expect(printString("§4§lADMIN")).toBe('"§4§lADMIN"');
    });

    it("round-trips every control character", () => {
        for (const code of [...Array(0x20).keys(), 0x7f]) {
            const value = `x${String.fromCharCode(code)}y`;
            const tag: Tag = { type: "string", value };
            expect(parse(htsw.nbt.printSnbt(tag))).toEqual(tag);
        }
    });

    it("decodes the escapes the printer never emits", () => {
        expect(parse('"a\\sb"')).toEqual({ type: "string", value: "a b" });
        expect(parse('"\\u0041"')).toEqual({ type: "string", value: "A" });
        expect(parse('"\\U0001F600"')).toEqual({ type: "string", value: "\u{1f600}" });
    });

    it("keeps malformed escapes literal rather than throwing", () => {
        expect(parse('"a\\qb"')).toEqual({ type: "string", value: "aqb" });
        expect(parse('"a\\x0"')).toEqual({ type: "string", value: "ax0" });
        expect(parse('"a\\u12"')).toEqual({ type: "string", value: "au12" });
    });

    it("escapes only the backslash and quote in ordinary text", () => {
        expect(printString("§aLore")).toBe('"§aLore"');
        expect(printString('a\\b "c" d')).toBe('"a\\\\b \\"c\\" d"');
        expect(printString("")).toBe('""');
    });

    it("appends .0 to integer-valued floats and doubles", () => {
        expect(htsw.nbt.printSnbt({ type: "float", value: 1 })).toBe("1.0f");
        expect(htsw.nbt.printSnbt({ type: "double", value: 2 })).toBe("2.0d");
    });

    it("quotes keys containing characters outside the bare set", () => {
        const out = htsw.nbt.printSnbt({
            type: "compound",
            value: { "weird key": { type: "byte", value: 1 } },
        });
        expect(out).toBe('{"weird key":1b}');
        expect(parse(out)).toBeDefined();
    });

    it("round-trips a hypixel-style item with interact_data", () => {
        const src =
            '{id:"minecraft:paper",Count:1b,tag:{display:{Name:"Foo"},' +
            'ExtraAttributes:{interact_data:{left:"abc",right:"def"}}}}';
        const out = roundTrip(src, { pretty: true });
        expect(out).toContain("interact_data");
    });
});
