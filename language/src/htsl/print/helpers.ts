/**
 * Helpers for emitting HTSL strings, names, notes, and per-line indentation.
 *
 * The bare-name regex mirrors the lexer's ident continuation rule
 * (see `htsl/parse/lexer.ts`): an ident starts with `[a-zA-Z_]` and continues
 * with `[a-zA-Z_/0-9.\-]`, which lets us emit names like `trig/angle` or
 * `MyFunc.v2` unquoted.
 */

const PLACEHOLDER_RE = /^%[^%]+%$/;
const BARE_NAME_RE = /^[a-zA-Z_][a-zA-Z_/0-9.\-]*$/;

export function isPlaceholderOnly(s: string): boolean {
    return PLACEHOLDER_RE.test(s);
}

export function isBareNameSafe(s: string): boolean {
    if (s.length === 0) return false;
    return BARE_NAME_RE.test(s);
}

export function quoteString(s: string): string {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Emits a name as an unquoted ident if safe, otherwise as a quoted string.
 * Used for fields whose parser is `parseName`, which accepts both `ident`
 * and `str` tokens.
 */
export function quoteName(s: string): string {
    if (isBareNameSafe(s)) return s;
    return quoteString(s);
}

/**
 * Emits a string-typed field: bare placeholder if the value is exactly one
 * placeholder, otherwise a quoted string. Used for fields whose parser is
 * `parseString` (e.g. MESSAGE.message, TITLE.title) since those accept either
 * a `str` or `placeholder` token.
 */
export function quoteStringOrPlaceholder(s: string): string {
    if (isPlaceholderOnly(s)) return s;
    return quoteString(s);
}

/**
 * Normalize a note for emission. The HTSL parser captures one-line `///`
 * doc comments only, so multi-line notes are joined with a single space to
 * preserve round-trip equivalence.
 */
export function normalizeNoteForEmit(note: string): string {
    return note.replace(/\s*\r?\n\s*/g, " ").trim();
}

export function indent(level: number, style: { indent: string }): string {
    return style.indent.repeat(level);
}
