import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * アプリ設定（UI 環境設定）。data/settings.json に永続化する（Electron main が読み書き）。
 * サーバ・モデル関連はセットアップパネル、こちらは表示・演出の設定。
 */
export interface UiSettings {
  /** Generate: カードの画像を writer に見せて描写に反映する（vision 対応モデルのみ有効） */
  generateIncludeImages: boolean
  /** Theater: 本文を 1 文字ずつストリーミング表示する（タイプライター演出） */
  theaterTextStreaming: boolean
  /** Theater: 文字送りの間隔（ms/字。小さいほど速い） */
  theaterTextStreamMsPerChar: number
  /** Theater: 次のシーンへ移るまでの待ち時間を固定秒数で指定する（オフ = 本文の長さから自動） */
  theaterFixedWaitEnabled: boolean
  /** Theater: 本文の表示が終わってから次のシーンへ移るまでの秒数（固定指定時） */
  theaterFixedWaitSeconds: number
  /** Theater: 本文のフォントサイズ（px） */
  theaterFontSizePx: number
  /** Theater: 本文のフォント（src/lib/theaterFonts.ts のプリセット ID） */
  theaterFontId: string
  /** Theater: 再生ステージのサイズ（画面に対する %。100 = 全面） */
  theaterStageScale: number
  /** Theater: 再生ステージの縦横比（auto = ウィンドウに合わせる） */
  theaterAspectRatio: 'auto' | '16:9' | '4:3' | '3:2' | '1:1'
  /** Theater: メディアの合わせ方（cover = 埋める・切れる / contain = 全体表示・余白） */
  theaterFitMode: 'cover' | 'contain'
  /** Theater: 動画ループの継ぎ目をクロスディゾルブで繋ぐ */
  theaterVideoLoopCrossfade: boolean
  /** Theater: クロスディゾルブの長さ（秒） */
  theaterVideoCrossfadeSeconds: number
  /** BGM: 生成時の自動選曲 + Theater での再生を有効にする */
  theaterBgmEnabled: boolean
  /** Theater: BGM の音量（0〜1） */
  theaterBgmVolume: number
  /** ステータスバー: システムリソース表示 */
  statusMonitorVisible: boolean
}

const DEFAULT_SETTINGS: UiSettings = {
  generateIncludeImages: true,
  theaterTextStreaming: true,
  theaterTextStreamMsPerChar: 45,
  theaterFixedWaitEnabled: false,
  theaterFixedWaitSeconds: 3.0,
  theaterFontSizePx: 16,
  theaterFontId: 'default',
  theaterStageScale: 100,
  theaterAspectRatio: 'auto',
  theaterFitMode: 'cover',
  theaterVideoLoopCrossfade: true,
  theaterVideoCrossfadeSeconds: 1.0,
  theaterBgmEnabled: true,
  theaterBgmVolume: 0.5,
  statusMonitorVisible: true
}

// 旧保存先（localStorage）からの移行用
const LEGACY_STORAGE_KEY = 'story-flow:ui-settings'

interface SettingsStore {
  settings: UiSettings
  updateSettings: (patch: Partial<UiSettings>) => void
}

const SettingsContext = createContext<SettingsStore | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiSettings>(DEFAULT_SETTINGS)

  // 起動時に data/settings.json から読み込む（旧 localStorage の値があれば移行）
  useEffect(() => {
    let canceled = false
    void (async () => {
      try {
        let loaded = (await window.storyFlow.loadUiSettings()) as Partial<UiSettings>
        if (Object.keys(loaded).length === 0) {
          const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
          if (legacy) {
            loaded = JSON.parse(legacy) as Partial<UiSettings>
            void window.storyFlow.saveUiSettings({ ...DEFAULT_SETTINGS, ...loaded })
            localStorage.removeItem(LEGACY_STORAGE_KEY)
          }
        }
        if (!canceled) setSettings({ ...DEFAULT_SETTINGS, ...loaded })
      } catch {
        // 読み込み失敗は既定値で続行
      }
    })()
    return () => {
      canceled = true
    }
  }, [])

  const value = useMemo(
    () => ({
      settings,
      updateSettings: (patch: Partial<UiSettings>) => {
        setSettings((prev) => {
          const next = { ...prev, ...patch }
          void window.storyFlow.saveUiSettings(next as unknown as Record<string, unknown>).catch(() => undefined)
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
