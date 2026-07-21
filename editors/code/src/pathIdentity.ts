import { nodeProjectFs } from "./nodeProjectFs";

export function absolutePathKey(filePath: string): string {
    return nodeProjectFs.pathKey(filePath);
}
