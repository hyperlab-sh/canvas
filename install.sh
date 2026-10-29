#!/bin/sh
# Installs the standalone canvas binary (no node or bun needed) on macOS or Linux.
#   curl -fsSL https://raw.githubusercontent.com/hyperlab-sh/canvas/main/install.sh | sh
#   sh install.sh [--version 0.3.0] [--uninstall]
# Environment: CANVAS_VERSION (default: the latest release), CANVAS_HOME (default: ${XDG_DATA_HOME:-~/.local/share}/canvas),
# CANVAS_BIN_DIR (default: ~/.local/bin; where the `canvas` link goes), CANVAS_DOWNLOAD_BASE (default: the GitHub release).
set -eu

REPO="hyperlab-sh/canvas"
home_dir="${CANVAS_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/canvas}"
bin_dir="${CANVAS_BIN_DIR:-$HOME/.local/bin}"
version="${CANVAS_VERSION:-}"
uninstall=0

say() { printf '%s\n' "$*"; }
die() { printf 'canvas install: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || die "--version needs a value"; version="$2"; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument \"$1\"" ;;
  esac
done

if [ "$uninstall" = 1 ]; then
  if [ -e "$home_dir/bin/canvas" ]; then "$home_dir/bin/canvas" service uninstall >/dev/null 2>&1 || true; fi
  [ -L "$bin_dir/canvas" ] && rm -f "$bin_dir/canvas"
  rm -rf "$home_dir"
  say "removed $home_dir and $bin_dir/canvas"
  exit 0
fi

if command -v curl >/dev/null 2>&1; then
  download() { curl -fsSL "$1" -o "$2"; }
  final_url() { curl -fsSL -o /dev/null -w '%{url_effective}' "$1"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -q "$1" -O "$2"; }
  final_url() { wget -q --spider -S "$1" 2>&1 | sed -n 's/^ *[Ll]ocation: //p' | tail -n 1; }
else
  die "needs curl or wget"
fi
command -v tar >/dev/null 2>&1 || die "needs tar"
if command -v sha256sum >/dev/null 2>&1; then sha256() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then sha256() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else die "needs sha256sum or shasum"; fi

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "$(uname -s) is not supported by this script (Windows: install.ps1)" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) cpu=arm64 ;;
  x86_64|amd64) cpu=x64 ;;
  *) die "$(uname -m) is not supported" ;;
esac
if [ "$os" = linux ] && { ldd --version 2>&1 || true; } | grep -qi musl; then
  die "musl libc (Alpine) is not supported by the standalone binary; use the npm package (npm i -g @hyperlab.sh/canvas)"
fi

if [ -z "$version" ]; then
  [ -z "${CANVAS_DOWNLOAD_BASE:-}" ] || die "set CANVAS_VERSION when CANVAS_DOWNLOAD_BASE is set"
  tag="$(final_url "https://github.com/$REPO/releases/latest" | sed 's#.*/tag/##')"
  case "$tag" in v[0-9]*) version="${tag#v}" ;; *) die "could not find the latest release (got \"$tag\")" ;; esac
fi
version="${version#v}"
base="${CANVAS_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download/v$version}"
archive="canvas-$version-$os-$cpu.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM
say "downloading canvas $version for $os-$cpu"
download "$base/$archive" "$tmp/$archive" || die "could not download $base/$archive"
download "$base/SHA256SUMS" "$tmp/SHA256SUMS" || die "could not download $base/SHA256SUMS"
expected="$(awk -v f="$archive" '$2 == f { print $1 }' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || die "$archive is not listed in SHA256SUMS"
[ "$(sha256 "$tmp/$archive")" = "$expected" ] || die "checksum mismatch for $archive; nothing was installed"

mkdir -p "$tmp/new"
tar -xzf "$tmp/$archive" -C "$tmp/new"
[ -x "$tmp/new/bin/canvas" ] || die "the archive has no bin/canvas"

# Swap the whole directory so an upgrade never leaves a half-written install, and a running service keeps its path.
mkdir -p "$(dirname "$home_dir")" "$bin_dir"
staged="$home_dir.new.$$"
rm -rf "$staged"
mv "$tmp/new" "$staged"
if [ -e "$home_dir" ]; then mv "$home_dir" "$home_dir.old.$$"; fi
mv "$staged" "$home_dir"
rm -rf "$home_dir.old.$$"
ln -sf "$home_dir/bin/canvas" "$bin_dir/canvas"

say "installed canvas $version to $home_dir"
say "linked $bin_dir/canvas"
case ":$PATH:" in *":$bin_dir:"*) ;; *) say "Add $bin_dir to your PATH:  export PATH=\"$bin_dir:\$PATH\"" ;; esac
say "Next: canvas service install   (keeps it running in the background)"
