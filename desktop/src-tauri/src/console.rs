//! A Windows GUI-subsystem process has no stdout; `--version` and `--smoke` print, so they attach to the
//! parent's console (or to the pipe the parent redirected).

#[cfg(windows)]
pub fn attach() {
    use std::os::windows::io::IntoRawHandle;
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
        fn GetStdHandle(handle: u32) -> isize;
        fn SetStdHandle(handle: u32, value: isize) -> i32;
    }
    // SAFETY: plain Win32 calls with valid constants; the opened handle is leaked on purpose.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
        let current = GetStdHandle(STD_OUTPUT_HANDLE);
        if current == 0 || current == -1 {
            if let Ok(console) = std::fs::OpenOptions::new().write(true).open("CONOUT$") {
                SetStdHandle(STD_OUTPUT_HANDLE, console.into_raw_handle() as isize);
            }
        }
    }
}

#[cfg(not(windows))]
pub fn attach() {}
