# LINE Bridge operating guide

The Bridge lets people talk to a company's designated AI assistant using an ordinary LINE account. Read the [README](../README.md) for the system and terminology. Use this guide to deploy and operate the released Linux pilot in a controlled environment. The [engineering handoff](Handoff.md) defines the design and future capabilities.

## 1. Prepare the host and assistant

Choose an always-on Linux x64 or ARM64 host, an authorized LINE account and an existing Nuwa-enabled AI assistant. Verify the assistant's canonical address and receiving route using the [official Nuwa Skill](https://mcp.agent-relay.company-notes.com/skills/nuwa-agent-relay/SKILL.md). The assistant's business tools and native context must be appropriate for all allowed LINE participants.

The bundled Node.js 24.11.0 runtime targets glibc 2.28+, Linux kernel 4.18+ and a POSIX shell, tar, gzip and util-linux `flock`. Check the host with:

```sh
uname -m
uname -r
getconf GNU_LIBC_VERSION
command -v flock
```

Select the standalone executable from [Releases](https://github.com/company-notes/nuwa-agent-relay-bridge/releases) and verify its checksum using the supplied SHA256SUMS.

| Host | Asset |
| --- | --- |
| x86_64 | nuwa-bridge-linux-x64.run |
| aarch64 | nuwa-bridge-linux-arm64.run |

The package includes Node.js and application dependencies. Keep adequate temporary disk space for extraction. Jetson Nano systems with Linux 4.9 are outside the bundled runtime's supported kernel baseline; use a supported host for production.

## 2. Set up the Bridge

For an ARM64 host, run the following in the installation directory. Use the x64 asset on x64 hosts.

```sh
chmod +x nuwa-bridge-linux-arm64.run
./nuwa-bridge-linux-arm64.run --version
./nuwa-bridge-linux-arm64.run setup
```

For a remote host, establish the OAuth loopback tunnel from the administrator's computer before opening the authorization URL:

```sh
ssh -N -L 43183:127.0.0.1:43183 user@vps
```

1. Open the authorization URL printed by the Bridge and complete Nuwa OAuth in the browser.
2. Record the returned Bridge canonical address and enter the designated assistant's exact canonical address.
3. Connect LINE by scanning the terminal QR code with the authorized account and completing its PIN prompt. Treat the QR and PIN as credentials.
4. Select the private access policy: Open, Friends or Allowlist.

The temporary OAuth callback listener closes after authorization. The LINE login uses its own connection. Keep the private data directory `~/.config/nuwa-agent-relay-bridge` protected; it contains OAuth, LINE login state, configuration and the SQLite delivery store. `NUWA_BRIDGE_HOME` selects a different directory.

Start the service:

```sh
./nuwa-bridge-linux-arm64.run start
```

Run one instance per data directory. Ctrl+C or SIGTERM stops it. The operating system releases the process lock on exit or crash; retain the lock file.

## 3. Configure access

Stop the Bridge before changing access settings.

```sh
./nuwa-bridge-linux-arm64.run access
```

| Private policy | Eligible senders |
| --- | --- |
| Open | Any sender whose private message LINE delivers; requires confirmation. |
| Friends | Contacts on the company's LINE friend list, excluding blocked contacts. |
| Allowlist | Selected native contact IDs. |

Manage the company's contacts and blocking in LINE itself.

### Groups

Join the company account to the desired LINE group using LINE. Run:

```sh
./nuwa-bridge-linux-arm64.run groups
```

Choose Disabled, Open (all joined groups, with confirmation) or Allowlist (selected groups and approved current membership). The default is Disabled. Group access is independent of the private policy. Allowlist membership changes require approval through the same command. The Bridge verifies current membership before submitting a group request or delivering a reply.

In the current release, a genuine native @Mention or quote of the assistant's own previous reply triggers a group message. Ordinary group chatter and @Everyone stay local. This applies to two-member groups as well. The next version's intended automatic two-member activation is described in the [handoff](Handoff.md#group-activation-by-audience-size).

Restart after completing configuration.

## 4. Daily conversations and replies

Use ordinary private chat or the supported group trigger. Replies arrive in the original native conversation.

| Action | Effect |
| --- | --- |
| Follow up in the same chat | Continue its active Relay Thread. |
| Quote an earlier assistant reply | Select that reply's original Relay Thread. |
| Send `/new <message>` | Create a separate Relay Thread (use a valid group trigger in a group). |
| Change a group's membership | Start a new audience-specific thread after authorization. |

The assistant receives text and supported sticker artifact links. Private media currently produces a type notice. AI context and tool permissions depend on the receiving platform; verify isolation for every intended participant.

## 5. Maintain and upgrade

Stop the service, inspect its status and reconcile unresolved work.

```sh
./nuwa-bridge-linux-arm64.run status
```

Status reports the Bridge address, designated assistant, access modes and pending, blocked and uncertain delivery counts. Back up the private data directory while stopped and restrict access to the backup. Download the new matching executable to a temporary filename, verify its checksum, make it executable and replace the installed executable. Start it using the same data directory. This retains the account, OAuth, policies and delivery history.

The existing release binds the designated assistant to its persisted database. The planned assistant-switch command is documented in the [handoff](Handoff.md#change-the-designated-assistant). Preserve the database and configuration until that migration is available.

## 6. Verify operation and diagnose failures

Send a permitted request and observe an actual reply in the original LINE conversation. Follow up and verify the same Relay Thread; use a second authorized chat and interleave replies. For a group, use a native mention, receive a reply, then quote the reply. Verify excluded chats and changed group audiences are protected. See [TESTING.md](../TESTING.md) for the complete acceptance scope.

| Log or evidence | Meaning |
| --- | --- |
| `/native/message/received` | Bridge accepted a native event for processing. |
| `/group/roster/verified` | Native group ID and actual membership were verified. |
| `/relay/message/submitted` | Relay accepted the message and returned Message and Thread IDs. |
| `/native/message/delivered` | LINE acknowledged native reply submission. |
| `/group/roster/rejected`, `/group/access/rejected` | Inspect the safe reason and member count; verify joined group and access policy. |
| Blocked or uncertain counts | Inspect the authorization or reconcile actual delivery evidence before retrying. |

Relay submission and Wake acceptance are intermediate evidence. Verify AI handling and the final LINE reply in the original chat. The current Inbox is bounded to 100 messages; reconcile a saturated window without a known checkpoint before resuming. Keep credentials and private message contents out of diagnostic reports.
