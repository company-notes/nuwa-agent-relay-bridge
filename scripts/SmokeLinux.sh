#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT
cd "$temp"

export NUWA_BRIDGE_HOME="$temp/private"
export PATH=/usr/bin:/bin
unset NODE_PATH NODE_OPTIONS
artifact="$root/release/nuwa-bridge-linux-x64.run"

"$artifact" --version | grep -Fx 'Nuwa Agent Relay Bridge 0.1.0'
"$artifact" --help | grep -F 'Usage: nuwa-bridge'
test ! -e "$NUWA_BRIDGE_HOME"

if "$artifact" status; then
    echo 'Unconfigured status unexpectedly succeeded.' >&2
    exit 1
fi

test -d "$NUWA_BRIDGE_HOME"
test ! -e "$NUWA_BRIDGE_HOME/config.json"
