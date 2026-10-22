#!/usr/bin/env bash
# Downloads PostgREST (the HTTP layer Supabase uses) for the integration tests. Pinned version + SHA-256.
# Usage: scripts/fetch-postgrest.sh [dest-dir]   (default .tools/postgrest). Prints the binary path.
set -euo pipefail
VERSION=v12.2.3
SHA256=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c
DEST="${1:-.tools/postgrest}"
mkdir -p "$DEST"
if [ ! -x "$DEST/postgrest" ]; then
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/p.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/${VERSION}/postgrest-${VERSION}-linux-static-x64.tar.xz"
  echo "${SHA256}  $TMP/p.tar.xz" | sha256sum -c - >&2
  tar -xJf "$TMP/p.tar.xz" -C "$DEST"
  rm -rf "$TMP"
fi
echo "$DEST/postgrest"
