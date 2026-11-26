#!/bin/sh
set -eu

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
