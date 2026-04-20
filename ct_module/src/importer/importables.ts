import {
    Importable,
    ImportableEvent,
    ImportableFunction,
    ImportableItem,
    ImportableRegion,
    Pos,
} from "htsw/types";

import { syncActionList } from "./actions";
import TaskContext from "../tasks/context";
import {
    getSlotPaginate,
    clickGoBack,
    waitForMenu,
    waitForUnformattedMessage,
    setNumberValue,
    parseLoreKeyValueLine,
} from "./helpers";
import { MouseButton } from "../tasks/specifics/slots";
import { cyrb53, removedFormatting } from "../utils/helpers";
import { getItemFromNbt } from "../utils/nbt";
import { C09PacketHeldItemChange, C10PacketCreativeInventoryAction } from "../utils/packets";

export async function importImportable(
    ctx: TaskContext,
    importable: Importable,
): Promise<void> {
    if (importable.type === "FUNCTION") {
        return importImportableFunction(ctx, importable);
    }
    if (importable.type === "EVENT") {
        return importImportableEvent(ctx, importable);
    }
    if (importable.type === "REGION") {
        return importImportableRegion(ctx, importable);
    }
    if (importable.type === "ITEM") {
        return importImportableItem(ctx, importable);
    }
    // TODO add the others idk and remove the ts ignore
    // @ts-ignore
    const _exhaustiveCheck: never = importable;
}

async function importImportableFunction(
    ctx: TaskContext,
    importable: ImportableFunction,
): Promise<void> {
    ctx.runCommand(`/function edit ${importable.name}`);

    const alreadyExists = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a function with that name!",
                )
                .then(() => false),
        ]),
        "Waiting for function to open",
    );

    if (!alreadyExists) {
        ctx.runCommand(`/function create ${importable.name}`);
        await waitForMenu(ctx);
    }

    // we have a function!!! open!!
    await syncActionList(ctx, importable.actions);

    if (importable.repeatTicks) {
        await clickGoBack(ctx);

        (await getSlotPaginate(ctx, importable.name)).click(MouseButton.RIGHT);
        await waitForMenu(ctx);

        const autoExecSlot = ctx.getItemSlot("Automatic Execution");
        const targetStr = importable.repeatTicks.toString();

        // Lore shows "Current: §a67 Ticks (00m03s)"
        // Check if it's already correct 
        const alreadyCorrect = autoExecSlot.getItem().getLore().some((line) => {
            const kv = parseLoreKeyValueLine(line);
            if (!kv || kv.label !== "Current") return false;
            return parseInt(removedFormatting(kv.value).trim(), 10).toString() === targetStr;
        });

        if (!alreadyCorrect) {
            await setNumberValue(ctx, autoExecSlot, importable.repeatTicks);
        }
    }
}

async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
): Promise<void> {
    ctx.runCommand(`/eventactions`);
    await waitForMenu(ctx);

    ctx.getItemSlot(importable.event).click();
    await waitForMenu(ctx);

    // we have an event!!! open!!! :)
    await syncActionList(ctx, importable.actions);
}

async function importImportableRegion(
    ctx: TaskContext,
    importable: ImportableRegion,
): Promise<void> {
    const setPos = async (pos: Pos, corner: "A" | "B") => {
        ctx.runCommand(`/tp ${pos.x} ${pos.y} ${pos.z}`);
        await waitForUnformattedMessage(
            ctx,
            `Teleporting you to ${pos.x}, ${pos.y}, ${pos.z}.`,
        );

        ctx.runCommand(`//pos${corner}`);
        await waitForUnformattedMessage(
            ctx,
            `Position ${corner} set to ${pos.x}, ${pos.y}, ${pos.z}.`,
        );
    };

    await setPos(importable.bounds.from, "A");
    await setPos(importable.bounds.to, "B");

    ctx.runCommand(`/region edit ${importable.name}`);

    const alreadyExists = await ctx.withTimeout(
        Promise.race([
            waitForMenu(ctx).then(() => true),
            ctx
                .waitFor(
                    "message",
                    (message) =>
                        removedFormatting(message) ===
                        "Could not find a region with that name!",
                )
                .then(() => false),
        ]),
        "Waiting for region to open",
    );

    if (!alreadyExists) {
        ctx.runCommand(`/region create ${importable.name}`);
        await waitForUnformattedMessage(
            ctx,
            `Created region ${importable.name}!`,
        );

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenu(ctx);
    } else {
        ctx.getItemSlot("Move Region").click();
        await waitForUnformattedMessage(
            ctx,
            "Updated region to your current selection!",
        );

        ctx.runCommand(`/region edit ${importable.name}`);
        await waitForMenu(ctx);
    }

    if (importable.onEnterActions) {
        ctx.getItemSlot("Entry Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onEnterActions);

        if (importable.onExitActions) {
            await clickGoBack(ctx);
        }
    }

    if (importable.onExitActions) {
        ctx.getItemSlot("Exit Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.onExitActions);
    }
}

async function importImportableItem(
    ctx: TaskContext,
    importable: ImportableItem
): Promise<void> {
    if (!importable.leftClickActions && !importable.rightClickActions) return;

    ctx.runCommand("/wtfmap");

    let message: string = "";
    await ctx.withTimeout(
        ctx.waitFor(
            "message",
            (chatMessage) =>
                removedFormatting(chatMessage).startsWith("You are currently playing on") &&
                (() => { message = removedFormatting(chatMessage); return true })(), // This is fine I guess....
        ),
        "Waiting for message in chat",
    );

    const uuid = message.substring(29, 65);
    const hash = cyrb53(JSON.stringify(importable));
    if (FileLib.exists(`./htsw/.cache/${uuid}/items/${hash}.snbt`)) {
        return;
    }

    const item = getItemFromNbt(importable.nbt);

    Client.sendPacket(
        new C10PacketCreativeInventoryAction(
            36,
            item.getItemStack()
        )
    );
    if (Player.getPlayer().field_71071_by.field_70461_c !== 0) {
        Client.sendPacket(new C09PacketHeldItemChange(0));
        Player.getPlayer().field_71071_by.field_70461_c = 0;
    };
    await ctx.sleep(1000);

    ctx.runCommand("/edit");
    await waitForMenu(ctx);

    ctx.getItemSlot("Edit Actions").click();
    await waitForMenu(ctx);

    if (importable.leftClickActions) {
        ctx.getItemSlot("Left Click Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.leftClickActions);

        if (importable.rightClickActions) {
            await clickGoBack(ctx);
        }
    }

    if (importable.rightClickActions) {
        ctx.getItemSlot("Right Click Actions").click();
        await waitForMenu(ctx);

        await syncActionList(ctx, importable.rightClickActions);
    }

    await ctx.sleep(1000);

    const snbt = Player.getInventory()?.getStackInSlot(0)?.getRawNBT();
    if (!snbt) throw Error("Why don't we have the item?");

    FileLib.write(`./htsw/.cache/${uuid}/items/${hash}.snbt`, snbt, true);
}
