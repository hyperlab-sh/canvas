# Canvas desktop app

`canvas-app` is a native window (Tauri 2) onto the running Canvas service. It bundles no editor and no service:
it shows `http://127.0.0.1:<port>`, where `canvas serve` (or `canvas service install`) is listening.

- **Service up:** the window shows the editor.
- **Service down:** a bundled page says so and offers *Start service*, which runs `canvas serve --port <port>`
  detached when `canvas` is on your `PATH`. The page keeps retrying and opens the editor once the service answers.
  This button is the only thing in the app that starts a process. `canvas` is looked up on `PATH`, then in
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin` and `~/.npm-global/bin` (on Windows
  also `%LOCALAPPDATA%\canvas\bin` and `%APPDATA%\npm`), because an app opened from the Finder, Dock or a menu
  gets a minimal `PATH`; no shell is started to find it.
- **Port:** `CANVAS_PORT`, else `port` in the service config (`CANVAS_SERVICE_CONFIG`, default
  `~/.config/canvas/service.json`), else `43120`. A port given only to `canvas service install --port N`
  lives in the launchd/systemd unit, not in either source: set `port` in the service config for the app to
  find it.
- **Links:** `canvas://home` (or the bare `canvas://`) shows the editor home and brings the window to the front; `canvas://open/<project>/<id>` shows that diagram, on a cold start and in the running window
  (one instance). The window only ever navigates to the bundled page and to `http://127.0.0.1:<port>`;
  `localhost`, other ports, other hosts and `file:` are refused. (`blob:` URLs minted by the service page are
  allowed, because that is how exports download.)
- **Files:** a diagram file dropped on the window, opened with the app (argv, `open -a Canvas f`, `xdg-open`, "Open
  With") or passed on the command line opens as a diagram. The first openable file wins when several arrive.
  - `*.openflow.json` inside a project the service knows (matched by real path, as `canvas open` does) opens in place.
  - `*.openflow.json` anywhere else is imported into the `scratch` project as a copy with a new id (dropping the
    same file twice imports it twice) and opened.
  - `*.openflow` (OpenFlow DSL) and `*.mmd` (Mermaid) open as a new diagram titled by the file name, through the
    editor's `#/from/dsl` route; the file must be UTF-8 text of at most 1 MB.
  - A file inside a project folder opens in place only if the service lists a diagram with that id there;
    otherwise (a suffix in another case, an id another file already holds) it is imported like any other.
  - Other files are ignored. The drop is handled natively, so the page never receives the file and the window
    never navigates to it. With the service down the file is held and opens once it answers.
  - **Known loss:** because the page receives no drops, the editor's own drop targets do not work in the app:
    the home page's drop-to-import and the agent panel's image drop. Use the editor's import button, or drop a
    diagram file on the window.
  - A file that cannot be opened (not a diagram, rejected by the service) is reported on stderr only; a
    follow-up should show it in the window. If the service rejects an import after creating its diagram, the
    message names the empty diagram left in `scratch` (the service has no delete route).
  - Associations: Linux registers all three globs (`share/mime/packages/canvas-app.xml`, `Exec=... %U`). macOS and
    Windows only match the last extension of a name, so there `.openflow` and `.mmd` are associated and
    `.openflow.json` opens by drop, "Open With", `open -a Canvas f` or `canvas open`. The AppImage registers no
    file association.
- **Downloads:** exports are saved in the OS Downloads folder (created if missing), never overwriting a file
  (`name (1).png`). macOS asks once whether Canvas may access Downloads.

## Flags

```
canvas-app --version   # canvas-app 0.4.1
canvas-app --smoke     # one JSON line, exit 0 when the editor mounted, 1 when it did not within 30 s
```

`--smoke` prints `{"ok":true,"mounted":true,"errors":[],"url":"http://127.0.0.1:43120/#/d/..."}`. `ok` is whether
the editor mounted; `errors` lists console errors and uncaught exceptions seen until then. With no service
answering it exits 1 at once.

## Build

Needs Rust 1.90 or newer. `rust-toolchain.toml` pins the version the lockfile was verified with; rustup applies
it only when cargo runs inside `desktop/`, and `cargo +stable ...` (what the repository gate uses) overrides it.
On Linux it also needs the WebKitGTK 4.1 and GTK 3 development
packages (see the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml     # unit tests
bunx @tauri-apps/cli@2 build --bundles app                   # Canvas.app on macOS (omit --bundles for all)
./src-tauri/target/release/canvas-app --smoke                # against a running `canvas serve`
```

`bunx @tauri-apps/cli@2 icon ../assets/logo.svg -o src-tauri/icons` regenerates the icons from the logo.
