import { Importable } from "htsw/types";

import type { Step, StepSelectValue } from "./step";
import { getSlotFromName, ButtonType } from "../slots";
import {
    chatHistoryContains,
    setAnvilItemName,
    acceptNewAnvilItem,
} from "../helpers";

import { stepClickButtonOrNextPage } from "./helpers";
import { stepsForImportable } from "./importables";

export class Importer {
    static remainingSteps: Step[] = [];
    static nextIterationWaitUntil: number;
    static lastStepExecutedAt: number;

    static isImporting: boolean = false;
    static triggers: Trigger[];

    private static init() {
        this.remainingSteps = [];
        this.nextIterationWaitUntil = 0;
        this.lastStepExecutedAt = Date.now();

        this.triggers.push(register("tick", () => {
            try {
                this.maybeIterate();
            } catch (e) {
                ChatLib.chat(`Error: ${e}`);
            }

            if (this.remainingSteps.length === 0) {
                this.stop();
            }
        }));
    }

    static import(importables: Importable[]) {
        if (!this.isImporting) this.init();

        const steps: Step[] = [];

        for (const importable of importables) {
            steps.push(...stepsForImportable(importable));
        }

        this.remainingSteps.push(...steps);
    }

    private static stop() {
        this.isImporting = false;
        this.triggers.forEach(it => it.unregister());
    }

    private static getNextStep(): Step | null {
        if (this.remainingSteps.length === 0) {
            return null;
        }
        const step = this.remainingSteps.shift();
        if (!step) {
            return null;
        }
        return step;
    }

    private static executeSelectValueStep(step: StepSelectValue): boolean {
        if (
            chatHistoryContains(
                "Please use the chat to provide the value you wish to set.",
                this.lastStepExecutedAt,
                false,
                false
            )
        ) {
            // Enter chat message
            this.remainingSteps.unshift({
                type: "SEND_MESSAGE",
                message: step.value,
            });
            return true;
        }

        if (Client.currentGui.getClassName() === "GuiRepair") {
            // Anvil GUI input
            setAnvilItemName(step.value);
            acceptNewAnvilItem();
            this.nextIterationWaitUntil = Date.now() + 200;
            return false;
        }

        if (getSlotFromName(step.key) !== null) {
            // Boolean toggle button, already pressed
            return true;
        }

        // Select menu with possible next page button(s)
        this.remainingSteps.unshift(
            stepClickButtonOrNextPage(step.value)
        );
        return true;
    }

    private static executeStep(step: Step): boolean {
        switch (step.type) {
            case "RUN_COMMAND":
                const command = step.command;
                ChatLib.command(command.slice(1));
                this.nextIterationWaitUntil = Date.now() + 500;
                return false;
            case "SEND_MESSAGE":
                const message = step.message;
                ChatLib.command(`ac ${message}`);
                this.nextIterationWaitUntil = Date.now() + 500;
                return false;
            case "SELECT_VALUE":
                return this.executeSelectValueStep(step);
            case "CLICK_BUTTON":
                const slot = getSlotFromName(step.key);
                if (slot === null) {
                    throw new Error(`No slot found for key: ${step.key}`);
                }
                slot.click(ButtonType.LEFT);
                this.nextIterationWaitUntil = Date.now() + 200;
                return false;
            case "CONDITIONAL":
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

    private static iterate(): void {
        while (true) {
            const step = this.getNextStep();
            if (step === null) {
                throw new Error("No more steps to execute");
            }

            let repeat: boolean;
            try {
                repeat = this.executeStep(step);
            } finally {
                this.lastStepExecutedAt = Date.now();
            }

            console.log("\n\n\n\n\n\n\n\n\n\n\nRemaining steps:");
            for (const remainingStep of this.remainingSteps) {
                console.log(`  ${JSON.stringify(remainingStep, null, 0)}`);
            }
            console.log("\n\n\n");

            if (!repeat) {
                break;
            }
        }
    }

    public static maybeIterate(): void {
        if (this.remainingSteps.length === 0) {
            ChatLib.chat("All steps executed");
        }
        const now = Date.now();
        if (now < this.nextIterationWaitUntil) {
            return;
        }
        this.iterate();
    }
}