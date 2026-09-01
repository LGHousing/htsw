export type HtswGuiState = {
    enabled: boolean;
    visible: boolean;
};

type HtswGuiCommandAction = "toggle" | "enable" | "disable" | "none";

export type HtswGuiCommandResult = {
    action: HtswGuiCommandAction;
    message: string;
};

function stateMessage(state: HtswGuiState): string {
    if (!state.enabled) {
        return "&e[htsw] gui &cdisabled &7(use /htsw gui on)";
    }
    if (state.visible) return "&e[htsw] gui &aenabled &7(visible)";
    return (
        "&e[htsw] gui &aenabled " +
        "&7(draws over open Housing menus; not visible now because no menu is open)"
    );
}

export function resolveHtswGuiCommand(
    state: HtswGuiState,
    args: string[]
): HtswGuiCommandResult {
    const argument = args.length === 0 ? "" : args[0].toLowerCase();
    if (argument === "") return { action: "toggle", message: stateMessage(state) };
    if (argument === "on") return { action: "enable", message: stateMessage(state) };
    if (argument === "off") return { action: "disable", message: stateMessage(state) };
    if (argument === "status") return { action: "none", message: stateMessage(state) };

    const current = state.enabled
        ? state.visible
            ? "&aenabled&7; visible"
            : "&aenabled&7; draws over open Housing menus; not visible now because no menu is open"
        : "&cdisabled&7; use /htsw gui on";
    return {
        action: "none",
        message: `&cUsage: /htsw gui [on|off|status] &7(current state: ${current})`,
    };
}
