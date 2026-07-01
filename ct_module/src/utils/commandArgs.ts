export type ParsedCommandArgs =
    | { ok: true; args: string[] }
    | { ok: false; error: string };

export function parseCommandArgs(rawArgs: string[]): ParsedCommandArgs {
    const input = rawArgs.join(" ");
    const args: string[] = [];
    let current = "";
    let inQuote = false;
    let quoted = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input.charAt(i);

        if (ch === "\\") {
            const next = i + 1 < input.length ? input.charAt(i + 1) : "";
            if (next === "\"" || next === "\\") {
                current += next;
                i++;
            } else {
                current += ch;
            }
            continue;
        }

        if (ch === "\"") {
            inQuote = !inQuote;
            quoted = true;
            continue;
        }

        if (!inQuote && /\s/.test(ch)) {
            if (quoted || current.length > 0) {
                args.push(current);
                current = "";
                quoted = false;
            }
            continue;
        }

        current += ch;
    }

    if (inQuote) return { ok: false, error: "Unclosed quote." };
    if (quoted || current.length > 0) args.push(current);

    return { ok: true, args };
}

export function quoteCommandArg(value: string): string {
    if (value.length === 0 || /\s|"|\\/.test(value)) {
        return `"${value.split("\\").join("\\\\").split("\"").join("\\\"")}"`;
    }
    return value;
}
