import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { get } from "node:https";
import * as path from "node:path";
import { PINNED_VERSION_JSON } from "./soundMap";
import type { SoundVersionId } from "../webview/protocol";

const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const MANIFEST_FALLBACK_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
const OBJECT_BASE_URL = "https://resources.download.minecraft.net";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

type VersionManifest = {
    versions: { id: string; url: string }[];
};

type VersionJson = {
    assetIndex: { url: string };
};

type AssetIndex = {
    objects: Record<string, { hash: string; size: number }>;
};

type SoundsJson = Record<string, { sounds?: SoundVariant[] }>;

type SoundVariant = string | { name?: string };

export type ResolvedSoundObject = {
    hash: string;
    variants: string[];
    objectKey: string;
};

export async function resolveVersionJsonUrl(version: SoundVersionId): Promise<string> {
    for (const url of [MANIFEST_URL, MANIFEST_FALLBACK_URL]) {
        try {
            const manifest = await fetchJson<VersionManifest>(url);
            const match = manifest.versions.find((entry) => entry.id === version);
            if (match) return match.url;
        } catch {
            continue;
        }
    }
    return PINNED_VERSION_JSON[version];
}

export async function fetchVersionJson(version: SoundVersionId): Promise<VersionJson> {
    return fetchJson(await resolveVersionJsonUrl(version));
}

export async function fetchAssetIndex(versionJson: VersionJson): Promise<AssetIndex> {
    return fetchJson(versionJson.assetIndex.url);
}

export async function fetchSoundsJson(index: AssetIndex): Promise<SoundsJson> {
    const object = index.objects["minecraft/sounds.json"];
    if (!object) throw new Error("Asset index has no minecraft/sounds.json entry.");
    return fetchJson(objectUrl(object.hash));
}

export function resolveSoundObject(
    index: AssetIndex,
    sounds: SoundsJson,
    eventName: string,
): ResolvedSoundObject {
    const event = sounds[eventName];
    const variants = (event?.sounds ?? [])
        .map(soundVariantName)
        .filter((name): name is string => Boolean(name));
    if (variants.length === 0) {
        throw new Error(`No audio variants for sound event "${eventName}".`);
    }

    const available: ResolvedSoundObject[] = [];
    for (const variant of variants) {
        const objectKey = `minecraft/sounds/${variant}.ogg`;
        const object = index.objects[objectKey];
        if (!object) continue;
        available.push({ hash: object.hash, objectKey, variants });
    }

    if (available.length > 0) {
        return available[Math.floor(Math.random() * available.length)];
    }

    throw new Error(`No cached object entry for sound event "${eventName}".`);
}

export async function downloadObject(hash: string, destPath: string): Promise<void> {
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    const tempPath = `${destPath}.${Date.now()}.tmp`;
    try {
        const actual = await download(objectUrl(hash), tempPath);
        if (actual.toLowerCase() !== hash.toLowerCase()) {
            throw new Error("downloaded object hash mismatch");
        }
        await fs.rename(tempPath, destPath);
    } finally {
        await fs.rm(tempPath, { force: true });
    }
}

export async function verifySha1(filePath: string, expected: string): Promise<boolean> {
    try {
        const data = await fs.readFile(filePath);
        return createHash("sha1").update(data).digest("hex").toLowerCase() === expected.toLowerCase();
    } catch {
        return false;
    }
}

function soundVariantName(variant: SoundVariant): string | null {
    const raw = typeof variant === "string" ? variant : variant.name;
    if (!raw) return null;
    return raw.replace(/^minecraft:/, "");
}

function objectUrl(hash: string): string {
    return `${OBJECT_BASE_URL}/${hash.slice(0, 2)}/${hash}`;
}

function fetchJson<T>(url: string): Promise<T> {
    return fetchText(url).then((text) => JSON.parse(text) as T);
}

function fetchText(url: string, redirects = 0): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, (res) => {
            const redirect = redirectUrl(url, res.statusCode, res.headers.location);
            if (redirect !== null) {
                res.resume();
                if (redirects >= MAX_REDIRECTS) {
                    reject(new Error("too many redirects"));
                    return;
                }
                fetchText(redirect, redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve(body));
        });
        req.on("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () =>
            req.destroy(new Error(`request timed out after ${REQUEST_TIMEOUT_MS}ms`))
        );
    });
}

function download(url: string, destPath: string, redirects = 0): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, (res) => {
            const redirect = redirectUrl(url, res.statusCode, res.headers.location);
            if (redirect !== null) {
                res.resume();
                if (redirects >= MAX_REDIRECTS) {
                    reject(new Error("too many redirects"));
                    return;
                }
                download(redirect, destPath, redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const hash = createHash("sha1");
            const file = createWriteStream(destPath);
            res.on("data", (chunk) => hash.update(chunk));
            res.pipe(file);
            file.on("finish", () => file.close(() => resolve(hash.digest("hex"))));
            file.on("error", reject);
        });
        req.on("error", reject);
        req.setTimeout(REQUEST_TIMEOUT_MS, () =>
            req.destroy(new Error(`download timed out after ${REQUEST_TIMEOUT_MS}ms`))
        );
    });
}

function redirectUrl(
    currentUrl: string,
    statusCode: number | undefined,
    location: string | string[] | undefined,
): string | null {
    if (statusCode === undefined || statusCode < 300 || statusCode >= 400) return null;
    const next = Array.isArray(location) ? location[0] : location;
    if (typeof next !== "string" || next.length === 0) return null;
    return new URL(next, currentUrl).toString();
}
