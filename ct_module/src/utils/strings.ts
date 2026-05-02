export function stripSurroundingQuotes(value: string): string {
    if (
        value.length >= 2 &&
        value.charAt(0) === '"' &&
        value.charAt(value.length - 1) === '"'
    ) {
        return value.slice(1, value.length - 1);
    }
    return value;
}
