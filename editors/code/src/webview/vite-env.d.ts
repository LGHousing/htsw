declare module "*.css?inline" {
    const css: string;
    export default css;
}

declare module "*.woff2?inline" {
    const dataUri: string;
    export default dataUri;
}

declare function acquireVsCodeApi<T = unknown>(): {
    postMessage(message: unknown): void;
    getState(): T | undefined;
    setState(state: T): void;
};
