# Linux pilot acceptance

The pilot uses one company LINE account, one explicitly paired employee, and one existing Nuwa-enabled AI assistant. Run it in an isolated organization with a restricted assistant that has only the tools approved for that employee.

## Installation

Use Node.js 24.11 or newer in the Node 24 release series.

```sh
npm install
npm run build
npm run setup
npm start
```

The setup command prints a Nuwa OAuth authorization URL and opens a loopback callback listener at port 43183. When operating a remote Linux host, establish an SSH local port forward for 43183 to the host before opening the authorization URL on the administrator's workstation. Complete authorization in the browser, select the assistant's exact canonical address, connect the authorized LINE account, and follow the one-time employee pairing prompt. The employee sends the generated text in a private LINE chat with the company account; the administrator confirms the pairing.

The default private data directory is `~/.config/nuwa-agent-relay-bridge`. The `NUWA_BRIDGE_HOME` environment variable selects a separate directory. The directory contains authorization material, LINE session state, configuration and the SQLite delivery database; protect and back it up as sensitive data. Start one process per directory. Stop a running process with SIGINT or SIGTERM. A stale lock after an abnormal termination requires administrator verification that the process has stopped before removal.

## Acceptance

Use a fresh request for a new task. Quote the assistant's specific LINE response to continue its existing Relay thread. A new unquoted message creates a new thread. Check the assistant's native conversation and the actual LINE reply, including a response delayed beyond the initial request. Restart the bridge and repeat the continuation. Confirm an unpaired LINE account cannot trigger work.

`npm run status` reports the bridge address, designated assistant and uncertain native delivery count. Reconcile uncertain sends using actual native delivery evidence before taking recovery action.

The Relay inbox exposes a bounded window of 100 messages. The pilot detects a saturated window without a retained checkpoint and requires reconciliation. Continuous event replay and recovery from arbitrary offline intervals require a durable paginated or Wake-based receive contract.

Real account login and live cross-platform delivery are acceptance gates. The automated test suite covers the core with controlled external boundaries.
