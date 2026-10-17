import { helpers, type Diagnostic } from "htsw";
import { getMinecraft } from "./java";

export function removedFormatting(str: string): string {
    return helpers.stripFormatting(str);
}

export function normalizeFormattingCodes(str: string): string {
    return helpers.sectionToAmp(str);
}

// Advanced tooltips (F3+H) append the item id to names, e.g. "Stone (#0001)"
// or "Wool (#0035/14)", sometimes after a color code.
export function stripTooltipDebugSuffix(name: string): string {
    return name
        .replace(/\s*(?:&[0-9a-fklmnor])*\(#[0-9a-fA-F]+(?:\/[0-9]+)?\)\s*$/i, "")
        .trim();
}

/** Item name with formatting codes and the F3+H id suffix removed. */
export function plainItemName(name: string): string {
    return stripTooltipDebugSuffix(removedFormatting(name));
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (
        error !== null &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error.message;
    }
    return String(error);
}

/** Errors and bugs: the diagnostics that stop an import. */
export function blockingDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
    return diagnostics.filter((it) => it.level === "error" || it.level === "bug");
}

/**
 * Rendered width of `string` in the Minecraft font.
 *
 * With `hasFormatCodes`, `&x` codes go through `ChatLib.addColor` (`&` to `§`), so
 * the font renderer skips them and charges the extra pixel per character that
 * `&l` bold costs. `removeFormatting` would measure bold too narrow, and
 * `replaceFormatting` (`§` to `&`) would measure the codes as glyphs, far too wide.
 *
 * Pass `false` for literal text, where `&` is just an ampersand.
 */
export function chatWidth(string: string, hasFormatCodes: boolean = true): number {
    const raw = hasFormatCodes ? ChatLib.addColor(string) : string;
    return getMinecraft().field_71466_p.func_78256_a(raw);
}

export function spaceWidth() {
    return chatWidth(" ");
}

export function chatSeparator(): string {
    const totalWidth = ChatLib.getChatWidth();
    const sepWidth = chatWidth("-");

    return "-".repeat(totalWidth / sepWidth);
}

export function cyrb53(str: string, seed: number = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    // Deliberately NOT standard cyrb53: the low word is added as a SIGNED
    // int32, not `h1 >>> 0`. ChatTriggers' Rhino compiles `x >>> 0` to a
    // no-op that keeps the sign (verified against ctjs 2.2.1 at optimization
    // level 9; interpreted Rhino and Node both return unsigned), so the
    // standard form gives in-game values exactly 2^32 below Node's whenever
    // h1 is negative. Every hash persisted by released builds (knowledge
    // caches, house.lock.json) carries the in-game signed form, so that form
    // is canonical; the signed encoding maps (h1, h2) pairs one-to-one just
    // like the unsigned one, so collision behavior is unchanged.
    return 4294967296 * (2097151 & h2) + h1;
}

export function unique(values: readonly string[]): string[] {
    const seen = Object.create(null) as unknown as Record<string, boolean>;
    const result: string[] = [];
    for (const value of values) {
        if (seen[value]) continue;
        seen[value] = true;
        result.push(value);
    }
    return result;
}

/**
 * Deterministic JSON stringify: sorts object keys and drops `undefined` fields.
 * Domain-specific comparison code decides whether values such as empty arrays
 * are meaningful before calling this serializer.
 */
export function stableStringify(value: unknown): string {
    if (value === null) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
        return "[" + value.map(stableStringify).join(",") + "]";
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts: string[] = [];
    for (const key of keys) {
        const v = record[key];
        if (v === undefined) continue;
        parts.push(JSON.stringify(key) + ":" + stableStringify(v));
    }
    return "{" + parts.join(",") + "}";
}

export function stripSurroundingQuotes(value: string): string {
    if (
        value.length >= 2 &&
        value.charAt(0) === '"' &&
        value.charAt(value.length - 1) === '"'
    ) {
        return value.slice(1, value.length - 1);
    }
    return value;
}
