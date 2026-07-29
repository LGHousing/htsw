import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTaskCancelledError } from "../src/tasks/cancellation";
import type TaskContext from "../src/tasks/context";

const mocks = vi.hoisted(() => ({
    chats: [] as string[],
    popover: null as null | {
        onConfirm: () => void;
        onClose?: () => void;
    },
}));

vi.mock("../src/gui/popovers/confirm", () => ({
    openConfirmPopover: (options: NonNullable<typeof mocks.popover>) => {
        mocks.popover = options;
    },
    closeConfirmPopover: () => {
        const popover = mocks.popover;
        mocks.popover = null;
        popover?.onClose?.();
    },
}));

import {
    answerConflictPrompt,
    openAnswerableConflictPrompt,
} from "../src/gui/popovers/conflictPrompt";

const options = {
    chatMessage:
        "[htsw] Import conflict: 1 importable changed in Housing — awaiting confirmation\n" +
        '[htsw] Conflict: FUNCTION "Debug" · actions',
    chatConfirmAction: "import anyway",
    chatRefuseAction: "cancel the import",
    title: "Housing changed since your last import",
    lines: ['FUNCTION "Debug"'],
    confirmLabel: "Import anyway",
};

function promptId(): string {
    const instruction = mocks.chats.find((line) =>
        line.startsWith("[htsw] Type /htsw answer ")
    );
    const match = instruction?.match(/answer ([^ ]+) yes/);
    if (match === undefined || match === null) throw new Error("missing prompt ID");
    return match[1];
}

function waitingContext(): TaskContext {
    return {
        sleep: async () => Promise.resolve(),
    } as unknown as TaskContext;
}

beforeEach(() => {
    mocks.chats = [];
    mocks.popover = null;
    vi.stubGlobal("ChatLib", {
        chat: (line: string) => mocks.chats.push(line),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("answerable conflict prompt", () => {
    it("resolves from a typed chat answer and ignores the popover close", async () => {
        const result = openAnswerableConflictPrompt(waitingContext(), options);
        const popover = mocks.popover;

        answerConflictPrompt([promptId(), "yes"]);
        popover?.onClose?.();

        await expect(result).resolves.toBe(true);
        expect(mocks.popover).toBeNull();
        expect(mocks.chats).toEqual([
            options.chatMessage,
            expect.stringMatching(
                /^\[htsw] Type \/htsw answer \S+ yes to import anyway or \/htsw answer \S+ no to cancel the import\.$/
            ),
        ]);
    });

    it("resolves from a GUI click and rejects a later chat answer", async () => {
        const result = openAnswerableConflictPrompt(waitingContext(), options);
        const id = promptId();

        mocks.popover?.onConfirm();
        answerConflictPrompt([id, "no"]);

        await expect(result).resolves.toBe(true);
        expect(mocks.chats).toContain(
            `[htsw] Conflict prompt ${id} is expired or unknown.`
        );
    });

    it("rejects a stale identifier without resolving the active prompt", async () => {
        const result = openAnswerableConflictPrompt(waitingContext(), options);
        const id = promptId();
        const popover = mocks.popover;

        answerConflictPrompt(["older-prompt", "yes"]);
        expect(mocks.chats).toContain(
            "[htsw] Conflict prompt older-prompt is expired or unknown."
        );
        expect(mocks.popover).toBe(popover);

        answerConflictPrompt([id, "no"]);
        await expect(result).resolves.toBe(false);
    });

    it("treats task cancellation while unanswered as a refusal", async () => {
        const ctx = {
            sleep: async () => {
                throw createTaskCancelledError();
            },
        } as unknown as TaskContext;

        await expect(openAnswerableConflictPrompt(ctx, options)).resolves.toBe(false);
        expect(mocks.popover).toBeNull();
    });
});
