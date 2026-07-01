/// <reference types="../../CTAutocomplete" />

let taskRunning = false;

export function setTaskRunning(value: boolean): void {
    taskRunning = value;
}

export function isTaskRunning(): boolean {
    return taskRunning;
}
