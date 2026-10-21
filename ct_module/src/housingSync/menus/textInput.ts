import type TaskContext from "../../tasks/context";
import type { WaitForPromise } from "../../tasks/specifics/waitFor";
import { removedFormatting } from "../../utils/helpers";

export function housingTextRejection(message: string): string | null {
    const text = removedFormatting(message).trim();
    // Anchor on server sentences: a player's chat quoting an error must not
    // reject the field currently being imported.
    if (
        /^(?:The|This|That|Your) [^:!\n]+ contains blocked words\b/i.test(text) ||
        /^This .+ is not valid!/.test(text) ||
        /^(?:The|This|That) [^:!\n]+ already exists!/.test(text) ||
        /^(?:The|This|That|Your) [^:!\n]+ (?:is (?:invalid|too long|too short)|(?:can only|may only|must|cannot|can't) contain)\b/i.test(
            text
        )
    ) {
        return text;
    }
    return null;
}

export class HousingTextRejectedError extends Error {
    constructor(
        field: string,
        value: string,
        public readonly reason: string
    ) {
        super(
            /contains blocked words/i.test(reason)
                ? `Hypixel's chat filter rejected ${JSON.stringify(value)} for ${field}; rename it`
                : `Housing rejected ${JSON.stringify(value)} for ${field}: ${reason}`
        );
        this.name = "HousingTextRejectedError";
    }
}

/** Listen before sending, and keep listening until the server confirms. */
export async function submitHousingText<T>(
    ctx: TaskContext,
    field: string,
    value: string,
    send: () => unknown,
    confirm: () => WaitForPromise<T>
): Promise<T> {
    const state: { rejection: HousingTextRejectedError | null } = { rejection: null };
    const throwIfRejected = (): void => {
        if (state.rejection !== null) throw state.rejection;
    };
    const refusal = ctx.waitFor("message", (message) => {
        const reason = housingTextRejection(message);
        if (reason === null) return false;
        state.rejection = new HousingTextRejectedError(field, value, reason);
        return true;
    });
    let confirmation: WaitForPromise<T> | undefined;
    try {
        // Also arm the confirmation before sending; fast connections can
        // deliver the menu while sendMessage/runCommand is still returning.
        confirmation = confirm();
        confirmation.catch(() => {});
        await send();
        throwIfRejected();
        const result = await ctx.race<T>([
            [confirmation, confirmation],
            [
                refusal.then(([message]) => {
                    throw new HousingTextRejectedError(
                        field,
                        value,
                        removedFormatting(message).trim()
                    );
                }),
                refusal,
            ],
        ]);
        throwIfRejected();
        return result;
    } finally {
        refusal.cleanupWaiter?.();
        confirmation?.cleanupWaiter?.();
    }
}
