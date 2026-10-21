import type TaskContext from "../../tasks/context";
import type { WaitForPromise } from "../../tasks/specifics/waitFor";
import { removedFormatting } from "../../utils/helpers";

const REPLY_WINDOW_MS = 1500;

// Only observed Housing replies, scoped to the input they answer. House
// functions can print arbitrary chat, including sentences that sound like errors.
export function housingTextRejection(message: string, field: string): string | null {
    const text = removedFormatting(message).trim();
    if (
        field === "Variable" &&
        text === "The stat key provided contains blocked words! (1)"
    ) {
        return text;
    }
    if (
        field === "Command name" &&
        (text === "This command is not valid!" ||
            text === "This command already exists!" ||
            text === "This command is not valid! This command already exists!")
    ) {
        return text;
    }
    return null;
}

export class HousingTextRejectedError extends Error {
    constructor(
        field: string,
        value: string,
        public readonly reason: string,
        actual?: string
    ) {
        const detail = /contains blocked words/i.test(reason)
            ? `Hypixel's chat filter rejected ${JSON.stringify(value)} for ${field}; rename it`
            : actual !== undefined
              ? `Housing did not apply ${field}: expected ${JSON.stringify(value)}, read ${JSON.stringify(actual)}`
              : `Housing rejected ${JSON.stringify(value)} for ${field}: ${reason}`;
        super(`HTSW_INPUT_REJECTED: ${detail}`);
        this.name = "HousingTextRejectedError";
    }
}

export type TextReadBack = {
    read(): string | null;
    matches(actual: string, expected: string): boolean;
};

/** Read-back decides success when available; chat only explains a mismatch. */
export async function submitHousingText<T>(
    ctx: TaskContext,
    field: string,
    value: string,
    send: (onSent: () => void) => unknown,
    confirm: () => WaitForPromise<T>,
    readBack?: TextReadBack
): Promise<T> {
    const state: { reason: string | null; known: boolean } = {
        reason: null,
        known: false,
    };
    let refusal: WaitForPromise<unknown> | undefined;
    let expiry: WaitForPromise<unknown> | undefined;
    let confirmation: WaitForPromise<T> | undefined;
    const onSent = (): void => {
        const deadline = Date.now() + REPLY_WINDOW_MS;
        refusal = ctx.waitFor("message", (message) => {
            if (Date.now() >= deadline) return false;
            const reason = housingTextRejection(message, field);
            if (reason !== null) {
                state.reason = reason;
                state.known = true;
                return true;
            }
            // A broader filter hint can explain a verified mismatch, but must
            // never fail an unreadable field on its own.
            const text = removedFormatting(message).trim();
            if (readBack !== undefined && /contains blocked words/i.test(text)) {
                state.reason = text;
            }
            return false;
        });
        expiry = ctx.waitFor("tick", () => Date.now() >= deadline);
        void expiry.then(() => refusal?.cleanupWaiter?.());
    };
    const rejection = () =>
        new HousingTextRejectedError(
            field,
            value,
            state.reason ?? "Housing rejected the input"
        );
    try {
        // Confirmation must still be armed before the send. Rejection chat
        // starts at onSent, after any sender cooldown and the actual send.
        confirmation = confirm();
        confirmation.catch(() => {});
        await send(onSent);
        if (readBack !== undefined) {
            const result = await confirmation;
            const actual = readBack.read();
            if (actual !== null) {
                if (!readBack.matches(actual, value)) {
                    throw new HousingTextRejectedError(
                        field,
                        value,
                        state.reason ?? "Read-back mismatch",
                        actual
                    );
                }
            } else if (state.known) {
                throw rejection();
            }
            return result;
        }
        if (state.reason !== null) throw rejection();
        if (refusal === undefined) return await confirmation;
        return await ctx.race<T>([
            [confirmation, confirmation],
            [
                refusal.then(() => {
                    throw rejection();
                }),
                refusal,
            ],
        ]);
    } finally {
        refusal?.cleanupWaiter?.();
        expiry?.cleanupWaiter?.();
        confirmation?.cleanupWaiter?.();
    }
}
