type DiffLine = {
    kind: "context" | "delete" | "insert";
    text: string;
};

const CONTEXT_LINES = 3;
const MAX_LCS_CELLS = 20_000;

function linesOf(text: string): string[] {
    if (text === "") return [];
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    if (normalized.endsWith("\n")) lines.pop();
    return lines;
}

function diffLines(source: readonly string[], live: readonly string[]): DiffLine[] {
    const table = new Array<number[]>(source.length + 1);
    const finalRow = new Array<number>(live.length + 1);
    for (let j = 0; j <= live.length; j++) finalRow[j] = 0;
    table[source.length] = finalRow;
    for (let i = source.length - 1; i >= 0; i--) {
        const row = new Array<number>(live.length + 1);
        row[live.length] = 0;
        for (let j = live.length - 1; j >= 0; j--) {
            row[j] =
                source[i] === live[j]
                    ? table[i + 1][j + 1] + 1
                    : Math.max(table[i + 1][j], row[j + 1]);
        }
        table[i] = row;
    }

    const result: DiffLine[] = [];
    let sourceIndex = 0;
    let liveIndex = 0;
    while (sourceIndex < source.length && liveIndex < live.length) {
        if (source[sourceIndex] === live[liveIndex]) {
            result.push({ kind: "context", text: source[sourceIndex] });
            sourceIndex++;
            liveIndex++;
        } else if (
            table[sourceIndex + 1][liveIndex] >= table[sourceIndex][liveIndex + 1]
        ) {
            result.push({ kind: "delete", text: source[sourceIndex++] });
        } else {
            result.push({ kind: "insert", text: live[liveIndex++] });
        }
    }
    while (sourceIndex < source.length) {
        result.push({ kind: "delete", text: source[sourceIndex++] });
    }
    while (liveIndex < live.length) {
        result.push({ kind: "insert", text: live[liveIndex++] });
    }
    return result;
}

function range(start: number, count: number): string {
    if (count === 0) return `${start},0`;
    const firstLine = start + 1;
    return count === 1 ? String(firstLine) : `${firstLine},${count}`;
}

function lineCountsBefore(
    lines: readonly DiffLine[],
    end: number
): {
    source: number;
    live: number;
} {
    let source = 0;
    let live = 0;
    for (let i = 0; i < end; i++) {
        if (lines[i].kind !== "insert") source++;
        if (lines[i].kind !== "delete") live++;
    }
    return { source, live };
}

function formatHunk(lines: readonly DiffLine[], start: number, end: number): string[] {
    const before = lineCountsBefore(lines, start);
    let sourceCount = 0;
    let liveCount = 0;
    const body: string[] = [];
    for (let i = start; i < end; i++) {
        const line = lines[i];
        if (line.kind !== "insert") sourceCount++;
        if (line.kind !== "delete") liveCount++;
        body.push(
            `${line.kind === "context" ? " " : line.kind === "delete" ? "-" : "+"}${line.text}`
        );
    }
    return [
        `@@ -${range(before.source, sourceCount)} +${range(before.live, liveCount)} @@`,
        ...body,
    ];
}

export function unifiedDiff(
    sourceText: string,
    liveText: string,
    sourcePath: string,
    livePath: string
): string {
    const sourceLines = linesOf(sourceText);
    const liveLines = linesOf(liveText);
    if (
        sourceLines.length + 1 >
        MAX_LCS_CELLS / Math.max(1, liveLines.length + 1)
    ) {
        return (
            `# HTSW diff body omitted: ${sourceLines.length} source lines × ` +
            `${liveLines.length} live lines exceeds the ${MAX_LCS_CELLS}-cell comparison limit.\n` +
            `--- ${sourcePath}\n` +
            `+++ ${livePath}\n`
        );
    }
    const lines = diffLines(sourceLines, liveLines);
    const changes: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].kind !== "context") changes.push(i);
    }
    if (changes.length === 0) return "";

    const output = [`--- ${sourcePath}`, `+++ ${livePath}`];
    let changeIndex = 0;
    while (changeIndex < changes.length) {
        const start = Math.max(0, changes[changeIndex] - CONTEXT_LINES);
        let end = Math.min(lines.length, changes[changeIndex] + CONTEXT_LINES + 1);
        changeIndex++;
        while (
            changeIndex < changes.length &&
            changes[changeIndex] - CONTEXT_LINES <= end
        ) {
            end = Math.min(lines.length, changes[changeIndex] + CONTEXT_LINES + 1);
            changeIndex++;
        }
        output.push(...formatHunk(lines, start, end));
    }
    return output.join("\n") + "\n";
}
