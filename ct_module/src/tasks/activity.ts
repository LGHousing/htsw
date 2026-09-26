/// <reference types="../../CTAutocomplete" />

/**
 * A label for what the running task is doing during stretches no progress row
 * covers. Callers clear it once an importable's own progress row takes over.
 */

let current: string | null = null;
const observers: Array<() => void> = [];

export function setTaskActivity(label: string | null): void {
    if (current === label) return;
    current = label;
    for (let i = 0; i < observers.length; i++) observers[i]();
}

export function getTaskActivity(): string | null {
    return current;
}

export function observeTaskActivity(observer: () => void): void {
    observers.push(observer);
}
