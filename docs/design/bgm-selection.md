# BGM 選定アルゴリズム

作成日時: 2026-07-10 04:15
更新日時: 2026-07-10 04:15

シーンごとに鳴らす BGM を決める仕組みの設計資料。
実装: `backend/services/bgm_select.py`（選定本体）、`backend/services/pipeline.py`（呼び出し）、
`src/phases/theater/TheaterPhase.tsx` の `BgmPlayer`（再生）。

## 設計原則

- **選定は Generate 時に確定し、`story_scenes.bgm_id` に保存する**。再生は保存値を読むだけで、
  Theater 側に選定ロジックは持たない（再生が決定的・再現可能になる）。
- **埋め込むのは曲の説明文（description）**。作者が書いた「曲の雰囲気」の自由文であり、
  spec の原則「埋め込み対象は作者の意図」と整合する。音声波形の解析はしない。
- 選定は spec の確定パターン「**候補検索 → LLM 選択**」の二段に乗せる。全曲を LLM に見せない。
- **曲の切り替えを乱発しない**。LLM には常に「直前の曲を継続する」選択肢を与え、
  プロンプトでも継続を促す。失敗時の劣化先も常に「継続」。

## データ

| テーブル | 内容 |
|---|---|
| `bgm` | id / title / description / media_path（ライブラリ相対、sha256 命名） |
| `bgm_vec` | description の埋め込み（sqlite-vec、Qwen3-Embedding-4B、2560 次元） |
| `bgm_fts` | title / description の FTS5（Vault の BGM タブのキーワード検索用） |
| `story_scenes.bgm_id` | 確定した選曲（NULL = 無音）。条件付き ALTER で追加 |

## 選定フロー（シーンごと、`resolve_bgm`）

```
手動指名あり？ ──yes→ その曲で確定（LLM は回さない）
   │no
ムードクエリが空？ ──yes→ 直前の曲を継続
   │no
候補検索: ムードクエリを埋め込み → bgm_vec KNN（k=6）
   │ 埋め込みサーバ未起動 → 直前の曲を継続（劣化）
   │ 候補ゼロ → 直前の曲を継続
LLM 選択: 候補 6 件 + 「現在流れている曲」を提示し、
          {"choice": "<曲ID または continue>"} を出力させる（temperature 0.3）
   │ LLM 失敗 / continue / 候補外の ID → 直前の曲を継続
確定した bgm_id を story_scenes に保存し、SSE の scene イベントにも載せる
```

### 入力の組み立て

- **手動指名**: Compose のノードプロパティで曲を指名した場合（workspace graph の
  `bgm_id`）。最優先で、そのシーンは自動選曲を回さない。
- **ムードクエリ**: そのシーンの清書が終わった後の
  `state.tone_so_far`（ここまでの語りの色）+ `target_tone` + カードの brief を連結。
  清書 **後** の state を使うので、シーンの実際の空気に沿った選曲になる。
- **直前の曲（prev_bgm_id）**: パイプラインがシーンを跨いで持ち回る。
  「継続」判断の基準であり、全劣化経路の着地先。

### LLM プロンプトの要点

- 役割: 「物語の各シーンに合う BGM を選ぶ音響監督」（システムプロンプトは現状コード内固定。
  UI 編集対応は残課題）。
- 候補は `ID / タイトル / 説明文` の一覧。現在流れている曲も同じ形式で提示。
- 「切り替えは頻繁にせず、同じ雰囲気が続くなら continue を選ぶ」ことを明示。
- 出力は `{"choice": ...}` のみ（response_format=json_object + 検証）。

## 堅牢性（参照切れ対策）

生成には数分かかるため、選定・保存の各時点で BGM が削除されている可能性がある。

1. **生成開始時**（`routes/generate.py` `_load_slots`）: 手動指名の bgm_id が実在しなければ
   None（自動選曲）に劣化。workspace graph に残った削除済み曲の指名で保存が全損しない。
2. **保存直前**（`pipeline.save_story`）: 全シーンの bgm_id を再検証し、消えた参照は
   NULL に落として保存する（外部キー違反でテイクを失わない）。
3. **削除時**（`routes/bgm.py` `delete_bgm`）: 使用中シーンの `story_scenes.bgm_id` を
   先に NULL 化してから削除する。

## 再生（Theater / BgmPlayer）

- `<audio>` を 2 枚持ち、**曲が変わったシーンでだけ**クロスフェード（900ms）する。
  同じ曲が続く間は再生を継続（頭出ししない）。
- 一時停止・音量・BGM オンオフ設定に追従。プレイヤー終了で停止。
- bgm_id が NULL のシーンは無音（フェードアウト）。

## 定数・チューニング点

| 定数 | 値 | 場所 |
|---|---|---|
| CANDIDATE_K | 6 | bgm_select.py |
| temperature | 0.3（選定のブレを抑える） | bgm_select.py |
| クロスフェード | 900ms | TheaterPhase.tsx |

## 残課題

- 選定プロンプトの UI 編集対応（writer / selector と同じプリセット機構に乗せる）。
- 実 LLM での自動選曲の質の確認（切替頻度が高すぎないか、説明文の書き方のコツの整理）。
