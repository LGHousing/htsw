export type Extractable<T> = T | (() => T);

export function extract<T>(value: Extractable<T>): T {
    return typeof value === "function" ? (value as () => T)() : value;
}
