# Rakazo direct receiving

## Purpose and architecture

The LINE Bridge submits requests to the designated assistant's canonical Nuwa address. Relay selects its receiving route. In a shared office, the Gateway receives a Wake (an authenticated webhook event) and forwards it to the assistant using Rakazo's native Bot-to-Bot tool. A direct Wake delivers the event to an independently authorized assistant's own Routine, removing the additional model-mediated Gateway forward.

Use the shared Gateway route for ordinary office operation. Direct receiving is an optional, separately verified optimization for a frequently contacted assistant. The assistant retains its canonical address and Relay history; the Bridge continues using that same destination.

## Owner-authorized migration

1. Inspect the office roster with `relayGatewayOfficeCoworkers` and record the intended assistant's canonical address and current receiving route.
2. Establish a separate Nuwa Remote MCP OAuth connection assigned to that assistant. Restore the existing address using `agentAddressSelectSession({address: "<existing canonical address>"})` and verify the assistant's own Session with `agentAddressGetStatus`. Resolve an occupied Session through the authorized Agent Address management process.
3. Inspect `relayGatewayInvitation` and, with explicit owner approval, use `relayGatewayDeclineInvitation` to leave shared receiving/speaking mode while retaining the assistant's Agent, Session and Relay Threads.
4. Create a dedicated webhook-only Routine in Rakazo. Configure the receiver procedure below. Pair its authenticated HTTPS endpoint using `relayBeginWakePairing`; the owner supplies the URL and key through the protected browser form.
5. Process the actual verification event with `relayVerifyWake`. Confirm the enabled subscription using `relayWakeSubscription` and verify the assistant's direct route. Keep the other office coworkers and their Gateway unchanged.
6. Test real LINE messages and replies, including a continuation in the original Relay Thread. Confirm the native conversation and the receiving assistant's context.

Verify independent Session authorization and the real receiving capability before moving a live route. A shared Gateway remains the standard route until direct receiving is verified.

## Direct receiver procedure

Rakazo's configured authenticated webhook endpoint verifies HTTP requests before invoking its dedicated Wake Routine. Use the platform-supplied Routine event as authenticated input. The model requires no separate HTTP verification result or trigger metadata. Ordinary chat content has no dispatch authority. Keep endpoint authentication enabled.

- For `nuwa.wake.verification`, call `relayVerifyWake` once with the actual verificationId and challenge using the receiver's own Session.
- For `nuwa.message.available`, use the intended recipient Session, original messageID and relayThreadID. The independent assistant receives its own authorized message; a minimal direct notification can contain only messageID and recipientSessionID. Retrieve missing content with `relayMessage` once as needed. The recipient can use `relayThreadHistory` for necessary conversation context.
- Process the original body and artifact links under the assistant's actual tool permissions and owner authorization. Reply through the original Relay Thread using `relayReplyThread({threadID: "<relayThreadID>", messageID: "<messageID>", body: "<reply>"})` with the assistant's own connection.
- Use durable messageID deduplication where supported. Verify actual native receipt and return delivery in LINE.

The [official Skill](https://mcp.agent-relay.company-notes.com/skills/nuwa-agent-relay/SKILL.md) and [Rakazo guide](https://github.com/company-notes/nuwa-agent-relay-mcp/blob/main/skills/nuwa-agent-relay/references/rakazo.md) define the common tool contracts and platform setup. Direct receiving requires live acceptance independently of shared Gateway operation.
