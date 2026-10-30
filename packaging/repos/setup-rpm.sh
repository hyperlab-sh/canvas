#!/bin/sh
# Adds the signed Canvas yum/dnf/zypper repository (Fedora, RHEL and clones, openSUSE). Run as root; needs curl.
#   setup-rpm.sh [site URL]      default: https://hyperlab-sh.github.io/canvas
# The URL picks the site whose canvas.repo and canvas.asc are downloaded. That canvas.repo names its own baseurl and gpgkey (the URL
# the site was built for), so a mirror must serve a canvas.repo built for the mirror. (setup-apt.sh writes the URL into the source line.)
# Then: dnf install canvas canvas-app     or     zypper install canvas canvas-app
set -eu
base="${1:-https://hyperlab-sh.github.io/canvas}"
if command -v zypper >/dev/null 2>&1; then dir=/etc/zypp/repos.d; else dir=/etc/yum.repos.d; fi
mkdir -p "$dir"
# The repository definition is the file the site publishes as /canvas.repo (gpgcheck, repo_gpgcheck and gpgkey are set there).
curl -fsSL "$base/canvas.repo" -o "$dir/canvas.repo"
# zypper does not fetch gpgkey= by itself; dnf imports it on first use.
if command -v zypper >/dev/null 2>&1; then rpm --import "$base/canvas.asc"; fi
