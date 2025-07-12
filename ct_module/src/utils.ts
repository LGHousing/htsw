/// <reference types="../../CTAutocomplete" />

export function normalized(str: string): string {
    return str
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '')
        .toLowerCase();
}

export function assertIsNormalized(str: string): void {
    if (!/^[a-z0-9_]+$/.test(str)) {
        throw new Error(`Key "${str}" is not normalized`);
    }
}

export function removeFormatting(str: string): string {
    return str.replace(/(?:§|&)[0-9a-fklmnor]/g, '');
}

type ChatHistoryEntry = {
    message: string;
    timestamp: number;
};

const CHAT_HISTORY_MAX_AGE = 5 * 60 * 1000;
const CHAT_HISTORY: ChatHistoryEntry[] = [];

register('chat', (event: string | ForgeClientChatReceivedEvent) => {
    // @ts-ignore
    const message = ChatLib.getChatMessage(event, true);

    const entry: ChatHistoryEntry = {
        message: message,
        timestamp: Date.now(),
    };
    CHAT_HISTORY.push(entry);

    const now = Date.now();
    while (
        CHAT_HISTORY.length > 0 &&
        CHAT_HISTORY[0].timestamp < now - CHAT_HISTORY_MAX_AGE
    ) {
        CHAT_HISTORY.shift();
    }
});

export function chatHistory(since: number): ChatHistoryEntry[] {
    return CHAT_HISTORY.filter((entry) => entry.timestamp >= since);
}

export function chatHistoryContains(
    message: string,
    since: number,
    exact: boolean,
    formatted: boolean
): boolean {
    for (const entry of chatHistory(since)) {
        console.log(JSON.stringify(entry, null, 0));
        let entryMessage: string;
        if (formatted) {
            entryMessage = entry.message;
        } else {
            entryMessage = removeFormatting(entry.message);
        }

        let matches: boolean;
        if (exact) {
            matches = entryMessage === message;
        } else {
            matches = entryMessage.includes(message);
        }

        if (matches) {
            return true;
        }
    }
    return false;
}

export function setAnvilItemName(newName: string) {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error('No open container found');
    }
    const outputSlotField = inventory.container.class.getDeclaredField('field_82852_f');
    // @ts-ignore
    outputSlotField.setAccessible(true);
    const outputSlot = outputSlotField.get(inventory.container);

    const outputSlotItemField = outputSlot.class.getDeclaredField('field_70467_a');
    outputSlotItemField.setAccessible(true);
    let outputSlotItem = outputSlotItemField.get(outputSlot);

    outputSlotItem[0] = new Item(339).setName(newName).itemStack;
    outputSlotItemField.set(outputSlot, outputSlotItem);
}

export function acceptNewAnvilItem(): void {
    const inventory = Player.getContainer();
    if (inventory == null) {
        throw new Error('No open container found');
    }
    inventory.click(2, false);
}
