import { getAutoRun } from "@htsw/importer/settings";
import { setAutoRunEnabled } from "@htsw/importer/runtime/autoRun";

export function commandWatch(args: string[]): void {
    const action = (args[0] ?? "").toLowerCase();
    if (action === "on") {
        setAutoRunEnabled(true);
        return;
    }
    if (action === "off") {
        setAutoRunEnabled(false);
        return;
    }
    ChatLib.chat(`&7[htsw] Auto-run is ${getAutoRun() ? "&aon" : "&coff"}&7.`);
    ChatLib.chat("&7[htsw] Usage: /htsw watch <on|off>");
}
