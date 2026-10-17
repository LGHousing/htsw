export class Span {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    static at(pos: number): Span {
        return new Span(pos, pos);
    }

    static single(pos: number): Span {
        return new Span(pos, pos + 1);
    }

    static dummy(): Span {
        return Span.at(-1);
    }

    /** A zero-width insertion point immediately before this span. */
    startSpan(): Span {
        return Span.at(this.start);
    }

    /** A zero-width insertion point immediately after this span. */
    endSpan(): Span {
        return Span.at(this.end);
    }

    to(other: Span) {
        const start = Math.min(this.start, other.start);
        const end = Math.max(this.end, other.end);
        return new Span(start, end);
    }
}
