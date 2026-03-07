import { chatWidth, spaceWidth } from "../utils/helpers";

export interface UIElement {

    getWidth(): number;
    getHeight(): number;
    render(): string[];

}

export function printUI(element: UIElement) {
    for (const line of element.render()) {
        ChatLib.chat(line);
    }
}

export class UIElementText implements UIElement {
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

export class UIElementVStack implements UIElement {
    elements: UIElement[];

    constructor() {
        this.elements = [];
    }

    static fromElements(elements: UIElement[]): UIElementVStack {
        const stack = new UIElementVStack();
        stack.elements = elements;
        return stack;
    }

    add(element: UIElement) {
        this.elements.push(element);
    }

    getWidth(): number {
        return Math.max(...this.elements.map(it => it.getWidth()));
    }

    getHeight(): number {
        let height = 0;
        for (const element of this.elements) {
            height += element.getHeight();
        }
        return height;
    }

    render(): string[] {
        const res: string[] = [];
        for (const element of this.elements) {
            res.push(...element.render());
        }
        return res;
    }
}

export class UIElementCanvas implements UIElement {
    elements: { x: number; y: number; element: UIElement }[];

    constructor() {
        this.elements = [];
    }

    addElement(x: number, y: number, element: UIElement) {
        this.elements.push({ x, y, element });
    }

    getWidth(): number {
        if (this.elements.length === 0) return 0;
        return Math.max(...this.elements.map(e => e.x + e.element.getWidth()));
    }

    getHeight(): number {
        if (this.elements.length === 0) return 0;
        return Math.max(...this.elements.map(e => e.y + e.element.getHeight()));
    }

    private tokenizeFormatting(text: string): { token: string; width: number }[] {
        const tokens: { token: string; width: number }[] = [];
        let i = 0;
        while (i < text.length) {
            if (text[i] === "&" && i + 1 < text.length) {
                tokens.push({ token: text.slice(i, i + 2), width: 0 });
                i += 2;
            } else {
                let start = i;
                while (i < text.length && text[i] !== "&") i++;
                const substr = text.slice(start, i);
                tokens.push({ token: substr, width: chatWidth(substr) });
            }
        }
        return tokens;
    }

    render(): string[] {
        const lineMap = new Map<number, { x: number; text: string; order: number }[]>();

        for (let order = 0; order < this.elements.length; order++) {
            const { x, y, element } = this.elements[order];
            const rendered = element.render();
            for (let i = 0; i < rendered.length; i++) {
                const absY = y + i;
                if (!lineMap.has(absY)) lineMap.set(absY, []);
                lineMap.get(absY)!.push({ x, text: rendered[i], order });
            }
        }

        const arr: number[] = [];
        for (const line of lineMap.keys()) arr.push(line);
        const maxY = Math.max(...arr, 0);
        const result: string[] = [];

        for (let y = 0; y <= maxY; y++) {
            const spans = lineMap.get(y) ?? [];
            spans.sort((a, b) => a.order - b.order);

            const fragments: { start: number; end: number; char: string; width: number }[] = [];

            for (const span of spans) {
                let pos = span.x;
                const tokens = this.tokenizeFormatting(span.text);

                for (const { token, width } of tokens) {
                    const start = pos;
                    const end = pos + width;

                    // remove overlapping fragments only for real-width chars
                    for (let i = fragments.length - 1; i >= 0; i--) {
                        const f = fragments[i];
                        if (f.width > 0 && !(f.end <= start || f.start >= end)) {
                            fragments.splice(i, 1);
                        }
                    }

                    fragments.push({ start, end, char: token, width });
                    pos = end;
                }
            }

            // sort fragments: zero-width first if same start
            fragments.sort((a, b) => a.start - b.start || (a.width === 0 ? -1 : 0));

            let line = "";
            let cursor = 0;

            for (const f of fragments) {
                const gap = f.start - cursor;
                if (gap > 0) {
                    let gapWidth = 0;
                    while (gapWidth < gap) {
                        line += "&0.";
                        gapWidth += chatWidth(".");
                    }
                }
                line += f.char;
                cursor = Math.max(cursor, f.end); // prevents gaps from zero-width tokens
            }

            result.push(line);
        }

        return result;
    }
}

export class UIElementHLine extends UIElementText {
    constructor(width: number, char: string = "-", color?: string) {
        super((color ?? "") + char.repeat(Math.max(1,
            Math.round(width / chatWidth(char))
        )));

        console.log(this.text);
    }
}

export class UIElementVLine extends UIElementVStack {
    constructor(height: number, char: string = "|") {
        super();
        for (let i = 0; i < height; i++) {
            this.add(new UIElementText(char));
        }
    }
}

export class UIElementTruncate implements UIElement {
    inner: UIElement;
    maxWidth: number;

    constructor(inner: UIElement, maxWidth: number) {
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

        return lines.map(line => {
            const width = chatWidth(line);
            if (width <= this.maxWidth) return line;

            // truncate from the right, keeping enough room for "..."
            let truncated = "";
            let currentWidth = 0;
            for (const ch of line) {
                const chWidth = chatWidth(ch);
                if (currentWidth + chWidth + ellipsisWidth > this.maxWidth)
                    break;
                truncated += ch;
                currentWidth += chWidth;
            }
            return truncated + ellipsis;
        });
    }
}