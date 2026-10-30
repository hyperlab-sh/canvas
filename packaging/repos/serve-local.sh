#!/usr/bin/env bash
# Points the canvas.repo of a built tree at the local server the install jobs start, so the documented setup commands install
# from the tree under test and not from the live Pages site. The artifact is left alone: only the copy that is served changes.
#   serve-local.sh <site dir> <local url>
# The tree names the URL it was built for (https://hyperlab-sh.github.io/canvas on a release, the local URL on a dry run).
set -euo pipefail

site="${1:?usage: serve-local.sh <site dir> <local url>}"
local_url="${2:?usage: serve-local.sh <site dir> <local url>}"
pages="https://hyperlab-sh.github.io/canvas"

sed "s|$pages|$local_url|g" "$site/canvas.repo" > "$site/canvas.repo.local"
mv "$site/canvas.repo.local" "$site/canvas.repo"
grep -qxF "baseurl=$local_url/rpm/\$basearch" "$site/canvas.repo" && grep -qxF "gpgkey=$local_url/canvas.asc" "$site/canvas.repo" \
  || { echo "canvas.repo does not name $local_url" >&2; exit 1; }
