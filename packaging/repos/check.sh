#!/usr/bin/env bash
# Checks a built site: both packages for both architectures, signed metadata, prior versions kept, canvas.repo names the site.
#   check.sh <site dir> <before.txt> <base url>
# <before.txt> is `retention.mjs list <site dir>` taken before build.sh ran. Run from anywhere; versions come from this checkout.
set -euo pipefail

site="${1:?usage: check.sh <site dir> <before.txt> <base url>}"
before="${2:?usage: check.sh <site dir> <before.txt> <base url>}"
url="${3:?usage: check.sh <site dir> <before.txt> <base url>}"
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

cli="$(node -p "require('$root/package.json').version")"
app="$(node "$root/scripts/app-assets.mjs" version)"
for f in "apt/pool/main/c/canvas/canvas_${cli}_amd64.deb" "apt/pool/main/c/canvas/canvas_${cli}_arm64.deb" \
         "apt/pool/main/c/canvas-app/canvas-app_${app}_amd64.deb" "apt/pool/main/c/canvas-app/canvas-app_${app}_arm64.deb" \
         "rpm/x86_64/canvas-${cli}-1.x86_64.rpm" "rpm/aarch64/canvas-${cli}-1.aarch64.rpm" \
         "rpm/x86_64/canvas-app-${app}-1.x86_64.rpm" "rpm/aarch64/canvas-app-${app}-1.aarch64.rpm" \
         apt/dists/stable/InRelease apt/dists/stable/Release.gpg rpm/x86_64/repodata/repomd.xml.asc rpm/aarch64/repodata/repomd.xml.asc \
         canvas.asc canvas-archive-keyring.gpg canvas.repo; do
  test -s "$site/$f" || { echo "missing $f" >&2; exit 1; }
done

# Earlier versions stay (up to the retention limit in retention.mjs) and no package exceeds it.
node "$here/retention.mjs" check "$site" "$before"

grep -qxF "baseurl=$url/rpm/\$basearch" "$site/canvas.repo" || { echo "canvas.repo does not name $url" >&2; exit 1; }
