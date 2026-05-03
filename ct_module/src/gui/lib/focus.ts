let focusedInputId: string | null = null;

export function getFocusedInput(): string | null {
    return focusedInputId;
}
export function setFocusedInput(id: string | null): void {
    focusedInputId = id;
}
export function isInputFocused(id: string): boolean {
    return focusedInputId === id;
}
