import type { ImportEventHandler } from "../importEvents";

/**
 * Build a setup-step emitter for one importable's per-type import.
 *
 * The five `importables/<type>/import.ts` files all need to fire
 * monotonically-numbered `setupStep` events against a known total —
 * this helper collapses the bookkeeping (counter + total + emit shape)
 * into one call per step:
 *
 *   const setup = createSetupStepEmitter(events, totalSteps);
 *   setup("ensuring function exists");
 *   setup("opening editor");
 *
 * Each call pre-increments and emits; no manual counter management at
 * the call site.
 */
export function createSetupStepEmitter(
    events: ImportEventHandler | undefined,
    total: number
): (label: string) => void {
    let step = 0;
    return (label: string): void => {
        events?.emit({
            kind: "setupStep",
            label,
            completed: ++step,
            total,
        });
    };
}
