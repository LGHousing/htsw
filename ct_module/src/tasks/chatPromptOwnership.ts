type PromptOwner = object;

type ActivePrompt = {
    owner: PromptOwner;
    ownedPackets: object[];
    deferred: object[];
};

let activePrompt: ActivePrompt | null = null;

export function beginChatPromptOwnership(owner: PromptOwner): void {
    if (activePrompt !== null) {
        throw new Error("A Housing chat prompt is already active");
    }
    activePrompt = { owner, ownedPackets: [], deferred: [] };
}

export function markOwnedChatPacket(owner: PromptOwner, packet: object): void {
    if (activePrompt === null || activePrompt.owner !== owner) return;
    activePrompt.ownedPackets.push(packet);
}

function samePacket(left: object, right: object): boolean {
    if (left === right) return true;
    try {
        return (left as { equals(other: object): boolean }).equals(right);
    } catch (_error) {
        return false;
    }
}

export function deferUnownedChat(packet: object): boolean {
    if (activePrompt === null) return false;
    for (let i = 0; i < activePrompt.ownedPackets.length; i++) {
        if (samePacket(activePrompt.ownedPackets[i], packet)) {
            activePrompt.ownedPackets.splice(i, 1);
            return false;
        }
    }
    activePrompt.deferred.push(packet);
    return true;
}

export async function finishChatPromptOwnership(
    owner: PromptOwner,
    replay: (packet: object) => Promise<void>
): Promise<number> {
    if (activePrompt === null || activePrompt.owner !== owner) return 0;

    let replayed = 0;
    while (activePrompt.deferred.length > 0) {
        const packet = activePrompt.deferred[0];
        await replay(packet);
        activePrompt.deferred.shift();
        replayed++;
    }
    activePrompt = null;
    return replayed;
}

export function abandonChatPromptOwnership(owner: PromptOwner): number | null {
    if (activePrompt === null || activePrompt.owner !== owner) return null;
    const deferred = activePrompt.deferred.length;
    activePrompt = null;
    return deferred;
}
