// Typing into Housing's anvil and sign prompts, by reflection on the open
// container and GUI screen. The client module behind
// importer/src/housingSync/menus/menuInput.ts, used by its menuUtils.ts.
import { getMinecraft, javaType } from "../../utils/java";

const GuiEditSign = javaType("net.minecraft.client.gui.inventory.GuiEditSign");

const ChatComponentText = javaType("net.minecraft.util.ChatComponentText");
const IChatComponent = javaType("net.minecraft.util.IChatComponent");
const JavaArray = javaType("java.lang.reflect.Array");

type RhinoJavaObject = {
    class: HtswJavaClass;
};

type OpenContainer = {
    container: RhinoJavaObject;
    click(slot: number, shift: boolean): void;
};

function getOpenContainer(): OpenContainer | null {
    const container = (
        Player as unknown as {
            getContainer(): OpenContainer | null | undefined;
        }
    ).getContainer();
    return container ?? null;
}

export function setAnvilItemName(newName: string) {
    const inventory = getOpenContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    const outputSlotField = inventory.container.class.getDeclaredField("field_82852_f");
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container) as RhinoJavaObject;

    const outputSlotItemField = outputSlot.class.getDeclaredField("field_70467_a");
    outputSlotItemField.setAccessible(true);
    const outputSlotItem = outputSlotItemField.get(
        outputSlot
    ) as HtswJavaObjectArray<unknown>;

    outputSlotItem[0] = new Item(339).setName(newName).itemStack;
    outputSlotItemField.set(outputSlot, outputSlotItem);
}

export function acceptNewAnvilItem(): void {
    const inventory = getOpenContainer();
    if (inventory == null) {
        throw new Error("No open container found");
    }
    inventory.click(2, false);
}

function currentScreen(): unknown {
    return getMinecraft().field_71462_r;
}

export function isSignEditorOpen(): boolean {
    return currentScreen() instanceof GuiEditSign;
}

function getDeclaredFieldInHierarchy(obj: unknown, name: string): HtswJavaReflectField {
    let cls: HtswJavaClass | null = (obj as RhinoJavaObject).class;
    while (cls !== null) {
        try {
            const field = cls.getDeclaredField(name);
            field.setAccessible(true);
            return field;
        } catch (_e) {
            cls = cls.getSuperclass();
        }
    }
    throw new Error(`Could not find field ${name}`);
}

function chatComponentLines(
    lines: string[]
): HtswJavaObjectArray<HtswMinecraftChatComponent> {
    const array = JavaArray.newInstance<HtswMinecraftChatComponent>(
        IChatComponent.class,
        4
    );
    for (let i = 0; i < 4; i++) {
        JavaArray.set(array, i, new ChatComponentText(lines[i] ?? ""));
    }
    return array;
}

export function submitSignValue(value: string): void {
    const screen = currentScreen();
    if (!(screen instanceof GuiEditSign)) {
        throw new Error("Sign input was expected, but the sign editor is not open.");
    }

    const sign = getDeclaredFieldInHierarchy(screen, "field_146848_f").get(screen);
    const lines = chatComponentLines([value, "", "", ""]);
    getDeclaredFieldInHierarchy(sign, "field_145915_a").set(sign, lines);
    // In MC 1.8.9, GuiEditSign.onGuiClosed sends C12 with these lines and position.
    getMinecraft().func_147108_a(null);
}
