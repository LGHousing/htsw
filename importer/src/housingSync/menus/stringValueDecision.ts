/**
 * What to do when writing a desired string value onto a Housing editor field.
 * `currentValue` is what the field reads back as, and is null when the field is
 * empty/unset (an empty field carries no "Current Value:" line).
 *
 * - "enter": submit the value through Housing's input prompt.
 * - "skip": the field already holds the desired value, or both are empty.
 * - "cannot-clear": the desired value is empty but the field is not. An empty
 *   value can't be submitted through Housing's chat prompt — the editor never
 *   reopens and the import hangs until the menu-wait times out — so callers must
 *   not attempt it.
 */
export type StringWriteAction = "enter" | "skip" | "cannot-clear";

export function decideStringWrite(
    currentValue: string | null,
    desiredValue: string
): StringWriteAction {
    if (currentValue === desiredValue) return "skip";
    if (desiredValue === "") return currentValue === null ? "skip" : "cannot-clear";
    return "enter";
}
