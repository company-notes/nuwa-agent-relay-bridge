# Testing Nuwa Agent Relay Bridge

Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md) in production and test code. Tests describe user scenarios and verify visible outcomes together with persisted state. Use real SQLite databases in temporary directories. External messaging and Relay services can be controlled at their service boundary; label that scope precisely. Real-account acceptance requires an authorized isolated organization, bridge account, and AI assistant.

## Essential scenarios

1. Two first-time permitted LINE users chat normally and receive interleaved delayed answers in their original private chats.
2. Ordinary follow-ups continue the same thread; quotes select the original thread, and an explicit new topic starts a separate thread.
3. Duplicate inbound events and an interrupted Relay submission reuse the same persisted submission identifier.
4. Restart preserves pending messages, conversation correlation, and confirmed deliveries. An interrupted native send retains an uncertain state for reconciliation.
5. Unauthorized senders, self-generated messages, unknown quote targets, unexpected Relay senders, and unrelated threads cannot reach an unauthorized destination.
6. A full bounded inbox window without a known checkpoint requires investigation; tests do not treat it as a complete history.
7. Friend and allowlist policies restrict both submissions and delayed replies. Upgrades preserve the existing account and authorization.
8. Textless stickers carry validated public artifact links; private media notices accurately describe the unavailable attachment payload. The HTTP contract test verifies the artifactLinks field.

9. Group access defaults to disabled. A permitted group member mentions the assistant, receives a reply in the same group and quotes it after restart; ordinary chatter, @Everyone, self messages, cross-group quotes and unapproved groups do not trigger work. Private and group routes remain distinct.
10. A changed approved roster or lost membership blocks submissions and delayed replies. Open group access requires current membership. Verify the real LINE group directory, mentions, quote events, native group send and AI context isolation before production use.

Run `npm install`, `npm run check`, and `npm test`. CI executes the same checks. For regressions, demonstrate a meaningful failing assertion before repair, run the same test after repair, then run the related and full suites. Perform the Rule 20 spacing review after logic passes and rerun validation.

The core tests use controlled external services; they do not establish live LINE login, Nuwa OAuth, or AI platform delivery. Verify those boundaries through a real two-way conversation before production deployment. A clearly labeled pilot release enables real-account acceptance. CI builds and launches both Linux x64 and ARM64 standalone executables on native runners from a separate working directory without a Node.js installation on PATH, checks its version/help output, and verifies that an unconfigured status command fails safely.
