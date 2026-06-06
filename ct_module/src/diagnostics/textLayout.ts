import { chatWidth } from "../utils/helpers";

export type FormattedTextBlock = {
    lines: string[];
    width: number;
    height: number;
};

export interface TextLayoutElement {
    getWidth(): number;
    getHeight(): number;
    render(): string[];
}

export function renderTextBlock(element: TextLayoutElement): FormattedTextBlock {
    const lines = element.render();
    return {
        lines,
        width: element.getWidth(),
        height: lines.length,
    };
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
        const lineMap = new Map<number, { x: number; text: string; order: number }[]>();
        for (let order = 0; order < this.elements.length; order++) {
            const entry = this.elements[order];
            const rendered = entry.element.render();
            for (let i = 0; i < rendered.length; i++) {
                const y = entry.y + i;
                const line = lineMap.get(y);
                const fragment = { x: entry.x, text: rendered[i], order };
                if (line === undefined) lineMap.set(y, [fragment]);
                else line.push(fragment);
            }
        }

        const result: string[] = [];
        const maxY = Math.max(0, this.getHeight() - 1);
        for (let y = 0; y <= maxY; y++) {
            const spans = lineMap.get(y) ?? [];
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
}

export class TextLayoutHLine extends TextLayoutText {
    constructor(width: number, char: string = "-", color?: string) {
        super((color ?? "") + char.repeat(Math.max(1, Math.round(width / chatWidth(char)))));
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
}
