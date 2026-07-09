import { getApiBaseUrl } from './api'

/**
 * POST + SSE（text/event-stream）受信。data 行の JSON をイベントとしてコールバックする。
 * EventSource は POST に使えないため fetch + ReadableStream でパースする。
 */
export async function postSse<TEvent>(
  path: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(detail?.detail ?? `SSE ${path} failed: ${response.status}`)
  }
  if (!response.body) {
    throw new Error('SSE response has no body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separatorIndex: number
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, separatorIndex)
        buffer = buffer.slice(separatorIndex + 2)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            onEvent(JSON.parse(line.slice(6)) as TEvent)
          }
        }
      }
    }
  } finally {
    // onEvent が throw した場合などに接続を掴んだままにしない
    void reader.cancel().catch(() => undefined)
  }
}
