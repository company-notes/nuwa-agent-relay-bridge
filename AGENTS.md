# Nuwa Agent Relay Bridge engineering rules

Read [README.md](README.md), [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md), and [TESTING.md](TESTING.md) before implementation.

Keep the bridge core independent of individual messaging protocols. Preserve Nuwa's published identity, authorization, message submission, and thread contracts. Use object-oriented encapsulation, DRY, and separation of concerns. Record native delivery evidence separately from Relay acceptance. Keep credentials out of logs and protect the persisted communication state.

Work through pull requests with scenario-based tests. After the relevant tests pass, review Rule 20 vertical spacing in production and test code and rerun validation. Obtain approval before merging or releasing. Document durable contracts in the README and implementation history in issues and pull requests.
