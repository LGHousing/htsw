/// <reference types="../../CTAutocomplete" />

import type { Step, StepSelectValue } from '../steps/step';
import { generateSteps } from '../steps/generateSteps';
import { getSlots, getSlotFromName, ItemSlot, ButtonType } from '../slots';
import {
    chatHistoryContains,
    normalized,
    removeFormatting,
    setAnvilItemName,
    acceptNewAnvilItem,
} from '../utils';

import type { ActionHolder } from 'housing-common/src/types';
import * as htsl from 'htsl/src/index';
import { stepClickButtonOrNextPage } from '../steps/helpers';

export class Importer {
    public static INSTANCE: Importer | null = null;

    private remainingSteps: Step[];
    private nextIterationWaitUntil: number;
    private lastStepExecutedAt: number;

    constructor(steps: Step[]) {
        this.remainingSteps = steps;
        this.nextIterationWaitUntil = 0;
        this.lastStepExecutedAt = 0;
    }

    public static fromActionHolders(holders: ActionHolder[]): Importer {
        const steps = generateSteps(holders);
        return new Importer(steps);
    }

    public static fromSource(src: string): Importer {
        const diagnostics: htsl.Diagnostic[] = htsl.diagnostics(src);
        for (const diagnostic of diagnostics) {
            console.log(`  ${diagnostic.level}: ${diagnostic.message}`);
        }
        const holders: ActionHolder[] = htsl.actions(src);
        return Importer.fromActionHolders(holders);
    }

    public initialize(): void {
        Importer.INSTANCE = this;
    }

    public getLastStepExecutedAt(): number {
        return this.lastStepExecutedAt;
    }

    private getNextStep(): Step | null {
        if (this.remainingSteps.length === 0) {
            return null;
        }
        const step = this.remainingSteps.shift();
        if (!step) {
            return null;
        }
        return step;
    }

    private executeSelectValueStep(step: StepSelectValue): boolean {
        if (
            chatHistoryContains(
                'Please use the chat to provide the value you wish to set.',
                this.getLastStepExecutedAt(),
                false,
                false
            )
        ) {
            // Enter chat message
            this.remainingSteps.unshift({
                type: 'SEND_MESSAGE',
                message: step.value,
            });
            return true;
        }

        if (Client.currentGui.getClassName() === 'GuiRepair') {
            // Anvil GUI input
            setAnvilItemName(step.value);
            acceptNewAnvilItem();
            this.nextIterationWaitUntil = Date.now() + 200;
            return false;
        }

        if (getSlotFromName(step.key, step.keyIsNormalized) !== null) {
            // Boolean toggle button, already pressed
            return true;
        }

        // Select menu with possible next page button(s)
        this.remainingSteps.unshift(
            stepClickButtonOrNextPage(step.value, step.valueIsNormalized)
        );
        return true;
    }

    private executeStep(step: Step): boolean {
        switch (step.type) {
            case 'RUN_COMMAND':
                const command = step.command;
                ChatLib.command(command.slice(1));
                this.nextIterationWaitUntil = Date.now() + 500;
                return false;
            case 'SEND_MESSAGE':
                const message = step.message;
                ChatLib.command(`ac ${message}`);
                this.nextIterationWaitUntil = Date.now() + 500;
                return false;
            case 'SELECT_VALUE':
                return this.executeSelectValueStep(step);
            case 'CLICK_BUTTON':
                const slot = getSlotFromName(step.key, true);
                if (slot === null) {
                    throw new Error(`No slot found for key: ${step.key}`);
                }
                slot.click(ButtonType.LEFT);
                this.nextIterationWaitUntil = Date.now() + 200;
                return false;
            case 'CONDITIONAL':
                const condition = step.condition;
                if (condition()) {
                    this.remainingSteps.unshift(...step.then());
                } else {
                    this.remainingSteps.unshift(...step.else());
                }
                return true;
            default:
                // @ts-ignore
                throw new Error(`Unknown step type: ${step.type}`);
        }
    }

    private iterate(): void {
        while (true) {
            const step = this.getNextStep();
            if (step === null) {
                throw new Error('No more steps to execute');
            }

            let repeat: boolean;
            try {
                repeat = this.executeStep(step);
            } finally {
                this.lastStepExecutedAt = Date.now();
            }

            console.log('\n\n\n\n\n\n\n\n\n\n\nRemaining steps:');
            for (const remainingStep of this.remainingSteps) {
                console.log(`  ${JSON.stringify(remainingStep, null, 0)}`);
            }
            console.log('\n\n\n');

            if (!repeat) {
                break;
            }
        }
    }

    public maybeIterate(): void {
        if (this.remainingSteps.length === 0) {
            ChatLib.chat('All steps executed');
            Importer.INSTANCE = null;
        }
        const now = Date.now();
        if (now < this.nextIterationWaitUntil) {
            return;
        }
        this.iterate();
    }
}

register('tick', () => {
    if (!Importer.INSTANCE) {
        return;
    }
    try {
        Importer.INSTANCE.maybeIterate();
    } catch (e) {
        ChatLib.chat(`Error: ${e}`);
        Importer.INSTANCE = null;
    }
});
