# story-flow — 仕様書 (spec.md)

作成日時: 2026-07-08 16:27
更新日時: 2026-07-09 00:59

短編ストーリー生成・鑑賞アプリ。作者が事前に「シーンカード」を大量に用意し、
始点・終点（と任意の中間点）を置くと、ローカル LLM が在庫カードから間を埋め、
逐次清書して一本の物語に仕立て、それを鑑賞する。`lm-graph` をフォークして構築する。

---

## 0. このドキュメントの読み方（Claude Code へ）

- 本 spec は**設計判断の根拠**（なぜそうするか）を各所に埋めている。実装時にこの判断を
  蒸し返さないこと。特に「### 判断」ブロックは確定事項。
- スコープは v1 / v1.5 / v2 に厳密に分かれている。**まず v1 を完成させる**。v1.5 以降の
  コードは v1 の関数に差し込めるよう設計するが、v1 の段階では実装しない。
- 迷ったら「一本道 → 逐次清書 → 鑑賞」の最小経路を優先し、多機能化しない。

---

## 1. コンセプトと中核設計

### 1.1 何を作るか

素材（メディア + 短い指示文）を貯めておき、プロットと数個のアンカーを与えると、
毎回すこしずつ違う短編が生成される。リプレイ性（同じ素材から別の物語）が面白さの核。

### 1.2 カードは「本文」ではなく「ブリーフ」

各カードが持つテキストは、完成した地の文ではなく**作者の指示・アイデア（ブリーフ）**。
清書は LLM がおこない、多少の改変を許容する。

### 判断: 清書は全編 LLM が書く

- カード本文 = 骨（意図の固定点）、LLM の清書 = 実。
- 「本文をそのまま並べる」方式は採らない。毎回読み味が変わるリプレイ性と噛み合わせる。
- ただしブリーフの**意図**は尊重する。改変は語り口・接続の範囲で、設定の破壊はしない。

### 1.3 生成は逐次（1 シーンずつ）

全シーンを一括生成しない。左から 1 枚ずつ清書し、その都度「確定した事実
（名前・持ち物・起きたこと・場所・トーン）」をコンパクトな状態として次に持ち越す。
`mem-chat` の走行中メモリと同じ構造を、1 本の物語の中で回す。

### 判断: ドリフト抑制は逐次 + 状態持ち越しで行う

- 失敗モードは「繋ぎ目のガタつき」ではなく「事実の食い違い（3 枚目の赤い傘が 5 枚目で消える）」。
- 一括生成はこのドリフトを誘発するので禁止。逐次のみ。

### 1.4 ベクトル検索が拾うのは常に「入力（カード）」

- **埋め込みはブリーフに対して計算する**（作者の意図の安定点だから）。
- 検索が引き当てるのは常にカード（入力素材）。完成した清書文は検索対象にしない。
- 清書文は再生・履歴のために**保存はする**が、埋め込まない・検索しない・DB に照合し返さない。

### 判断: 清書文は index しない

- `stories` / `story_scenes` に清書結果を保存するのは playback と履歴のためだけ。
- これらに対して embedding を計算したり FTS を張ったりしないこと。矢印は常に `DB → 物語` の
  一方向で、逆流させない。

### 1.5 パズル型の穴埋め（v1.5 の本命）

始点・終点・任意の中間点だけを作者が置き、間の穴を LLM が在庫カードから探して埋める。

### 判断: 穴埋めは「候補検索 → LLM 選択」の二段

- 全在庫を LLM に見せない。ベクトル検索 + ロールで **k 件（5〜8）に絞ってから** LLM に 1 枚選ばせる。
- 既存アプリのハイブリッド検索（sqlite-vec + FTS5 + Qwen3-Embedding）をそのまま流用する。新規部品なし。
- 穴が連続するときは、まとめてではなく**左から 1 枚ずつ確定**し、選んだカードを直前カードに
  繰り込んでから次の 1 枚を選ぶ。選択と清書を同じ逐次ループに乗せる（下記 §6）。

---

## 2. フェーズ構成（4 モード）

データは `Vault → Compose → Generate → Theater` と一方向に流れる。

| フェーズ | 責務 | v1 |
|---|---|---|
| **Vault** | 素材の入出力。メディア + ブリーフ + タグ + ロールの登録、埋め込み計算、一覧・検索、在庫密度の可視化 | ○ フル実装 |
| **Compose** | 構成。どのカードをどう並べるか（アンカー配置）。`lm-graph` の React Flow を流用 | ○ アンカーのみ（順序 = 並び） |
| **Generate** | 生成。逐次清書 + 状態持ち越し。（v1.5 で穴埋めが入る重い工程なので独立フェーズにする） | ○ 穴埋めなし |
| **Theater** | 鑑賞。Ken Burns + オート送り + クロスフェード | ○ |

### 判断: Generate は独立フェーズ

「アンカーを繋いでから読めるまで」の間に逐次生成・状態蓄積・破綻チェックという重い処理が
挟まる。これを Theater に押し込むと再生が重く、Compose に押し込むと図が汚れる。内部的に
必ず 4 フェーズで分離すること（UI タブを 4 つ立てるかは実装判断でよいが、状態機械としては 4 相）。

---

## 3. 技術スタック

- **フロント**: Electron + React + TypeScript（`lm-graph` フォーク）。Compose は React Flow を流用。
- **バックエンド**: FastAPI（Python）。venv（`.venv` + `backend/requirements.txt`）で実行。
- **LLM 推論**: llama.cpp の OpenAI 互換エンドポイント。既定は Qwen 系 instruct。
  - llama-server は `runtime/` に配置し、アプリ UI 内のインストーラで導入する。
    GGUF モデルは `models/` に置く。導入・起動管理は Electron main 側（lm-graph の方式を流用）。
  - writer（清書）と selector（カード選択）で**エンドポイント/モデルを分けられる**設定にする
    （`news-desk` の dual-port と同じ発想）。selector は推論寄りモデルでもよい。
  - Ornith 系推論モデルを使う場合は `<think>...</think>` ブロックを剥がすパーサを噛ませる。
- **埋め込み**: Qwen3-Embedding-4B（`models/Qwen3-Embedding-4B-GGUF/` の GGUF、配置済み）。
  llama-server を `--embedding` で起動し、OpenAI 互換 `/v1/embeddings` を HTTP で叩く
  （`image-assistant` の `embedding_client.py` と同方式・同モデル）。ブリーフに対して計算。
- **ストレージ/検索**: SQLite + sqlite-vec（ベクトル）+ FTS5（全文）。
- **メディア**: 画像・短尺動画をディスク保存し、DB にはパスのみ持つ。
  - ライブラリルート（DB + メディア + サムネイル）は当面 `data/library/` に置く。
    のちに設定で外部フォルダを参照できるよう、DB のパスは**ライブラリルート相対**で保持する。
- **方針**: ML コンポーネントは再実装せず、subprocess / HTTP でラップする。

---

## 4. データモデル (SQLite)

`backend/db/schema.sql` に反映する。ID はすべて text (uuid)。

### 4.1 cards — シーンカード（素材）

```sql
CREATE TABLE cards (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,              -- 作者用の短い識別名
  brief       TEXT NOT NULL,              -- ~200字。LLMへの指示/アイデア（清書の入力）
  media_path  TEXT,                       -- ライブラリルート以下の相対パス（media/xxx）
  media_type  TEXT CHECK(media_type IN ('image','video')),
  role        TEXT NOT NULL               -- 物語上の役割
              CHECK(role IN ('intro','rising','turn','climax','ending')),
  tone        TEXT                        -- ending カードのみ意味を持つ（終点タグ）
              CHECK(tone IN ('happy','bad','bitter','neutral') OR tone IS NULL),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

- `role`: 導入 / 展開 / 転換 / クライマックス / 結末。純粋な意味的類似度だけで組むと
  「導入っぽいシーン」ばかり並ぶので、ロールを弧の骨格に使う。
- `tone`: 終点タグ。v1 では ending カードに付けておくだけ（分岐は使わない）。v1.5 で「目標
  トーンを先に決めてそこへ向かう」引力として使う。

### 4.2 card_tags — 意味タグ（フィルタ用に正規化）

```sql
CREATE TABLE card_tags (
  card_id   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_type  TEXT NOT NULL CHECK(tag_type IN ('place','time','mood')),
  value     TEXT NOT NULL,
  PRIMARY KEY (card_id, tag_type, value)
);
```

### 4.3 card_vec — 埋め込み（sqlite-vec 仮想テーブル）

```sql
CREATE VIRTUAL TABLE card_vec USING vec0(
  card_id TEXT PRIMARY KEY,
  embedding FLOAT[<EMBED_DIM>]           -- ブリーフから計算。次元は Qwen3-Embedding-4B に合わせる
);
```

### 4.4 cards_fts — 全文検索（FTS5 仮想テーブル）

```sql
CREATE VIRTUAL TABLE cards_fts USING fts5(
  card_id UNINDEXED,
  title,
  brief,
  tags                                  -- card_tags を空白連結して投入
);
```

### 4.5 stories — 生成された物語（1 インスタンス）

```sql
CREATE TABLE stories (
  id           TEXT PRIMARY KEY,
  plot         TEXT,                     -- 入力プロット
  target_tone  TEXT,                     -- 目標トーン（v1.5 で使用、v1 は NULL 可）
  created_at   TEXT NOT NULL
);
```

> 注: 清書結果はここと story_scenes に保存するが **index しない**（§1.4 判断）。

### 4.6 story_scenes — 物語内の順序付きシーン

```sql
CREATE TABLE story_scenes (
  id                TEXT PRIMARY KEY,
  story_id          TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,    -- 0 始まりの並び
  card_id           TEXT NOT NULL REFERENCES cards(id),
  prose             TEXT NOT NULL,       -- このシーンの清書文
  is_fixed          INTEGER NOT NULL,    -- 1=作者が置いたアンカー / 0=LLMが埋めた(v1.5)
  selection_reason  TEXT,                -- LLM がこのカードを選んだ理由（v1.5）
  state_after       TEXT,                -- このシーン終了時点の確定事実(JSON) デバッグ/継続用
  UNIQUE(story_id, position)
);
```

### 4.7 workspaces — 作品単位の編集状態（2026-07-09 追加）

作者が「作品（ワークスペース）」単位で構成を切り替えて編集・保存できるようにする。
**Vault（cards）は全ワークスペース共通のアセット**であり、ワークスペースに属さない。
ワークスペースが持つのは構成（Compose グラフ）と生成設定だけ。

```sql
CREATE TABLE workspaces (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  graph             TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',  -- カードIDと座標・接続のみ
  plot              TEXT NOT NULL DEFAULT '',
  target_tone       TEXT CHECK(target_tone IN ('happy','bad','bitter','neutral') OR target_tone IS NULL),
  prompt_preset_id  TEXT,               -- NULL = 既定プロンプト
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
```

- `graph` にはカード ID と座標・接続だけを保存し、カード本体は保存しない
  （読み込み時に cards から再構成。削除済みカードのノードは落とす）。
- `stories.workspace_id`（NULL 可）で生成結果を作品に紐付ける。ワークスペース削除時、
  生成済みの物語は残して紐付けだけ外す。
- Compose の編集は自動保存（デバウンス）でワークスペースに書き戻す。

---

## 5. 確定事実（StoryState）

逐次清書で持ち越す走行中メモリ。コンパクトに保つ。`backend/services/state.py`。

```python
@dataclass
class StoryState:
    characters: list[dict]   # [{"name": "...", "traits": "..."}]
    items:      list[str]    # ["赤い傘", ...]
    events:     list[str]    # ["二人は別れた", ...]  時系列に追記
    location:   str | None
    time:       str | None
    tone_so_far: str | None  # ここまでの語りの色（happy寄り/陰り 等）

    @classmethod
    def empty(cls) -> "StoryState": ...
    def snapshot(self) -> dict: ...      # story_scenes.state_after へ
```

- writer が清書と同時に**更新後の state を構造化出力**する（別途抽出パスを立てない）。
- 肥大化を防ぐため、各リストは上限を設けて古い/些末な項目を落とす（実装時に上限を定数化）。

---

## 6. 生成パイプライン（中核）

`backend/services/pipeline.py`。**選択と清書を 1 つの左→右ループに乗せる**のが要。

### 6.1 メインループ

```python
def generate(composition: Composition, plot: str, target_tone: str | None) -> Story:
    state = StoryState.empty()
    prev_card: Card | None = None
    scenes: list[SceneResult] = []
    used_ids: set[str] = set()

    for slot in flatten(composition):          # FIXED か GAP を左から
        if slot.kind == "FIXED":
            card = slot.card
        else:                                  # GAP（1スロット=1枚）: v1.5
            card, reason = fill_gap(
                state, prev_card, slot.next_anchor,
                inventory=load_inventory(exclude=used_ids),
                target_role=slot.target_role,
                target_tone=target_tone,
                used_ids=used_ids,
            )
            slot.reason = reason

        prose, state = write_scene(card, state, target_tone, position=slot.position)
        scenes.append(SceneResult(card, prose, state.snapshot(),
                                  is_fixed=(slot.kind == "FIXED"), reason=slot.reason))
        used_ids.add(card.id)
        prev_card = card

    return save_story(plot, target_tone, scenes)   # 保存のみ。index しない
```

- `flatten(composition)`: アンカー列と、アンカー間の GAP(count=N) を N 個の GAP スロットに展開。
- **v1 では GAP が存在しない**（Compose はアンカーのみ）。ループは FIXED だけを回す。
- `position`: intro/climax/ending などの位置情報。清書の語り方（結末に向けた着地）に使う。

### 6.2 穴埋め関数 fill_gap（v1.5 — 最初に固める関数）

作者が最初に決めたいと言った関数。シグネチャを確定させる。

```python
def fill_gap(
    state: StoryState,          # 直前までの確定事実
    prev_card: Card | None,     # A（直前に確定したカード）
    next_anchor: Card,          # B（次の固定点）
    inventory: list[Card],      # 使用可能な在庫（used を除外済み）
    target_role: str | None,    # このスロットに欲しいロール（rising/turn 等）
    target_tone: str | None,    # 結末へ向かう引力
    used_ids: set[str],
) -> tuple[Card, str]:          # (選んだカード1枚, 理由)
    # 1. 候補検索: sqlite-vec（A と B の中間ムード）+ role フィルタ + FTS → k 件
    candidates = retrieve_candidates(
        state, prev_card, next_anchor, target_role, target_tone,
        k=CANDIDATE_K, penalize=used_ids,
    )
    # 2. 最終選択: k 件だけを LLM に見せ、「A から B へ繋ぐ最良の 1 枚」を理由付きで選ばせる
    card, reason = select_card(state, prev_card, next_anchor, candidates)
    return card, reason
```

`retrieve_candidates`（`backend/services/selection.py`）:
- クエリベクトル = A と B のブリーフ埋め込みの中点付近（or state を条件にした合成）。
- `target_role` でロール・バケットを絞る（導入から / 展開から… とスロットごとに引く）。
- `penalize`: 既使用カードは除外 or スコアに軽いペナルティ（§7 多様性）。
- k = `CANDIDATE_K`（既定 6）。

`select_card`:
- 候補 k 件のブリーフ・ロール・タグだけを提示。清書はさせない。card_id と理由を構造化出力。

---

## 7. v1.5 のチューニング論点（実装は v1.5、設計だけ先取り）

動くこと自体は難しくない。難しいのは以下 3 点で、いずれも設定で殺せる。

1. **多様性（同じ答えにしない）**: 選択済みカードにペナルティ／除外、k をやや大きく取って
   LLM に幅を持たせる、`target_tone` をサイコロで振って引力をずらす。リプレイ性の生命線。
2. **行き止まり**: 左から貪欲に埋めると終盤で B に繋がらなくなる盤面がある。v1.5 では**浅い
   バックトラック**（1 手戻して除外して再選択）か、**橋渡しの地の文だけで繋ぐ逃げ道**で足りる。
   完全なビームサーチは v1.5 では実装しない。
3. **在庫密度**: パズルが解けるかはアルゴリズムより「ロール別に十分な種類があるか」に効く。
   → Vault の在庫密度可視化（§8.1 `/vault/stats`）で不足ロールを見えるようにする。

---

## 8. バックエンド API (FastAPI)

`backend/routes/` に分割。すべて JSON。生成系は SSE でシーン単位に流せると Theater が滑らか。

### 8.1 Vault (`routes/cards.py`)

```
POST   /cards                 # 作成。brief から埋め込み計算 → card_vec / cards_fts に挿入
GET    /cards                 # 一覧/検索。q=FTS, role=, place=, mood=, semantic=（ベクトル）
GET    /cards/{id}
PUT    /cards/{id}            # 更新。brief 変更時は埋め込み再計算
DELETE /cards/{id}
POST   /cards/{id}/media      # メディアアップロード（ライブラリの media/ に保存し相対パス記録）
GET    /cards/similar         # ?card_id= or ?text= 類似検索。作者補助（重複検知・候補サジェスト）
GET    /vault/stats           # ロール別枚数・タグ分布（在庫密度 / 素材マップ）
```

### 判断: v1 の埋め込みは「作者の道具」

v1 は選択経路が手置きなので、埋め込みは生成の主役ではない。Vault での重複検知・類似
サジェスト（`/cards/similar`）として使う。生成の主役に戻るのは v1.5 の `fill_gap` から。

### 8.2 Generate (`routes/generate.py`)

```
POST /generate                # 本体。入力: composition(アンカー+GAP), plot, target_tone
                              #   逐次パイプライン実行。SSE でシーン毎に push 推奨。
                              #   返り値: story_id + scenes
POST /generate/gap            # 単一穴埋めステップ（fill_gap）。対話/ステップ実行・テスト用。v1.5
```

### 8.3 Theater / Stories (`routes/stories.py`)

```
GET    /stories               # 履歴一覧
GET    /stories/{id}          # 再生用フル取得（scenes 順）
DELETE /stories/{id}
```

---

## 9. LLM プロンプト

`backend/prompts/` に分離。両方とも**構造化出力**（JSON）で受ける。

`backend/prompts/*.md` は**既定値**であり、生成用 system prompt はユーザーが UI から編集
できるようにする（上書き値を設定に保存して優先適用、「既定に戻す」可能）。ただし出力形式
（JSON スキーマ）の指示は編集対象から分離し、システム側で必ず付与する。

### 9.1 writer.md — 清書

- 入力: 当該カードの `brief` + `StoryState`(これまでの確定事実) + `target_tone` + `position`。
- 出力: `{ "prose": "...", "state": { ...更新後の StoryState... } }`。
- 指示の要点:
  - ブリーフの**意図を尊重**。改変は語り口・接続の範囲に留め、設定（名前・持ち物・既発生の
    出来事）を確定事実と矛盾させない。
  - `position` が ending なら、`target_tone`（happy/bad/bitter）へ**着地**させる。
  - 直前までの `events`/`items`/`characters` を必ず引き継ぐ。新規に確定した事実は `state` に追記。

### 9.2 selector.md — カード選択（v1.5）

- 入力: `StoryState` の要約 + `prev_card`(A) の要旨 + `next_anchor`(B) の要旨 + 候補 k 件
  （各カードの role/tags/brief 要旨）+ `target_role` + `target_tone`。
- 出力: `{ "card_id": "...", "reason": "..." }`。
- 指示の要点: A から B へ自然に橋渡しし、弧（role）と目標トーンに沿う 1 枚を選ぶ。清書はしない。

---

## 10. フロントエンド構成

`lm-graph` の Electron + React + TS + React Flow をフォーク。

```
src/
  phases/
    vault/       # カード CRUD, メディア登録, タグ/ロール入力, 一覧・検索, 在庫密度パネル
    compose/     # React Flow。始点/中間(複数可)/終点ノードを置き線で繋ぐ最小構成ビュー
    generate/    # 生成トリガ + SSE 受信で進行表示（シーンが埋まっていく様子）
    theater/     # Ken Burns(パン/ズーム) + テキスト長に応じたオート送り + クロスフェード
  components/
  lib/           # API クライアント, SSE
  store/         # フェーズ間の状態（composition ドラフト等）
```

### Compose (v1)

- v1 は「順序付きの選択トレイ」でも成立するが、React Flow を流用して**始点・中間(N)・終点を
  ノードで置き線で繋ぐ**。エッジは v1 では「並び順 = 次に来る」だけ（"エッジとは何か" 問題は
  分岐を入れる v2 で初めて再燃する）。
- 設定ノブ（v1.5 で有効化）: 中間ノードの許容枚数、未指定区間の橋渡しシーン自動挿入 on/off。

### Theater (v1)

- 生成済み `story` を順に見せるだけ。Ken Burns + オート送り + クロスフェード。シンプルに保つ。

---

## 11. ディレクトリ構成（全体）

```
story-flow/
  electron/                  # main プロセス
  src/                       # renderer（§10）
  backend/
    main.py
    db/
      schema.sql
      migrations/
    routes/
      cards.py
      generate.py
      stories.py
    services/
      embedding.py           # Ruri ラッパー（HTTP/subprocess）
      llm.py                 # llama.cpp OpenAI 互換クライアント（writer/selector 別エンドポイント可）
      pipeline.py            # generate() 逐次オーケストレーション（§6）
      selection.py           # retrieve_candidates + select_card（§6.2, v1.5）
      writer.py              # write_scene 清書（§9.1）
      state.py               # StoryState（§5）
    prompts/
      writer.md
      selector.md
  data/
    library/                 # ライブラリルート（コミットしない。設定で外部フォルダへ変更可能にする予定）
      story-flow.sqlite3     # DB 本体
      media/                 # メディア原本
      thumbs/                # サムネイル
  models/                    # GGUF モデル置き場（コミットしない）
  runtime/                   # llama-server 実行環境。UI のインストーラで導入（コミットしない）
  spec.md
  CLAUDE.md
```

---

## 12. 作業順序

手戻りを避けるため次の順で進める。Compose を最初に作ると楽しくて沼るが、生成が動かない
うちは空箱なので後回し。

1. **Vault**: CRUD + メディア + タグ/ロール + 保存時の埋め込み計算 + `/vault/stats`。
   （実質アプリの半分の作業量。ここを確実に。）
2. **Generate の逐次パイプライン**（穴埋めなし）: `write_scene` + `StoryState` 持ち越しを
   一本通す。手で用意した数枚のアンカー列で「順に清書 → 繋がった 1 本」が出ることを確認。
3. **Theater**: 生成済み story の再生（Ken Burns + オート送り + クロスフェード）。
4. **Compose**: React Flow でアンカー配置ビュー。ここまでで v1 完成。
5. **v1.5**: `fill_gap`（retrieve_candidates + select_card）を差し込み、中間点だけ置いて間を
   自動探索する本命のパズル型へ。多様性・浅いバックトラック・在庫密度を調整。

---

## 13. スコープ境界

| | 内容 |
|---|---|
| **v1** | Vault フル / Compose(アンカーのみ, 順序=並び) / Generate(逐次清書+状態, 穴埋めなし) / Theater(Ken Burns+オート送り+クロスフェード)。ending カードに tone は付けるが分岐は未使用。 |
| **v1.5** | 穴埋め(候補検索→LLM選択) / 多様性制御 / 浅いバックトラック / target_tone 引力 / ロール別スロット指定。 |
| **v2** | 分岐（手張りエッジでなく引力=アトラクタ方式の複数終端） / 鑑賞後の軌跡マップ(通った経路を光らせ、通らなかった枝を薄く) / TTS + BGM / VN 的な選択分岐。 |

---

## 14. 未決事項（実装前に埋める定数・判断）

- ~~埋め込みモデルと呼び出し方式~~ → **決定（2026-07-08）**: Qwen3-Embedding-4B（GGUF）を
  llama-server subprocess + HTTP（`/v1/embeddings`）で使う。`EMBED_DIM` は 2560 想定、
  実装時に `/v1/embeddings` の返り値で実測確認する。
- `CANDIDATE_K` の既定値（暫定 6）。
- `StoryState` 各リストの上限件数。
- 中間ノードの許容枚数の上限。
- 未指定区間の橋渡しシーン自動挿入を v1.5 で入れるか（設定ノブとして持つ想定）。
- writer / selector を同一モデルにするか、別エンドポイントに分けるか（既定は分離可能に）。
