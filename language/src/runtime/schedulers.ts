import type { Action } from "../types";

export interface ActionScheduler {
    tick(): Action[] | undefined;
    hasNext(): boolean;
}

export class DelayedActionScheduler implements ActionScheduler {
    private readonly actions: Action[];
    private delay: number;

    constructor(actions: Action[], delay: number) {
        this.actions = actions;
        this.delay = delay;
    }

    tick(): Action[] | undefined {
        this.delay -= 1;
        if (this.delay === 0) return this.actions;
        return undefined;
    }

    hasNext(): boolean {
        return this.delay > 0;
    }
}

export class RepeatingActionScheduler implements ActionScheduler {
    private readonly actions: Action[];
    private readonly initialDelay: number;
    private delay: number;

    constructor(actions: Action[], delay: number) {
        this.actions = actions;
        this.initialDelay = delay;
        this.delay = delay;
    }

    tick(): Action[] | undefined {
        this.delay -= 1;
        if (this.delay === 0) {
            this.delay = this.initialDelay;
            return this.actions;
        }
        return undefined;
    }

    hasNext(): boolean {
        return true;
    }
}
