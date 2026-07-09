# Vault フォルダ階層と「使うフォルダ」

作成日時: 2026-07-10 05:10
更新日時: 2026-07-10 05:10

Vault のカードをフォルダで整理し、Compose で「この作品で使うフォルダ」を選択する仕組みの設計資料。
UI は image-assistant のライブラリページを参考（作者指定）。
実装: `backend/routes/folders.py`、`src/phases/vault/FolderTree.tsx`、`src/lib/folders.ts`。

## 設計原則（2026-07-10 作者と協議して確定）

- **ルート = 全作品共有の共通素材**（`cards.folder_id IS NULL`）。どの作品でも常に
  アセットに表示され、おまかせスロットの在庫にも常に入る。
- **フォルダ = 選んで使う作品セット**。Compose の「使うフォルダ」で選択した
  フォルダ（**サブツリーを含む**）のカードだけが、その作品のアセット一覧と
  おまかせの在庫に加わる。
- **手置き済みカードは常に有効**（ルート扱い）。フォルダ選択を後から狭めても、
  キャンバスに置いたノードは無効化されない。フィルタが効くのは表示と
  おまかせの母集団だけ。
- **後方互換**: 既存カードは全部ルート（folder_id NULL）なので、フォルダを
  使い始めるまで挙動は一切変わらない。Compose の「使うフォルダ」未選択 =
  ルートのみ（在庫 API 側はフォルダ未指定 = 全カードで従来互換）。
- カードとフォルダは 1 対多（カードは 1 フォルダ所属）。Vault は全作品共通の
  アセットという spec §4.7 の原則は維持（フォルダは所有ではなくフィルタ）。

## データモデル

```sql
CREATE TABLE folders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES folders(id),  -- NULL = トップレベル。無制限ネスト
  sort_order  INTEGER NOT NULL DEFAULT 0,   -- 同一階層内の並び順
  ...
);
-- cards.folder_id TEXT REFERENCES folders(id)   （NULL = ルート）
-- workspaces.folder_ids TEXT DEFAULT '[]'        （使うフォルダ ID の JSON 配列）
```

## API

```
GET    /folders                 # フラット配列 + card_count（直下のみ）+ root_count
POST   /folders                 # {name, parent_id?}
PUT    /folders/{id}            # 改名 {name}
PUT    /folders/{id}/parent     # 移動 {parent_id | null=トップレベル化}。循環参照は 400
POST   /folders/reorder         # 同一階層の兄弟 ID 配列で sort_order 振り直し
DELETE /folders/{id}            # 解体: 子フォルダとカードを親へ昇格（カードは消えない）
POST   /cards/{id}/folder       # カードの所属変更 {folder_id | null=ルートへ}
GET    /cards?folder=root|<id>  # 一覧のフォルダフィルタ（直下のみ）
POST   /generate {folder_ids}   # おまかせの在庫 = ルート ∪ 指定フォルダのサブツリー
```

サブツリー展開は backend（`folders.expand_folder_ids`）とフロント
（`lib/folders.ts` の `expandFolderSelection`）の両方に同じロジックを持つ
（前者は生成の在庫、後者はアセット表示用）。

## Vault の UI（FolderTree）

- カードタブの左サイドバー。「すべて」「ルート（共有）」+ フォルダツリー
  （インデント表示、展開/折りたたみは localStorage 永続、件数バッジは直下のみ）。
- 作成: ヘッダの ＋（トップレベル）、行の ⋯ メニュー「子フォルダを作成」。
  インライン入力（Enter 確定 / Esc キャンセル / blur 確定）。
- 名前変更: ダブルクリック or ⋯ メニュー。削除: ⋯ メニュー（確認あり。解体 =
  中身は 1 つ上の階層へ）。
- フォルダを開いた状態で新規カードを作ると、そのフォルダに入る。

### ドラッグ&ドロップ（image-assistant の方式を移植）

| 操作 | 判定 | 結果 |
|---|---|---|
| カード → フォルダ行 | MIME `application/x-story-flow-card` | 所属変更（行全体をハイライト） |
| カード → ルート行 | 同上 | ルート（共有）へ戻す |
| フォルダ → フォルダ行の上端 30% | 同一階層の兄弟のみ | その前に並べ替え（上罫線表示） |
| フォルダ → 行の下端 30% | 同一階層の兄弟のみ | その後に並べ替え（下罫線表示） |
| フォルダ → 行の中央（or 別階層） | 子孫への移動はクライアント/サーバ両方で拒否 | 入れ子化（破線ハイライト） |
| フォルダ → ルート行 | — | トップレベル化 |

ドラッグ種別は MIME タイプで判別（カード: グリッド側の dragstart が設定、
フォルダ: ツリー内の dragstart + コンポーネント内 ref）。OS ファイルドロップ
（新規カード作成）とは `items.kind === 'file'` 判定で排他。

## Compose / Generate との接続

- 生成設定パネルに「使うフォルダ」チェックボックスツリー。選択は
  `workspaces.folder_ids` に自動保存（作品ごと）。
- アセットエリア = ルート ∪ 選択サブツリーの未配置カード。
- 生成時に `folder_ids` を `/generate` へ渡し、`fill_gap` の
  `load_inventory` が「ルート ∪ サブツリー − 使用済み」に絞る。
  固定アンカー（手置き）はフォルダ検証をしない（常に有効）。

## 保留・将来

- BGM のフォルダ対応（作者判断で保留。同じ機構を乗せるだけの想定）。
- カードの複数選択ドラッグ（image-assistant にはあるが、Vault グリッドに
  複数選択が無いため見送り）。
- フォルダ選択と検索の関係: Vault の検索はフォルダフィルタと併用
  （AND）。image-assistant は検索中フォルダ無視だが、story-flow は絞る側に倒した。
