import { Uri, Webview } from "vscode";

export type WebviewAssetOptions = {
    scriptName: string;
    styleName?: string;
    extraLocalResourceRoots?: Uri[];
};

export function renderWebviewHtml(
    webview: Webview,
    extensionUri: Uri,
    options: WebviewAssetOptions,
): string {
    const webviewRoot = Uri.joinPath(extensionUri, "dist", "webview");
    webview.options = {
        enableScripts: true,
        localResourceRoots: [
            webviewRoot,
            Uri.joinPath(extensionUri, "media"),
            ...(options.extraLocalResourceRoots ?? []),
        ],
    };

    const nonce = createNonce();
    const scriptUri = webview.asWebviewUri(Uri.joinPath(webviewRoot, options.scriptName));
    const styleTag = options.styleName
        ? `<link href="${webview.asWebviewUri(Uri.joinPath(webviewRoot, options.styleName))}" rel="stylesheet">`
        : "";

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https: data:; font-src ${webview.cspSource} data:; media-src ${webview.cspSource}; connect-src ${webview.cspSource} https: data:;">
    ${styleTag}
    <title>HTSW</title>
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function createNonce(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let out = "";
    for (let i = 0; i < 32; i++) {
        out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return out;
}
