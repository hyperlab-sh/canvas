#!/usr/bin/env bash
# Adds .deb and .rpm packages to the apt and yum/dnf repository trees of the Pages site and signs them.
#   build.sh <site dir> <package dir>...
# <site dir> is a checkout of the gh-pages branch (or an empty directory); it is updated in place and prior versions stay.
# Packages are taken from the given directories by extension (*.deb, *.rpm); their names and architectures are read from the
# package metadata, not from the file names.
# Signing key, from the environment (no default):
#   REPO_GPG_PRIVATE_KEY  the armoured private key (no passphrase), as in the release secret; or
#   REPO_EPHEMERAL_KEY=1  generate a throwaway key (dry runs: nothing is published, the tree carries its public key)
#   REPO_EXPECT_FPR       optional: refuse a key with another fingerprint
#   REPO_BASE_URL         the site URL written into canvas.repo
# Retention: the newest 3 versions of each package for each architecture stay in the pools (retention.mjs); older ones are deleted
# before the metadata is regenerated, so the site stays far below the 1 GB Pages limit and git history grows by the newest only.
# Needs node, apt-ftparchive (apt-utils), dpkg-deb, createrepo_c, rpm (rpmsign), gpg, gzip.
set -euo pipefail

site="${1:?usage: build.sh <site dir> <package dir>...}"
shift
[ "$#" -gt 0 ] || { echo "no package directory given" >&2; exit 1; }
: "${REPO_BASE_URL:?set REPO_BASE_URL (the site URL, e.g. the Pages URL)}"
mkdir -p "$site"
site="$(cd "$site" && pwd)"
here="$(cd "$(dirname "$0")" && pwd)"

export GNUPGHOME
GNUPGHOME="$(mktemp -d)"
trap 'rm -rf "$GNUPGHOME"' EXIT

if [ -n "${REPO_GPG_PRIVATE_KEY:-}" ]; then
  printf '%s\n' "$REPO_GPG_PRIVATE_KEY" | gpg --batch --quiet --import
elif [ "${REPO_EPHEMERAL_KEY:-}" = 1 ]; then
  gpg --batch --quiet --passphrase '' --quick-generate-key 'Canvas packages (dry run) <noreply@hyperlab.sh>' rsa4096 sign 1d
else
  echo "set REPO_GPG_PRIVATE_KEY, or REPO_EPHEMERAL_KEY=1 for a dry run" >&2
  exit 1
fi
fpr="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[ -n "$fpr" ] || { echo "no signing key was imported" >&2; exit 1; }
if [ -n "${REPO_EXPECT_FPR:-}" ] && [ "$fpr" != "$REPO_EXPECT_FPR" ]; then
  echo "signing key is $fpr, expected $REPO_EXPECT_FPR" >&2
  exit 1
fi
echo "signing with $fpr"

gpg --batch --armor --export "$fpr" > "$site/canvas.asc"
gpg --batch --export "$fpr" > "$site/canvas-archive-keyring.gpg"
sed "s|@BASE_URL@|$REPO_BASE_URL|g" "$here/canvas.repo.in" > "$site/canvas.repo"

# --- packages into the pools -------------------------------------------------------------------------------------------
for dir in "$@"; do
  for f in "$dir"/*.deb; do
    [ -e "$f" ] || continue
    name="$(dpkg-deb -f "$f" Package)"
    pool="$site/apt/pool/main/${name:0:1}/$name"
    mkdir -p "$pool"
    cp "$f" "$pool/${name}_$(dpkg-deb -f "$f" Version)_$(dpkg-deb -f "$f" Architecture).deb"
  done
  for f in "$dir"/*.rpm; do
    [ -e "$f" ] || continue
    arch="$(rpm -qp --qf '%{ARCH}' "$f")"
    mkdir -p "$site/rpm/$arch"
    dest="$site/rpm/$arch/$(rpm -qp --qf '%{NAME}-%{VERSION}-%{RELEASE}.%{ARCH}.rpm' "$f")"
    cp "$f" "$dest"
    # Package signatures: the copies in the tree are signed, the release assets stay as built.
    rpmsign --define "__gpg $(command -v gpg)" --define "_gpg_name $fpr" --define "_gpg_path $GNUPGHOME" --addsign "$dest" >/dev/null
  done
done
compgen -G "$site/apt/pool/main/*/*/*.deb" >/dev/null || { echo "no .deb in the tree" >&2; exit 1; }
compgen -G "$site/rpm/*/*.rpm" >/dev/null || { echo "no .rpm in the tree" >&2; exit 1; }

node "$here/retention.mjs" prune "$site"

# --- apt: Packages per architecture, Release, InRelease, Release.gpg ---------------------------------------------------
apt_archs="amd64 arm64"
(
  cd "$site/apt"
  for arch in $apt_archs; do
    mkdir -p "dists/stable/main/binary-$arch"
    apt-ftparchive --arch "$arch" packages pool > "dists/stable/main/binary-$arch/Packages"
    gzip -9nk -f "dists/stable/main/binary-$arch/Packages"
  done
  apt-ftparchive \
    -o APT::FTPArchive::Release::Origin=Canvas \
    -o APT::FTPArchive::Release::Label=Canvas \
    -o APT::FTPArchive::Release::Suite=stable \
    -o APT::FTPArchive::Release::Codename=stable \
    -o APT::FTPArchive::Release::Architectures="$apt_archs" \
    -o APT::FTPArchive::Release::Components=main \
    release dists/stable > dists/stable/Release
  gpg --batch --yes --local-user "$fpr" --armor --detach-sign --output dists/stable/Release.gpg dists/stable/Release
  gpg --batch --yes --local-user "$fpr" --clearsign --output dists/stable/InRelease dists/stable/Release
)

# --- yum/dnf/zypper: repodata per architecture, repomd.xml signed ------------------------------------------------------
for dir in "$site"/rpm/*/; do
  createrepo_c --quiet --update "$dir"
  gpg --batch --yes --local-user "$fpr" --armor --detach-sign --output "$dir/repodata/repomd.xml.asc" "$dir/repodata/repomd.xml"
done
echo "repository trees built under $site"
