# Testing Nuwa Agent Relay Bridge

Follow [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md) in production and test code. Tests describe user scenarios and verify visible outcomes together with persisted state. Use real SQLite databases in temporary directories. External messaging and Relay services can be controlled at their service boundary; label that scope precisely. Real-account acceptance requires an authorized isolated organization, bridge account, and AI assistant.

## Essential scenarios

1. An authorized employee submits a request and receives the AI assistant's delayed response in the original private chat.
2. The employee quotes that response to continue the same Relay thread. Two separate requests remain independently correlated.
3. Duplicate inbound events and an interrupted Relay submission reuse the same persisted submission identifier.
4. Restart preserves pending messages, conversation correlation, and confirmed deliveries. An interrupted native send retains an uncertain state for reconciliation.
5. Unauthorized senders, self-generated messages, unknown quote targets, unexpected Relay senders, and unrelated threads cannot reach an unauthorized destination.
6. A full bounded inbox window without a known checkpoint requires investigation; tests do not treat it as a complete history.

Run `npm install`, `npm run check`, and `npm test`. CI executes the same checks. For regressions, demonstrate a meaningful failing assertion before repair, run the same test after repair, then run the related and full suites. Perform the Rule 20 spacing review after logic passes and rerun validation.

The core tests use controlled external services; they do not establish live LINE login, Nuwa OAuth, or AI platform delivery. Verify those boundaries through a real two-way conversation before production deployment. A clearly labeled pilot release enables real-account acceptance. CI builds and launches the standalone executable from a separate working directory without a Node.js installation on PATH, checks its version/help output, and verifies that an unconfigured status command fails safely.
