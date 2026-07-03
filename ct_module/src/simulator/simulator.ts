import { SourceMap, SpanTable, runtime, types } from "htsw";

import { registerCommandTriggers } from "./commands";
import { createActionBehaviors } from "./actions";
import { printDiagnostic } from "../tui/diagnostics";
import { registerEventTriggers } from "./events";
import { registerRegionTriggers } from "./regions";
import { createConditionBehaviors } from "./conditions";
import { createPlaceholderBehaviors } from "./placeholders";
import {
    runSimulatorActions,
    setSimulatorActive,
    setSimulatorRuntime,
    setSimulatorSource,
} from "./session";

export class Simulator {
    static isActive: boolean = false;

    static sm: SourceMap;
    static importables: types.Importable[];
    static runtime: runtime.Runtime;
    static vars: runtime.simple.SimpleVars;

    static triggers: Trigger[] = [];

    static start(sm: SourceMap, importables: types.Importable[], spans: SpanTable) {
        this.isActive = true;
        setSimulatorActive(true);

        this.sm = sm;
        this.importables = importables;
        setSimulatorSource(sm, importables);
        this.runtime = this.createRuntime(spans);
        this.registerTriggers();
    }

    static restart(): void {
        const spans = this.runtime.spans;
        this.stop();
        this.isActive = true;
        setSimulatorActive(true);
        this.runtime = this.createRuntime(spans);
        this.registerTriggers();
    }

    static stop(): void {
        this.isActive = false;
        setSimulatorActive(false);
        for (const trigger of this.triggers) {
            trigger.unregister();
        }
        this.triggers = [];
    }

    private static createRuntime(spans: SpanTable): runtime.Runtime {
        const vars = new runtime.simple.SimpleVars();
        this.vars = vars;
        const rt = new runtime.Runtime({
            spans,
            actionBehaviors: createActionBehaviors(vars),
            conditionBehaviors: createConditionBehaviors(vars),
            placeholderBehaviors: createPlaceholderBehaviors(vars),
            onDiagnostic: (diag) => printDiagnostic(this.sm, diag),
        });
        setSimulatorRuntime(rt, vars);

        for (const importable of this.importables) {
            if (importable.type !== "FUNCTION") continue;
            if (!importable.actions || !importable.repeatTicks) continue;

            rt.schedulers.push(
                new runtime.RepeatingActionScheduler(
                    importable.actions,
                    importable.repeatTicks
                )
            );
        }

        return rt;
    }

    private static registerTriggers(): void {
        this.triggers = [
            register("tick", this.tick.bind(this)),
            ...registerCommandTriggers(),
            ...registerEventTriggers(),
            ...registerRegionTriggers(),
        ];
    }

    static runActions(actions: types.Action[], childCtx: boolean = false) {
        runSimulatorActions(actions, childCtx);
    }

    private static tick(): void {
        this.runtime.tick();
    }
}
