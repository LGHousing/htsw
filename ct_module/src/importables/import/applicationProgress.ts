import type { ActionListPlan } from "../../housingSync/actions/plan";
import type { ActionSyncContext } from "../../housingSync/actions/syncContext";
import type {
    ProgressScope,
    SyncEvent,
    SyncEventHandler,
} from "../../housingSync/syncEvents";

export type ApplicationStep = {
    key: string;
    kind: "work" | "actionList";
    units: number;
};

export type ApplicationPlan = {
    steps: readonly ApplicationStep[];
    totalUnits: number;
};

export function workStep(key: string, units: number): ApplicationStep {
    return { key, kind: "work", units };
}

export function actionListStep(key: string, plan: ActionListPlan): ApplicationStep {
    return { key, kind: "actionList", units: plan.phaseUnits.applying };
}

export function defineApplicationPlan(
    steps: readonly ApplicationStep[]
): ApplicationPlan {
    const keys = new Set<string>();
    let totalUnits = 0;
    for (const step of steps) {
        if (keys.has(step.key)) {
            throw new Error(`Duplicate application step "${step.key}".`);
        }
        if (!isFinite(step.units) || step.units < 0) {
            throw new Error(
                `Application step "${step.key}" has invalid units ${step.units}.`
            );
        }
        keys.add(step.key);
        totalUnits += step.units;
    }
    return { steps: steps.slice(), totalUnits };
}

export class ApplicationProgress {
    private readonly stepsByKey = new Map<string, ApplicationStep>();
    private readonly completedKeys = new Set<string>();
    private completedUnits = 0;
    private nextStepIndex = 0;

    public constructor(
        private readonly plan: ApplicationPlan,
        private readonly events: SyncEventHandler | undefined
    ) {
        for (const step of plan.steps) this.stepsByKey.set(step.key, step);
    }

    public async run<T>(key: string, work: () => Promise<T>): Promise<T> {
        this.requireStep(key, "work");
        const result = await work();
        this.complete(key);
        return result;
    }

    public async runActionList<T>(
        key: string,
        plan: ActionListPlan,
        sync: ActionSyncContext,
        work: (sync: ActionSyncContext) => Promise<T>
    ): Promise<T> {
        const step = this.requireStep(key, "actionList");
        if (Math.abs(step.units - plan.phaseUnits.applying) > 1e-6) {
            throw new Error(
                `Action-list application step "${key}" planned ${step.units} units but received ${plan.phaseUnits.applying}.`
            );
        }
        const baselineUnits = this.completedUnits;
        const sourceEvents = sync.events;
        const translatedEvents: SyncEventHandler | undefined =
            sourceEvents === undefined && this.events === undefined
                ? undefined
                : {
                      emit: (event) => {
                          if (event.kind !== "progress") {
                              sourceEvents?.emit(event);
                              return;
                          }
                          this.events?.emit({
                              kind: "applicationProgress",
                              completedUnits:
                                  baselineUnits +
                                  Math.min(
                                      step.units,
                                      actionListApplicationUnits(
                                          event.scope,
                                          event.progress
                                      )
                                  ),
                              sync: event.progress.sync,
                          });
                      },
                  };
        const result = await work({ ...sync, events: translatedEvents });
        this.complete(key);
        return result;
    }

    public complete(key: string): void {
        const step = this.requireStep(key);
        if (this.completedKeys.has(key)) {
            throw new Error(`Application step "${key}" completed twice.`);
        }
        this.completedKeys.add(key);
        this.completedUnits += step.units;
        this.nextStepIndex++;
        this.emit(null);
    }

    public assertComplete(): void {
        if (this.completedKeys.size === this.plan.steps.length) return;
        const missing = this.plan.steps
            .filter((step) => !this.completedKeys.has(step.key))
            .map((step) => step.key);
        throw new Error(`Application plan did not complete: ${missing.join(", ")}.`);
    }

    private requireStep(key: string, kind?: ApplicationStep["kind"]): ApplicationStep {
        const step = this.stepsByKey.get(key);
        if (step === undefined) {
            throw new Error(`Unknown application step "${key}".`);
        }
        if (kind !== undefined && step.kind !== kind) {
            throw new Error(
                `Application step "${key}" is ${step.kind}, expected ${kind}.`
            );
        }
        if (
            this.nextStepIndex >= this.plan.steps.length ||
            this.plan.steps[this.nextStepIndex].key !== key
        ) {
            const expected =
                this.nextStepIndex < this.plan.steps.length
                    ? this.plan.steps[this.nextStepIndex].key
                    : "none";
            throw new Error(
                `Application step "${key}" ran out of order; expected "${expected}".`
            );
        }
        return step;
    }

    private emit(
        sync: Extract<SyncEvent, { kind: "applicationProgress" }>["sync"]
    ): void {
        this.events?.emit({
            kind: "applicationProgress",
            completedUnits: this.completedUnits,
            sync,
        });
    }
}

function actionListApplicationUnits(
    scope: ProgressScope,
    progress: Extract<SyncEvent, { kind: "progress" }>["progress"]
): number {
    if (scope.kind === "childList") {
        return scope.baselineApplyUnits + Math.max(0, progress.completedUnits);
    }
    return Math.max(
        0,
        progress.completedUnits -
            progress.phaseUnits.reading -
            progress.phaseUnits.hydrating
    );
}
