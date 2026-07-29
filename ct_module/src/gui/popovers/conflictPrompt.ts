import type TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/cancellation";
import { closeConfirmPopover, openConfirmPopover } from "./confirm";

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
        ChatLib.chat("&cUsage: /htsw answer <id> <yes|no>");
        return;
    }
    const prompt = activePrompt;
    if (prompt === null || prompt.id !== args[0]) {
        ChatLib.chat(`[htsw] Conflict prompt ${args[0]} is expired or unknown.`);
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
        closeConfirmPopover();
    };
    activePrompt = { id, answer };

    ChatLib.chat(options.chatMessage);
    ChatLib.chat(
        `[htsw] Type /htsw answer ${id} yes to ${options.chatConfirmAction} ` +
            `or /htsw answer ${id} no to ${options.chatRefuseAction}.`
    );
    openConfirmPopover({
        title: options.title,
        lines: options.lines,
        confirmLabel: options.confirmLabel,
        extraLabel: options.extraLabel,
        cancelLabel: options.cancelLabel,
        danger: options.danger,
        onConfirm: () => answer(true),
        onExtra:
            options.onExtra === undefined
                ? undefined
                : () => {
                      options.onExtra?.();
                      answer(false);
                  },
        onClose: () => answer(false),
    });

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
