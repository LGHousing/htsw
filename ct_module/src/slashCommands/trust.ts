import { isHouseTrusted, setHouseTrust } from "../runtime/state/trust";
import { emitBridgeEvent } from "../bridge/status";
import { withCurrentHouse } from "./currentHouse";

type TrustAction = "status" | "on" | "off";

function trustFailure(reason: string): void {
    emitBridgeEvent("htsw_setting", { setting: "trust", status: "failed", reason });
    ChatLib.chat(`[htsw] Trust change failed: ${reason}`);
}

function applyTrustAction(uuid: string, action: TrustAction): void {
    if (action === "status") {
        ChatLib.chat(
            `[htsw] Trust: ${isHouseTrusted(uuid) ? "ON" : "OFF"} · house ${uuid}`
        );
        return;
    }
    const enabled = action === "on";
    if (!setHouseTrust(uuid, enabled)) {
        trustFailure("could not save trust setting");
        return;
    }
    ChatLib.chat(`[htsw] Trust set to ${enabled ? "ON" : "OFF"} · house ${uuid}`);
    emitBridgeEvent("htsw_setting", {
        setting: "trust",
        status: "completed",
        value: enabled,
        house: uuid,
    });
}

export function commandTrust(args: string[]): void {
    const action = args.length === 0 ? "status" : args[0].toLowerCase();
    if (args.length > 1 || (action !== "status" && action !== "on" && action !== "off")) {
        trustFailure("expected status, on, or off");
        return;
    }

    withCurrentHouse((uuid) => applyTrustAction(uuid, action), trustFailure);
}
