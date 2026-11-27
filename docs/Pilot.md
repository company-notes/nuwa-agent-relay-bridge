# Linux pilot acceptance

The pilot uses one company LINE account and one existing Nuwa-enabled AI assistant. People send ordinary private messages through LINE under an administrator-selected access policy. Run the pilot in an isolated organization with a restricted assistant whose tools, data and memory are safe for all permitted senders.

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

The setup command prints a Nuwa OAuth authorization URL and opens a loopback callback listener at port 43183. When operating a remote Linux host, establish an SSH local port forward for 43183 to the host before opening the authorization URL on the administrator's workstation. Complete authorization in the browser, select the assistant's exact canonical address, scan the QR code shown directly in the SSH terminal with the authorized company LINE account, confirm login and enter the temporary PIN in LINE when prompted, and select Open, Friends, or Allowlist at the access policy prompt. Treat the QR and PIN as credentials and keep them private. Once Nuwa OAuth finishes, the temporary callback port closes; an SSH forward may report connection refused for subsequent browser requests. LINE login uses a separate connection.

The default private data directory is `~/.config/nuwa-agent-relay-bridge`. The `NUWA_BRIDGE_HOME` environment variable selects a separate directory. The directory contains authorization material, LINE session state, configuration and the SQLite delivery database; protect and back it up as sensitive data. Start one process per directory. Stop a running process with SIGINT or SIGTERM. A stale lock after an abnormal termination requires administrator verification that the process has stopped before removal.

## Access and upgrades

Stop the existing bridge using Ctrl+C. Run the new executable with `status` to verify the existing database and check for unresolved work, then run it with `access` to choose the access policy. Preserve the private data directory and its account authorization. Upgrades from the single-user pilot retain its approved sender until the administrator selects a policy. Complete pending submissions on the old executable before migrating its database. Keep a private backup of the data directory while stopped. The new executable accepts ordinary messages; end users need no pairing code.

Start the bridge after changing access. Open mode requires explicit confirmation; select Friends when the company account maintains its own friend list, or Allowlist to choose specific contacts. LINE's own privacy controls govern friend additions and blocking.

## Group access

Join the company LINE account to the desired internal group using the LINE app. Stop the bridge and run the executable with `groups`. Choose 3 (Allowlist), select the joined group by number, and restart. The private access policy remains unchanged. Group membership changes require running `groups` again to approve the new membership. The changed audience starts a new Relay conversation; replies to earlier audiences remain blocked. All group members can address the assistant regardless of private friend status.

In the group, use LINE's native @Mention to select the company account and ask a question. Quote the assistant's reply to continue without another mention. Normal group chatter and @Everyone stay local. The bridge forwards only addressed messages and replies in the original group. Keep group participants informed and verify that the assistant's native context and tool permissions are suitable for the group.

Group roster diagnostics distinguish unavailable chat data, unsupported chat type, missing member map, missing account or sender, and changed approved roster. The logs report a reason and member count when available, without listing member identifiers or message content. Open group access still requires a verified current roster.

## Acceptance

Send an ordinary question, receive its reply, and ask a follow-up without quoting. Verify the same Relay Thread. Have a second permitted person add the company account and chat normally. Interleave the two conversations and verify that the replies and AI context stay isolated. Send a LINE sticker and verify the corresponding Relay message and public image link. Send a private image and confirm its content-type notice. Use `/new <message>` for a distinct topic; quote an earlier AI reply to continue that specific thread. Restart and repeat the continuation. Verify that a sender excluded by Friends or Allowlist cannot trigger work, and that revoked access prevents a delayed reply. 


`./nuwa-bridge-linux-arm64.run status` (or the x64 executable with the same command) reports the bridge address, designated assistant, access mode and pending, blocked or uncertain delivery counts. Reconcile uncertain sends using actual native delivery evidence before taking recovery action.

The Relay inbox exposes a bounded window of 100 messages. The pilot detects a saturated window without a retained checkpoint and requires reconciliation. Continuous event replay and recovery from arbitrary offline intervals require a durable paginated or Wake-based receive contract.

Real account login and live cross-platform delivery are acceptance gates for production deployment. Pilot releases enable this testing. The automated test suite covers the core with controlled external boundaries.
