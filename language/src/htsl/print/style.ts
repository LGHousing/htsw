/**
 * Style options for printing HTSL source.
 */
export type PrintStyle = {
    /** String used for one indent level. Defaults to four spaces. */
    indent: string;
    /** Line ending. Defaults to `\n`. */
    lineEnding: "\n" | "\r\n";
    /** Whether the printed output should end with a newline. Defaults to `true`. */
    trailingNewline: boolean;
};

export const DEFAULT_PRINT_STYLE: PrintStyle = {
    indent: "    ",
    lineEnding: "\n",
    trailingNewline: true,
};

export function resolveStyle(partial?: Partial<PrintStyle>): PrintStyle {
    return { ...DEFAULT_PRINT_STYLE, ...(partial ?? {}) };
}
