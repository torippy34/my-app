# Number Veil

Number Veil は、Domemo 風の「自分の数字だけ見えない」数字推理ゲームを、ブラウザだけで遊べる個人利用向け Web アプリです。

公式名称・公式デザインは使わず、独自タイトル・独自 UI の数字推理ゲームとして実装しています。

## 技術構成

- Frontend: React + Vite + TypeScript
- Styling: Tailwind CSS
- Hosting: Cloudflare Pages
- Backend: Cloudflare Workers
- Realtime / State: Cloudflare Durable Objects
- 通信: WebSocket
- DB / 有料外部サービス: 不使用
- 最大同時ルーム数: 2

## 主要機能

- 3桁ルームIDで入室
- ルーム作成時に未使用の3桁IDをランダム生成
- プレイヤー最大6人、最小2人
- 観戦者入室
- ゲーム開始後の途中参加は観戦者のみ
- ホストのみ設定変更可能
- 最大数字 1〜10
- 最大プレイヤー数 2〜6
- 手札枚数 3〜8
- 観戦許可 ON / OFF
- ボタン式の数字宣言 UI
- WebSocket 切断後、同じ userId で復帰可能
- サーバー側で ClientView を生成し、自分の未解決手札は送信しない
- 無人ルームは5分後に削除

## ディレクトリ構成

```txt
.
├── src/                    # React フロントエンド
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   └── types.ts
├── worker/                 # Cloudflare Worker / Durable Objects
│   └── src/
│       ├── index.ts        # Worker entrypoint / API routing
│       ├── game.ts         # RoomRegistry / GameRoom Durable Objects
│       └── types.ts        # サーバー側型定義
├── public/
├── index.html
├── wrangler.toml           # Worker + Durable Objects 設定
├── tailwind.config.ts
├── postcss.config.js
├── vite.config.ts
└── package.json
```

## 主要な型

### GameSettings

ゲーム設定です。

- `maxNumber`: 最大数字。1〜10
- `maxPlayers`: 最大プレイヤー数。2〜6
- `handSize`: 手札枚数。3〜8
- `allowSpectators`: 観戦許可

### RoomData

Durable Object が保持するルーム状態です。

- `roomId`
- `hostId`
- `phase`: `lobby` / `playing` / `finished`
- `players`
- `spectators`
- `hands`
- `deck`
- `currentPlayerId`
- `rankings`
- `logs`

### ClientView

フロントエンドへ送る表示専用データです。

アクティブなプレイヤーには、自分の未解決手札の `value` を含めません。観戦者と上がったプレイヤーには全手札を表示します。

### RoomRegistry Durable Object

全体のルーム数を管理します。

- 最大2部屋制限
- 未使用3桁IDの生成
- 無効化されたルームの除外

### GameRoom Durable Object

ルーム単位のゲーム管理者です。

- WebSocket 接続管理
- 入室 / 復帰管理
- 設定変更
- 配布
- ターン処理
- 勝敗判定
- ClientView 生成

## ゲームルール

1. 最大数字 `N` に対して、1〜N の数字タイルを作ります。
2. 各数字は、その数字と同じ枚数だけあります。
   - 例: 最大数字7なら、1が1枚、2が2枚、3が3枚……7が7枚
3. 総タイル数は `N(N+1)/2` 枚です。
   - 最大数字10なら55枚
4. ゲーム開始時にタイルをシャッフルします。
5. ホストが設定した手札枚数を各プレイヤーに配ります。
6. プレイヤーは他人の未解決手札を見られます。
7. プレイヤーは自分の未解決手札を見られません。
8. 自分の番に数字ボタンを押して宣言します。
9. 宣言した数字が自分の未解決手札にあれば正解です。
10. 正解なら、その数字を1枚だけ解決済みにします。
11. 正解した場合は、同じプレイヤーが続けて行動できます。
12. 不正解なら、次の未上がりプレイヤーへ手番が移ります。
13. 自分の手札をすべて解決したら上がりです。
14. 上がったプレイヤーは観戦者扱いになり、全手札を見られます。
15. 最後の1人以外が上がったらゲーム終了です。

## セットアップ

```bash
npm install
```

## ローカル起動

Worker と Vite を同時に起動します。

```bash
npm run dev
```

起動後、通常は以下で確認できます。

- Frontend: `http://localhost:5173`
- Worker API / WebSocket: `http://localhost:8787`

フロントエンドは、ローカル時は自動で `http://localhost:8787` を Worker として扱います。

## Cloudflare ログイン

```bash
npx wrangler login
```

## Durable Objects の設定

`wrangler.toml` に Durable Objects の binding と migration を定義済みです。

```toml
[[durable_objects.bindings]]
name = "ROOM_REGISTRY"
class_name = "RoomRegistry"

[[durable_objects.bindings]]
name = "GAME_ROOM"
class_name = "GameRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RoomRegistry", "GameRoom"]
```

## Worker のデプロイ

```bash
npm run deploy:worker
```

デプロイ後、Worker の URL を控えてください。

例:

```txt
https://number-veil-api.<your-subdomain>.workers.dev
```

## Cloudflare Pages へのデプロイ

Cloudflare Pages 側で、ビルド時の環境変数を設定してください。

```txt
VITE_WORKER_URL=https://number-veil-api.<your-subdomain>.workers.dev
```

その後、以下を実行します。

```bash
npm run deploy:pages
```

Pages の設定例:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_WORKER_URL`

## npm scripts

```txt
npm run dev             # Worker + Frontend を同時起動
npm run dev:web         # Vite のみ起動
npm run dev:worker      # Wrangler Worker のみ起動
npm run build           # TypeScript typecheck + Vite build
npm run preview         # Vite preview
npm run deploy:worker   # Worker / Durable Objects をデプロイ
npm run deploy:pages    # dist を Cloudflare Pages にデプロイ
npm run typecheck       # TypeScript typecheck
```

## セキュリティ / 状態管理メモ

- userId はブラウザの localStorage に保存します。
- 名前の重複は許可し、内部 ID で区別します。
- ゲームロジックは Durable Object 側で処理します。
- フロントエンドは `ClientView` の描画だけを行います。
- 手番外操作、観戦者の宣言、上がったプレイヤーの宣言はサーバー側で拒否します。
- アクティブなプレイヤーには、自分の未解決手札の数字を送信しません。

## MVP で未実装のもの

- チャット機能
- 山札を使った追加ルール
- アカウント認証
- 永続的な戦績保存

個人利用の軽量 MVP として、ゲーム開始から終了まで遊べる状態を優先しています。
