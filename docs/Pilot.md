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

A verified group of two, including the Bridge, accepts ordinary incoming messages. In larger groups, a genuine native @Mention, @All or quote of the assistant's previous reply activates the assistant; unrelated chatter remains local. The Bridge verifies the audience at intake and before submission. See the [handoff](Handoff.md#group-activation-by-audience-size).

### Natural group conversation (optional)

The `conversation` command enables semantic activation for selected authorized groups and their current member sets. Obtain the members' consent to send bounded group dialogue to Cloudflare Workers AI and to include recent group dialogue as context in accepted Relay requests. This is separate from group access. Existing approved groups retain their settings; new groups use explicit activation until configured. Inform members of the seven-day local dialogue retention before using natural conversation.

Create a dedicated Cloudflare API token scoped to the intended account and Workers AI inference permission. Keep the token private. Set the credentials in the service environment:

```sh
export CLOUDFLARE_ACCOUNT_ID='your-account-id'
read -rs -p 'Workers AI API token: ' CLOUDFLARE_API_TOKEN
echo
export CLOUDFLARE_API_TOKEN
./nuwa-bridge-linux-arm64.run conversation
```

Select the group numbers, enter the assistant's visible chat name (for example `小媧`), and confirm member consent. An empty selection disables the feature. Reconfigure after approving a new membership set.

Start the Bridge from the same environment. For the supplied systemd unit, place the two credential assignments in a private, mode-0600 `~/.config/nuwa-agent-relay-bridge/decision.env` file, reload the unit and start the service. For a custom service data directory, set its EnvironmentFile accordingly. Use a locally trusted editor; never put the token in Git, terminal history or logs.

The model receives bounded text, observation timestamps and conversation-local speaker labels. Native ID fields and attachment links stay local. In approved groups, the Bridge stores up to 30 turns from the last seven days in its private SQLite database, with a 500-character bound per turn and at most 64 group windows. Restart preserves the window for the same approved audience and assistant generation. Expired window entries are removed during operation and at startup; observed membership changes, revoked consent and assistant switching remove affected dialogue. Keep database backups protected and apply the same retention policy to them. Accepted semantic requests persist their dialogue snapshot as part of normal delivery history, independently of the rolling window.

Explicit native mentions, @All, assistant quotes, private chats and two-member chats bypass inference. When the assistant has spoken anywhere in the retained window or its configured name appears in a short text message, Clef-flash may classify the message. It receives timestamps and intervening conversation, so it can assess a natural reply hours or days later. A probability of at least 0.8 activates the assistant. Explicit mentions of other members and replies addressed elsewhere do not use semantic activation. Ambiguous messages remain local. On model failure or missing credentials, explicit activation continues; failures enter a 30-second inference cooldown.

The window begins with events the running Bridge observes. After an upgrade from the memory-only version, send an explicit mention and receive a reply to establish dialogue in the persistent window.

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

Status reports the Bridge address, designated assistant, access modes and pending, blocked and uncertain delivery counts. Back up the private data directory while stopped and restrict access to the backup. Download the new matching executable to a temporary filename, verify its checksum, make it executable and replace the installed executable. Start it using the same data directory. This retains the account, OAuth, policies and delivery history. The database records its routing schema version; older executables cannot open the migrated identity. Keep the pre-upgrade backup for an authorized rollback.

### Change the designated assistant

Stop the service, complete pending submissions and reconcile uncertain native deliveries. Run:

```sh
./nuwa-bridge-linux-arm64.run assistant
```

Enter the new assistant's canonical address, such as `nuwainfo/ava/main`, and confirm with `yes`. The command resolves the address in the same organization, preserves the Bridge's OAuth and LINE identity, policies and history, and starts a new routing generation. Delayed replies and quotes from the former generation are withheld. Start the service and verify an ordinary private and group conversation with the new assistant.

## 6. Run as a background service

systemd is the Linux service manager. Install the supplied [user service unit](nuwa-bridge.service) as `~/.config/systemd/user/nuwa-bridge.service`. The unit expects a stable executable path at `~/.local/bin/nuwa-bridge`; point that path to the installed standalone executable (a symbolic link is sufficient).

```sh
mkdir -p ~/.local/bin ~/.config/systemd/user
ln -s "$HOME/nuwa-bridge/nuwa-bridge-linux-arm64.run" ~/.local/bin/nuwa-bridge
systemctl --user daemon-reload
systemctl --user enable --now nuwa-bridge
```

Enable user lingering with `sudo loginctl enable-linger "$USER"` when the host should run the service before login. The unit restarts failed processes. Inspect operation with `systemctl --user status nuwa-bridge` and `journalctl --user -u nuwa-bridge -f`. Stop it with `systemctl --user stop nuwa-bridge` before configuration or upgrade, then start it again. Confirm automatic startup and restart on the actual host.

## 7. Verify operation and diagnose failures

Send a permitted request and observe an actual reply in the original LINE conversation. Follow up and verify the same Relay Thread; use a second authorized chat and interleave replies. For a two-member group, send an ordinary message. For a larger group, verify ambient chatter remains local, then use a native mention, @All and a quote of the reply. Verify excluded chats and changed group audiences are protected. See [TESTING.md](../TESTING.md) for the complete acceptance scope.

| Log or evidence | Meaning |
| --- | --- |
| `/native/message/received` | Bridge accepted a native event for processing. |
| `/group/roster/verified` | Native group ID and actual membership were verified. |
| `/group/conversation/skipped` | A semantic candidate was skipped; the reason identifies approval, addressing, model availability, message size or missing assistant context. |
| `/group/conversation/decided` | Model decision with probability and inference elapsed milliseconds; no dialogue text. |
| `/group/conversation/failed`, `/group/conversation/disabled` | Explicit activation remains available; inspect credentials or model availability. |
| `/relay/message/submitted` | Relay accepted the message and returned Message and Thread IDs. |
| `/native/message/delivered` | LINE acknowledged native reply submission. |
| `/group/roster/rejected`, `/group/access/rejected` | Inspect the safe reason and member count; verify joined group and access policy. |
| Blocked or uncertain counts | Inspect the authorization or reconcile actual delivery evidence before retrying. |

Relay submission and Wake acceptance are intermediate evidence. Verify AI handling and the final LINE reply in the original chat. The current Inbox is bounded to 100 messages; reconcile a saturated window without a known checkpoint before resuming. Keep credentials and private message contents out of diagnostic reports.
