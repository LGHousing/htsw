import { IDisposable, languages } from "monaco-editor";
import * as languageFeatures from "./languageFeatures";

export function setupHtsl() {
    setupMode();
}

function setupMode() {
    const disposables: IDisposable[] = [];
    const providers: IDisposable[] = [];

    function registerProviders() {
        disposeAll(disposables);

        providers.push(
            languages.registerInlayHintsProvider(
                "htsl",
                new languageFeatures.InlayHintsAdapter()
            )
        );

        providers.push(new languageFeatures.DiagnosticsAdapter());
    }

    registerProviders();

    disposables.push(asDisposable(providers));
}

function asDisposable(disposables: IDisposable[]): IDisposable {
    return { dispose: () => disposeAll(disposables) };
}

function disposeAll(disposables: IDisposable[]) {
    while (disposables.length) {
        disposables.pop()!.dispose();
    }
}
