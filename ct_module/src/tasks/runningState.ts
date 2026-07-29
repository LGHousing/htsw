/// <reference types="../../CTAutocomplete" />

let taskRunning = false;
const observers: Array<(running: boolean) => void> = [];

export function setTaskRunning(value: boolean): void {
    if (taskRunning === value) return;
    taskRunning = value;
    for (let i = 0; i < observers.length; i++) observers[i](value);
}

export function isTaskRunning(): boolean {
    return taskRunning;
}

export function observeTaskRunning(observer: (running: boolean) => void): void {
    observers.push(observer);
}
