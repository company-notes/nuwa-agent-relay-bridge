#!/bin/sh
set -eu

case "$(uname -m)" in
    x86_64) hostArchitecture=x64 ;;
    aarch64) hostArchitecture=arm64 ;;
    *) echo "Unsupported Linux architecture." >&2; exit 1 ;;
esac

if [ "$(uname -s)" != Linux ] || [ "$hostArchitecture" != "__NUWA_ARCH__" ]; then
    echo "This executable requires Linux __NUWA_ARCH__. Download the matching release asset." >&2
    exit 1
fi

umask 077
workDir=$(mktemp -d "${TMPDIR:-/tmp}/nuwa-bridge.XXXXXXXX")
child=
cleanup() {
    rm -rf -- "$workDir"
}
stop() {
    if [ -n "$child" ]; then
        kill -TERM "$child" 2>/dev/null || :
        wait "$child" || :
    fi
    exit 143
}
trap cleanup EXIT
trap stop INT TERM HUP

payloadLine=$(awk '/^__NUWA_PAYLOAD__$/ {print NR+1; exit}' "$0")
tail -n +"$payloadLine" "$0" | tar -xzf - -C "$workDir"

exec 3<&0
"$workDir/node" "$workDir/dist/src/Main.js" "$@" <&3 3<&- &
child=$!
exec 3<&-
set +e
wait "$child"
result=$?
set -e
exit "$result"
__NUWA_PAYLOAD__
