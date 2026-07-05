import * as vscode from "vscode";
import * as htsw from "htsw";
import { SoundCache } from "../sounds/soundCache";
import { SOUND_NAME_1_8_TO_1_21, soundEventForVersion } from "../sounds/soundMap";
import { renderWebviewHtml } from "./html";
import type {
    SoundEntry,
    SoundPreviewFromHostMessage,
    SoundPreviewToHostMessage,
    SoundVersionId,
} from "./protocol";

const VERSION_KEY = "htsw.soundPreviewer.version";
const PITCH_KEY = "htsw.soundPreviewer.pitch";
const VOLUME_KEY = "htsw.soundPreviewer.volume";

class SoundPreviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "htsw.soundPreviewer";
    private readonly controller: SoundPreviewController;

    public constructor(
        private readonly extensionUri: vscode.Uri,
        globalStorageUri: vscode.Uri,
        globalState: vscode.Memento,
    ) {
        this.controller = new SoundPreviewController(globalStorageUri, globalState);
    }

    public resolveWebviewView(view: vscode.WebviewView): void {
        view.webview.html = renderWebviewHtml(view.webview, this.extensionUri, {
            scriptName: "soundPreviewer.js",
            extraLocalResourceRoots: [this.controller.cacheRootUri()],
        });

        view.webview.onDidReceiveMessage((message: SoundPreviewToHostMessage) => {
            void this.controller.handleMessage(view.webview, message);
        });
    }
}

export class SoundPreviewController {
    private readonly cache: SoundCache;

    public constructor(
        globalStorageUri: vscode.Uri,
        private readonly globalState: vscode.Memento,
    ) {
        this.cache = new SoundCache(vscode.Uri.joinPath(globalStorageUri, "sounds"));
    }

    public cacheRootUri(): vscode.Uri {
        return this.cache.cacheRootUri();
    }

    public async handleMessage(
        webview: vscode.Webview,
        message: SoundPreviewToHostMessage,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                await this.post(webview, {
                    type: "init",
                    sounds: soundEntries(),
                    settings: this.readSettings(),
                });
                return;
            case "requestPlay":
                await this.play(webview, message.version, message.soundPath);
                return;
            case "copyPath":
                await this.copyPath(webview, message.soundPath);
                return;
            case "saveSettings":
                await this.saveSettings(message.version, message.pitch, message.volume);
                return;
        }
    }

    private async play(
        webview: vscode.Webview,
        version: SoundVersionId,
        soundPath: string,
    ): Promise<void> {
        const eventName = soundEventForVersion(version, soundPath);
        if (eventName === null) {
            await this.post(webview, {
                type: "playState",
                ok: false,
                version,
                soundPath,
                error: version === "1.21.1"
                    ? "No 1.21 audio is mapped for this 1.8 sound."
                    : "No audio is mapped for this sound.",
            });
            return;
        }

        try {
            const cached = await this.cache.ensureSound(version, eventName);
            await this.post(webview, {
                type: "playState",
                ok: true,
                version,
                soundPath,
                uri: webview.asWebviewUri(cached.fileUri).toString(),
                variants: cached.variants,
            });
        } catch (err) {
            await this.post(webview, {
                type: "playState",
                ok: false,
                version,
                soundPath,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private async copyPath(webview: vscode.Webview, soundPath: string): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(soundPath);
            await this.post(webview, { type: "copyResult", ok: true });
        } catch (err) {
            await this.post(webview, {
                type: "copyResult",
                ok: false,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    private readSettings(): { version: SoundVersionId; pitch: number; volume: number } {
        return {
            version: this.globalState.get<SoundVersionId>(VERSION_KEY, "1.8.9"),
            pitch: this.globalState.get<number>(PITCH_KEY, 1),
            volume: this.globalState.get<number>(VOLUME_KEY, 0.7),
        };
    }

    private async saveSettings(
        version: SoundVersionId,
        pitch: number,
        volume: number,
    ): Promise<void> {
        await this.globalState.update(VERSION_KEY, version);
        await this.globalState.update(PITCH_KEY, pitch);
        await this.globalState.update(VOLUME_KEY, volume);
    }

    private async post(
        webview: vscode.Webview,
        message: SoundPreviewFromHostMessage,
    ): Promise<void> {
        await webview.postMessage(message);
    }
}

function soundEntries(): SoundEntry[] {
    return htsw.types.SOUNDS.map((sound) => ({
        name: sound.name,
        path: sound.path,
        mapped1_21: SOUND_NAME_1_8_TO_1_21[sound.path] ?? null,
    }));
}
