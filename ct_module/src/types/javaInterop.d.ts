export {};

declare global {
    interface Java {
        to(values: readonly number[], type: "byte[]" | "int[]"): HtswJavaNumberArray;
        to(values: readonly unknown[], type: "java.lang.Object[]"): HtswJavaObjectArray<unknown>;
        to(values: readonly string[], type: "java.lang.String[]"): HtswJavaObjectArray<string>;
    }

    interface HtswJavaIterator<T> {
        hasNext(): boolean;
        next(): T;
    }

    interface HtswJavaCloseable {
        close(): void;
    }

    type HtswJavaInputStream = HtswJavaCloseable;

    type HtswJavaOutputStream = HtswJavaCloseable;

    interface HtswJavaUri {
        toURL(): HtswJavaUrl;
    }

    interface HtswJavaPath {
        getFileName(): HtswJavaPath | null;
        getParent(): HtswJavaPath | null;
        isAbsolute(): boolean;
        normalize(): HtswJavaPath;
        relativize(other: HtswJavaPath): HtswJavaPath;
        resolve(other: string | HtswJavaPath): HtswJavaPath;
        startsWith(other: HtswJavaPath): boolean;
        toAbsolutePath(): HtswJavaPath;
        toRealPath(): HtswJavaPath;
        toString(): unknown;
        toUri(): HtswJavaUri;
    }

    interface HtswJavaDirectoryStream extends HtswJavaCloseable {
        iterator(): HtswJavaIterator<HtswJavaPath>;
    }

    interface HtswJavaPathStream extends HtswJavaCloseable {
        iterator(): HtswJavaIterator<HtswJavaPath>;
    }

    interface HtswJavaFileTime {
        toMillis(): unknown;
    }

    interface HtswJavaByteArray {
        readonly length: number;
        [index: number]: number;
    }

    interface HtswJavaNumberArray {
        readonly length: number;
        [index: number]: number;
    }

    interface HtswJavaObjectArray<T> {
        readonly length: number;
        [index: number]: T;
    }

    interface HtswJavaPathsClass {
        get(path: string): HtswJavaPath;
    }

    interface HtswJavaFilesClass {
        copy(
            source: HtswJavaInputStream,
            target: HtswJavaPath,
            ...options: unknown[]
        ): number;
        createDirectories(path: HtswJavaPath): HtswJavaPath;
        delete(path: HtswJavaPath): void;
        deleteIfExists(path: HtswJavaPath): boolean;
        exists(path: HtswJavaPath): boolean;
        getLastModifiedTime(path: HtswJavaPath): HtswJavaFileTime;
        isDirectory(path: HtswJavaPath): boolean;
        isRegularFile(path: HtswJavaPath): boolean;
        list(path: HtswJavaPath): HtswJavaPathStream;
        move(
            source: HtswJavaPath,
            target: HtswJavaPath,
            ...options: unknown[]
        ): HtswJavaPath;
        newDirectoryStream(path: HtswJavaPath): HtswJavaDirectoryStream;
        notExists(path: HtswJavaPath): boolean;
        readAllBytes(path: HtswJavaPath): HtswJavaByteArray;
        write(
            path: HtswJavaPath,
            bytes: HtswJavaByteArray,
            ...options: unknown[]
        ): HtswJavaPath;
    }

    interface HtswJavaCopyOptionsClass {
        readonly ATOMIC_MOVE: unknown;
        readonly REPLACE_EXISTING: unknown;
    }

    interface HtswJavaOpenOptionsClass {
        readonly APPEND: unknown;
        readonly CREATE: unknown;
    }

    interface HtswJavaCharsetClass {
        readonly UTF_8: unknown;
    }

    interface HtswJavaString {
        getBytes(charset?: unknown): HtswJavaByteArray;
        toString(): string;
    }

    interface HtswJavaStringClass {
        new (value: unknown): HtswJavaString;
    }

    interface HtswJavaLong {
        toString(): string;
    }

    interface HtswJavaLongClass {
        valueOf(value: string): HtswJavaLong;
    }

    type HtswJavaPrimitiveClass = object;

    interface HtswJavaDoubleClass {
        readonly TYPE: HtswJavaPrimitiveClass;
    }

    interface HtswJavaIntegerClass {
        readonly TYPE: HtswJavaPrimitiveClass;
    }

    interface HtswJavaReflectMethod<T> {
        invoke(target: null, ...arguments_: unknown[]): T;
    }

    interface HtswLongValue {
        add(other: HtswLongValue): HtswLongValue;
        and(other: HtswLongValue): HtswLongValue;
        div(other: HtswLongValue): HtswLongValue;
        eq(other: HtswLongValue): boolean;
        gt(other: HtswLongValue): boolean;
        high(): number;
        low(): number;
        lt(other: HtswLongValue): boolean;
        mod(other: HtswLongValue): HtswLongValue;
        mul(other: HtswLongValue): HtswLongValue;
        or(other: HtswLongValue): HtswLongValue;
        shl(bits: number): HtswLongValue;
        shr(bits: number): HtswLongValue;
        shru(bits: number): HtswLongValue;
        sub(other: HtswLongValue): HtswLongValue;
        toNumber(): number;
        toString(): string;
        xor(other: HtswLongValue): HtswLongValue;
    }

    interface HtswLongValueClass {
        getMethod(
            name: "fromString",
            parameterType: HtswJavaStringClass
        ): HtswJavaReflectMethod<HtswLongValue>;
        getMethod(
            name: "fromNumber",
            parameterType: HtswJavaPrimitiveClass
        ): HtswJavaReflectMethod<HtswLongValue>;
        getMethod(
            name: "fromBits",
            lowType: HtswJavaPrimitiveClass,
            highType: HtswJavaPrimitiveClass
        ): HtswJavaReflectMethod<HtswLongValue>;
        getMethod(name: "zero"): HtswJavaReflectMethod<HtswLongValue>;
    }

    interface HtswJavaUrlClassLoader {
        loadClass(name: "LongValue"): HtswLongValueClass;
    }

    interface HtswJavaUrlClassLoaderClass {
        new (urls: HtswJavaObjectArray<HtswJavaUrl>): HtswJavaUrlClassLoader;
    }

    interface HtswJavaReflectArrayClass {
        newInstance<T>(componentType: unknown, length: number): HtswJavaObjectArray<T>;
        set<T>(array: HtswJavaObjectArray<T>, index: number, value: T): void;
    }

    interface HtswJavaRunnable {
        run(): void;
    }

    interface HtswJavaRunnableClass {
        new (implementation: HtswJavaRunnable): HtswJavaRunnable;
    }

    interface HtswJavaThread {
        join(): void;
        setDaemon(daemon: boolean): void;
        start(): void;
    }

    interface HtswJavaThreadClass {
        new (runnable: HtswJavaRunnable): HtswJavaThread;
        currentThread(): HtswJavaThread;
        sleep(milliseconds: number): void;
    }

    interface HtswJavaUrlConnection {
        getInputStream(): HtswJavaInputStream;
        setConnectTimeout(milliseconds: number): void;
        setReadTimeout(milliseconds: number): void;
        setRequestProperty(name: string, value: string): void;
    }

    interface HtswJavaHttpConnection extends HtswJavaUrlConnection {
        getErrorStream(): HtswJavaInputStream | null;
        getOutputStream(): HtswJavaOutputStream;
        getResponseCode(): number;
        setDoOutput(enabled: boolean): void;
        setRequestMethod(method: string): void;
    }

    interface HtswJavaUrl {
        openConnection(): HtswJavaHttpConnection;
    }

    interface HtswJavaUrlClass {
        new (url: string): HtswJavaUrl;
    }

    type HtswJavaInputStreamReader = HtswJavaCloseable;

    interface HtswJavaInputStreamReaderClass {
        new (stream: HtswJavaInputStream, charset?: string): HtswJavaInputStreamReader;
    }

    interface HtswJavaBufferedReader extends HtswJavaCloseable {
        readLine(): string | { toString(): string } | null;
    }

    interface HtswJavaBufferedReaderClass {
        new (reader: HtswJavaInputStreamReader): HtswJavaBufferedReader;
    }

    interface HtswJavaOutputStreamWriter extends HtswJavaCloseable {
        write(value: string): void;
    }

    interface HtswJavaOutputStreamWriterClass {
        new (stream: HtswJavaOutputStream, charset?: string): HtswJavaOutputStreamWriter;
    }

    type HtswJavaFileInputStream = HtswJavaInputStream;

    interface HtswJavaFileInputStreamClass {
        new (path: string): HtswJavaFileInputStream;
    }

    interface HtswJavaZipEntry {
        getName(): unknown;
        isDirectory(): boolean;
    }

    interface HtswJavaZipInputStream extends HtswJavaInputStream {
        closeEntry(): void;
        getNextEntry(): HtswJavaZipEntry | null;
    }

    interface HtswJavaZipInputStreamClass {
        new (stream: HtswJavaInputStream): HtswJavaZipInputStream;
    }

    interface HtswJavaMessageDigest {
        digest(bytes: HtswJavaByteArray): HtswJavaByteArray;
    }

    interface HtswJavaMessageDigestClass {
        getInstance(algorithm: string): HtswJavaMessageDigest;
    }

    interface HtswJavaList<T> {
        add(value: T): boolean;
    }

    interface HtswJavaArrayListClass {
        new <T = string>(): HtswJavaList<T>;
    }

    interface HtswJavaQueue<T> {
        add(value: T): boolean;
        poll(): T | null;
    }

    interface HtswJavaConcurrentLinkedQueueClass {
        new <T = string>(): HtswJavaQueue<T>;
    }

    interface HtswJavaProcess {
        getErrorStream(): HtswJavaInputStream;
        getInputStream(): HtswJavaInputStream;
        waitFor(): number;
    }

    interface HtswJavaProcessBuilder {
        redirectErrorStream(redirect: boolean): HtswJavaProcessBuilder;
        start(): HtswJavaProcess;
    }

    interface HtswJavaProcessBuilderClass {
        new (command: HtswJavaList<string>): HtswJavaProcessBuilder;
    }

    interface HtswJavaSystemClass {
        getProperty(name: string): unknown;
    }

    interface HtswJavaFile {
        getAbsolutePath(): unknown;
        getParentFile(): HtswJavaFile | null;
        length(): unknown;
        mkdirs(): boolean;
    }

    interface HtswJavaFileClass {
        new (path: string): HtswJavaFile;
    }

    interface HtswJavaRuntime {
        freeMemory(): unknown;
        maxMemory(): unknown;
        totalMemory(): unknown;
    }

    interface HtswJavaRuntimeClass {
        getRuntime(): HtswJavaRuntime;
    }

    interface HtswGarbageCollectorMxBean {
        getCollectionCount(): unknown;
        getCollectionTime(): unknown;
        getName(): unknown;
    }

    interface HtswJavaManagementFactoryClass {
        getGarbageCollectorMXBeans(): {
            get(index: number): HtswGarbageCollectorMxBean;
            size(): number;
        };
        getPlatformMBeanServer(): HtswMBeanServer;
    }

    type HtswObjectName = object;

    interface HtswObjectNameClass {
        new (name: string): HtswObjectName;
    }

    interface HtswMBeanServer {
        invoke(
            name: HtswObjectName,
            operationName: string,
            params: HtswJavaObjectArray<unknown>,
            signature: HtswJavaObjectArray<string>
        ): unknown;
    }

    interface HtswJavaDesktop {
        open(file: HtswJavaFile): void;
    }

    interface HtswJavaDesktopClass {
        getDesktop(): HtswJavaDesktop;
    }

    interface HtswJavaClipboard {
        setContents(contents: HtswJavaTransferable, owner: unknown): void;
    }

    interface HtswJavaToolkit {
        getSystemClipboard(): HtswJavaClipboard;
    }

    interface HtswJavaToolkitClass {
        getDefaultToolkit(): HtswJavaToolkit;
    }

    type HtswJavaTransferable = object;

    interface HtswJavaStringSelectionClass {
        new (value: string): HtswJavaTransferable;
    }

    interface HtswLwjglMouseClass {
        getDWheel(): number;
        getEventDWheel(): number;
        getEventX(): number;
        getEventY(): number;
        getX(): number;
        getY(): number;
        isButtonDown(button: number): boolean;
        setCursorPosition(x: number, y: number): void;
    }

    interface HtswLwjglKeyboardClass {
        getEventCharacter(): string;
        getEventKey(): number;
        getEventKeyState(): boolean;
        isKeyDown(key: number): boolean;
    }

    interface HtswGl11Class {
        readonly GL_BLEND: number;
        readonly GL_DEPTH_TEST: number;
        readonly GL_MODELVIEW: number;
        readonly GL_ONE_MINUS_SRC_ALPHA: number;
        readonly GL_PROJECTION: number;
        readonly GL_SCISSOR_TEST: number;
        readonly GL_SRC_ALPHA: number;
        glBlendFunc(sourceFactor: number, destinationFactor: number): void;
        glDepthMask(enabled: boolean): void;
        glDisable(capability: number): void;
        glEnable(capability: number): void;
        glMatrixMode(mode: number): void;
        glPopMatrix(): void;
        glPushMatrix(): void;
        glScalef(x: number, y: number, z: number): void;
        glScissor(x: number, y: number, width: number, height: number): void;
        glTranslated(x: number, y: number, z: number): void;
    }

    interface HtswGlStateManagerClass {
        func_179097_i(): void;
        func_179098_w(): void;
        func_179120_a(
            sourceFactor: number,
            destinationFactor: number,
            sourceAlphaFactor: number,
            destinationAlphaFactor: number
        ): void;
        func_179126_j(): void;
        func_179131_c(red: number, green: number, blue: number, alpha: number): void;
        func_179140_f(): void;
        func_179147_l(): void;
    }

    interface HtswRenderHelperClass {
        disableStandardItemLighting(): void;
        func_74518_a(): void;
        func_74520_c(): void;
    }

    type HtswMinecraftItem = MCItem;

    interface HtswMinecraftItemClass {
        readonly field_150901_e: {
            func_148750_c(item: HtswMinecraftItem): { toString(): string } | null;
        };
        func_111206_d(id: string): HtswMinecraftItem | null;
        func_150891_b(item: HtswMinecraftItem): number;
    }

    interface HtswMinecraftNbtClass {
        getSimpleName(): unknown;
    }

    interface HtswMinecraftNbtBase {
        getClass(): HtswMinecraftNbtClass;
        toString(): string;
    }

    interface HtswMinecraftNbtByte extends HtswMinecraftNbtBase {
        func_150290_f(): number;
    }

    interface HtswMinecraftNbtShort extends HtswMinecraftNbtBase {
        func_150289_e(): number;
    }

    interface HtswMinecraftNbtInt extends HtswMinecraftNbtBase {
        func_150287_d(): number;
    }

    interface HtswMinecraftNbtLong extends HtswMinecraftNbtBase {
        func_150291_c(): HtswJavaLong;
    }

    interface HtswMinecraftNbtFloat extends HtswMinecraftNbtBase {
        func_150288_h(): number;
    }

    interface HtswMinecraftNbtDouble extends HtswMinecraftNbtBase {
        func_150286_g(): number;
    }

    interface HtswMinecraftNbtString extends HtswMinecraftNbtBase {
        func_150285_a_(): unknown;
    }

    interface HtswMinecraftNbtByteArray extends HtswMinecraftNbtBase {
        func_150292_c(): HtswJavaNumberArray;
    }

    interface HtswMinecraftNbtIntArray extends HtswMinecraftNbtBase {
        func_150302_c(): HtswJavaNumberArray;
    }

    interface HtswMinecraftNbtCompound extends HtswMinecraftNbtBase {
        func_74781_a(key: string): HtswMinecraftNbtBase | null;
        func_74782_a(key: string, value: HtswMinecraftNbtBase): void;
        func_150296_c(): HtswJavaObjectArray<string | { toString(): string }>;
    }

    interface HtswMinecraftNbtList extends HtswMinecraftNbtBase {
        func_74742_a(value: HtswMinecraftNbtBase): void;
        func_74745_c(): number;
        func_179238_g(index: number): HtswMinecraftNbtBase;
    }

    interface HtswMinecraftNbtKindMap {
        NBTTagByte: HtswMinecraftNbtByte;
        NBTTagShort: HtswMinecraftNbtShort;
        NBTTagInt: HtswMinecraftNbtInt;
        NBTTagLong: HtswMinecraftNbtLong;
        NBTTagFloat: HtswMinecraftNbtFloat;
        NBTTagDouble: HtswMinecraftNbtDouble;
        NBTTagString: HtswMinecraftNbtString;
        NBTTagByteArray: HtswMinecraftNbtByteArray;
        NBTTagIntArray: HtswMinecraftNbtIntArray;
        NBTTagCompound: HtswMinecraftNbtCompound;
        NBTTagList: HtswMinecraftNbtList;
    }

    interface HtswMinecraftNumberNbtClass<T extends HtswMinecraftNbtBase> {
        new (value: number): T;
    }

    interface HtswMinecraftNbtLongClass {
        new (value: HtswJavaLong): HtswMinecraftNbtLong;
    }

    interface HtswMinecraftNbtStringClass {
        new (value: string): HtswMinecraftNbtString;
    }

    interface HtswMinecraftNbtListClass {
        new (): HtswMinecraftNbtList;
    }

    interface HtswMinecraftNbtCompoundClass {
        new (): HtswMinecraftNbtCompound;
    }

    interface HtswMinecraftNbtByteArrayClass {
        new (value: HtswJavaNumberArray): HtswMinecraftNbtByteArray;
    }

    interface HtswMinecraftNbtIntArrayClass {
        new (value: HtswJavaNumberArray): HtswMinecraftNbtIntArray;
    }

    type HtswMinecraftItemStack = MCItemStack;

    interface MCItemStack {
        field_77994_a: number;
        func_77960_j(): number;
        func_77973_b(): HtswMinecraftItem | null;
        func_77955_b(compound: HtswMinecraftNbtCompound): HtswMinecraftNbtCompound;
        func_77978_p(): HtswMinecraftNbtCompound | null;
        func_82833_r(): unknown;
    }

    interface HtswMinecraftItemStackClass {
        new (
            item: HtswMinecraftItem,
            count: number,
            metadata?: number
        ): HtswMinecraftItemStack;
        func_77949_a(compound: HtswMinecraftNbtCompound): HtswMinecraftItemStack | null;
    }

    interface HtswMinecraftJsonToNbtClass {
        func_180713_a(value: string): HtswMinecraftNbtCompound;
    }

    interface HtswGuiTextField {
        field_146209_f: number;
        field_146210_g: number;
        func_146178_a(): void;
        func_146179_b(): string;
        func_146180_a(text: string): void;
        func_146185_a(enabled: boolean): void;
        func_146190_e(position: number): void;
        func_146195_b(focused: boolean): void;
        func_146198_h(): number;
        func_146203_f(maxLength: number): void;
        func_146205_d(canLoseFocus: boolean): void;
    }

    interface HtswGuiTextFieldClass {
        new (
            componentId: number,
            fontRenderer: unknown,
            x: number,
            y: number,
            width: number,
            height: number
        ): HtswGuiTextField;
    }

    interface HtswScaledResolution {
        func_78325_e(): number;
        func_78326_a(): number;
    }

    interface HtswScaledResolutionClass {
        new (minecraft: unknown): HtswScaledResolution;
    }

    interface HtswGuiScreenClass {
        setClipboardString(value: string): void;
    }

    interface HtswGuiInventoryClass {
        readonly class: HtswJavaClass;
        new (player: HtswMinecraftPlayer): HtswMinecraftGuiScreen;
    }

    interface HtswMinecraftKeyBindingClass {
        func_74507_a(keyCode: number): void;
        func_74510_a(keyCode: number, pressed: boolean): void;
    }

    interface HtswForgeElementType {
        equals(other: unknown): boolean;
    }

    interface HtswForgeElementTypeClass {
        readonly ALL: HtswForgeElementType;
    }

    type HtswMinecraftGuiEditSign = HtswMinecraftGuiScreen;

    interface HtswMinecraftGuiEditSignClass {
        new (...args: never[]): HtswMinecraftGuiEditSign;
    }

    interface HtswMinecraftChatComponent {
        func_150254_d(): string;
    }

    interface HtswMinecraftChatComponentTextClass {
        new (text: string): HtswMinecraftChatComponent;
    }

    interface HtswMinecraftChatComponentClass {
        readonly class: HtswJavaClass;
    }

    interface HtswPacketInstance {
        readonly class: HtswJavaClass;
    }

    interface HtswPacketClass {
        new (...args: never[]): HtswPacketInstance;
    }

    type HtswChatPacket = HtswPacketInstance;

    interface HtswChatPacketClass {
        new (message: string): HtswChatPacket;
    }

    interface HtswCreativeInventoryPacketClass {
        new (slot: number, stack: HtswMinecraftItemStack | null): HtswPacketInstance;
    }

    interface HtswSignUpdatePacketClass {
        new (
            position: unknown,
            lines: HtswJavaObjectArray<HtswMinecraftChatComponent>
        ): HtswPacketInstance;
    }

    interface HtswJavaTypeMap {
        "java.awt.Desktop": HtswJavaDesktopClass;
        "java.awt.Toolkit": HtswJavaToolkitClass;
        "java.awt.datatransfer.StringSelection": HtswJavaStringSelectionClass;
        "java.io.BufferedReader": HtswJavaBufferedReaderClass;
        "java.io.File": HtswJavaFileClass;
        "java.io.FileInputStream": HtswJavaFileInputStreamClass;
        "java.io.InputStreamReader": HtswJavaInputStreamReaderClass;
        "java.io.OutputStreamWriter": HtswJavaOutputStreamWriterClass;
        "java.lang.ProcessBuilder": HtswJavaProcessBuilderClass;
        "java.lang.Double": HtswJavaDoubleClass;
        "java.lang.Integer": HtswJavaIntegerClass;
        "java.lang.Long": HtswJavaLongClass;
        "java.lang.Runtime": HtswJavaRuntimeClass;
        "java.lang.Runnable": HtswJavaRunnableClass;
        "java.lang.String": HtswJavaStringClass;
        "java.lang.System": HtswJavaSystemClass;
        "java.lang.Thread": HtswJavaThreadClass;
        "java.lang.management.ManagementFactory": HtswJavaManagementFactoryClass;
        "javax.management.ObjectName": HtswObjectNameClass;
        "java.net.URL": HtswJavaUrlClass;
        "java.net.URLClassLoader": HtswJavaUrlClassLoaderClass;
        "java.nio.charset.StandardCharsets": HtswJavaCharsetClass;
        "java.nio.file.Files": HtswJavaFilesClass;
        "java.nio.file.Paths": HtswJavaPathsClass;
        "java.nio.file.StandardCopyOption": HtswJavaCopyOptionsClass;
        "java.nio.file.StandardOpenOption": HtswJavaOpenOptionsClass;
        "java.security.MessageDigest": HtswJavaMessageDigestClass;
        "java.lang.reflect.Array": HtswJavaReflectArrayClass;
        "java.util.ArrayList": HtswJavaArrayListClass;
        "java.util.concurrent.ConcurrentLinkedQueue": HtswJavaConcurrentLinkedQueueClass;
        "java.util.zip.ZipInputStream": HtswJavaZipInputStreamClass;
        "net.minecraft.client.gui.GuiScreen": HtswGuiScreenClass;
        "net.minecraft.client.gui.GuiTextField": HtswGuiTextFieldClass;
        "net.minecraft.client.gui.inventory.GuiEditSign": HtswMinecraftGuiEditSignClass;
        "net.minecraft.client.gui.inventory.GuiInventory": HtswGuiInventoryClass;
        "net.minecraft.client.gui.ScaledResolution": HtswScaledResolutionClass;
        "net.minecraft.client.settings.KeyBinding": HtswMinecraftKeyBindingClass;
        "net.minecraft.client.renderer.GlStateManager": HtswGlStateManagerClass;
        "net.minecraft.client.renderer.RenderHelper": HtswRenderHelperClass;
        "net.minecraft.item.Item": HtswMinecraftItemClass;
        "net.minecraft.item.ItemStack": HtswMinecraftItemStackClass;
        "net.minecraft.nbt.JsonToNBT": HtswMinecraftJsonToNbtClass;
        "net.minecraft.nbt.NBTTagByte": HtswMinecraftNumberNbtClass<HtswMinecraftNbtByte>;
        "net.minecraft.nbt.NBTTagByteArray": HtswMinecraftNbtByteArrayClass;
        "net.minecraft.nbt.NBTTagCompound": HtswMinecraftNbtCompoundClass;
        "net.minecraft.nbt.NBTTagDouble": HtswMinecraftNumberNbtClass<HtswMinecraftNbtDouble>;
        "net.minecraft.nbt.NBTTagFloat": HtswMinecraftNumberNbtClass<HtswMinecraftNbtFloat>;
        "net.minecraft.nbt.NBTTagInt": HtswMinecraftNumberNbtClass<HtswMinecraftNbtInt>;
        "net.minecraft.nbt.NBTTagIntArray": HtswMinecraftNbtIntArrayClass;
        "net.minecraft.nbt.NBTTagList": HtswMinecraftNbtListClass;
        "net.minecraft.nbt.NBTTagLong": HtswMinecraftNbtLongClass;
        "net.minecraft.nbt.NBTTagShort": HtswMinecraftNumberNbtClass<HtswMinecraftNbtShort>;
        "net.minecraft.nbt.NBTTagString": HtswMinecraftNbtStringClass;
        "net.minecraft.network.play.client.C01PacketChatMessage": HtswChatPacketClass;
        "net.minecraft.network.play.client.C10PacketCreativeInventoryAction": HtswCreativeInventoryPacketClass;
        "net.minecraft.network.play.client.C12PacketUpdateSign": HtswSignUpdatePacketClass;
        "net.minecraft.network.play.server.S2DPacketOpenWindow": HtswPacketClass;
        "net.minecraft.network.play.server.S2FPacketSetSlot": HtswPacketClass;
        "net.minecraft.network.play.server.S30PacketWindowItems": HtswPacketClass;
        "net.minecraft.util.ChatComponentText": HtswMinecraftChatComponentTextClass;
        "net.minecraft.util.IChatComponent": HtswMinecraftChatComponentClass;
        "net.minecraftforge.client.event.GuiOpenEvent": JavaClass<unknown>;
        "net.minecraftforge.client.event.GuiScreenEvent$KeyboardInputEvent$Pre": JavaClass<unknown>;
        "net.minecraftforge.client.event.GuiScreenEvent$MouseInputEvent$Pre": JavaClass<unknown>;
        "net.minecraftforge.client.event.RenderGameOverlayEvent$ElementType": JavaClass<unknown> &
            HtswForgeElementTypeClass;
        "net.minecraftforge.client.event.RenderGameOverlayEvent$Post": JavaClass<unknown>;
        "org.lwjgl.input.Keyboard": HtswLwjglKeyboardClass;
        "org.lwjgl.input.Mouse": HtswLwjglMouseClass;
        "org.lwjgl.opengl.GL11": HtswGl11Class;
    }
}
