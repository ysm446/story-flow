/**
 * 下部ステータスバーへのアクション通知（保存・更新などの結果表示）。
 * 自動保存には保存ボタンがなく「保存されたか」が分かりにくいため、
 * 変更が確定したタイミングで reportStatusAction を呼び、ステータスバーに数秒表示する。
 * React の context を介さない pub/sub（発信側の再レンダーを誘発しない）。
 */

export interface StatusAction {
  id: number
  message: string
  kind: 'info' | 'error'
  at: Date
}

type Listener = (action: StatusAction) => void

const listeners = new Set<Listener>()
let nextId = 1

export function reportStatusAction(message: string, kind: 'info' | 'error' = 'info'): void {
  const action: StatusAction = { id: nextId++, message, kind, at: new Date() }
  listeners.forEach((listener) => listener(action))
}

export function onStatusAction(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
