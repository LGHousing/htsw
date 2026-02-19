export class Span {
    start: number;
    end: number;

    constructor(start: number, end: number) {
        this.start = start;
        this.end = end;
    }

    static single(pos: number): Span {
        return new Span(pos, pos);
    }

    static dummy(): Span {
        return Span.single(-1);
    }

    startSpan(): Span {
        return Span.single(this.start);
    }

    endSpan(): Span {
        return Span.single(this.end);
    }

    to(other: Span) {
        const start = Math.min(this.start, other.start);
        const end = Math.max(this.end, other.end);
        return new Span(start, end);
    }
}
