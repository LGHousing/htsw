const COLOR_CODES = new Set("0123456789abcdef".split(""));
const ADDITIVE_CODES = new Set("klmno".split(""));
const RESET_CODES = new Set("r".split(""));
const ALL_CODES = new Set<string>([...COLOR_CODES, ...ADDITIVE_CODES, ...RESET_CODES]);

const PLACEHOLDER_REGEX = /%([^%]+?)%/g;

export interface LayoutOptions {
    maxLength?: number;
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

    if (layoutRaw.length !== codes.length) return text;

    return addFormattingCodes(layoutRaw, codes);
}

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

function getPlaceholderParts(text: string): string[] {
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
            if (part === "") continue;
            const split = part.split(" ");

            const first = split.shift() as string;
            if (first !== "" && i > 0 && words.length > 0) {
                words[words.length - 1] += first;
                lengths[lengths.length - 1] += first.length;
                if (split.length === 0 && i < parts.length - 1) {
                    words[words.length - 1] += parts[i + 1];
                    lengths[lengths.length - 1] += placeholderLength;
                    parts[i + 1] = "";
                    continue;
                }
            } else if (first !== "") {
                split.unshift(first);
            }

            if (split.length === 0) continue;

            const last = split.pop() as string;
            if (last !== "" && i < parts.length - 1) {
                parts[i + 1] = last + parts[i + 1];
                lengthsIncrements[i + 1] = last.length;
            } else if (last !== "") {
                split.push(last);
            }

            for (const word of split) {
                if (word === "") continue;
                words.push(word);
                lengths.push(word.length);
            }
        } else {
            if (part === "") continue;
            words.push(part);
            lengths.push(placeholderLength + (lengthsIncrements[i] ?? 0));
        }
    }

    return { words, lengths };
}

function getWidth(i: number, j: number, lengths: number[]): number {
    let sum = j - i;
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

function getFormattingCodes(text: string): string[][] {
    const result: string[][] = [];
    let active: string[] = [];
    let i = 0;

    while (i < text.length) {
        const c = text[i];
        if ((c === "&" || c === "§") && i + 1 < text.length) {
            const next = text[i + 1].toLowerCase();

            if (COLOR_CODES.has(next)) {
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
