// Knuth–Plass-style line breaking for Minecraft Lore strings.
//
// Strips Minecraft formatting codes (`&[0-9a-fk-orR]` and `§[...]`) before
// layout, then re-applies them after, so a split lore line keeps its coloring
// and styling on every line. Placeholders (`%foo%`) are treated as fixed-width
// tokens — the laid-out text contains the original `%...%` text, but width
// calculations use a configurable `placeholderLength` (default 4).
//
// Direct port of the Python implementation supplied by the user, with two
// hardening tweaks: (1) defensive bail when the placeholder-attachment logic
// would produce mismatched lengths, (2) a greedy fallback when a single word
// is wider than `maxLength` so the action still produces output instead of
// raising.
//
// This file is consumed only by `editors/code` (Node + Electron / modern V8)
// — the ES5/Rhino constraint from `ct_module/` does NOT apply here.

const COLOR_CODES = new Set("0123456789abcdef".split(""));
const ADDITIVE_CODES = new Set("klmno".split(""));
const RESET_CODES = new Set("r".split(""));
const ALL_CODES = new Set<string>([...COLOR_CODES, ...ADDITIVE_CODES, ...RESET_CODES]);

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;

export interface LayoutOptions {
    /** Max unformatted character width per laid-out line. Default 40. */
    maxLength?: number;
    /** Fixed width assigned to every `%...%` placeholder. Default 4. */
    placeholderLength?: number;
}

/**
 * Lay out `text` into multiple lines (separated by `\n`) so that each line's
 * unformatted width is `<= maxLength`. Returns the original text unchanged if
 * the layout would be a single line, or if the input has whitespace shapes
 * the algorithm doesn't handle (leading/trailing whitespace, double spaces,
 * or embedded newlines).
 */
export function computeBestLayout(text: string, options: LayoutOptions = {}): string {
    const maxLength = options.maxLength ?? 40;
    const placeholderLength = options.placeholderLength ?? 4;

    if (text.includes("\n")) return text;

    const unformatted = removeFormatting(text);
    if (unformatted.length === 0) return text;

    // Algorithm requires no leading/trailing whitespace and no double spaces.
    if (
        unformatted.startsWith(" ") ||
        unformatted.endsWith(" ") ||
        unformatted.includes("  ")
    ) {
        return text;
    }

    const { words, lengths } = wordsAndLengths(unformatted, placeholderLength);
    if (words.length === 0) return text;

    const layoutRaw = computeBestLayoutRaw(words, lengths, maxLength);
    const codes = getFormattingCodes(text);

    // Defensive: if our placeholder-attachment logic produced a layout that
    // doesn't align char-for-char with the format-code stream, bail rather
    // than emit broken output. (Rare adjacent-placeholder edge case.)
    if (layoutRaw.length !== codes.length) return text;

    return addFormattingCodes(layoutRaw, codes);
}

// ---------------------------------------------------------------------------
// Format-code stripping
// ---------------------------------------------------------------------------

function removeFormatting(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if ((c === "&" || c === "§") && i + 1 < text.length) {
            const next = text[i + 1].toLowerCase();
            if (ALL_CODES.has(next)) {
                i += 2;
                continue;
            }
        }
        out += c;
        i++;
    }
    return out;
}

// ---------------------------------------------------------------------------
// Placeholder-aware word splitting
// ---------------------------------------------------------------------------

function getPlaceholderParts(text: string): string[] {
    // Even-indexed parts are literal text, odd-indexed parts are full
    // `%...%` placeholder tokens (delimiters included so total length
    // matches the input).
    const parts: string[] = [];
    let lastEnd = 0;
    PLACEHOLDER_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
        parts.push(text.slice(lastEnd, match.index));
        parts.push(match[0]);
        lastEnd = match.index + match[0].length;
    }
    parts.push(text.slice(lastEnd));
    return parts;
}

function wordsAndLengths(
    unformatted: string,
    placeholderLength: number,
): { words: string[]; lengths: number[] } {
    const parts = getPlaceholderParts(unformatted);
    const words: string[] = [];
    const lengths: number[] = [];
    const lengthsIncrements: Record<number, number> = {};

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i % 2 === 0) {
            // Literal text segment
            if (part === "") continue;
            const split = part.split(" ");

            // Attach the leading word fragment to whatever's already in `words`
            // (a placeholder from the previous odd-index part) so we don't get
            // a phantom space between e.g. `%a%hello` → ["%a%", "hello"].
            let first = split.shift() as string;
            if (first !== "" && i > 0 && words.length > 0) {
                words[words.length - 1] += first;
                lengths[lengths.length - 1] += first.length;
                if (split.length === 0 && i < parts.length - 1) {
                    // No more words in this part — also absorb the next
                    // placeholder so it sticks to the same word.
                    words[words.length - 1] += parts[i + 1];
                    lengths[lengths.length - 1] += placeholderLength;
                    parts[i + 1] = "";
                    continue;
                }
            } else if (first !== "") {
                split.unshift(first);
            }

            if (split.length === 0) continue;

            // Attach the trailing word fragment to the next placeholder.
            const last = split.pop() as string;
            if (last !== "" && i < parts.length - 1) {
                parts[i + 1] = last + parts[i + 1];
                lengthsIncrements[i + 1] = last.length;
            } else if (last !== "") {
                split.push(last);
            }

            for (const word of split) {
                if (word === "") continue; // defensive — caller guards against double spaces
                words.push(word);
                lengths.push(word.length);
            }
        } else {
            // Placeholder
            if (part === "") continue;
            words.push(part);
            lengths.push(placeholderLength + (lengthsIncrements[i] ?? 0));
        }
    }

    return { words, lengths };
}

// ---------------------------------------------------------------------------
// DP line-breaker
// ---------------------------------------------------------------------------

function getWidth(i: number, j: number, lengths: number[]): number {
    let sum = j - i; // one space per gap
    for (let k = i; k <= j; k++) sum += lengths[k];
    return sum;
}

function computeLineStartIndexes(lengths: number[], maxLength: number): number[] {
    const n = lengths.length;
    const minCostUpTo = new Array<number>(n + 1).fill(Infinity);
    const lineStartIndexes = new Array<number>(n + 1).fill(0);
    minCostUpTo[0] = 0;

    for (let j = 1; j <= n; j++) {
        for (let i = 1; i <= j; i++) {
            const width = getWidth(i - 1, j - 1, lengths);
            if (width > maxLength) continue;

            const slack = maxLength - width;
            const cost = slack * slack * slack;
            const candidate = minCostUpTo[i - 1] + cost;
            if (candidate >= minCostUpTo[j]) continue;

            minCostUpTo[j] = candidate;
            lineStartIndexes[j] = i - 1;
        }
    }

    return lineStartIndexes;
}

function computeBestLayoutRaw(
    words: string[],
    lengths: number[],
    maxLength: number,
): string {
    const n = lengths.length;
    if (n === 0) return "";

    const lineStartIndexes = computeLineStartIndexes(lengths, maxLength);

    // If even a single word at the end overflows, the DP can't produce a
    // valid layout — fall back to greedy hard-split so we still return
    // something sensible.
    const overflow = lengths.some((l) => l > maxLength);
    if (overflow) return greedyHardSplit(words, lengths, maxLength);

    const lines: string[][] = [];
    let j = n;
    while (j > 0) {
        const i = lineStartIndexes[j];
        lines.unshift(words.slice(i, j));
        j = i;
    }
    return lines.map((line) => line.join(" ")).join("\n");
}

function greedyHardSplit(
    words: string[],
    lengths: number[],
    maxLength: number,
): string {
    const lines: string[][] = [[]];
    let curWidth = 0;
    for (let i = 0; i < words.length; i++) {
        const wlen = lengths[i];
        const sep = lines[lines.length - 1].length === 0 ? 0 : 1;
        const projected = curWidth + sep + wlen;
        if (lines[lines.length - 1].length === 0 || projected <= maxLength) {
            lines[lines.length - 1].push(words[i]);
            curWidth = projected;
        } else {
            lines.push([words[i]]);
            curWidth = wlen;
        }
    }
    return lines.map((line) => line.join(" ")).join("\n");
}

// ---------------------------------------------------------------------------
// Format-code reapplication
// ---------------------------------------------------------------------------

function getFormattingCodes(text: string): string[][] {
    const result: string[][] = [];
    let active: string[] = [];
    let i = 0;

    while (i < text.length) {
        const c = text[i];
        if ((c === "&" || c === "§") && i + 1 < text.length) {
            const next = text[i + 1].toLowerCase();

            if (COLOR_CODES.has(next)) {
                // Reset, then reapply this color (even if it's the same as
                // before). Encoded by repeating the code N+1 times so a
                // repeated color still produces a "change" in the active
                // list and triggers a re-emission downstream.
                let count = 0;
                for (const code of active) if (code === next) count++;
                active = new Array<string>(count + 1).fill(next);
                i += 2;
                continue;
            }
            if (ADDITIVE_CODES.has(next)) {
                active = [...active, next];
                i += 2;
                continue;
            }
            if (RESET_CODES.has(next)) {
                active = [];
                i += 2;
                continue;
            }
        }

        if (c === "\n") active = [];

        result.push(active.slice());
        i++;
    }

    return result;
}

function addFormattingCodes(unformattedText: string, formatting: string[][]): string {
    const out: string[] = [];
    let prev: string[] = [];

    const len = Math.min(unformattedText.length, formatting.length);
    for (let k = 0; k < len; k++) {
        const ch = unformattedText[k];
        const codes = formatting[k];

        if (ch === "\n") {
            out.push(ch);
            prev = [];
            continue;
        }

        if (!arraysEqual(codes, prev)) {
            if (codes.length === 0) {
                out.push("&r");
            } else {
                // Emit only the prefix that's different from `prev`. The
                // count-based encoding in getFormattingCodes guarantees that
                // every color/style transition shows up here.
                for (let i = 0; i < codes.length; i++) {
                    if (i < prev.length && codes[i] === prev[i]) continue;
                    out.push("&" + codes[i]);
                }
            }
        }

        out.push(ch);
        prev = codes;
    }

    return out.join("");
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
