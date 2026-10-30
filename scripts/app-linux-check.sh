#!/usr/bin/env bash
# Installs the built canvas-app .deb with the canvas .deb on this (Ubuntu) runner and checks it under xvfb.
#   scripts/app-linux-check.sh <app assets dir> <canvas packages dir> <app version> <cli version> [--files]
# SMOKE_OUT (default: a temp dir) receives the smoke JSON.
# Always: the .deb and .rpm dependency lines, the install, and `canvas-app --smoke` against the installed canvas.
# With --files (D14, D18): `xdg-open` of a .openflow.json starts the app on it, and an XDND drop of another file opens it,
# and neither makes the window navigate to file:// (the app refuses and logs that; the log must not show it); then
# `xdg-open canvas://home` takes the running app from that diagram to the editor home.
set -euo pipefail

assets="$(cd "$1" && pwd)"
packages="$(cd "$2" && pwd)"
app_version="$3"
cli_version="$4"
files=false
[ "${5:-}" = --files ] && files=true

case "$(uname -m)" in
  x86_64) cpu=x64; deb_arch=amd64 ;;
  aarch64) cpu=arm64; deb_arch=arm64 ;;
  *) echo "unsupported machine $(uname -m)" >&2; exit 1 ;;
esac
app_deb="$assets/canvas-app-$app_version-linux-$cpu.deb"
app_rpm="$assets/canvas-app-$app_version-linux-$cpu.rpm"
cli_deb="$packages/canvas_${cli_version}_$deb_arch.deb"
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "::group::package dependencies"
dpkg-deb -I "$app_deb"
rpm -qpR "$app_rpm"
echo "::endgroup::"
[ "$(dpkg-deb -f "$app_deb" Package)" = canvas-app ] || fail "the .deb is not named canvas-app"
[ "$(dpkg-deb -f "$app_deb" Depends | tr ',' '\n' | grep -c '^ *canvas (>= '"$cli_version"')$')" = 1 ] || fail "the .deb does not say Depends: canvas (>= $cli_version)"
[ "$(rpm -qp --qf '%{NAME}' "$app_rpm")" = canvas-app ] || fail "the .rpm is not named canvas-app"
rpm -qpR "$app_rpm" | grep -qxF "canvas" || fail "the .rpm does not say Requires: canvas (the bare name)"

sudo apt-get install -y "$cli_deb" "$app_deb"
canvas --version
canvas-app --version

work="$(mktemp -d)"
export OPENFLOWKIT_SERVICE_CONFIG="$work/service.json"
export HOME="$work/home"
mkdir -p "$HOME"
pids=()
# The app and its WebKit helpers keep writing under $HOME (the mesa shader cache) until they have exited, so stop them and
# wait before removing $work. Nothing here may change the exit status: by now the assertions have decided it.
# pkill and pgrep match the kernel's process name, cut to 15 characters (WebKitWebProces), so the helpers are listed truncated.
app_procs='^(canvas-app|WebKit(WebProces|NetworkPr|GPUProces))$'
cleanup() {
  set +e
  pkill -TERM "$app_procs" 2>/dev/null
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null; done
  for _ in $(seq 1 50); do pgrep "$app_procs" >/dev/null || break; sleep 0.2; done
  pkill -KILL "$app_procs" 2>/dev/null
  # Bounded: a service that ignores SIGTERM is killed rather than left to hang the job. dbus-launch's daemon is not our
  # child, so it is polled here and `wait` cannot see it.
  for _ in $(seq 1 50); do kill -0 "${pids[@]}" 2>/dev/null || break; sleep 0.2; done
  kill -KILL "${pids[@]}" 2>/dev/null
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
  for _ in 1 2 3 4 5; do rm -rf "$work" 2>/dev/null && break; sleep 1; done
  return 0
}
trap cleanup EXIT

canvas serve --port 43120 >"$work/serve.log" 2>&1 &
pids+=($!)
curl -fsS --retry 30 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:43120/health || { cat "$work/serve.log"; fail "canvas serve did not answer"; }

Xvfb :99 -screen 0 1920x1080x24 >"$work/xvfb.log" 2>&1 &
pids+=($!)
export DISPLAY=:99
for _ in $(seq 1 50); do xdpyinfo >/dev/null 2>&1 && break; sleep 0.2; done
xdpyinfo >/dev/null 2>&1 || fail "Xvfb did not start"

echo "::group::canvas-app --smoke"
smoke="$(canvas-app --smoke)" || { echo "$smoke"; fail "smoke failed"; }
echo "$smoke" | tee "${SMOKE_OUT:-$work}/smoke-linux-$cpu.json"
echo "::endgroup::"
echo "$smoke" | jq -e '.ok == true and .mounted == true' >/dev/null || fail "the editor did not mount"

# The AppImage is its own bundle: it must start and mount the editor too (extract-and-run, as the runner has no FUSE).
appimage="$assets/canvas-app-$app_version-linux-$cpu.AppImage"
chmod +x "$appimage"
echo "::group::AppImage --smoke"
appimage_smoke="$(APPIMAGE_EXTRACT_AND_RUN=1 "$appimage" --smoke)" || { echo "$appimage_smoke"; fail "the AppImage smoke failed"; }
echo "$appimage_smoke" | tee "${SMOKE_OUT:-$work}/smoke-linux-$cpu-appimage.json"
echo "::endgroup::"
echo "$appimage_smoke" | jq -e '.ok == true and .mounted == true' >/dev/null || fail "the AppImage did not mount the editor"

$files || { echo "ok"; exit 0; }

eval "$(dbus-launch --sh-syntax)"
pids+=("$DBUS_SESSION_BUS_PID")

# The mime database and the desktop entry are what xdg-open reads.
desktop="$(dpkg -L canvas-app | grep '/usr/share/applications/.*\.desktop$')"
echo "desktop entry: $desktop"; cat "$desktop"
sudo update-desktop-database /usr/share/applications
sample="$work/open.openflow.json"
cat > "$sample" <<'JSON'
{"format":"openflowkit.scene","schemaVersion":1,"id":"d14-open","name":"d14 xdg-open","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","pages":[{"id":"d14-open:page-1","name":"Page 1","diagramKind":"flowchart","layers":[{"id":"default","name":"Default","visible":true,"locked":false}],"nodes":[],"connectors":[],"metadata":{},"extensions":{}}],"metadata":{},"extensions":{}}
JSON
# Without a desktop environment xdg-open types files with file(1) (application/json) and starts a browser; saying GNOME makes
# it use gio, which reads the shared-mime-info glob like a real desktop does.
export XDG_CURRENT_DESKTOP=GNOME DESKTOP_SESSION=gnome
content_type="$(gio info -a standard::content-type "$sample" | sed -n 's/^ *standard::content-type: //p')"
echo "mime type: $content_type"
[ "$content_type" = application/x-openflow+json ] || fail "$sample is typed $content_type, not application/x-openflow+json"
[ "$(xdg-mime query default application/x-openflow+json)" = "$(basename "$desktop")" ] || fail "application/x-openflow+json does not default to $(basename "$desktop")"

# The shim is first on PATH so the desktop entry's `Exec=canvas-app %U` runs it: it records the arguments and the app's stderr.
mkdir -p "$work/shim"
cat > "$work/shim/canvas-app" <<SHIM
#!/bin/sh
echo "argv: \$*" >> "$work/app.log"
exec /usr/bin/canvas-app "\$@" 2>> "$work/app.log"
SHIM
chmod +x "$work/shim/canvas-app"

# The titles of the diagrams the service holds in the scratch project (files outside every project are imported there).
scratch_titles() { curl -fsS http://127.0.0.1:43120/projects | jq -r '.[] | select(.name == "scratch") | .diagrams[].title'; }
scratch_id() { curl -fsS http://127.0.0.1:43120/projects | jq -r --arg t "$1" '.[] | select(.name == "scratch") | .diagrams[] | select(.title == $t) | .id'; }
# The window was pointed at the diagram: the app logs the route it shows (cold start and warm navigation alike).
wait_for_window_on() {
  id="$(scratch_id "$1")"
  [ -n "$id" ] || fail "scratch has no diagram \"$1\""
  for _ in $(seq 1 60); do grep -qxF "canvas-app: showing http://127.0.0.1:43120/#/p/scratch/$id" "$work/app.log" && return 0; sleep 1; done
  echo "--- app.log"; cat "$work/app.log"
  fail "the window never showed scratch/$id (\"$1\")"
}
wait_for_title() {
  for _ in $(seq 1 60); do scratch_titles | grep -qxF "$1" && return 0; sleep 1; done
  echo "scratch holds:"; scratch_titles || true; echo "--- app.log"; cat "$work/app.log" || true
  fail "the app never opened \"$1\""
}

echo "::group::xdg-open"
PATH="$work/shim:$PATH" timeout 30 xdg-open "$sample"
wait_for_title "d14 xdg-open"
wait_for_window_on "d14 xdg-open"
cat "$work/app.log"
grep -q "open.openflow.json" "$work/app.log" || fail "xdg-open did not hand the file to the app"
pgrep -x canvas-app >/dev/null || fail "the app is not running"
! grep -q "cannot open" "$work/app.log" || fail "the app could not open the file"
echo "::endgroup::"

echo "::group::XDND drop"
window="$(xdotool search --onlyvisible --name '^Canvas$' | head -n 1)" || true
[ -n "$window" ] || fail "no Canvas window"
eval "$(xdotool getwindowgeometry --shell "$window")"
echo "app window at $X,$Y ${WIDTH}x$HEIGHT"
drop="$work/drop.openflow.json"
cat > "$drop" <<'JSON'
{"format":"openflowkit.scene","schemaVersion":1,"id":"d14-drop","name":"d14 xdnd drop","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z","pages":[{"id":"d14-drop:page-1","name":"Page 1","diagramKind":"flowchart","layers":[{"id":"default","name":"Default","visible":true,"locked":false}],"nodes":[],"connectors":[],"metadata":{},"extensions":{}}],"metadata":{},"extensions":{}}
JSON
timeout 60 python3 "$(dirname "$0")/app-xdnd-source.py" "file://$drop" 1500 100 >"$work/source.log" 2>&1 &
source_pid=$!
for _ in $(seq 1 50); do grep -q ready "$work/source.log" && break; sleep 0.2; done
grep -q ready "$work/source.log" || { cat "$work/source.log"; fail "the drag source did not start"; }
# A drag needs the pointer to move in steps with the button down; the pauses are the X server and GTK catching up.
xdotool mousemove 1600 200 sleep 0.3 mousedown 1 sleep 0.3
for step in 1 2 3 4 5 6 7 8; do
  xdotool mousemove $((1600 - step * (1600 - X - WIDTH / 2) / 8)) $((200 + step * (Y + HEIGHT / 2 - 200) / 8)) sleep 0.15
done
xdotool sleep 0.3 mouseup 1
# The source exits when the drag ends; the timeout turns a drag that never started into a failure.
wait "$source_pid" || { cat "$work/source.log"; fail "the drag source failed or never saw a drag"; }
! grep -q drag-failed "$work/source.log" || { cat "$work/source.log"; fail "the drag was cancelled or not accepted"; }
wait_for_title "d14 xdnd drop"
wait_for_window_on "d14 xdnd drop"
echo "::endgroup::"

# D18: canvas://home brings the running app, now on a diagram, back to the editor home. The scheme handler is the desktop
# entry's x-scheme-handler/canvas; the running instance gets the link and logs the route it shows.
echo "::group::canvas://home"
before="$(wc -l < "$work/app.log")"
PATH="$work/shim:$PATH" timeout 30 xdg-open canvas://home
for _ in $(seq 1 60); do tail -n +"$((before + 1))" "$work/app.log" | grep -qxF "canvas-app: showing http://127.0.0.1:43120/" && break; sleep 1; done
tail -n +"$((before + 1))" "$work/app.log" | grep -qxF "canvas-app: showing http://127.0.0.1:43120/" || { echo "--- app.log"; cat "$work/app.log"; fail "canvas://home did not take the running app to the editor home"; }
echo "::endgroup::"

! grep -q "cannot open" "$work/app.log" || { cat "$work/app.log"; fail "the app could not open a file"; }
! grep -q "refused to navigate" "$work/app.log" || { cat "$work/app.log"; fail "the window tried to navigate to the dropped file"; }
pgrep -x canvas-app >/dev/null || fail "the app exited"
echo "app log:"; cat "$work/app.log"
echo "ok"
