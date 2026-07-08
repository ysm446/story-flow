import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * アプリ設定（UI 環境設定）。localStorage に永続化する。
 * サーバ・モデル関連はセットアップパネル（Electron main 管理）、こちらは表示・演出の設定。
 */
export interface UiSettings {
  /** Theater: 本文を 1 文字ずつストリーミング表示する（タイプライター演出） */
  theaterTextStreaming: boolean
}

const DEFAULT_SETTINGS: UiSettings = {
  theaterTextStreaming: true
}

const STORAGE_KEY = 'story-flow:ui-settings'

function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UiSettings>) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

interface SettingsStore {
  settings: UiSettings
  updateSettings: (patch: Partial<UiSettings>) => void
}

const SettingsContext = createContext<SettingsStore | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiSettings>(loadSettings)

  const value = useMemo(
    () => ({
      settings,
      updateSettings: (patch: Partial<UiSettings>) => {
        setSettings((prev) => {
          const next = { ...prev, ...patch }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
          } catch {
            // 永続化失敗はセッション内設定として続行
          }
          return next
        })
      }
    }),
    [settings]
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useUiSettings(): SettingsStore {
  const store = useContext(SettingsContext)
  if (!store) throw new Error('useUiSettings must be used within SettingsProvider.')
  return store
}
