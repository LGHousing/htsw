import TaskContext from "../tasks/context";

export function filterAlreadyExported(
    ctx: TaskContext,
    label: string,
    names: readonly string[],
    skipExisting: boolean | undefined,
    isComplete: (name: string) => boolean
): readonly string[] {
    if (!skipExisting || names.length === 0) return names;

    const remaining: string[] = [];
    let skipped = 0;
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (isComplete(name)) {
            skipped++;
        } else {
            remaining.push(name);
        }
    }

    if (skipped > 0) {
        ctx.displayMessage(
            `&aResume detected ${skipped} already-exported ${label}${skipped === 1 ? "" : "s"}; exporting ${remaining.length} remaining.`
        );
    }

    return remaining;
}
