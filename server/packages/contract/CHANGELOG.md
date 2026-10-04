# Changelog: @experience-agent/contract

Both the playground and the backend import this package. Every change to the
wire shapes is listed here, with the reason.

## Unreleased (2026-10-03)

### Changed
- `A2UIDocument.meta` is optional. A document without a header is valid. The
  playground's `A2UIDocument` already allowed this, so the two types now match.
- `AgentRequest` no longer has `threadId`. The thread id travels in the URL path
  (`POST /v1/threads/:threadId/prompts`), and the playground passes it as the
  first argument of `sendPrompt(threadId, request, signal?)`.

### Added
- `PlacementView.flowId`, the key the impacts tabs use. The backend already had
  the flow id in its query; it is now part of the response.
- A2UI v0.9 wire types (`A2UIDocument`, `A2UIMessage`, `A2UIComponentNode`,
  `A2UIMeta`, `DynamicString` and the message interfaces), with Zod schemas
  (`A2UIDocumentSchema` and friends). Moved here from the playground so both
  sides share one definition. Components are loose: `id` and `component` are
  required, other props are allowed.

- `AgentEvent` has a `switch` event (`compositionId`, `name`, `message`), a
  terminal event. It is sent when a designer asks in the thread for another
  composition. The playground discards unsaved work and opens the target.
  Added to `TERMINAL_EVENT_TYPES`.

- `AgentRequest.experienceId`, `compositionId` and `currentA2ui` are optional, for
  a chat-first start where the designer types before choosing a tile. They are sent
  together: a request has both composition fields or neither. Requests that were
  valid before are still valid.

### Notes
- The playground's `src/a2ui/types.ts` re-exports these types, so renderer
  imports did not change.
