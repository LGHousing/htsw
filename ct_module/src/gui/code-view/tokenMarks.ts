import type { TokenMark, TokenSpan } from "./lineTypes";

export function tokensWithMarks(
    tokens: readonly TokenSpan[],
    marks: readonly TokenMark[]
): TokenSpan[] {
    if (marks.length === 0) return tokens.slice();
    const out: TokenSpan[] = [];
    let tokenStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenEnd = tokenStart + token.text.length;
        const cuts = [tokenStart, tokenEnd];
        for (let j = 0; j < marks.length; j++) {
            if (marks[j].startColumn > tokenStart && marks[j].startColumn < tokenEnd)
                cuts.push(marks[j].startColumn);
            if (marks[j].endColumn > tokenStart && marks[j].endColumn < tokenEnd)
                cuts.push(marks[j].endColumn);
        }
        cuts.sort((a, b) => a - b);
        const uniqueCuts: number[] = [];
        for (let j = 0; j < cuts.length; j++) {
            if (j === 0 || cuts[j] !== cuts[j - 1]) uniqueCuts.push(cuts[j]);
        }
        for (let j = 0; j < uniqueCuts.length - 1; j++) {
            const start = uniqueCuts[j];
            const end = uniqueCuts[j + 1];
            let mark: TokenMark | undefined;
            for (let k = 0; k < marks.length; k++) {
                if (marks[k].startColumn < end && marks[k].endColumn > start) {
                    mark = marks[k];
                    break;
                }
            }
            out.push({
                text: token.text.substring(start - tokenStart, end - tokenStart),
                color: token.color,
                fieldProp: token.fieldProp,
                srcStart: token.srcStart,
                underlineColor: token.underlineColor ?? mark?.underlineColor,
                linkTarget: mark?.linkTarget ?? token.linkTarget,
            });
        }
        tokenStart = tokenEnd;
    }
    return out;
}
