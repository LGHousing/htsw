/// <reference types="../../CTAutocomplete" />

// Native Windows file/folder picker via PowerShell + inline C# wrapping
// IFileOpenDialog (the Common Item Dialog API used by Explorer, Chrome,
// Edge, and modern Windows apps).
//
// Runs the picker on a daemon thread so the calling thread (typically the
// MC render thread) is not blocked. The onPicked callback is invoked from
// that worker thread once the dialog closes; if you need to mutate
// script-side state, route through a thread-safe queue and drain on a
// known thread (see queueSourcePath in gui/left-panel/explore/source.ts
// for an example using ConcurrentLinkedQueue).

export type NativePickerMode = "file" | "folder";

export type NativePickerOptions = {
    mode: NativePickerMode;
    title?: string;
    multi?: boolean; // file mode only; default true
    onPicked: (paths: string[]) => void;
    onError?: (msg: string) => void;
};

const NATIVE_PICKER_CSHARP = `
using System;
using System.Runtime.InteropServices;

public static class HtswPicker {
    [Flags]
    public enum FOS : uint {
        PICKFOLDERS = 0x00000020,
        FORCEFILESYSTEM = 0x00000040,
        ALLOWMULTISELECT = 0x00000200,
        PATHMUSTEXIST = 0x00000800,
        FILEMUSTEXIST = 0x00001000,
    }
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogRCW { }

    [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
        [PreserveSig] uint Show(IntPtr hwndOwner);
        void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
        void SetFileTypeIndex(uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise(IntPtr pfde, out uint pdwCookie);
        void Unadvise(uint dwCookie);
        void SetOptions(FOS fos);
        void GetOptions(out FOS pfos);
        void SetDefaultFolder(IShellItem psi);
        void SetFolder(IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
        void AddPlace(IShellItem psi, int alignment);
        void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
        void Close(int hr);
        void SetClientGuid(ref Guid guid);
        void ClearClientData();
        void SetFilter(IntPtr pFilter);
        void GetResults(out IShellItemArray ppenum);
        void GetSelectedItems(out IShellItemArray ppsai);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
        void Compare(IShellItem psi, uint hint, out int piOrder);
    }

    [ComImport, Guid("B63EA76D-1F85-456F-A19C-48159EFA858B"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemArray {
        void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
        void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
        void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
        void GetAttributes(uint attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
        void GetCount(out uint pdwNumItems);
        void GetItemAt(uint dwIndex, out IShellItem ppsi);
        void EnumItems(out IntPtr ppenumShellItems);
    }

    public static string[] PickFiles(string title, bool multi) {
        var dlg = (IFileOpenDialog)new FileOpenDialogRCW();
        try {
            FOS opts;
            dlg.GetOptions(out opts);
            opts |= FOS.FORCEFILESYSTEM | FOS.FILEMUSTEXIST | FOS.PATHMUSTEXIST;
            if (multi) opts |= FOS.ALLOWMULTISELECT;
            dlg.SetOptions(opts);
            if (title != null) dlg.SetTitle(title);
            uint hr = dlg.Show(IntPtr.Zero);
            if (hr != 0) return new string[0];
            IShellItemArray arr;
            dlg.GetResults(out arr);
            uint cnt;
            arr.GetCount(out cnt);
            string[] result = new string[cnt];
            for (uint i = 0; i < cnt; i++) {
                IShellItem item;
                arr.GetItemAt(i, out item);
                string p;
                item.GetDisplayName(SIGDN_FILESYSPATH, out p);
                result[i] = p;
            }
            return result;
        } finally {
            Marshal.ReleaseComObject(dlg);
        }
    }

    public static string PickFolder(string title) {
        var dlg = (IFileOpenDialog)new FileOpenDialogRCW();
        try {
            FOS opts;
            dlg.GetOptions(out opts);
            opts |= FOS.PICKFOLDERS | FOS.FORCEFILESYSTEM | FOS.PATHMUSTEXIST;
            dlg.SetOptions(opts);
            if (title != null) dlg.SetTitle(title);
            uint hr = dlg.Show(IntPtr.Zero);
            if (hr != 0) return null;
            IShellItem item;
            dlg.GetResult(out item);
            string p;
            item.GetDisplayName(SIGDN_FILESYSPATH, out p);
            return p;
        } finally {
            Marshal.ReleaseComObject(dlg);
        }
    }
}
`;

function escapePsString(s: string): string {
    return s.replace(/'/g, "''");
}

function buildScript(opts: NativePickerOptions): string {
    const title = opts.title ?? (opts.mode === "file" ? "Open files" : "Open folder");
    const titleArg = `'${escapePsString(title)}'`;
    const call =
        opts.mode === "file"
            ? `foreach ($p in [HtswPicker]::PickFiles(${titleArg}, $${
                  opts.multi !== false ? "true" : "false"
              })) { [Console]::Out.WriteLine($p) }`
            : `$p = [HtswPicker]::PickFolder(${titleArg}); if ($p) { [Console]::Out.WriteLine($p) }`;
    return (
        "$ErrorActionPreference = 'Stop';" +
        "Add-Type -TypeDefinition @'\n" +
        NATIVE_PICKER_CSHARP +
        "\n'@;" +
        call
    );
}

function encodePsCommand(script: string): string {
    const JString = Java.type("java.lang.String");
    const Charset = Java.type("java.nio.charset.Charset");
    const Base64 = Java.type("java.util.Base64");
    const bytes = new JString(script).getBytes(Charset.forName("UTF-16LE"));
    return String(Base64.getEncoder().encodeToString(bytes));
}

export function showNativePicker(opts: NativePickerOptions): void {
    const Thread = Java.type("java.lang.Thread");
    const Runnable = Java.type("java.lang.Runnable");

    const errorOut = (msg: string): void => {
        if (opts.onError !== undefined) opts.onError(msg);
    };

    let t: any;
    try {
        t = new Thread(
            new Runnable({
                run: function () {
                    try {
                        runPicker(opts, errorOut);
                    } catch (e) {
                        errorOut(`nativePicker threw: ${String(e)}`);
                    }
                },
            })
        );
    } catch (e) {
        errorOut(`nativePicker thread construction failed: ${String(e)}`);
        return;
    }
    try {
        t.setDaemon(true);
        t.start();
    } catch (e) {
        errorOut(`nativePicker thread.start failed: ${String(e)}`);
    }
}

function runPicker(opts: NativePickerOptions, errorOut: (msg: string) => void): void {
    const ProcessBuilder = Java.type("java.lang.ProcessBuilder");
    const ArrayList = Java.type("java.util.ArrayList");
    const BufferedReader = Java.type("java.io.BufferedReader");
    const InputStreamReader = Java.type("java.io.InputStreamReader");
    const Charset = Java.type("java.nio.charset.Charset");

    const encoded = encodePsCommand(buildScript(opts));

    const args = new ArrayList();
    args.add("powershell.exe");
    args.add("-NoProfile");
    args.add("-STA");
    args.add("-EncodedCommand");
    args.add(encoded);

    const pb = new ProcessBuilder(args);
    pb.redirectErrorStream(false);
    const proc = pb.start();
    const reader = new BufferedReader(
        new InputStreamReader(proc.getInputStream(), Charset.forName("UTF-8"))
    );
    const lines: string[] = [];
    try {
        while (true) {
            const line = reader.readLine();
            if (line === null) break;
            const s = String(line).replace(/\s+$/g, "");
            if (s.length > 0) lines.push(s);
        }
    } finally {
        try {
            reader.close();
        } catch (_e) {
            /* ignore */
        }
    }
    const exit = proc.waitFor();
    if (exit !== 0) {
        errorOut(`nativePicker exited ${exit}`);
        return;
    }
    opts.onPicked(lines);
}
