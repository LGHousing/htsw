import { Long } from "../../long";
import type { Tag } from "../types";

export type PrintSnbtOptions = {
    /** Insert newlines and indent for human-readable output. */
    pretty?: boolean;
    /** Indent string for one level of nesting. Defaults to four spaces. */
    indent?: string;
};

/**
 * Bare keys must start with one of these and continue with isBareChar
 * (matching the lexer's `isBareStart` / `isBareChar`). We use the same
 * predicate the parser uses so anything we emit unquoted survives a
 * round-trip parse.
 */
function isBareKey(key: string): boolean {
    if (key.length === 0) return false;
    if (!/^[A-Za-z0-9+\-.]$/.test(key.charAt(0))) return false;
    for (let i = 1; i < key.length; i++) {
        if (!/^[A-Za-z0-9+\-._]$/.test(key.charAt(i))) return false;
    }
    return true;
}

function escapeString(value: string): string {
    let out = '"';
    for (let i = 0; i < value.length; i++) {
        const ch = value.charAt(i);
        if (ch === "\\") out += "\\\\";
        else if (ch === '"') out += '\\"';
        else if (ch === "\n") out += "\\n";
        else if (ch === "\r") out += "\\r";
        else if (ch === "\t") out += "\\t";
        else out += ch;
    }
    out += '"';
    return out;
}

function printKey(key: string): string {
    return isBareKey(key) ? key : escapeString(key);
}

function printNumber(value: number, suffix: string): string {
    if (value !== value) return "NaN" + suffix;
    if (value === Infinity) return "Infinity" + suffix;
    if (value === -Infinity) return "-Infinity" + suffix;
    return String(value) + suffix;
}

function printFloat(value: number): string {
    if (value !== value) return "NaN" + "f";
    if (value === Infinity) return "Infinityf";
    if (value === -Infinity) return "-Infinityf";
    let str = String(value);
    if (str.indexOf(".") < 0 && str.indexOf("e") < 0 && str.indexOf("E") < 0) {
        str += ".0";
    }
    return str + "f";
}

function printDouble(value: number): string {
    if (value !== value) return "NaNd";
    if (value === Infinity) return "Infinityd";
    if (value === -Infinity) return "-Infinityd";
    let str = String(value);
    if (str.indexOf(".") < 0 && str.indexOf("e") < 0 && str.indexOf("E") < 0) {
        str += ".0";
    }
    return str + "d";
}

function printLong(value: Long): string {
    return value.toString() + "L";
}

export class Printer {
    private readonly pretty: boolean;
    private readonly indent: string;

    constructor(options?: PrintSnbtOptions) {
        this.pretty = options?.pretty ?? false;
        this.indent = options?.indent ?? "    ";
    }

    print(tag: Tag): string {
        return this.printTag(tag, 0);
    }

    private printTag(tag: Tag, depth: number): string {
        switch (tag.type) {
            case "byte":
                return printNumber(tag.value, "b");
            case "short":
                return printNumber(tag.value, "s");
            case "int":
                return printNumber(tag.value, "");
            case "long":
                return printLong(tag.value);
            case "float":
                return printFloat(tag.value);
            case "double":
                return printDouble(tag.value);
            case "string":
                return escapeString(tag.value);
            case "list":
                return this.printList(tag, depth);
            case "compound":
                return this.printCompound(tag, depth);
            case "byte_array":
                return this.printNumberArray("B", tag.value, "b", depth);
            case "short_array":
                return this.printNumberArray("S", tag.value, "s", depth);
            case "int_array":
                return this.printNumberArray("I", tag.value, "", depth);
            case "long_array":
                return this.printLongArray(tag.value, depth);
        }
    }

    private printCompound(
        tag: { type: "compound"; value: Record<string, Tag | undefined> },
        depth: number
    ): string {
        const keys = Object.keys(tag.value);
        const present: string[] = [];
        for (let i = 0; i < keys.length; i++) {
            if (tag.value[keys[i]] !== undefined) present.push(keys[i]);
        }
        if (present.length === 0) return "{}";

        if (!this.pretty) {
            let out = "{";
            for (let i = 0; i < present.length; i++) {
                if (i > 0) out += ",";
                const k = present[i];
                const child = tag.value[k] as Tag;
                out += printKey(k) + ":" + this.printTag(child, depth + 1);
            }
            out += "}";
            return out;
        }

        const innerPad = this.pad(depth + 1);
        const outerPad = this.pad(depth);
        let out = "{\n";
        for (let i = 0; i < present.length; i++) {
            const k = present[i];
            const child = tag.value[k] as Tag;
            out += innerPad + printKey(k) + ": " + this.printTag(child, depth + 1);
            if (i < present.length - 1) out += ",";
            out += "\n";
        }
        out += outerPad + "}";
        return out;
    }

    private printList(
        tag: { type: "list"; value: { type: Tag["type"]; value: Tag["value"][] } },
        depth: number
    ): string {
        const elements = tag.value.value;
        if (elements.length === 0) return "[]";

        const elementType = tag.value.type;

        if (!this.pretty) {
            let out = "[";
            for (let i = 0; i < elements.length; i++) {
                if (i > 0) out += ",";
                const child = { type: elementType, value: elements[i] } as Tag;
                out += this.printTag(child, depth + 1);
            }
            out += "]";
            return out;
        }

        // For tiny lists of scalars, keep them on one line for readability.
        if (isScalarType(elementType) && elements.length <= 8) {
            let out = "[";
            for (let i = 0; i < elements.length; i++) {
                if (i > 0) out += ", ";
                const child = { type: elementType, value: elements[i] } as Tag;
                out += this.printTag(child, depth + 1);
            }
            out += "]";
            return out;
        }

        const innerPad = this.pad(depth + 1);
        const outerPad = this.pad(depth);
        let out = "[\n";
        for (let i = 0; i < elements.length; i++) {
            const child = { type: elementType, value: elements[i] } as Tag;
            out += innerPad + this.printTag(child, depth + 1);
            if (i < elements.length - 1) out += ",";
            out += "\n";
        }
        out += outerPad + "]";
        return out;
    }

    private printNumberArray(
        prefix: "B" | "S" | "I",
        values: number[],
        suffix: string,
        depth: number
    ): string {
        if (values.length === 0) return "[" + prefix + ";]";

        if (!this.pretty || values.length <= 16) {
            let out = "[" + prefix + ";";
            if (this.pretty) out += " ";
            for (let i = 0; i < values.length; i++) {
                if (i > 0) out += this.pretty ? ", " : ",";
                out += printNumber(values[i], suffix);
            }
            out += "]";
            return out;
        }

        const innerPad = this.pad(depth + 1);
        const outerPad = this.pad(depth);
        let out = "[" + prefix + ";\n";
        for (let i = 0; i < values.length; i++) {
            out += innerPad + printNumber(values[i], suffix);
            if (i < values.length - 1) out += ",";
            out += "\n";
        }
        out += outerPad + "]";
        return out;
    }

    private printLongArray(values: Long[], depth: number): string {
        if (values.length === 0) return "[L;]";

        if (!this.pretty || values.length <= 16) {
            let out = "[L;";
            if (this.pretty) out += " ";
            for (let i = 0; i < values.length; i++) {
                if (i > 0) out += this.pretty ? ", " : ",";
                out += printLong(values[i]);
            }
            out += "]";
            return out;
        }

        const innerPad = this.pad(depth + 1);
        const outerPad = this.pad(depth);
        let out = "[L;\n";
        for (let i = 0; i < values.length; i++) {
            out += innerPad + printLong(values[i]);
            if (i < values.length - 1) out += ",";
            out += "\n";
        }
        out += outerPad + "]";
        return out;
    }

    private pad(depth: number): string {
        let s = "";
        for (let i = 0; i < depth; i++) s += this.indent;
        return s;
    }
}

function isScalarType(type: Tag["type"]): boolean {
    return (
        type === "byte" ||
        type === "short" ||
        type === "int" ||
        type === "long" ||
        type === "float" ||
        type === "double" ||
        type === "string"
    );
}
