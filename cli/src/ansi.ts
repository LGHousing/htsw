export type AnsiColor = "red" | "yellow" | "blue" | "green";

const ANSI_CODES: Record<AnsiColor, string> = {
    red: "31",
    yellow: "33",
    blue: "34",
    green: "32",
};

export function ansi(color: AnsiColor, text: string, bold = false): string {
    const codes = [ANSI_CODES[color]];
    if (bold) codes.push("1");
    return `\u001b[${codes.join(";")}m${text}\u001b[0m`;
}
