type PromptOwner = object;

type ActivePrompt = {
    owner: PromptOwner;
    deferred: string[];
};

let activePrompt: ActivePrompt | null = null;

export function beginChatPromptDeferral(owner: PromptOwner): void {
    if (activePrompt !== null) {
        throw new Error("A Housing chat prompt is already active");
    }
    activePrompt = { owner, deferred: [] };
}

export function deferPlayerChat(message: string): boolean {
    if (activePrompt === null) return false;
    activePrompt.deferred.push(message);
    return true;
}

export function finishChatPromptDeferral(owner: PromptOwner): string[] {
    if (activePrompt === null || activePrompt.owner !== owner) return [];
    const deferred = activePrompt.deferred;
    activePrompt = null;
    return deferred;
}

export function abandonChatPromptDeferral(owner: PromptOwner): number | null {
    if (activePrompt === null || activePrompt.owner !== owner) return null;
    const deferred = activePrompt.deferred.length;
    activePrompt = null;
    return deferred;
}
