import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { get } from "node:https";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 5;

export function fetchText(url: string, redirects = 0): Promise<string> {
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

/** Download `url` to `destPath`; resolves with the file's hex digest. */
export function download(
    url: string,
    destPath: string,
    hashAlgorithm: "sha1" | "sha256",
    redirects = 0
): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = get(url, (res) => {
            const redirect = redirectUrl(url, res.statusCode, res.headers.location);
            if (redirect !== null) {
                res.resume();
                if (redirects >= MAX_REDIRECTS) {
                    reject(new Error("too many redirects"));
                    return;
                }
                download(redirect, destPath, hashAlgorithm, redirects + 1).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            const hash = createHash(hashAlgorithm);
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
