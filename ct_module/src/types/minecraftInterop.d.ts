export {};

declare global {
    interface HtswJavaReflectField {
        get(target: unknown): unknown;
        getName(): unknown;
        set(target: unknown, value: unknown): void;
        setAccessible(accessible: boolean): void;
    }

    interface HtswJavaClass {
        getDeclaredField(name: string): HtswJavaReflectField;
        getDeclaredFields(): {
            readonly length: number;
            [index: number]: HtswJavaReflectField;
        };
        getName(): unknown;
        getSuperclass(): HtswJavaClass | null;
    }

    interface HtswJavaObject {
        getClass(): HtswJavaClass;
    }

    interface HtswMinecraftGuiScreen extends HtswJavaObject {
        field_146294_l: number;
        field_146295_m: number;
    }

    type HtswMinecraftChatGui = HtswJavaObject;

    interface HtswMinecraftIngameGui {
        func_146158_b(): HtswMinecraftChatGui | null;
    }

    interface HtswMinecraftFontRenderer {
        func_175065_a(
            text: string,
            x: number,
            y: number,
            color: number,
            dropShadow: boolean
        ): number;
        func_78256_a(text: string): number;
        func_78271_c(text: string, width: number): unknown;
    }

    interface HtswMinecraftKeyBinding {
        func_151463_i(): unknown;
        getKeyCode(): unknown;
    }

    interface HtswMinecraftGameSettings {
        field_74310_D: HtswMinecraftKeyBinding | null;
        field_74314_A: HtswMinecraftKeyBinding | null;
        field_151445_Q: HtswMinecraftKeyBinding | null;
    }

    interface HtswMinecraftPlayerController {
        func_78753_a(
            windowId: number,
            slot: number,
            mouseButton: number,
            mode: number,
            player: unknown
        ): unknown;
    }

    interface HtswMinecraftItemRenderer {
        func_180450_b(stack: HtswMinecraftItemStack, x: number, y: number): void;
    }

    interface HtswMinecraft {
        field_71415_G: boolean;
        field_71440_d: number;
        field_71442_b: HtswMinecraftPlayerController;
        field_71443_c: number;
        field_71456_v: HtswMinecraftIngameGui | null;
        field_71462_r: HtswMinecraftGuiScreen | null;
        field_71466_p: HtswMinecraftFontRenderer;
        field_71474_y: HtswMinecraftGameSettings | null;
        func_147108_a(screen: unknown): void;
        func_152344_a(task: HtswJavaRunnable): unknown;
        func_152345_ab(): boolean;
        func_175599_af(): HtswMinecraftItemRenderer;
    }

    interface HtswClientClass {
        getChatGUI(): HtswMinecraftChatGui | null;
        getMinecraft(): HtswMinecraft;
        sendPacket(packet: HtswPacketInstance): void;
        showTitle(
            title: string,
            subtitle: string,
            fadeIn: number,
            time: number,
            fadeOut: number
        ): void;
    }

    interface HtswMinecraftGameType {
        func_77145_d(): boolean;
        func_82752_c(): boolean;
    }

    interface HtswMinecraftPlayer {
        field_70125_A: number;
        field_70177_z: number;
        field_71071_by: { field_70461_c: number };
        field_71075_bZ: {
            field_75098_d: boolean;
            field_75100_b: boolean;
        };
        func_110138_aP(): number;
        func_178889_l(): HtswMinecraftGameType;
        func_70016_h(x: number, y: number, z: number): void;
        func_71016_p(): void;
        func_71053_j(): void;
        func_85030_a(sound: string, volume: number, pitch: number): void;
    }

    interface HtswPlayerClass {
        getPlayer(): HtswMinecraftPlayer | null | undefined;
    }
}
