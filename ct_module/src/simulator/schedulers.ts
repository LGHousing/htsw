import * as htsl from 'htsl';

export interface ActionScheduler {

    tick(): htsl.IrAction[] | undefined;
    hasNext(): boolean;

}

export class DelayedActionScheduler implements ActionScheduler {

    actions: htsl.IrAction[];
    delay: number;

    constructor(
        actions: htsl.IrAction[],
        delay: number,
    ) {
        this.actions = actions;
        this.delay = delay;
    }

    tick(): htsl.IrAction[] | undefined {
        this.delay -= 1;

        if (this.delay == 0) return this.actions;
    }

    hasNext(): boolean {
        return this.delay > 0;
    }

}

export class RepeatingActionScheduler implements ActionScheduler {

    actions: htsl.IrAction[];
    initialDelay: number;
    delay: number;

    constructor(
        actions: htsl.IrAction[],
        delay: number,
    ) {
        this.actions = actions;
        this.initialDelay = delay;
        this.delay = delay;
    }

    tick(): htsl.IrAction[] | undefined {
        this.delay -= 1;

        if (this.delay == 0) {
            this.delay = this.initialDelay;
            return this.actions;
        }
    }

    hasNext(): boolean {
        return true;
    }

}