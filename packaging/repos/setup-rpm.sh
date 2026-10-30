#!/bin/sh
# Adds the signed Canvas yum/dnf/zypper repository (Fedora, RHEL and clones, openSUSE). Run as root.
#   setup-rpm.sh [site URL]      default: https://hyperlab-sh.github.io/canvas
# Then: dnf install canvas canvas-app     or     zypper install canvas canvas-app
set -eu
base="${1:-https://hyperlab-sh.github.io/canvas}"
if command -v zypper >/dev/null 2>&1; then dir=/etc/zypp/repos.d; else dir=/etc/yum.repos.d; fi
mkdir -p "$dir"
cat > "$dir/canvas.repo" <<REPO
[canvas]
name=Canvas
baseurl=$base/rpm/\$basearch
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$base/canvas.asc
REPO
# zypper does not fetch gpgkey= by itself; dnf imports it on first use.
if command -v zypper >/dev/null 2>&1; then rpm --import "$base/canvas.asc"; fi
