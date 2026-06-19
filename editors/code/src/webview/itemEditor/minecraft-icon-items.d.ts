declare module "minecraft-icon-items" {
    export type ItemIcon = {
        id: string;
        name: string;
        meta: number;
        type: number;
        icon: string;
    };

    export function get(key: string | number): ItemIcon | null | undefined;
}
