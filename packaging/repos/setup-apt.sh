#!/bin/sh
# Adds the signed Canvas apt repository (Debian, Ubuntu). Run as root; needs curl and ca-certificates.
#   setup-apt.sh [site URL]      default: https://hyperlab-sh.github.io/canvas
# Then: apt-get update && apt-get install canvas canvas-app
set -eu
base="${1:-https://hyperlab-sh.github.io/canvas}"
install -d -m 0755 /etc/apt/keyrings
curl -fsSL "$base/canvas-archive-keyring.gpg" -o /etc/apt/keyrings/canvas-archive-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/canvas-archive-keyring.gpg] $base/apt stable main" > /etc/apt/sources.list.d/canvas.list
