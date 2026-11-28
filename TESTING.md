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
| Group access and activation | Disabled is the default; an approved member can mention the assistant, receive an original-group reply and quote it after restart. Two-member groups accept ordinary messages; larger groups forward native mentions, @All and valid assistant quotes. Ambient chatter and invalid quotes stay local unless an approved natural-conversation decision addresses the assistant. |
| Group identity and audience | Validate the joined-group directory, matching group ID, actual member map and account/sender membership even with a conflicting chat-type label. Pending invitations and former membership confer no access. A changed audience starts a new thread; older delayed replies stay protected. |
| Process locking | A real child process holds the OS lock; a competing process is rejected. After forced termination a new process acquires the existing lock file. |

## Assistant cutover and group activation

- Switch the designated assistant while preserving account identity, policies and historical evidence. New conversations route to the new assistant. Pending submissions, historical quotes, delayed replies and interrupted configuration migrations obey the cutover contract. Switching back creates another generation. Verify the prior pilot's persisted private and group routes migrate and remain available before cutover.
- Authorize automatic conversation in a verified two-member group; use a direct mention, native @All or assistant quote in larger groups, with optional approved semantic activation. Verify the audience at intake and submission; test member changes, reapproval, self messages, duplicate ambient events and @All.

## Natural group conversation

Exercise an approved multi-member group with a real assistant introduction, natural follow-up, unrelated human conversation, direct name, explicit mentions of other members, duplicate events and a native mention during model failure. Verify group/roster and assistant-generation isolation, seven-day expiry and startup deletion, bounded text, thirty-turn history, multi-hour and next-day follow-ups after restart, intervening human conversation and timestamp propagation, local speaker labels, cooldown recovery, persisted snapshot retry and consent revocation before submission. Exercise the authenticated Workers AI HTTP contract, including malformed probabilities and non-success responses. Synthetic live-provider evaluation uses representative Traditional Chinese dialogue and measures actual probabilities and latency without private production conversations; it supplements the deterministic automated scenarios. Validate real LINE behavior separately.

## Additional live acceptance

Demonstrate native AI context and business-tool permission isolation with separate harmless markers across simultaneous chats. Verify the systemd unit's startup and restart on the target host. Durable receive replay requires its own implementation and acceptance.

## Engineering verification

Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md). Run `npm install --ignore-scripts`, `npm run check` and `npm test`. For a regression, demonstrate the failing scenario (RED), repair it and run the same scenario (GREEN), then run the complete suite. Perform a separate Rule 20 review of logical vertical spacing after functionality passes; rerun validation.

CI builds the standalone Linux x64 and ARM64 executables on native runners and starts each from a separate directory without Node.js on PATH. It verifies version, help and safe unconfigured status behavior. Release immutable versioned executables and SHA256 checksums.

## Live acceptance and performance

Follow the [operating guide](docs/Pilot.md#verify-operation-and-diagnose-failures). Verify real account login, Nuwa OAuth, intended AI handling, original-thread reply and LINE visibility. Exercise private and group continuation, separate chats, membership changes, restart, text and stickers. Record actual native Message IDs, Relay Message IDs and Thread IDs in the acceptance record. Measure request acceptance, Wake, assistant reply and native return separately when timestamps are available. Keep dated results in PRs or issues, and use released artifacts to establish availability.
