# Linux pilot acceptance

The pilot uses one company LINE account, one explicitly paired employee, and one existing Nuwa-enabled AI assistant. Run it in an isolated organization with a restricted assistant that has only the tools approved for that employee.

## Installation

Download the Linux executable matching the host architecture from [GitHub Releases](https://github.com/company-notes/nuwa-agent-relay-bridge/releases). It includes the Node.js runtime, compiled application, and runtime dependencies. The target is a 64-bit Linux host with glibc 2.28 or later, Linux kernel 4.18 or later, and a standard POSIX shell, tar and gzip. Use a directory with enough temporary disk space to unpack the runtime.

Check the host with `uname -m`, `uname -r`, and `getconf GNU_LIBC_VERSION`. Select the asset based on the machine architecture:

| Machine architecture | Release asset |
| --- | --- |
| `x86_64` | `nuwa-bridge-linux-x64.run` |
| `aarch64` | `nuwa-bridge-linux-arm64.run` |

The original Jetson Nano operating system based on JetPack 4 (Ubuntu 18.04, Linux 4.9) is outside the bundled [Node.js 24.11.0 supported platform baseline](https://github.com/nodejs/node/blob/v24.11.0/BUILDING.md#platform-list). Use a supported host operating system; architecture alone does not establish compatibility.

For example, on ARM64:

```sh
chmod +x nuwa-bridge-linux-arm64.run
./nuwa-bridge-linux-arm64.run --version
./nuwa-bridge-linux-arm64.run setup
./nuwa-bridge-linux-arm64.run start
```

Run setup on the host where the service will run. For VPS setup, establish the port forward from your own computer before opening the authorization link:

```sh
ssh -L 43183:127.0.0.1:43183 user@vps
```

The setup command prints a Nuwa OAuth authorization URL and opens a loopback callback listener at port 43183. When operating a remote Linux host, establish an SSH local port forward for 43183 to the host before opening the authorization URL on the administrator's workstation. Complete authorization in the browser, select the assistant's exact canonical address, scan the QR code shown directly in the SSH terminal with the authorized company LINE account, confirm login and enter the temporary PIN in LINE when prompted, and follow the one-time employee pairing prompt. Treat the QR and PIN as credentials and keep them private. Once Nuwa OAuth finishes, the temporary callback port closes; an SSH forward may report connection refused for subsequent browser requests. LINE login uses a separate connection. The employee sends the generated text in a private LINE chat with the company account; the administrator confirms the pairing.

The default private data directory is `~/.config/nuwa-agent-relay-bridge`. The `NUWA_BRIDGE_HOME` environment variable selects a separate directory. The directory contains authorization material, LINE session state, configuration and the SQLite delivery database; protect and back it up as sensitive data. Start one process per directory. Stop a running process with SIGINT or SIGTERM. A stale lock after an abnormal termination requires administrator verification that the process has stopped before removal.

## Acceptance

Use a fresh request for a new task. Quote the assistant's specific LINE response to continue its existing Relay thread. A new unquoted message creates a new thread. Check the assistant's native conversation and the actual LINE reply, including a response delayed beyond the initial request. Restart the bridge and repeat the continuation. Confirm an unpaired LINE account cannot trigger work.

`./nuwa-bridge-linux-arm64.run status` (or the x64 executable with the same command) reports the bridge address, designated assistant and uncertain native delivery count. Reconcile uncertain sends using actual native delivery evidence before taking recovery action.

The Relay inbox exposes a bounded window of 100 messages. The pilot detects a saturated window without a retained checkpoint and requires reconciliation. Continuous event replay and recovery from arbitrary offline intervals require a durable paginated or Wake-based receive contract.

Real account login and live cross-platform delivery are acceptance gates for production deployment. Pilot releases enable this testing. The automated test suite covers the core with controlled external boundaries.
