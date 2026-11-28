# Testing Nuwa Agent Relay Bridge

## Acceptance model

The product's primary scenario is a real person sending a request in LINE, the intended AI assistant receiving and processing it, and the person seeing the reply in the original chat. Each layer provides its own evidence: Relay acceptance, mailbox receipt, Wake acceptance, AI handling, native submission and visible reply. The complete product test includes the last stage.

Use real SQLite databases in temporary directories for automated tests. Controlled substitutes for LINE and Relay prove the Bridge's behavior at those service boundaries. Live acceptance uses an authorized isolated organization, LINE account and restricted assistant.

## Released behavior: essential scenarios

| Scenario | Expected result |
| --- | --- |
| Private conversations | Two permitted users receive interleaved delayed replies in their own chats; ordinary follow-ups retain the active thread. |
| Topics and quotes | An explicit new topic creates a thread; a valid quote selects its original thread within the same chat. |
| Duplicate input and retry | Persist and reuse the same submission identifier and plan; duplicate native events produce one logical submission. |
| Restart and delivery reconciliation | Preserve pending records, conversation mapping and confirmed delivery; ambiguous native submission remains uncertain. |
| Authorization and routes | Excluded senders, self messages, unknown quote targets, unexpected Relay senders and unrelated threads cannot trigger unauthorized work or delivery. |
| Inbox window | A saturated 100-message window without a known checkpoint requires reconciliation. |
| Contact policy | Friends and Allowlist govern inbound requests and delayed replies; configuration and authorization persist across upgrades. |
| Content | Text and valid public sticker artifact links reach Relay; private media type notices are accurate. |
| Group access and activation | Disabled is the default; an approved member can mention the assistant, receive an original-group reply and quote it after restart. Ambient chatter, @Everyone and invalid quotes stay local. |
| Group identity and audience | Validate the joined-group directory, matching group ID, actual member map and account/sender membership even with a conflicting chat-type label. Pending invitations and former membership confer no access. A changed audience starts a new thread; older delayed replies stay protected. |
| Process locking | A real child process holds the OS lock; a competing process is rejected. After forced termination a new process acquires the existing lock file. |

## Next implementation targets

Add scenario tests for the design in [Handoff.md](docs/Handoff.md#next-implementation-targets):

- Switch the designated assistant while preserving account identity, policies and historical evidence. New conversations route to the new assistant. Pending submissions, historical quotes, delayed replies and interrupted configuration migrations obey the cutover contract.
- Authorize automatic conversation only in a verified two-member group; require a direct mention or assistant quote in larger groups. Verify the audience at submission and test member changes, reapproval, self messages and @Everyone.
- Demonstrate native AI context and business-tool permission isolation with separate harmless markers across simultaneous chats.
- Verify durable receive recovery and automatic process lifecycle when implemented.

## Engineering verification

Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md). Run `npm install --ignore-scripts`, `npm run check` and `npm test`. For a regression, demonstrate the failing scenario (RED), repair it and run the same scenario (GREEN), then run the complete suite. Perform a separate Rule 20 review of logical vertical spacing after functionality passes; rerun validation.

CI builds the standalone Linux x64 and ARM64 executables on native runners and starts each from a separate directory without Node.js on PATH. It verifies version, help and safe unconfigured status behavior. Release immutable versioned executables and SHA256 checksums.

## Live acceptance and performance

Follow the [operating guide](docs/Pilot.md#verify-operation-and-diagnose-failures). Verify real account login, Nuwa OAuth, intended AI handling, original-thread reply and LINE visibility. Exercise private and group continuation, separate chats, membership changes, restart, text and stickers. Record actual native Message IDs, Relay Message IDs and Thread IDs in the acceptance record. Measure request acceptance, Wake, assistant reply and native return separately when timestamps are available. Keep dated results in PRs or issues, and use released artifacts to establish availability.
