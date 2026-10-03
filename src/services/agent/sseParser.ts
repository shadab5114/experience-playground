// Reads a server-sent events body into frames. Handles frames split across
// network chunks, CRLF line endings, comment lines, and multi-line data.
export interface SseFrame {
  event?: string
  data: string
}

function parseFrame(raw: string): SseFrame | null {
  let event: string | undefined
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null
}

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const frame = parseFrame(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (frame) yield frame
        end = buffer.indexOf('\n\n')
      }
    }
    buffer += decoder.decode()
    const tail = parseFrame(buffer.trim())
    if (tail) yield tail
  } finally {
    // Cancels the body if the consumer stopped early; a no-op once it has ended.
    await reader.cancel().catch(() => {})
  }
}
