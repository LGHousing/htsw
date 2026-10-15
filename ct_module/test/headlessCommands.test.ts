import { expect, test, vi } from "vitest";

test("the headless command set leaves out watch, which needs the overlay's save polling", async () => {
    const commands = new Map<string, (...args: string[]) => void>();
    const chat: string[] = [];
    const trigger: Record<string, unknown> = new Proxy({}, { get: () => () => trigger });
    vi.stubGlobal("register", (type: string, run: (...args: string[]) => void) => ({
        setName: (name: string) => {
            if (type === "command") commands.set(name, run);
            return trigger;
        },
    }));
    vi.stubGlobal("ChatLib", {
        chat: (line: string) => chat.push(line),
        getCenteredText: (line: string) => line,
    });

    const { registerSlashCommands } = await import("../src/slashCommands/index");
    registerSlashCommands();
    commands.get("htsw")!("watch", "on");

    expect(chat).toContain("&cUnknown /htsw subcommand 'watch'.");
    expect(chat.some((line) => line.indexOf("/htsw watch") >= 0)).toBe(false);
    expect(chat.some((line) => line.indexOf("/htsw export") >= 0)).toBe(true);
});
