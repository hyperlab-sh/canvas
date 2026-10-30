#!/usr/bin/env bash
# Publishes the Pages site as one parentless commit on gh-pages.
#   publish.sh <site dir> [<tree dir>]
# <site dir> is a checkout of gh-pages. With <tree dir> the site is made to match it exactly, deletions included, so packages
# the build pruned leave the site; without it the site is published as it is. The commit is forced over the commit the site was
# checked out at (the lease), so the push fails if gh-pages moved since, and old packages do not pile up in the history.
# Needs PUBLISH_MESSAGE (the commit message). Pushes to the checkout's "origin".
set -euo pipefail

site="${1:?usage: publish.sh <site dir> [<tree dir>]}"
tree="${2:-}"
: "${PUBLISH_MESSAGE:?set PUBLISH_MESSAGE (the commit message)}"
site="$(cd "$site" && pwd)"
cd "$site"

base="$(git rev-parse HEAD)"
if [ -n "$tree" ]; then
  find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  cp -a "$tree/." .
fi
git add -A
if git diff --cached --quiet; then
  echo "repositories unchanged"
  exit 0
fi
git checkout --orphan pages-new
git -c user.name='canvas release' -c user.email=actions@users.noreply.github.com commit -q -m "$PUBLISH_MESSAGE"
git push --force-with-lease="gh-pages:$base" origin HEAD:gh-pages
