// Theater の本文フォント（プリセット選択式）。
// すべて SIL OFL のフリーフォントを @fontsource でローカルバンドルする（オフラインで動く。
// CJK は unicode-range でサブセット分割されており、実際に使う文字の分だけ読み込まれる）
import '@fontsource/dotgothic16'
import '@fontsource/klee-one'
import '@fontsource/shippori-mincho'
import '@fontsource/zen-old-mincho'

export type TheaterFontId = 'default' | 'shippori-mincho' | 'zen-old-mincho' | 'klee-one' | 'dotgothic16'

export interface TheaterFont {
  id: TheaterFontId
  label: string
  /** CSS font-family。空文字 = 既定（アプリのシステムフォントスタック）を継承 */
  family: string
}

export const THEATER_FONTS: TheaterFont[] = [
  { id: 'default', label: '既定（システムゴシック）', family: '' },
  { id: 'shippori-mincho', label: 'しっぽり明朝 — 文芸・しっとり', family: "'Shippori Mincho', 'Yu Mincho', serif" },
  { id: 'zen-old-mincho', label: 'Zen オールド明朝 — 文学的・硬質', family: "'Zen Old Mincho', 'Yu Mincho', serif" },
  { id: 'klee-one', label: 'クレー — 手書き風・温かい', family: "'Klee One', 'Yu Gothic', sans-serif" },
  { id: 'dotgothic16', label: 'ドットゴシック16 — レトロゲーム', family: "'DotGothic16', 'MS Gothic', monospace" }
]

/** 設定値から font-family を引く（既定・不明な ID は undefined = 継承） */
export function theaterFontFamily(id: string): string | undefined {
  const font = THEATER_FONTS.find((item) => item.id === id)
  return font && font.family ? font.family : undefined
}
