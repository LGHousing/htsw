import { Diagnostic, SourceMap } from "htsw";
import { IrAction, IrImportable } from "htsw/ir";

import { VarHolder, TeamVarKey } from "./vars";
import {
    ActionScheduler,
    DelayedActionScheduler,
    RepeatingActionScheduler,
} from "./schedulers";
import { registerCommandTriggers } from "./commands";
import { runAction } from "./actions";
import { printDiagnostic } from "../tui/diagnostics";

export class Simulator {
    static sm: SourceMap;
    static importables: IrImportable[];

    static playerVars: VarHolder<string>;
    static globalVars: VarHolder<string>;
    static teamVars: VarHolder<TeamVarKey>;

    static schedulers: ActionScheduler[];
    static cooldowns: Map<string, number>;

    static triggers: Trigger[];

    static start(sm: SourceMap, importables: IrImportable[]) {
        Simulator.sm = sm;
        Simulator.importables = importables;

        this.playerVars = new VarHolder();
        this.globalVars = new VarHolder();
        this.teamVars = new VarHolder();

        this.schedulers = [];
        this.cooldowns = new Map();

        this.triggers = [
            register("tick", this.tick.bind(this)),
            ...registerCommandTriggers(),
        ];

        this.postinit();
    }

    static stop(): void {
        for (const trigger of this.triggers) {
            trigger.unregister();
        }
    }

    static runFunction(name: string): boolean {
        for (const importable of this.importables) {
            if (importable.type === "FUNCTION" && importable.name?.value === name) {
                this.runActions(importable.actions?.value ?? []);
                return true;
            }
        }
        return false;
    }

    static runActions(actions: IrAction[], childCtx: boolean = false) {
        for (let i = 0; i < actions.length; i++) {
            try {
                const action = actions[i];

                runAction(action);
            } catch (err) {
                if (err instanceof Diagnostic) {
                    // We have encountered a known runtime issue
                    printDiagnostic(this.sm, err);
                } else if (err instanceof ExitError) {
                    // Exit action
                } else if (err instanceof PauseError) {
                    // Pause action
                    const slice = actions.slice(i + 1);
                    this.schedulers.push(new DelayedActionScheduler(slice, err.ticks));
                }

                if (childCtx) {
                    throw err;
                }
                return;
            }
        }
    }

    private static postinit() {
        this.runFunction("htsw:main");

        for (const importable of this.importables) {
            if (importable.type === "FUNCTION" && importable.actions && importable.repeatTicks) {
                this.schedulers.push(
                    new RepeatingActionScheduler(
                        importable.actions.value,
                        importable.repeatTicks.value
                    )
                );
            }
        }
    }

    private static tick(): void {
        for (const scheduler of this.schedulers) {
            const actions = scheduler.tick();
            if (actions) this.runActions(actions);
        }
    }
}

export class ExitError {}

export class PauseError {
    ticks: number;

    constructor(ticks: number) {
        this.ticks = ticks;
    }
}
