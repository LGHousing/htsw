const UPLOAD_URL = "https://legendarygames.dev/htsw/import-errors/upload";
const USER_AGENT = "HTSW-Import-Diagnostics";

import { javaType, runtimeString, type RuntimeString } from "../utils/java";

function readFile(path: string): string | null {
    try {
        const raw = FileLib.read(path) as RuntimeString | null | undefined;
        return raw === null || raw === undefined ? null : runtimeString(raw);
    } catch (_e) {
        return null;
    }
}

function upload(path: string, chatUploadedId: boolean): void {
    const body = readFile(path);
    if (body === null || body.length === 0) return;

    const URL = javaType("java.net.URL");
    const OutputStreamWriter = javaType("java.io.OutputStreamWriter");
    const BufferedReader = javaType("java.io.BufferedReader");
    const InputStreamReader = javaType("java.io.InputStreamReader");

    const conn = new URL(UPLOAD_URL).openConnection();
    conn.setRequestMethod("POST");
    conn.setRequestProperty("User-Agent", USER_AGENT);
    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
    conn.setConnectTimeout(5000);
    conn.setReadTimeout(15000);
    conn.setDoOutput(true);

    const writer = new OutputStreamWriter(conn.getOutputStream(), "UTF-8");
    try {
        writer.write(body);
    } finally {
        writer.close();
    }

    const code = conn.getResponseCode();
    if (code < 200 || code >= 300) return;

    const reader = new BufferedReader(
        new InputStreamReader(conn.getInputStream(), "UTF-8")
    );
    let response = "";
    try {
        let line = reader.readLine();
        while (line !== null) {
            response += runtimeString(line);
            line = reader.readLine();
        }
    } finally {
        reader.close();
    }

    try {
        const parsed: unknown = JSON.parse(response);
        if (
            chatUploadedId &&
            parsed !== null &&
            typeof parsed === "object" &&
            "id" in parsed &&
            typeof parsed.id === "string"
        ) {
            ChatLib.chat(`&a[htsw] Uploaded failure log id: &f${parsed.id}`);
        }
    } catch (_e) {}
}

export function uploadDiagnosticsFile(
    path: string,
    options: { chatUploadedId?: boolean } = {}
): void {
    try {
        const Thread = javaType("java.lang.Thread");
        const Runnable = javaType("java.lang.Runnable");
        const chatUploadedId = options.chatUploadedId === true;
        const t = new Thread(
            new Runnable({
                run: function () {
                    try {
                        upload(path, chatUploadedId);
                    } catch (_e) {}
                },
            })
        );
        t.setDaemon(true);
        t.start();
    } catch (_e) {}
}
