# Canvas desktop app

`canvas-app` is a native window (Tauri 2) onto the running Canvas service. It bundles no editor and no service:
it shows `http://127.0.0.1:<port>`, where `canvas serve` (or `canvas service install`) is listening.

- **Service up:** the window shows the editor.
- **Service down:** a bundled page says so and offers *Start service*, which runs `canvas serve --port <port>`
  detached when `canvas` is on your `PATH`. The page keeps retrying and opens the editor once the service answers.
  This button is the only thing in the app that starts a process. `canvas` is looked up on `PATH`, then in
  `/opt/homebrew/bin`, `/usr/local/bin`, `~/.bun/bin`, `~/.local/bin` and `~/.npm-global/bin` (on Windows
  also `%LOCALAPPDATA%\Programs` and `%APPDATA%\npm`), because an app opened from the Finder, Dock or a menu
  gets a minimal `PATH`; no shell is started to find it.
- **Port:** `CANVAS_PORT`, else `port` in the service config (`OPENFLOWKIT_SERVICE_CONFIG`, default
  `~/.config/openflowkit/service.json`), else `43120`. A port given only to `canvas service install --port N`
  lives in the launchd/systemd unit, not in either source: set `port` in the service config for the app to
  find it.
- **Links:** `canvas://open/<project>/<id>` shows that diagram, on a cold start and in the running window
  (one instance). The window only ever navigates to the bundled page and to `http://127.0.0.1:<port>`;
  `localhost`, other ports, other hosts and `file:` are refused. (`blob:` URLs minted by the service page are
  allowed, because that is how exports download.)
- **Downloads:** exports are saved in the OS Downloads folder (created if missing), never overwriting a file
  (`name (1).png`). macOS asks once whether Canvas may access Downloads.

## Flags

```
canvas-app --version   # canvas-app 0.4.0
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

`bunx @tauri-apps/cli@2 icon icon-source.svg -o src-tauri/icons` regenerates the icons from the logo.
