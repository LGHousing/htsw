import type TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/cancellation";
import { Observers } from "../utils/observers";
import { openBridgePrompt, closeBridgePrompt } from "../bridge/status";
import { platform } from "../platform";

export type AnswerableConflictPromptOptions = {
    chatMessage: string;
    chatConfirmAction: string;
    chatRefuseAction: string;
    title: string;
    lines: string[];
    confirmLabel: string;
    extraLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onExtra?: () => void;
};

export const conflictPrompts = new Observers<
    | {
          kind: "open";
          options: AnswerableConflictPromptOptions;
          answer: (value: boolean) => void;
      }
    | { kind: "close" }
>();

type ActiveConflictPrompt = {
    id: string;
    answer: (decision: boolean) => void;
};

let activePrompt: ActiveConflictPrompt | null = null;
let nextPromptSequence = 1;

function nextPromptId(): string {
    return `${Date.now().toString(36)}-${(nextPromptSequence++).toString(36)}`;
}

export function answerConflictPrompt(args: readonly string[]): void {
    if (
        args.length !== 2 ||
        (args[1].toLowerCase() !== "yes" && args[1].toLowerCase() !== "no")
    ) {
        platform().chat("&cUsage: /htsw answer <id> <yes|no>");
        return;
    }
    const prompt = activePrompt;
    if (prompt === null || prompt.id !== args[0]) {
        platform().chat(`[htsw] Conflict prompt ${args[0]} is expired or unknown.`);
        return;
    }
    prompt.answer(args[1].toLowerCase() === "yes");
}

export async function openAnswerableConflictPrompt(
    ctx: TaskContext,
    options: AnswerableConflictPromptOptions
): Promise<boolean> {
    activePrompt?.answer(false);

    const id = nextPromptId();
    let decision: boolean | null = null;
    let handled = false;
    const currentDecision = (): boolean | null => decision;
    const answer = (value: boolean): void => {
        if (handled) return;
        handled = true;
        decision = value;
        if (activePrompt?.id === id) activePrompt = null;
        closeBridgePrompt(id);
        conflictPrompts.emit({ kind: "close" });
    };
    activePrompt = { id, answer };
    openBridgePrompt({
        promptId: id,
        confirmAction: options.chatConfirmAction,
        refuseAction: options.chatRefuseAction,
        answerYesCommand: `/htsw answer ${id} yes`,
        answerNoCommand: `/htsw answer ${id} no`,
    });

    platform().chat(options.chatMessage);
    platform().chat(
        `[htsw] Type /htsw answer ${id} yes to ${options.chatConfirmAction} ` +
            `or /htsw answer ${id} no to ${options.chatRefuseAction}.`
    );
    conflictPrompts.emit({ kind: "open", options, answer });

    try {
        for (;;) {
            const current = currentDecision();
            if (current !== null) return current;
            try {
                await ctx.sleep(50);
            } catch (error) {
                if (!isTaskCancelled(error)) throw error;
                answer(false);
            }
        }
    } finally {
        answer(false);
    }
}
