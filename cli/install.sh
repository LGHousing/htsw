#!/bin/sh
# Installs the htsw CLI. Usage:
#   curl -fsSL https://legendarygames.dev/htsw/cli/install.sh | sh
#
# Env overrides:
#   HTSW_BASE_URL   artifact root (default https://legendarygames.dev/htsw)
#   HTSW_BIN_DIR    install dir   (default $HOME/.local/bin)
set -eu

BASE_URL="${HTSW_BASE_URL:-https://legendarygames.dev/htsw}/cli"
BIN_DIR="${HTSW_BIN_DIR:-$HOME/.local/bin}"
BUNDLE="$BIN_DIR/htsw.mjs"
LAUNCHER="$BIN_DIR/htsw"

say() { printf '[htsw-install] %s\n' "$1"; }
die() { printf '[htsw-install] error: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js 20+ is required but 'node' is not on PATH."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 20 ] 2>/dev/null || die "Node.js 20+ is required (found $(node -v 2>/dev/null || echo none))."

fetch() {
    if command -v curl >/dev/null 2>&1; then curl -fsSL "$1"
    elif command -v wget >/dev/null 2>&1; then wget -qO- "$1"
    else die "need curl or wget to download"; fi
}

say "Reading $BASE_URL/latest.json"
MANIFEST=$(fetch "$BASE_URL/latest.json") || die "could not fetch latest.json"

json_val() { printf '%s' "$MANIFEST" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"; }
VERSION=$(json_val version)
FILE=$(json_val cli)
SHA=$(json_val sha256)
[ -n "$FILE" ] || die "manifest missing 'cli' filename"

mkdir -p "$BIN_DIR"
TMP="$BIN_DIR/.htsw-download-$$"
LAUNCHER_TMP="$BIN_DIR/.htsw-launcher-$$"
trap 'rm -f "$TMP" "$LAUNCHER_TMP"' EXIT
say "Downloading htsw ${VERSION:-?}"
fetch "$BASE_URL/$FILE" > "$TMP" || die "download failed"

if [ -n "$SHA" ]; then
    if command -v shasum >/dev/null 2>&1; then GOT=$(shasum -a 256 "$TMP" | awk '{print $1}')
    elif command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$TMP" | awk '{print $1}')
    else GOT=""; fi
    [ -z "$GOT" ] || [ "$GOT" = "$SHA" ] || die "sha256 mismatch (expected $SHA, got $GOT)"
fi

cat > "$LAUNCHER_TMP" <<'EOF'
#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd "$(dirname "$0")" && pwd)
exec node "$SCRIPT_DIR/htsw.mjs" "$@"
EOF

chmod +x "$TMP" "$LAUNCHER_TMP"
mv "$TMP" "$BUNDLE"
mv "$LAUNCHER_TMP" "$LAUNCHER"
trap - EXIT
say "Installed htsw ${VERSION:-?} to $BIN_DIR"

case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say "note: $BIN_DIR is not on PATH. Add it, e.g.:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

say "Update in place later with 'htsw upgrade'."
