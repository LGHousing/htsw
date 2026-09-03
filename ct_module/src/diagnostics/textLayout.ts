import { chatWidth, spaceWidth } from "../utils/helpers";

export type LineSegment = { x: number; text: string };

export type FormattedTextBlock = {
    lines: string[];
    segments: LineSegment[][];
    width: number;
    height: number;
};

export interface TextLayoutElement {
    getWidth(): number;
    getHeight(): number;
    render(): string[];
    renderSegments(): LineSegment[][];
}

export function renderTextBlock(element: TextLayoutElement): FormattedTextBlock {
    const lines = element.render();
    return {
        lines,
        segments: element.renderSegments(),
        width: element.getWidth(),
        height: lines.length,
    };
}

function clipTextToWidth(text: string, maxWidth: number): string {
    let out = "";
    let width = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text.charAt(i);
        if (ch === "&" && i + 1 < text.length) {
            out += ch + text.charAt(i + 1);
            i++;
            continue;
        }
        const chWidth = chatWidth(ch);
        if (width + chWidth > maxWidth) break;
        out += ch;
        width += chWidth;
    }
    return out;
}

// The subset of `&x` codes the Minecraft font actually consumes. Anything
// else (`&&`, `&z`) is literal text that chatWidth() charges for, so the
// wrapper must charge for it too or its lines come out wider than the budget.
const FORMAT_CODES = "0123456789abcdefklmnor";

function isFormatCode(text: string, index: number): boolean {
    if (text.charAt(index) !== "&" || index + 1 >= text.length) return false;
    return FORMAT_CODES.indexOf(text.charAt(index + 1).toLowerCase()) >= 0;
}

// A color code clears any style codes before it, exactly as the vanilla font
// renderer treats it, so a wrapped line reopens only what is still in effect.
type FormatState = { color: string; styles: string[] };

const NO_FORMAT: FormatState = { color: "", styles: [] };

function applyFormatCode(state: FormatState, code: string): FormatState {
    const c = code.charAt(1).toLowerCase();
    if (c === "r") return NO_FORMAT;
    if ("0123456789abcdef".indexOf(c) >= 0) return { color: "&" + c, styles: [] };
    if (state.styles.indexOf("&" + c) >= 0) return state;
    return { color: state.color, styles: state.styles.concat("&" + c) };
}

function formatPrefix(state: FormatState): string {
    return state.color + state.styles.join("");
}

/**
 * Greedy word wrap that keeps `&x` codes intact and reopens the active ones
 * at the start of every continuation line. Breaks at the last space that fits;
 * falls back to a mid-token break so an unbroken run (a long identifier, a
 * path) still wraps rather than overflowing.
 */
function wrapFormatted(text: string, firstWidth: number, restWidth: number): string[] {
    const out: string[] = [];
    let limit = Math.max(1, firstWidth);
    let state = NO_FORMAT;
    let prefix = "";
    let body = "";
    // chatWidth(prefix + body): the width of the line as it stands.
    let width = 0;
    // Last space in `body`, and the formatting in effect just after it.
    let breakIndex = -1;
    let breakState = NO_FORMAT;

    for (let i = 0; i < text.length; i++) {
        if (isFormatCode(text, i)) {
            const code = text.substring(i, i + 2);
            state = applyFormatCode(state, code);
            body += code;
            i++;
            continue;
        }
        const ch = text.charAt(i);
        // Measure whole candidate lines, never single characters. Summing
        // per-character widths does not reproduce chatWidth() of the finished
        // line — format codes and bold only mean anything in context — and a
        // wrap measured differently from the container that holds it either
        // overflows or, as here, breaks far short of the space available.
        // Measuring the same way the caller sizes the box makes the two agree
        // by construction.
        let next = chatWidth(prefix + body + ch);
        // Loops rather than branches: a break at a space leaves the rest of an
        // over-long token behind, which then has to break again against the
        // narrower continuation budget. `width > 0` keeps at least one visible
        // character per line, so a tight budget still makes progress.
        while (next > limit && width > 0) {
            let atSpace = breakIndex >= 0;
            if (atSpace) {
                // How wide is the word we are in the middle of, in full? Format
                // codes never contain a space, so the next space ends it.
                const nextSpace = text.indexOf(" ", i);
                const word =
                    body.substring(breakIndex + 1)
                    + (nextSpace < 0 ? text.substring(i) : text.substring(i, nextSpace));
                // A word too wide for a line of its own gets split no matter
                // where we break. Breaking at the space would leave the rest of
                // this line empty and split the word on the next one anyway, so
                // split it here and use the space up.
                if (chatWidth(formatPrefix(breakState) + word) > Math.max(1, restWidth)) {
                    atSpace = false;
                }
            }
            if (atSpace) {
                out.push(prefix + body.substring(0, breakIndex));
                prefix = formatPrefix(breakState);
                body = body.substring(breakIndex + 1);
            } else {
                out.push(prefix + body);
                prefix = formatPrefix(state);
                body = "";
            }
            breakIndex = -1;
            limit = Math.max(1, restWidth);
            width = chatWidth(prefix + body);
            next = chatWidth(prefix + body + ch);
        }
        if (ch === " ") {
            breakIndex = body.length;
            breakState = state;
        }
        body += ch;
        width = next;
    }
    out.push(prefix + body);
    return out;
}

/**
 * Formatted text broken across as many lines as it takes to fit `maxWidth`.
 * Continuation lines sit at `hangingIndent` so a wrapped diagnostic message
 * still reads as one paragraph hanging off its `error: ` prefix instead of
 * looking like a second diagnostic.
 */
export class TextLayoutWrap implements TextLayoutElement {
    private readonly wrapped: string[];
    private readonly indent: number;

    constructor(text: string, maxWidth: number, hangingIndent: number = 0) {
        const limit = Math.max(1, maxWidth);
        // An indent wider than the budget would leave no room for text.
        this.indent = Math.max(0, Math.min(hangingIndent, limit - 1));
        this.wrapped = wrapFormatted(text, limit, limit - this.indent);
    }

    getWidth(): number {
        let width = 0;
        for (let i = 0; i < this.wrapped.length; i++) {
            width = Math.max(width, (i === 0 ? 0 : this.indent) + chatWidth(this.wrapped[i]));
        }
        return width;
    }

    getHeight(): number {
        return this.wrapped.length;
    }

    render(): string[] {
        if (this.indent === 0) return this.wrapped.slice();
        // Chat has no x-positioning, so the indent has to be spelled in spaces.
        let pad = "";
        const count = Math.round(this.indent / spaceWidth());
        for (let i = 0; i < count; i++) pad += " ";
        const out: string[] = [];
        for (let i = 0; i < this.wrapped.length; i++) {
            out.push(i === 0 ? this.wrapped[i] : pad + this.wrapped[i]);
        }
        return out;
    }

    renderSegments(): LineSegment[][] {
        const out: LineSegment[][] = [];
        for (let i = 0; i < this.wrapped.length; i++) {
            out.push([{ x: i === 0 ? 0 : this.indent, text: this.wrapped[i] }]);
        }
        return out;
    }
}

export class TextLayoutText implements TextLayoutElement {
    text: string;

    constructor(text: string) {
        this.text = text;
    }

    getWidth(): number {
        return chatWidth(this.text);
    }

    getHeight(): number {
        return 1;
    }

    render(): string[] {
        return [this.text];
    }

    renderSegments(): LineSegment[][] {
        return [[{ x: 0, text: this.text }]];
    }
}

export class TextLayoutVStack implements TextLayoutElement {
    elements: TextLayoutElement[] = [];

    add(element: TextLayoutElement): void {
        this.elements.push(element);
    }

    getWidth(): number {
        let width = 0;
        for (let i = 0; i < this.elements.length; i++) {
            width = Math.max(width, this.elements[i].getWidth());
        }
        return width;
    }

    getHeight(): number {
        let height = 0;
        for (let i = 0; i < this.elements.length; i++) {
            height += this.elements[i].getHeight();
        }
        return height;
    }

    render(): string[] {
        const out: string[] = [];
        for (let i = 0; i < this.elements.length; i++) {
            const lines = this.elements[i].render();
            for (let j = 0; j < lines.length; j++) out.push(lines[j]);
        }
        return out;
    }

    renderSegments(): LineSegment[][] {
        const out: LineSegment[][] = [];
        for (let i = 0; i < this.elements.length; i++) {
            const lines = this.elements[i].renderSegments();
            for (let j = 0; j < lines.length; j++) out.push(lines[j]);
        }
        return out;
    }
}

export class TextLayoutCanvas implements TextLayoutElement {
    elements: { x: number; y: number; element: TextLayoutElement }[] = [];

    addElement(x: number, y: number, element: TextLayoutElement): void {
        this.elements.push({ x, y, element });
    }

    getWidth(): number {
        let width = 0;
        for (let i = 0; i < this.elements.length; i++) {
            const entry = this.elements[i];
            width = Math.max(width, entry.x + entry.element.getWidth());
        }
        return width;
    }

    getHeight(): number {
        let height = 0;
        for (let i = 0; i < this.elements.length; i++) {
            const entry = this.elements[i];
            height = Math.max(height, entry.y + entry.element.getHeight());
        }
        return height;
    }

    private tokenizeFormatting(text: string): { token: string; width: number }[] {
        const tokens: { token: string; width: number }[] = [];
        let i = 0;
        while (i < text.length) {
            if (text.charAt(i) === "&" && i + 1 < text.length) {
                tokens.push({ token: text.substring(i, i + 2), width: 0 });
                i += 2;
            } else {
                const start = i;
                while (i < text.length && text.charAt(i) !== "&") i++;
                const token = text.substring(start, i);
                tokens.push({ token, width: chatWidth(token) });
            }
        }
        return tokens;
    }

    render(): string[] {
        const lineMap: Array<
            { x: number; text: string; order: number }[] | undefined
        > = [];
        for (let order = 0; order < this.elements.length; order++) {
            const entry = this.elements[order];
            const rendered = entry.element.render();
            for (let i = 0; i < rendered.length; i++) {
                const y = entry.y + i;
                const line = lineMap[y];
                const fragment = { x: entry.x, text: rendered[i], order };
                if (line === undefined) lineMap[y] = [fragment];
                else line.push(fragment);
            }
        }

        const result: string[] = [];
        const maxY = Math.max(0, this.getHeight() - 1);
        for (let y = 0; y <= maxY; y++) {
            const spans = lineMap[y] ?? [];
            spans.sort((a, b) => a.order - b.order);
            const fragments: { start: number; end: number; text: string; width: number }[] = [];
            for (let i = 0; i < spans.length; i++) {
                let pos = spans[i].x;
                const tokens = this.tokenizeFormatting(spans[i].text);
                for (let j = 0; j < tokens.length; j++) {
                    const token = tokens[j];
                    const start = pos;
                    const end = start + token.width;
                    for (let k = fragments.length - 1; k >= 0; k--) {
                        const existing = fragments[k];
                        if (
                            existing.width > 0
                            && !(existing.end <= start || existing.start >= end)
                        ) {
                            fragments.splice(k, 1);
                        }
                    }
                    fragments.push({ start, end, text: token.token, width: token.width });
                    pos = end;
                }
            }
            fragments.sort((a, b) => a.start - b.start || (a.width === 0 ? -1 : 0));
            let line = "";
            let cursor = 0;
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                let gapWidth = 0;
                while (gapWidth < fragment.start - cursor) {
                    line += "&0.";
                    gapWidth += chatWidth(".");
                }
                line += fragment.text;
                cursor = Math.max(cursor, fragment.end);
            }
            result.push(line);
        }
        return result;
    }

    renderSegments(): LineSegment[][] {
        const lineMap: Array<LineSegment[] | undefined> = [];
        for (let k = 0; k < this.elements.length; k++) {
            const entry = this.elements[k];
            const childLines = entry.element.renderSegments();
            for (let i = 0; i < childLines.length; i++) {
                const y = entry.y + i;
                const line = lineMap[y] ?? [];
                lineMap[y] = line;
                const childSegs = childLines[i];
                for (let s = 0; s < childSegs.length; s++) {
                    line.push({ x: entry.x + childSegs[s].x, text: childSegs[s].text });
                }
            }
        }
        const maxY = Math.max(0, this.getHeight() - 1);
        const out: LineSegment[][] = [];
        for (let y = 0; y <= maxY; y++) out.push(lineMap[y] ?? []);
        return out;
    }
}

export class TextLayoutHLine extends TextLayoutText {
    constructor(width: number, char: string = "-", color?: string) {
        let line = "";
        const count = Math.max(1, Math.round(width / chatWidth(char)));
        for (let i = 0; i < count; i++) line += char;
        super((color ?? "") + line);
    }
}

export class TextLayoutVLine extends TextLayoutVStack {
    constructor(height: number, char: string = "|") {
        super();
        for (let i = 0; i < height; i++) this.add(new TextLayoutText(char));
    }
}

export class TextLayoutTruncate implements TextLayoutElement {
    inner: TextLayoutElement;
    maxWidth: number;

    constructor(inner: TextLayoutElement, maxWidth: number) {
        this.inner = inner;
        this.maxWidth = maxWidth;
    }

    getWidth(): number {
        return Math.min(this.inner.getWidth(), this.maxWidth);
    }

    getHeight(): number {
        return this.inner.getHeight();
    }

    render(): string[] {
        const lines = this.inner.render();
        const ellipsis = "...";
        const ellipsisWidth = chatWidth(ellipsis);
        return lines.map((line) => {
            if (chatWidth(line) <= this.maxWidth) return line;
            let truncated = "";
            let width = 0;
            for (let i = 0; i < line.length; i++) {
                const ch = line.charAt(i);
                // A "&x" format code is zero-width and must never be split;
                // copy it whole without charging it against the width budget,
                // matching how chatWidth() measures the line above.
                if (ch === "&" && i + 1 < line.length) {
                    truncated += ch + line.charAt(i + 1);
                    i++;
                    continue;
                }
                const chWidth = chatWidth(ch);
                if (width + chWidth + ellipsisWidth > this.maxWidth) break;
                truncated += ch;
                width += chWidth;
            }
            return truncated + ellipsis;
        });
    }

    renderSegments(): LineSegment[][] {
        const ellipsis = "...";
        const ellipsisWidth = chatWidth(ellipsis);
        return this.inner.renderSegments().map((segs) => {
            let extent = 0;
            for (let i = 0; i < segs.length; i++) {
                extent = Math.max(extent, segs[i].x + chatWidth(segs[i].text));
            }
            if (extent <= this.maxWidth) return segs;
            const budget = this.maxWidth - ellipsisWidth;
            const out: LineSegment[] = [];
            let ellipsisX = 0;
            for (let i = 0; i < segs.length; i++) {
                const seg = segs[i];
                if (seg.x >= budget) continue;
                const end = seg.x + chatWidth(seg.text);
                if (end <= budget) {
                    out.push(seg);
                    ellipsisX = Math.max(ellipsisX, end);
                    continue;
                }
                const clipped = clipTextToWidth(seg.text, budget - seg.x);
                out.push({ x: seg.x, text: clipped });
                ellipsisX = Math.max(ellipsisX, seg.x + chatWidth(clipped));
            }
            out.push({ x: ellipsisX, text: ellipsis });
            return out;
        });
    }
}
