#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Linux ]]; then
    echo "Build the pilot on Linux." >&2
    exit 1
fi

case "$(uname -m)" in
    x86_64) architecture=x64 ;;
    aarch64) architecture=arm64 ;;
    *) echo "Unsupported build architecture." >&2; exit 1 ;;
esac

if [[ "$(node -p 'process.arch')" != "$architecture" ]]; then
    echo "Node.js runtime architecture differs from the build host." >&2
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

artifact="release/nuwa-bridge-linux-$architecture.run"
sed "s/__NUWA_ARCH__/$architecture/g" scripts/Launcher.sh > "$artifact"
cat "$stage/payload.tar.gz" >> "$artifact"
chmod 755 "$artifact"
(cd release && sha256sum "nuwa-bridge-linux-$architecture.run" > "SHA256SUMS-$architecture")
