#!/bin/sh
# In a clean container: adds the repository with the documented setup script and installs from it with signature checks on.
#   test-install.sh <site URL> <setup scripts dir> <canvas version> <canvas-app version>
# Run as root inside debian, ubuntu, fedora or opensuse images. Nothing here turns verification off.
set -eu
base="$1"
scripts="$2"
cli_version="$3"
app_version="$4"
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
  sh "$scripts/setup-apt.sh" "$base"
  apt-get update -qq
  # The app alone pulls the CLI in as a dependency.
  apt-get install -y -qq canvas-app
  dpkg -s canvas >/dev/null 2>&1 || fail "canvas was not installed as a dependency of canvas-app"
  apt-get remove -y -qq canvas-app canvas
  apt-get install -y -qq canvas canvas-app
elif command -v dnf >/dev/null 2>&1; then
  sh "$scripts/setup-rpm.sh" "$base"
  dnf install -y -q canvas-app
  rpm -q canvas >/dev/null || fail "canvas was not installed as a dependency of canvas-app"
  dnf remove -y -q canvas-app canvas
  dnf install -y -q canvas canvas-app
elif command -v zypper >/dev/null 2>&1; then
  sh "$scripts/setup-rpm.sh" "$base"
  zypper --non-interactive install canvas-app
  rpm -q canvas >/dev/null || fail "canvas was not installed as a dependency of canvas-app"
  zypper --non-interactive remove canvas-app canvas
  zypper --non-interactive install canvas canvas-app
else
  fail "no apt-get, dnf or zypper"
fi

out="$(canvas --version)"
echo "canvas --version: $out"
[ "$out" = "canvas $cli_version" ] || fail "canvas --version printed \"$out\""
out="$(canvas-app --version)"
echo "canvas-app --version: $out"
[ "$out" = "canvas-app $app_version" ] || fail "canvas-app --version printed \"$out\""
echo ok
