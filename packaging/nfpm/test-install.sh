#!/bin/sh
# Installs the canvas package in this (clean) container, checks it runs, removes it and checks it is gone.
#   test-install.sh <version> <directory holding the packages>
# Run as root inside debian, ubuntu, fedora or opensuse images; picks deb or rpm by the package manager it finds.
set -eu

version="$1"
dir="$2"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

# The directory holds the packages of both architectures; take this machine's.
case "$(uname -m)" in
  x86_64) deb_arch=amd64; rpm_arch=x86_64 ;;
  aarch64|arm64) deb_arch=arm64; rpm_arch=aarch64 ;;
  *) fail "unsupported machine $(uname -m)" ;;
esac

if command -v apt-get >/dev/null 2>&1; then
  kind=deb
  pkg="$(ls "$dir"/canvas_"$version"_"$deb_arch".deb)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "$pkg"
  remove() { apt-get remove -y -qq canvas; }
elif command -v dnf >/dev/null 2>&1; then
  kind=rpm
  pkg="$(ls "$dir"/canvas-"$version"-1."$rpm_arch".rpm)"
  dnf install -y -q "$pkg"
  remove() { dnf remove -y -q canvas; }
elif command -v zypper >/dev/null 2>&1; then
  kind=rpm
  pkg="$(ls "$dir"/canvas-"$version"-1."$rpm_arch".rpm)"
  # The local package is unsigned; repo signing is the pkg-repos concern.
  # Exit 106 means a mirror was unreachable while refreshing; the local package still installs, and the checks below prove it.
  zypper --non-interactive --no-gpg-checks install "$pkg" || [ $? -eq 106 ]
  remove() { zypper --non-interactive remove canvas; }
else
  fail "no apt-get, dnf or zypper"
fi
echo "installed $pkg ($kind)"

[ -L /usr/bin/canvas ] || fail "/usr/bin/canvas is not a symlink"
[ "$(readlink /usr/bin/canvas)" = /usr/lib/canvas/bin/canvas ] || fail "/usr/bin/canvas points at $(readlink /usr/bin/canvas)"

out="$(canvas --version)"
echo "canvas --version: $out"
[ "$out" = "canvas $version" ] || fail "--version printed \"$out\", want \"canvas $version\""

tmp="$(mktemp -d)"
printf 'graph LR\n A-->B\n' > "$tmp/a.mmd"
canvas render "$tmp/a.mmd" -o "$tmp/a.svg"
grep -q '<svg' "$tmp/a.svg" || fail "render wrote no svg"

# The editor is served from /usr/lib/canvas/share/canvas/app, found through the /usr/bin symlink.
if ! command -v curl >/dev/null 2>&1; then
  case "$kind" in
    deb) apt-get install -y -qq curl ;;
    *) if command -v dnf >/dev/null 2>&1; then dnf install -y -q curl; else zypper --non-interactive install curl || [ $? -eq 106 ]; fi ;;
  esac
fi
OPENFLOWKIT_SERVICE_CONFIG="$tmp/service.json" canvas serve --port 43557 >"$tmp/serve.log" 2>&1 &
serve_pid=$!
curl -fs --retry 30 --retry-connrefused --retry-delay 1 -o "$tmp/index.html" http://127.0.0.1:43557/ || { cat "$tmp/serve.log"; fail "canvas serve did not serve the app"; }
grep -qi '<html' "$tmp/index.html" || fail "the served page is not the editor"
kill "$serve_pid"
wait "$serve_pid" 2>/dev/null || true
rm -rf "$tmp"

remove
[ ! -e /usr/bin/canvas ] && [ ! -L /usr/bin/canvas ] || fail "/usr/bin/canvas remains after removal"
[ ! -e /usr/lib/canvas ] || { find /usr/lib/canvas | head -20; fail "/usr/lib/canvas remains after removal"; }
echo "ok"
