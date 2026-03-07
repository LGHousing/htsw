import type { Action } from "htsw/types";

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

const MessageDigest = Java.type("java.security.MessageDigest");
const StandardCharsets = Java.type("java.nio.charset.StandardCharsets");
const JString = Java.type("java.lang.String");

function canonicalize(value: any): JsonValue {
    if (value === null) return null;

    if (Array.isArray(value)) {
        return value.map((it) => canonicalize(it));
    }

    const valueType = typeof value;
    if (valueType !== "object") {
        return value as JsonValue;
    }

    const obj: Record<string, JsonValue> = {};
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
        const field = value[key];
        if (field === undefined) continue;
        obj[key] = canonicalize(field);
    }

    return obj;
}

export function canonicalJson(value: any): string {
    return JSON.stringify(canonicalize(value));
}

export function hashSha256Hex(value: string): string {
    const digest = MessageDigest.getInstance("SHA-256");
    const bytes = digest.digest(new JString(value).getBytes(StandardCharsets.UTF_8));

    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
        const byteValue = bytes[i] & 0xff;
        const byteHex = byteValue.toString(16);
        hex += byteHex.length === 1 ? `0${byteHex}` : byteHex;
    }
    return hex;
}

export function hashFunctionRepresentation(
    name: string,
    actions: Action[],
    repeatTicks?: number
): string {
    const payload = {
        name,
        actions,
        repeatTicks: repeatTicks ?? null,
    };

    return hashSha256Hex(canonicalJson(payload));
}

