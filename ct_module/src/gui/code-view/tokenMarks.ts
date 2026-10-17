import type { TokenMark, TokenSpan } from "./lineTypes";

type ColumnSpan = { startColumn: number; endColumn: number };

/**
 * Split tokens at every span edge that falls inside one, so each piece sits
 * under the same spans throughout. `piece` builds the token for the columns
 * [start, end) of `token`.
 */
export function splitTokensAtSpans(
    tokens: readonly TokenSpan[],
    spans: readonly ColumnSpan[],
    piece: (token: TokenSpan, text: string, start: number, end: number) => TokenSpan
): TokenSpan[] {
    if (spans.length === 0) return tokens.slice();
    const out: TokenSpan[] = [];
    let tokenStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenEnd = tokenStart + token.text.length;
        const cuts = [tokenStart, tokenEnd];
        for (let j = 0; j < spans.length; j++) {
            if (spans[j].startColumn > tokenStart && spans[j].startColumn < tokenEnd)
                cuts.push(spans[j].startColumn);
            if (spans[j].endColumn > tokenStart && spans[j].endColumn < tokenEnd)
                cuts.push(spans[j].endColumn);
        }
        cuts.sort((a, b) => a - b);
        const uniqueCuts: number[] = [];
        for (let j = 0; j < cuts.length; j++) {
            if (j === 0 || cuts[j] !== cuts[j - 1]) uniqueCuts.push(cuts[j]);
        }
        for (let j = 0; j < uniqueCuts.length - 1; j++) {
            const start = uniqueCuts[j];
            const end = uniqueCuts[j + 1];
            const text = token.text.substring(start - tokenStart, end - tokenStart);
            out.push(piece(token, text, start, end));
        }
        tokenStart = tokenEnd;
    }
    return out;
}

export function tokensWithMarks(
    tokens: readonly TokenSpan[],
    marks: readonly TokenMark[]
): TokenSpan[] {
    return splitTokensAtSpans(tokens, marks, (token, text, start, end) => {
        let mark: TokenMark | undefined;
        for (let k = 0; k < marks.length; k++) {
            if (marks[k].startColumn < end && marks[k].endColumn > start) {
                mark = marks[k];
                break;
            }
        }
        return {
            text,
            color: token.color,
            fieldProp: token.fieldProp,
            srcStart: token.srcStart,
            underlineColor: token.underlineColor ?? mark?.underlineColor,
            linkTarget: mark?.linkTarget ?? token.linkTarget,
        };
    });
}
