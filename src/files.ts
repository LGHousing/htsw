export interface FileProvider {

    exists(path: string): string;
    read(path: string): string;

}