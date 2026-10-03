import { describe, expect, test } from 'vitest'
import type { AgentRequest } from '@experience-agent/contract'
import { RemoteAgentClient } from './RemoteAgentClient'

const request: AgentRequest = {
  experienceId: 'basic-plan-tile',
  compositionId: 'basic-plan-tile',
  currentA2ui: {
    a2ui: [{ version: 'v0.9', createSurface: { surfaceId: 'main', catalogId: 'https://pdesign.dev/catalog/v1/catalog.json' } }],
  },
  prompt: 'make the badge smaller',
}

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

async function collect(client: RemoteAgentClient, threadId: string) {
  const events = []
  for await (const event of client.sendPrompt(threadId, request)) events.push(event)
  return events
}

describe('RemoteAgentClient', () => {
  test('posts to the thread path with the request body and no threadId', async () => {
    let seenUrl = ''
    let seenBody: unknown = null
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seenUrl = url
      seenBody = JSON.parse(String(init?.body))
      return sseResponse(['event: scope\ndata: {"type":"scope","message":"out"}\n\n'])
    }) as typeof fetch
    await collect(new RemoteAgentClient('http://api.test', fetchImpl), 'thread 1')

    expect(seenUrl).toBe('http://api.test/v1/threads/thread%201/prompts')
    expect(seenBody).toEqual(request)
    expect(seenBody).not.toHaveProperty('threadId')
  })

  test('yields status steps as they arrive, then the terminal event', async () => {
    const fetchImpl = (async () =>
      sseResponse([
        'event: status\ndata: {"type":"status","stepId":"route","label":"Understanding your request","state":"running"}\n\n',
        'event: status\ndata: {"type":"status","stepId":"route","label":"Understanding your request","state":"done"}\n\n',
        'event: scope\ndata: {"type":"scope","message":"out of scope"}\n\n',
      ])) as typeof fetch
    const events = await collect(new RemoteAgentClient('http://api.test', fetchImpl), 't1')
    expect(events.map((e) => `${e.type}${e.type === 'status' ? `:${e.state}` : ''}`)).toEqual([
      'status:running',
      'status:done',
      'scope',
    ])
  })

  test('throws with the status when the server refuses the request', async () => {
    const fetchImpl = (async () => new Response('bad body', { status: 400 })) as typeof fetch
    await expect(collect(new RemoteAgentClient('http://api.test', fetchImpl), 't1')).rejects.toThrow('(400): bad body')
  })

  test('throws when an event does not match the contract', async () => {
    const fetchImpl = (async () => sseResponse(['event: patch\ndata: {"type":"patch"}\n\n'])) as typeof fetch
    await expect(collect(new RemoteAgentClient('http://api.test', fetchImpl), 't1')).rejects.toThrow('does not match the contract')
  })
})
