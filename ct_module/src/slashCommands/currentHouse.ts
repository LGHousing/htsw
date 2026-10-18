import { errorMessage } from "../utils/helpers";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { getHousingUuid, setHousingUuid } from "../runtime/state/index";
import { runHousingSyncTask } from "../housingSync/taskRunner";

/**
 * Calls `use` with the house the player is in. Without a cached UUID (no
 * container opened since joining, or the headless entry, which has no
 * overlay probe) it asks /wtfmap in a short task first.
 */
export function withCurrentHouse(
    use: (uuid: string) => void,
    fail: (reason: string) => void
): void {
    const cached = getHousingUuid();
    if (cached !== null) {
        use(cached);
        return;
    }
    void runHousingSyncTask(
        "import",
        async (ctx) => {
            const uuid = await getCurrentHousingUuid(ctx);
            setHousingUuid(uuid);
            return uuid;
        },
        { disabled: true }
    )
        .then((uuid) => {
            if (uuid !== undefined) use(uuid);
        })
        .catch((error: unknown) =>
            fail(errorMessage(error))
        );
}
