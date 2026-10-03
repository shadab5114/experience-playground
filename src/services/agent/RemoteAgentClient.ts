import { AgentEvent, type AgentRequest } from '@experience-agent/contract'
import type { AgentClient } from './AgentClient'
import { parseSse } from './sseParser'

type Fetch = typeof fetch

/**
 * Sends a prompt to POST /v1/threads/:threadId/prompts and yields the
 * AgentEvents from the SSE stream as they arrive, so status steps show live.
 * Every event is checked against the shared contract before it reaches the store.
 */
export class RemoteAgentClient implements AgentClient {
  private readonly baseUrl: string
  private readonly fetchImpl: Fetch

  // Wrapped so the browser calls fetch unbound; calling it as a method of this class throws "Illegal invocation".
  constructor(baseUrl: string, fetchImpl: Fetch = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  async *sendPrompt(threadId: string, req: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const path = `/v1/threads/${encodeURIComponent(threadId)}/prompts`
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(req),
      signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Agent request failed (${res.status})${detail ? `: ${detail}` : ''}`)
    }
    if (!res.body) throw new Error('Agent response had no body')

    for await (const frame of parseSse(res.body)) {
      const parsed = AgentEvent.safeParse(JSON.parse(frame.data))
      if (!parsed.success) throw new Error('Agent sent an event that does not match the contract')
      yield parsed.data
    }
  }
}
