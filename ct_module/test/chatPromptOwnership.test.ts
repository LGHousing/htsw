import { describe, expect, it } from "vitest";

import {
    abandonChatPromptOwnership,
    beginChatPromptOwnership,
    deferUnownedChat,
    finishChatPromptOwnership,
    markOwnedChatPacket,
} from "../src/tasks/chatPromptOwnership";

describe("Housing chat prompt ownership", () => {
    it("defers player chat, allows importer chat, and replays in order", async () => {
        const owner = {};
        const firstPlayerMessage = { message: "first" };
        const importerMessage = { message: "import value" };
        const secondPlayerMessage = { message: "second" };
        const messageSentDuringReplay = { message: "during replay" };
        const replayed: Array<{ message: string }> = [];

        beginChatPromptOwnership(owner);
        try {
            expect(deferUnownedChat(firstPlayerMessage)).toBe(true);
            markOwnedChatPacket(owner, importerMessage);
            expect(deferUnownedChat(importerMessage)).toBe(false);
            expect(deferUnownedChat(secondPlayerMessage)).toBe(true);

            await expect(
                finishChatPromptOwnership(owner, async (packet) => {
                    markOwnedChatPacket(owner, packet);
                    expect(deferUnownedChat(packet)).toBe(false);
                    replayed.push(packet as { message: string });
                    if (packet === firstPlayerMessage) {
                        expect(deferUnownedChat(messageSentDuringReplay)).toBe(true);
                    }
                })
            ).resolves.toBe(3);
            expect(replayed).toEqual([
                firstPlayerMessage,
                secondPlayerMessage,
                messageSentDuringReplay,
            ]);
            expect(deferUnownedChat({ message: "after" })).toBe(false);
        } finally {
            abandonChatPromptOwnership(owner);
        }
    });
});
