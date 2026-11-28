# Nuwa Agent Relay Bridge engineering rules

Read [README.md](README.md) for the purpose and architecture, [docs/Handoff.md](docs/Handoff.md) for technical contracts and planned work, and [CODE_PRINCIPLES.md](CODE_PRINCIPLES.md) and [TESTING.md](TESTING.md) for engineering and acceptance.

Design for ordinary organizational messaging: use the native conversation identity and actual membership, preserving continuity when people join or leave. Keep safeguards proportional to the real risk and avoid recurring setup for routine group changes.

Keep the Bridge core independent of messaging protocols. Use object-oriented encapsulation, DRY (reuse common logic) and separation of concerns. Preserve Nuwa's published identity, authorization, submission and thread contracts. Keep native delivery evidence separate from Relay acceptance, and protect credentials and communication state.

Work through pull requests with scenario-based tests. After functional tests pass, review Rule 20 semantic vertical spacing separately and rerun validation. Obtain approval before merging or releasing.

## Documentation

Write project documentation in English. Start with the purpose and user experience, define unfamiliar concepts before relying on them, then move from overall architecture to standard workflow, durable contracts and implementation details.

Describe the intended standard in positive, direct language. Use explicit prohibitions where a significant security or reliability hazard warrants them. Keep operator instructions aligned with released functionality; label future designs separately. Preserve durable lessons, constraints, invariants and verification requirements. Keep dated implementation history, intermediate experiments, individual fixes and test logs in issues, PRs and commits. Link to authoritative documentation rather than duplicating changing details.
