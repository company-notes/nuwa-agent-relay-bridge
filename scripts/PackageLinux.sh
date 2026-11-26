#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
    echo "Build this pilot on Linux x64." >&2
    exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/dist" release
nodePath=$(command -v node)
cp -L "$nodePath" "$stage/node"
cp -r dist/src "$stage/dist/"
cp package.json LICENSE "$stage/"
runtimeLicense="$(dirname "$(dirname "$nodePath")")/LICENSE"
if [[ -f "$runtimeLicense" ]]; then
    cp "$runtimeLicense" "$stage/NODE-LICENSE"
else
    echo "Bundled Node.js license is missing." >&2
    exit 1
fi
cp -r node_modules "$stage/"
tar -czf "$stage/payload.tar.gz" -C "$stage" node dist package.json LICENSE NODE-LICENSE node_modules

artifact=release/nuwa-bridge-linux-x64.run
cat scripts/Launcher.sh "$stage/payload.tar.gz" > "$artifact"
chmod 755 "$artifact"
(cd release && sha256sum nuwa-bridge-linux-x64.run > SHA256SUMS)
