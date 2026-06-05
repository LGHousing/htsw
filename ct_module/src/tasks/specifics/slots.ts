import { removedFormatting } from "../../utils/helpers";
import { IMPORT_DEBUG } from "../../housingSync/diagnostics/importDebug";
import { lastWindowID___FromS30PacketWindowItemsPacketReceived__ThisIsNecessary_sadly_itIncrementsFrom1To100ThenItGoesBackAround_ButSometimesItSkipsOneOrMoreWeAreNotSureMaybeMore_AndItWillNeverBeZero as lastObservedWindowID } from "./waitFor";

export enum MouseButton {
    LEFT = "LEFT",
    RIGHT = "RIGHT",
    MIDDLE = "MIDDLE",
}

export class ItemSlot {
    private slotId: number;
    private item: Item;

    constructor(slotId: number, item: Item) {
        this.slotId = slotId;
        this.item = item;
    }

    public getSlotId(): number {
        return this.slotId;
    }

    public getItem(): Item {
        return this.item;
    }

    public click(button: MouseButton = MouseButton.LEFT, shift: boolean = false): void {
        const container = Player.getContainer();
        if (container == null) {
            throw new Error("No open container found");
        }
        container.click(this.slotId, shift, button.valueOf());
    }

    public drop(ctrl: boolean = false): void {
        const container = Player.getContainer();
        if (container == null) {
            throw new Error("No open container found");
        }
        container.drop(this.slotId, ctrl);
    }
}

export function getAllItemSlots(
    check: null | ((slot: ItemSlot) => boolean) = null
): ItemSlot[] | null {
    const container = Player.getContainer();
    if (container == null) {
        return null;
    }

    const slots: ItemSlot[] = [];
    for (let slotId = 0; slotId < container.getSize(); slotId++) {
        const item = container.getStackInSlot(slotId);
        if (item == null) {
            continue;
        }
        const slot = new ItemSlot(slotId, item);
        if (check !== null && !check(slot)) {
            continue;
        }
        slots.push(slot);
    }

    return slots;
}

export function tryGetItemSlot(
    check: string | ((slot: ItemSlot) => boolean)
): ItemSlot | null {
    if (typeof check === "string") {
        const name = removedFormatting(check);
        check = (slot: ItemSlot) => {
            return removedFormatting(slot.getItem().getName()) === name;
        };
    }

    const slots = getAllItemSlots();
    if (slots == null) return null;
    for (const slot of slots) {
        if (check(slot)) {
            return slot;
        }
    }
    return null;
}

export function getItemSlot(check: string | ((slot: ItemSlot) => boolean)): ItemSlot {
    const slot = tryGetItemSlot(check);
    if (slot === null) {
        if (typeof check === "string") {
            throw new Error(`Could not find "${check}"`);
        } else {
            throw new Error("Could not find item slot");
        }
    }
    return slot;
}

/**
 * Like getAllItemSlots but only searches the container's own slots,
 * excluding the player inventory (last 36 slots). Works for any
 * container size.
 */
export function getMenuItemSlots(check: null | ((slot: ItemSlot) => boolean) = null): ItemSlot[] | null {
    const container = Player.getContainer();
    if (container == null) {
        return null;
    }

    const menuEnd = container.getSize() - 36;
    const slots: ItemSlot[] = [];
    for (let slotId = 0; slotId < menuEnd; slotId++) {
        const item = container.getStackInSlot(slotId);
        if (item == null) {
            continue;
        }
        const slot = new ItemSlot(slotId, item);
        if (check !== null && !check(slot)) {
            continue;
        }
        slots.push(slot);
    }

    return slots;
}

export function tryGetMenuItemSlot(
    check: string | ((slot: ItemSlot) => boolean),
): ItemSlot | null {
    if (typeof check === "string") {
        const name = removedFormatting(check);
        check = (slot: ItemSlot) => {
            return removedFormatting(slot.getItem().getName()) === name;
        };
    }

    const slots = getMenuItemSlots();
    if (slots == null) return null;
    for (const slot of slots) {
        if (check(slot)) return slot;
    }
    return null;
}

export function getMenuItemSlot(
    check: string | ((slot: ItemSlot) => boolean),
): ItemSlot {
    const slot = tryGetMenuItemSlot(check);
    if (slot === null) {
        const base = typeof check === "string"
            ? `Could not find "${check}"`
            : "Could not find item slot";
        throw new Error(IMPORT_DEBUG ? `${base}${menuStateDescription()}` : base);
    }
    return slot;
}

export function menuStateDescription(): string {
    const title = getOpenContainerTitle();
    const container = Player.getContainer();
    const containerSize = container == null ? -1 : container.getSize();
    const menuEnd = containerSize < 36 ? containerSize : containerSize - 36;
    const slots = getMenuItemSlots();
    const names: string[] = [];
    if (slots !== null) {
        for (let i = 0; i < slots.length && names.length < 24; i++) {
            const n = removedFormatting(slots[i].getItem().getName()).trim();
            if (n.length > 0) names.push(n);
        }
    }
    const slotList = names.length === 0
        ? "<empty>"
        : names.join(", ") + (slots !== null && slots.length > names.length ? ", …" : "");
    const winId = getOpenContainerWindowId();
    const containerWindowID: number | string = winId === null ? "?" : winId;
    return ` in "${title ?? "<no container>"}" (slots: ${slotList}; size=${containerSize}, menuSlots=${menuEnd < 0 ? "?" : menuEnd}, winID=${containerWindowID}, lastSeenWinID=${lastObservedWindowID})`;
}

export function getOpenContainerTitle(): string | null {
    const container = Player.getContainer();
    if (container == null) {
        return null;
    }

    return removedFormatting(container.getName());
}

/**
 * The windowId of the currently open container, read off the underlying
 * vanilla `Container.windowId` (1.8.9 obf `field_75152_c`). Returns null when
 * no container is open or the field can't be read. Used to confirm MC has
 * actually swapped the active container to a freshly-opened window.
 */
export function getOpenContainerWindowId(): number | null {
    const container = Player.getContainer();
    if (container == null) return null;
    try {
        const c = container as unknown as { container?: { field_75152_c?: number } };
        const id = c.container?.field_75152_c;
        return typeof id === "number" ? id : null;
    } catch (_e) {
        return null;
    }
}

/**
 * Menu-item count read straight off the DISPLAYED GuiContainer's own container
 * (1.8.9 obf: GuiContainer.field_147002_h = inventorySlots), not via
 * `Player.getContainer()` (= thePlayer.openContainer). When the two disagree, we
 * are polling a different/stale container instance than the menu the user sees.
 * Returns "<screen>:<count>/<windowId>" or a reason string. Diagnostic only.
 */
export function describeGuiScreenMenu(): string {
    try {
        const mc = Client.getMinecraft() as unknown as { field_71462_r?: unknown };
        const screen = mc.field_71462_r;
        if (screen == null) return "noScreen";
        const klass = (screen as { getClass(): { getName(): string } }).getClass().getName();
        const short = klass.substring(klass.lastIndexOf(".") + 1);
        const container = (screen as { field_147002_h?: unknown }).field_147002_h;
        if (container == null) return `${short}:noContainer`;
        const c = container as {
            func_75138_a(): { size(): number; get(i: number): unknown };
            field_75152_c?: number;
        };
        const inv = c.func_75138_a();
        const size = inv.size();
        const end = size < 36 ? size : size - 36;
        let n = 0;
        for (let i = 0; i < end; i++) {
            if (inv.get(i) != null) n++;
        }
        return `${short}:${n}items/win${c.field_75152_c}`;
    } catch (e) {
        return `err:${e}`;
    }
}
