import { describe, expect, test } from 'vitest'
import { parseSse } from './sseParser'

function body(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const frames = []
  for await (const frame of parseSse(stream)) frames.push(frame)
  return frames
}

describe('parseSse', () => {
  test('reads event and data fields', async () => {
    const frames = await collect(body(['event: status\ndata: {"a":1}\n\n']))
    expect(frames).toEqual([{ event: 'status', data: '{"a":1}' }])
  })

  test('joins a frame that is split across chunks', async () => {
    const frames = await collect(body(['event: sta', 'tus\ndata: {"a"', ':1}\n', '\nevent: result\ndata: {}\n\n']))
    expect(frames.map((f) => f.event)).toEqual(['status', 'result'])
    expect(frames[0]?.data).toBe('{"a":1}')
  })

  test('handles CRLF line endings and ignores comment lines', async () => {
    const frames = await collect(body([': keep-alive\r\nevent: scope\r\ndata: {"message":"x"}\r\n\r\n']))
    expect(frames).toEqual([{ event: 'scope', data: '{"message":"x"}' }])
  })

  test('joins multi-line data with newlines', async () => {
    const frames = await collect(body(['data: line one\ndata: line two\n\n']))
    expect(frames[0]?.data).toBe('line one\nline two')
  })

  test('yields a final frame that has no trailing blank line', async () => {
    const frames = await collect(body(['event: error\ndata: {"message":"boom"}']))
    expect(frames).toEqual([{ event: 'error', data: '{"message":"boom"}' }])
  })
})
