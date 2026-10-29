#!/bin/sh
# Installs the canvas package in this (clean) container, checks it runs, removes it and checks it is gone.
#   test-install.sh <version> <directory holding the packages>
# Run as root inside debian, ubuntu, fedora or opensuse images; picks deb or rpm by the package manager it finds.
set -eu

version="$1"
dir="$2"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if command -v apt-get >/dev/null 2>&1; then
  kind=deb
  pkg="$(ls "$dir"/canvas_"$version"_*.deb)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq "$pkg"
  remove() { apt-get remove -y -qq canvas; }
elif command -v dnf >/dev/null 2>&1; then
  kind=rpm
  pkg="$(ls "$dir"/canvas-"$version"-1.*.rpm)"
  dnf install -y -q "$pkg"
  remove() { dnf remove -y -q canvas; }
elif command -v zypper >/dev/null 2>&1; then
  kind=rpm
  pkg="$(ls "$dir"/canvas-"$version"-1.*.rpm)"
  # The local package is unsigned; repo signing is the pkg-repos concern.
  zypper --non-interactive --no-gpg-checks install "$pkg"
  remove() { zypper --non-interactive remove canvas; }
else
  fail "no apt-get, dnf or zypper"
fi
echo "installed $pkg ($kind)"

[ -L /usr/bin/canvas ] || fail "/usr/bin/canvas is not a symlink"
[ "$(readlink /usr/bin/canvas)" = /usr/lib/canvas/bin/canvas ] || fail "/usr/bin/canvas points at $(readlink /usr/bin/canvas)"

out="$(canvas --version)"
echo "canvas --version: $out"
case "$out" in *"$version"*) ;; *) fail "--version does not print $version" ;; esac

tmp="$(mktemp -d)"
printf 'graph LR\n A-->B\n' > "$tmp/a.mmd"
canvas render "$tmp/a.mmd" -o "$tmp/a.svg"
grep -q '<svg' "$tmp/a.svg" || fail "render wrote no svg"
rm -rf "$tmp"

remove
[ ! -e /usr/bin/canvas ] && [ ! -L /usr/bin/canvas ] || fail "/usr/bin/canvas remains after removal"
[ ! -e /usr/lib/canvas ] || fail "/usr/lib/canvas remains after removal"
echo "ok"
