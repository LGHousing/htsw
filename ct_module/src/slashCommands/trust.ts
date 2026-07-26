import { getCurrentHousingUuid } from "../importCache/housingId";
import { getHousingUuid, setHousingUuid } from "../gui/state/housing";
import { isHouseTrusted, setHouseTrust } from "../gui/state/trust";
import { runHousingSyncTask } from "../housingSync/taskRunner";

type TrustAction = "status" | "on" | "off";

function trustFailure(reason: string): void {
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
}

function errorReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function commandTrust(args: string[]): void {
    const action = args.length === 0 ? "status" : args[0].toLowerCase();
    if (args.length > 1 || (action !== "status" && action !== "on" && action !== "off")) {
        trustFailure("expected status, on, or off");
        return;
    }

    const cached = getHousingUuid();
    if (cached !== null) {
        applyTrustAction(cached, action);
        return;
    }

    void runHousingSyncTask("import", async (ctx) => {
        const uuid = await getCurrentHousingUuid(ctx);
        setHousingUuid(uuid);
        applyTrustAction(uuid, action);
    }).catch((error: unknown) => trustFailure(errorReason(error)));
}
