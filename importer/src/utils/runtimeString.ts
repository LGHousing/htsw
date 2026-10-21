export type RuntimeString = string | { toString(): string };

export function runtimeString(value: RuntimeString | null | undefined): string {
    if (value === null || value === undefined) return "";
    return typeof value === "string" ? value : String(value);
}
