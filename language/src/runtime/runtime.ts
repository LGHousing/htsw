import { Diagnostic } from "../diagnostic";
import type { SpanTable } from "../spanTable";
import type { Action, Condition } from "../types";
import {
    ActionBehaviors,
    ConditionBehaviors,
    PlaceholderBehaviors,
    RuntimeExitSignal,
    RuntimePauseSignal,
    type PlaceholderInvocation,
} from "./behaviors/index";
import { DelayedActionScheduler, type ActionScheduler } from "./schedulers";
import { VarHolder, type TeamVarKey, type Var } from "./vars";

export type RuntimeConfig = {
    spans: SpanTable;
    
    actionBehaviors?: ActionBehaviors;
    conditionBehaviors?: ConditionBehaviors;
    placeholderBehaviors?: PlaceholderBehaviors;
    onDiagnostic?: (diagnostic: Diagnostic) => void;
};

export class Runtime {
    readonly spans: SpanTable;
    readonly actionBehaviors: ActionBehaviors;
    readonly conditionBehaviors: ConditionBehaviors;
    readonly placeholderBehaviors: PlaceholderBehaviors;

    readonly diagnostics: Diagnostic[] = [];
    readonly schedulers: ActionScheduler[] = [];
    readonly playerVars = new VarHolder<string>();
    readonly globalVars = new VarHolder<string>();
    readonly teamVars = new VarHolder<TeamVarKey>();

    private readonly onDiagnostic?: (diagnostic: Diagnostic) => void;

    constructor(config: RuntimeConfig) {
        this.spans = config.spans;
        this.actionBehaviors = config.actionBehaviors ?? ActionBehaviors.default();
        this.conditionBehaviors = config.conditionBehaviors ?? ConditionBehaviors.default();
        this.placeholderBehaviors = config.placeholderBehaviors ?? PlaceholderBehaviors.default();
        this.onDiagnostic = config.onDiagnostic;
    }

    tick(): void {
        const active: ActionScheduler[] = [];
        for (const scheduler of this.schedulers) {
            const actions = scheduler.tick();
            if (actions) this.runActions(actions);
            if (scheduler.hasNext()) active.push(scheduler);
        }
        this.schedulers.splice(0, this.schedulers.length, ...active);
    }

    runActions(actions: Action[], childCtx: boolean = false): void {
        for (let i = 0; i < actions.length; i++) {
            try {
                this.runAction(actions[i]);
            } catch (err) {
                if (err instanceof RuntimeExitSignal) {
                    if (childCtx) throw err;
                    return;
                }

                if (err instanceof RuntimePauseSignal) {
                    const remaining = actions.slice(i + 1);
                    const continuation = [...err.continuation, ...remaining];
                    if (childCtx) {
                        throw new RuntimePauseSignal(err.ticks, continuation);
                    }

                    if (continuation.length > 0) {
                        this.schedulers.push(
                            new DelayedActionScheduler(continuation, err.ticks),
                        );
                    }
                    return;
                }

                throw err;
            }
        }
    }

    runAction<T extends Action>(action: T): void {
        const result = this.actionBehaviors.dispatch(this, action);
        if (result === undefined && !this.actionBehaviors.get(action.type)) {
            this.addDiagnostic(
                Diagnostic.warning(`No runtime behavior for action '${action.type}'`),
                action,
                "type"
            );
            return;
        }
    }

    runCondition<T extends Condition>(condition: T): boolean {
        const result = this.conditionBehaviors.dispatch(this, condition);
        if (result === undefined && !this.conditionBehaviors.get(condition.type)) {
            this.addDiagnostic(
                Diagnostic.warning(`No runtime behavior for condition '${condition.type}'`),
                condition,
                "type"
            );
            return false;
        }
        return condition.inverted ? !result : !!result;
    }

    runPlaceholder(raw: string): Var<any> | undefined {
        const invocation = parsePlaceholderInvocation(raw);
        return this.placeholderBehaviors.dispatch(this, invocation);
    }

    addDiagnostic(diagnostic: Diagnostic, node?: object, field?: string): void {
        this.attachSpan(diagnostic, node, field);
        this.pushDiagnostic(diagnostic);
    }

    getNodeSpan(node: object) {
        return this.spans.getNodeSpan(node);
    }

    getFieldSpan(node: object, key: string | number) {
        return this.spans.getFieldSpan(node, key);
    }

    private attachSpan(diagnostic: Diagnostic, node?: object, field?: string) {
        if (!node) return;
        const span = (field ? this.getFieldSpan(node, field) : undefined)
            ?? this.getNodeSpan(node);
        if (span) {
            diagnostic.addPrimarySpan(span);
        }
    }

    private pushDiagnostic(diagnostic: Diagnostic) {
        this.diagnostics.push(diagnostic);
        this.onDiagnostic?.(diagnostic);
    }
}

function parsePlaceholderInvocation(raw: string): PlaceholderInvocation {
    const trimmed = raw.trim();
    const slash = trimmed.indexOf("/");
    if (slash >= 0) {
        const type = trimmed.substring(0, slash);
        const argsString = trimmed.substring(slash + 1);
        let args: string[] = [];
        if (argsString) {
            args = argsString.split(" ").filter((arg) => arg !== "");
            if (args.length === 0) args = [""];
        }
        return { raw, type, args };
    }

    const [type, ...args] = trimmed.split(" ");
    return {
        raw,
        type: type ?? "",
        args,
    };
}
