import { describe, expect, it } from "vitest";

import TaskContext from "../src/tasks/context";

const NUL = String.fromCharCode(0);

// The guard inspects the wire payload, so reported indexes include the
// "/ac " prefix sendMessage adds.
describe("illegal chat character guard", () => {
    it("refuses a field value carrying a control character", async () => {
        const ctx = new TaskContext();

        await expect(ctx.sendMessage(`&l${NUL}<deferred>`)).rejects.toThrow(
            /NUL U\+0000 at index 6/
        );
    });

    it("refuses a field value carrying a section sign", async () => {
        const ctx = new TaskContext();

        await expect(ctx.sendMessage("§aHello")).rejects.toThrow(
            /section sign\) U\+00A7 at index 4/
        );
    });

    it("refuses a command carrying a control character", async () => {
        const ctx = new TaskContext();

        await expect(ctx.runCommand(`/chatinput ${NUL}`)).rejects.toThrow(
            /NUL U\+0000 at index 11/
        );
    });
});
