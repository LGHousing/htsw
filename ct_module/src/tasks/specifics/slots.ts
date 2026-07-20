import { removedFormatting } from "../../utils/helpers";
import { getMinecraft, javaType } from "../../utils/java";
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
export function getMenuItemSlots(
    check: null | ((slot: ItemSlot) => boolean) = null
): ItemSlot[] | null {
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
    check: string | ((slot: ItemSlot) => boolean)
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

export function getMenuItemSlot(check: string | ((slot: ItemSlot) => boolean)): ItemSlot {
    const slot = tryGetMenuItemSlot(check);
    if (slot === null) {
        const base =
            typeof check === "string"
                ? `Could not find "${check}"`
                : "Could not find item slot";
        throw new Error(`${base}${menuStateDescription()}`);
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
    const slotList =
        names.length === 0
            ? "<empty>"
            : names.join(", ") +
              (slots !== null && slots.length > names.length ? ", …" : "");
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
        const id = (
            container as unknown as { getWindowId?: () => number }
        ).getWindowId?.();
        if (typeof id === "number" && id >= 0) return id;
    } catch (_e) {}
    try {
        const c = container as unknown as { container?: { field_75152_c?: number } };
        const id = c.container?.field_75152_c;
        return typeof id === "number" ? id : null;
    } catch (_e) {
        return null;
    }
}

export type DisplayedGuiMenuState = {
    screen: string;
    itemCount: number;
    slotCount: number;
    menuSlotCount: number;
    windowId: number | null;
};

export type MenuItemDebugSnapshot = {
    slot: number;
    name: string;
    cleanName: string;
    lore: string[];
    rawStackName?: string;
    id?: string;
    damage?: number;
};

function itemStack(item: Item): unknown {
    try {
        return (item as unknown as { itemStack?: unknown }).itemStack;
    } catch (_e) {
        return null;
    }
}

function rawStackName(stack: unknown): string | undefined {
    try {
        return String((stack as { func_82833_r(): unknown }).func_82833_r());
    } catch (_e) {
        return undefined;
    }
}

function rawStackId(stack: unknown): string | undefined {
    try {
        const ItemClass = javaType("net.minecraft.item.Item");
        const rawItem = (
            stack as { func_77973_b(): HtswMinecraftItem | null }
        ).func_77973_b();
        if (rawItem === null) return undefined;
        const key = ItemClass.field_150901_e.func_148750_c(rawItem);
        return key === null ? undefined : key.toString();
    } catch (_e) {
        return undefined;
    }
}

function rawStackDamage(stack: unknown): number | undefined {
    try {
        const damage = (stack as { func_77960_j(): number }).func_77960_j();
        return typeof damage === "number" ? damage : undefined;
    } catch (_e) {
        return undefined;
    }
}

export function menuItemDebugSnapshot(limit: number = 54): MenuItemDebugSnapshot[] {
    const slots = getMenuItemSlots();
    if (slots === null) return [];

    const out: MenuItemDebugSnapshot[] = [];
    for (let i = 0; i < slots.length && out.length < limit; i++) {
        const slot = slots[i];
        const item = slot.getItem();
        const name = item.getName();
        const stack = itemStack(item);
        const entry: MenuItemDebugSnapshot = {
            slot: slot.getSlotId(),
            name,
            cleanName: removedFormatting(name),
            lore: item
                .getLore()
                .slice(0, 12)
                .map((line) => removedFormatting(line)),
        };
        const stackName = rawStackName(stack);
        if (stackName !== undefined) entry.rawStackName = stackName;
        const id = rawStackId(stack);
        if (id !== undefined) entry.id = id;
        const damage = rawStackDamage(stack);
        if (damage !== undefined) entry.damage = damage;
        out.push(entry);
    }
    return out;
}

function listSize(value: unknown): number {
    try {
        const n = (value as { size(): number }).size();
        if (typeof n === "number") return n;
    } catch (_e) {}
    try {
        const n = (value as { length?: number }).length;
        if (typeof n === "number") return n;
    } catch (_e) {}
    return 0;
}

function listItem(value: unknown, index: number): unknown {
    try {
        return (value as { get(i: number): unknown }).get(index);
    } catch (_e) {}
    try {
        return (value as unknown[])[index];
    } catch (_e) {}
    return null;
}

export function getDisplayedGuiMenuState(): DisplayedGuiMenuState | null {
    try {
        const mc = getMinecraft();
        const screen = mc.field_71462_r;
        if (screen == null) return null;
        const klass = String(screen.getClass().getName());
        const short = klass.substring(klass.lastIndexOf(".") + 1);
        const container = (screen as { field_147002_h?: unknown }).field_147002_h;
        if (container == null)
            return {
                screen: short,
                itemCount: 0,
                slotCount: 0,
                menuSlotCount: 0,
                windowId: null,
            };
        const c = container as {
            func_75138_a(): {
                length?: number;
                size?: () => number;
                get?: (i: number) => unknown;
            };
            field_75152_c?: number;
        };
        const inv = c.func_75138_a();
        const size = listSize(inv);
        const end = size < 36 ? size : size - 36;
        let n = 0;
        for (let i = 0; i < end; i++) {
            if (listItem(inv, i) != null) n++;
        }
        const id = c.field_75152_c;
        return {
            screen: short,
            itemCount: n,
            slotCount: size,
            menuSlotCount: end,
            windowId: typeof id === "number" ? id : null,
        };
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
    const state = getDisplayedGuiMenuState();
    if (state === null) return "noScreen";
    if (state.slotCount === 0 && state.windowId === null)
        return `${state.screen}:noContainer`;
    return `${state.screen}:${state.itemCount}items/win${state.windowId}`;
}
