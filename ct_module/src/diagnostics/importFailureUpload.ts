const UPLOAD_URL = "https://legendarygames.dev/htsw/import-errors/upload";
const USER_AGENT = "HTSW-Import-Diagnostics";

function readFile(path: string): string | null {
    try {
        const raw = FileLib.read(path);
        return raw === null || raw === undefined ? null : String(raw);
    } catch (_e) {
        return null;
    }
}

function upload(path: string): void {
    const body = readFile(path);
    if (body === null || body.length === 0) return;

    const URL = Java.type("java.net.URL");
    const OutputStreamWriter = Java.type("java.io.OutputStreamWriter");
    const BufferedReader = Java.type("java.io.BufferedReader");
    const InputStreamReader = Java.type("java.io.InputStreamReader");

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

    const reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
    let response = "";
    try {
        let line = reader.readLine();
        while (line !== null) {
            response += String(line);
            line = reader.readLine();
        }
    } finally {
        reader.close();
    }

    try {
        const parsed = JSON.parse(response);
        if (typeof parsed.id === "string") {
            ChatLib.chat(`&a[htsw] Uploaded failure log id: &f${parsed.id}`);
        }
    } catch (_e) {}
}

export function uploadImportFailureLog(path: string): void {
    const Thread = Java.type("java.lang.Thread");
    const Runnable = Java.type("java.lang.Runnable");
    const t = new Thread(
        new Runnable({
            run: function () {
                try {
                    upload(path);
                } catch (_e) {}
            },
        })
    );
    t.setDaemon(true);
    t.start();
}
