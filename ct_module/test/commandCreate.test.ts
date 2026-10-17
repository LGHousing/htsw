import { beforeEach, expect, test, vi } from "vitest";

vi.mock("../src/importables/commands/listCommands", () => ({
    getSessionCommandNamesLower: vi.fn(async () => new Set<string>()),
    noteCommandCreated: vi.fn(),
    resetCommandNameSession: vi.fn(),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(),
}));

import { ensureCommandExists } from "../src/importables/commands/housing";
import {
    getSessionCommandNamesLower,
    noteCommandCreated,
    resetCommandNameSession,
} from "../src/importables/commands/listCommands";
import { timedWaitForMenu } from "../src/housingSync/menus/menuWait";
import TaskContext from "../src/tasks/context";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";

function commandContext() {
    let receive: ((message: string) => void) | undefined;
    const messageCleanup = vi.fn();
    const menuCleanup = vi.fn();
    let openMenu!: () => void;
    let failMenu!: (error: Error) => void;
    const menu = new Promise<void>((resolve, reject) => {
        openMenu = resolve;
        failMenu = reject;
    }) as WaitForPromise<void>;
    menu.cleanupWaiter = menuCleanup;
    vi.mocked(timedWaitForMenu).mockReturnValue(menu);
    const ctx = Object.create(TaskContext.prototype) as TaskContext;
    ctx.waitFor = vi.fn((_event, predicate) => {
        const promise = new Promise<[string]>((resolve) => {
            receive = (message) => {
                if ((predicate as (message: string) => boolean)(message))
                    resolve([message]);
            };
        }) as WaitForPromise<[string]>;
        promise.cleanupWaiter = messageCleanup;
        return promise;
    }) as typeof ctx.waitFor;
    const runCommand = vi.fn(async (_command: string) => {});
    ctx.runCommand = runCommand;
    return {
        ctx,
        runCommand,
        messageCleanup,
        menuCleanup,
        openMenu,
        failMenu,
        receive: (message: string) => receive!(message),
    };
}

beforeEach(() => vi.clearAllMocks());

test.each([
    ["  This command is not valid!  ", "This command is not valid!"],
    // Any reason with the observed refusal prefix is handled without guessing
    // Housing's other reason texts.
    ["This command is not valid! A server-supplied reason.", "A server-supplied reason."],
])(
    "rejects command creation immediately for %s, even during send",
    async (reply, reason) => {
        const { ctx, runCommand, receive, messageCleanup, menuCleanup } =
            commandContext();
        runCommand.mockImplementation(async () => receive(reply));

        await expect(ensureCommandExists(ctx, "tpa")).rejects.toThrow(
            `command name rejected by Housing: ${reason}`
        );

        expect(runCommand).toHaveBeenCalledExactlyOnceWith("/command create tpa");
        expect(noteCommandCreated).not.toHaveBeenCalled();
        expect(resetCommandNameSession).not.toHaveBeenCalled();
        expect(getSessionCommandNamesLower).toHaveBeenCalledTimes(1);
        expect(messageCleanup).toHaveBeenCalled();
        expect(menuCleanup).toHaveBeenCalled();
    }
);

for (const reply of [
    "§cThis command is not valid! This command already exists!",
    "This command already exists!",
]) {
    test(`uses the existing command when a create race becomes visible: ${reply}`, async () => {
        const { ctx, runCommand, receive, messageCleanup, menuCleanup } =
            commandContext();
        vi.mocked(getSessionCommandNamesLower)
            .mockResolvedValueOnce(new Set())
            .mockImplementationOnce(async () => {
                expect(resetCommandNameSession).toHaveBeenCalledTimes(1);
                expect(messageCleanup).toHaveBeenCalled();
                expect(menuCleanup).toHaveBeenCalled();
                return new Set(["tpa"]);
            });
        runCommand.mockImplementation(async () => receive(reply));
        await expect(ensureCommandExists(ctx, "TPA")).resolves.toBe("existing");
        expect(getSessionCommandNamesLower).toHaveBeenCalledTimes(2);
        expect(runCommand).toHaveBeenCalledExactlyOnceWith("/command create TPA");
        expect(noteCommandCreated).not.toHaveBeenCalled();
    });

    test(`refuses an already-existing command only after one fresh list still hides it: ${reply}`, async () => {
        const { ctx, runCommand, receive } = commandContext();
        runCommand.mockImplementation(async () => receive(reply));
        await expect(ensureCommandExists(ctx, "home")).rejects.toThrow(
            "command name rejected by Housing: already exists (not visible in Commands)"
        );
        expect(resetCommandNameSession).toHaveBeenCalledTimes(1);
        expect(getSessionCommandNamesLower).toHaveBeenCalledTimes(2);
        expect(runCommand).toHaveBeenCalledExactlyOnceWith("/command create home");
        expect(noteCommandCreated).not.toHaveBeenCalled();
    });
}

test("preserves a failed Commands refresh instead of claiming a hidden collision", async () => {
    const { ctx, runCommand, receive } = commandContext();
    const error = new Error("Timed out reading Commands");
    vi.mocked(getSessionCommandNamesLower)
        .mockResolvedValueOnce(new Set())
        .mockRejectedValueOnce(error);
    runCommand.mockImplementation(async () => receive("This command already exists!"));
    await expect(ensureCommandExists(ctx, "home")).rejects.toBe(error);
    expect(getSessionCommandNamesLower).toHaveBeenCalledTimes(2);
    expect(resetCommandNameSession).toHaveBeenCalledTimes(1);
    expect(noteCommandCreated).not.toHaveBeenCalled();
});

test("creates a command on menu success, ignoring unrelated chat", async () => {
    const { ctx, runCommand, receive, openMenu, messageCleanup, menuCleanup } =
        commandContext();
    runCommand.mockImplementation(async () => {
        receive("Player: This command is not valid! This command already exists!");
        openMenu();
    });
    await expect(ensureCommandExists(ctx, "new")).resolves.toBe("created");
    expect(noteCommandCreated).toHaveBeenCalledExactlyOnceWith("new");
    expect(messageCleanup).toHaveBeenCalled();
    expect(menuCleanup).toHaveBeenCalled();
});

test("keeps permission/timeout failures and cleans the refusal listener", async () => {
    const { ctx, runCommand, failMenu, messageCleanup } = commandContext();
    const error = new Error(
        "Housing rejected the command: you do not have permission to use it in this house."
    );
    runCommand.mockImplementation(async () => failMenu(error));
    await expect(ensureCommandExists(ctx, "new")).rejects.toBe(error);
    expect(messageCleanup).toHaveBeenCalled();
    expect(noteCommandCreated).not.toHaveBeenCalled();
});

test("cleans the refusal listener if sending fails", async () => {
    const { ctx, runCommand, messageCleanup } = commandContext();
    runCommand.mockRejectedValue(new Error("cancelled"));
    await expect(ensureCommandExists(ctx, "new")).rejects.toThrow("cancelled");
    expect(messageCleanup).toHaveBeenCalled();
    expect(timedWaitForMenu).not.toHaveBeenCalled();
});

test("leaves commands found in the list alone", async () => {
    const { ctx, runCommand } = commandContext();
    vi.mocked(getSessionCommandNamesLower).mockResolvedValueOnce(new Set(["tpa"]));
    await expect(ensureCommandExists(ctx, "TPA")).resolves.toBe("existing");
    expect(runCommand).not.toHaveBeenCalled();
    expect(ctx.waitFor).not.toHaveBeenCalled();
});
