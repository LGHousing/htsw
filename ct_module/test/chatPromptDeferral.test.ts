import { describe, expect, it } from "vitest";

import {
    abandonChatPromptDeferral,
    beginChatPromptDeferral,
    deferPlayerChat,
    finishChatPromptDeferral,
} from "../src/tasks/chatPromptDeferral";

describe("Housing chat prompt deferral", () => {
    it("holds player chat until the prompt closes", () => {
        const owner = {};

        beginChatPromptDeferral(owner);
        try {
            expect(deferPlayerChat("first")).toBe(true);
            expect(deferPlayerChat("second")).toBe(true);
            expect(finishChatPromptDeferral(owner)).toEqual(["first", "second"]);
            expect(deferPlayerChat("after")).toBe(false);
        } finally {
            abandonChatPromptDeferral(owner);
        }
    });
});
