# ISBN2Notion

iPhoneでISBNバーコードを読み取り、openBD、国立国会図書館サーチ、Google Books API、Open Library APIから書誌情報を取得して、Notion Databaseに登録する個人用PWAです。DBは持たず、Notionをそのまま蔵書DBとして使います。国内ISBNの書影は版元ドットコムの画像URLもフォールバックに使います。

## 構成

- Next.js App Router
- TypeScript
- Tailwind CSS
- `@zxing/browser` によるバーコード読み取り
- openBD、国立国会図書館サーチ、Google Books API、Open Library API
- Notion API / OAuth
- Railwayデプロイ想定

## Notion Databaseプロパティ

Notion Databaseに以下のプロパティを作成してください。名前と型を一致させる必要があります。

| Property | Type |
| --- | --- |
| Title | title |
| Author | rich_text |
| Category | rich_text |
| Cover | files |
| ISBN | number |
| Published | date |
| Storage | select |
| memo | rich_text |
| 状態 | select |

`状態` の選択肢は `Unread`, `Reading`, `Finished` を用意してください。`Storage` の選択肢は `中野`, `仙台`, `電子` を用意してください。

## Notion OAuth Integrationの作り方

画面から本を登録するユーザーは、Notion OAuthで自分のWorkspaceへ接続します。

1. [Notion Developers](https://www.notion.so/my-integrations) を開きます。
2. Public Integrationを作成します。
3. `OAuth domain & URIs` にアプリのURLを設定します。
4. Redirect URIに `/api/notion/oauth/callback` を追加します。ローカル実験なら `http://localhost:3000/api/notion/oauth/callback` です。
5. `Capabilities` で少なくとも `Read content`, `Insert content`, `Update content` を有効にします。
6. `OAuth client ID` と `OAuth client secret` を環境変数に設定します。

アプリにログイン後、`Notionでログイン` を押します。Notionの認可画面で、上記プロパティを持つ蔵書Databaseへのアクセスを許可してください。OAuth完了後、アプリは許可されたDatabaseの中からISBN2Notion用スキーマに一致するDatabaseを自動で選びます。この端末では次回以降、Databaseを選び直さず登録できます。

OAuth接続情報はHTTPOnly Cookieへ暗号化して保存します。実験用にDBを持たない実装なので、別端末でも同じNotionアカウントに自動で紐づけたい場合は、Notion user IDとDatabase IDの対応をKV/DBへ保存する構成に拡張してください。Cookieの暗号化には `NOTION_OAUTH_COOKIE_SECRET` を使い、未設定の場合は `BOOKS_APP_PASSWORD` を使います。

## Internal Notion Integrationの作り方

メール取り込みなど無人で動くAPIは、従来どおり環境変数の `NOTION_TOKEN` と `NOTION_DATABASE_ID` を使えます。

1. [Notion Developers](https://www.notion.so/my-integrations) を開きます。
2. `New integration` を選びます。
3. Integration名を入力し、対象のWorkspaceを選びます。
4. `Capabilities` で少なくとも `Read content`, `Insert content`, `Update content` を有効にします。
5. 作成後、`Internal Integration Secret` をコピーします。これが `NOTION_TOKEN` です。

## Notion DatabaseにIntegrationを招待する

1. 蔵書管理用のNotion Databaseページを開きます。
2. 右上の `...` または共有メニューを開きます。
3. `Connections` から作成したIntegrationを追加します。
4. Database URLの32文字のID部分を控えます。これが `NOTION_DATABASE_ID` です。

## 環境変数

`.env.example` をコピーして `.env` を作ります。

```bash
cp .env.example .env
```

```env
NOTION_TOKEN=
NOTION_DATABASE_ID=
NOTION_OAUTH_CLIENT_ID=
NOTION_OAUTH_CLIENT_SECRET=
NOTION_OAUTH_REDIRECT_URI=
NOTION_OAUTH_COOKIE_SECRET=
BOOKS_APP_PASSWORD=
EBOOK_EMAIL_INGEST_TOKEN=
EBOOK_EMAIL_ALLOWED_SENDERS=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

重要: Notionトークン、OAuth client secret、Cookie secretに `NEXT_PUBLIC_` を付けないでください。ブラウザ側へ出してはいけません。
`NOTION_OAUTH_CLIENT_ID` と `NOTION_OAUTH_CLIENT_SECRET` は画面登録のOAuth接続で使います。
`NOTION_OAUTH_REDIRECT_URI` は本番URLを固定したい場合だけ設定します。未設定ならアクセス元のOriginから自動生成します。
`NOTION_TOKEN` と `NOTION_DATABASE_ID` はメール取り込みなどサーバー間処理用です。画面からの手動登録だけならOAuth設定だけで実験できます。
`BOOKS_APP_PASSWORD` はアプリを開くための合言葉です。iPhoneで初回アクセス時に入力すると、HTTPOnly Cookieでログイン状態を保持します。
`EBOOK_EMAIL_INGEST_TOKEN` は購入確認メール転送用APIだけで使う長いランダム文字列です。`OPENAI_API_KEY` を設定すると、転送メール本文からタイトル、著者、購入元、購入日、タグなどをJSONで抽出します。`OPENAI_API_KEY` が未設定の場合も、メール内にISBNがあれば既存の書誌検索で登録できます。
`EBOOK_EMAIL_ALLOWED_SENDERS` は転送を許可する中継メールアドレスのカンマ区切りリストです。空の場合はトークンのみで認証します。

## ローカル起動

```bash
npm install
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。iPhone実機のカメラで試す場合は、HTTPSまたは信頼できるローカル環境が必要です。カメラ権限が拒否された場合も、ISBN手入力で登録できます。

## Railwayへのデプロイ

1. GitHubへこのリポジトリをpushします。
2. Railwayで `New Project` を作り、GitHubリポジトリを接続します。
3. `Variables` に以下を追加します。

```env
NOTION_TOKEN=secret_xxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NOTION_OAUTH_CLIENT_ID=xxx
NOTION_OAUTH_CLIENT_SECRET=secret_xxx
BOOKS_APP_PASSWORD=long-random-password
NOTION_OAUTH_COOKIE_SECRET=another-long-random-string
```

4. Railwayが自動で `npm install` と `npm run build` を実行します。
5. Deploy後のURLをiPhone Safariで開き、共有メニューからホーム画面に追加するとPWAとして使えます。

このリポジトリにはRailway用の `railway.json` が含まれています。Railwayでは `PORT` が自動設定され、`npm run start` がそのポートでNext.jsを起動します。

## API

### `POST /api/lookup`

Input:

```json
{ "isbn": "978..." }
```

openBDで検索し、見つからない場合は国立国会図書館サーチ、Google Books API、Open Library APIの順に試します。日本語の商業出版物はopenBDと国立国会図書館サーチで見つかることが多いです。
書影が取得できない国内ISBNでは `https://img.hanmoto.com/bd/img/{ISBN}.jpg` を補完します。画像が存在しない場合は画面上で `NO COVER` 表示に戻ります。

Output:

```json
{
  "title": "Book title",
  "authors": ["Author"],
  "publisher": "Publisher",
  "publishedDate": "2024",
  "thumbnail": "https://...",
  "isbn": "978..."
}
```

### `POST /api/books`

Input:

```json
{
  "title": "Book title",
  "authors": ["Author"],
  "publisher": "Publisher",
  "publishedDate": "2024",
  "thumbnail": "https://...",
  "isbn": "978...",
  "whyBought": "講義で気になった",
  "tags": ["医学史"],
  "storage": "仙台",
  "status": "Unread"
}
```

登録前にNotion DatabaseをISBNでqueryします。同じISBNが既にあれば新規作成せず、成功レスポンスとして `duplicate: true` を返します。

### `POST /api/email/ebooks`

電子書籍の購入確認メールを転送サービスから受け取り、本文から書籍情報を抽出してNotionに登録します。登録時の `Storage` は自動で `電子`、`状態` は `Unread` になります。

認証はCookieログインではなく、メール転送サービス用のBearerトークンを使います。
必要に応じて `EBOOK_EMAIL_ALLOWED_SENDERS=me@example.com,forwarder@example.com` のように設定すると、許可した中継メールアドレス以外は本文解析前に拒否します。これは購入元が送ってきた `from` ではなく、GASなど転送処理を行ったアドレスを `forwardedBy` として判定します。

```http
POST /api/email/ebooks
Authorization: Bearer long-random-token
Content-Type: application/json
```

Input:

```json
{
  "subject": "ご注文の確認",
  "from": "store@example.com",
  "forwardedBy": "me@example.com",
  "text": "購入確認メール本文",
  "html": "<html>...</html>"
}
```

フォームPOSTにも対応しています。`subject`, `from`, `forwardedBy`, `text`, `html` のほか、Mailgun系の `body-plain`, `body-html` も受け取れます。`forwardedBy` の代わりに `forwarded_by`, `relayFrom`, `relay_from`, `X-Ebook-Forwarded-By` ヘッダーも使えます。

運用例:

1. 電子書籍登録用の専用メールアドレスをメール転送サービスで作ります。
2. そのアドレス宛の受信イベントを `/api/email/ebooks` へのPOSTに変換します。
3. 転送サービス側に `Authorization: Bearer <EBOOK_EMAIL_INGEST_TOKEN>` を設定します。
4. 自分の中継アドレスだけを受け入れる場合は `EBOOK_EMAIL_ALLOWED_SENDERS` に許可するメールアドレスを設定し、POST payloadに同じアドレスを `forwardedBy` として渡します。

Output:

```json
{
  "ok": true,
  "registered": [
    {
      "title": "Book title",
      "isbn": "978...",
      "notionUrl": "https://www.notion.so/...",
      "duplicate": false
    }
  ],
  "skipped": [],
  "ai": {
    "used": true,
    "model": "gpt-4.1-mini",
    "responseId": "resp_...",
    "skippedReason": "",
    "extractedDrafts": 1
  }
}
```

`ai.used` が `false` の場合はOpenAI APIを呼んでいません。多くの場合、Railwayに `OPENAI_API_KEY` が設定されていない状態です。`ai.responseId` が返っていればOpenAI Responses APIの呼び出しが発生しています。

Notionの `ISBN` がnumber型で既存の重複判定にも使われるため、有効なISBNがメール内に見つからない本は自動登録せず `skipped` に返します。AIにはISBNを推測させない設定にしています。

## セキュリティ

- フロントエンドはISBNと登録内容だけをAPIへ送ります。
- Notion API呼び出しは必ずサーバー側Route Handlerから行います。
- 画面登録用のNotion OAuth access tokenはHTTPOnly Cookieへ暗号化して保存します。
- `NOTION_TOKEN` と `NOTION_DATABASE_ID` は無人API用に `.env` またはRailway Variablesへ置けます。
- `BOOKS_APP_PASSWORD` でログインした端末だけが `/api/lookup` と `/api/books` を使えます。
- `/api/email/ebooks` は `EBOOK_EMAIL_INGEST_TOKEN` のBearer認証で保護します。メール転送サービスにはこのトークンを設定してください。`EBOOK_EMAIL_ALLOWED_SENDERS` を設定すると、許可した中継メールアドレスだけを処理します。
- ログイン状態はHTTPOnly Cookieで管理します。JavaScriptからCookie値は読めません。
- APIには簡易レート制限を入れています。ただしアプリ内レート制限はRailwayインスタンス単位の防御であり、大規模なDDoS対策はCloudflareなどの前段で行ってください。
- Notionトークンに `NEXT_PUBLIC_` を付けないでください。

公開URLの扱い:

- RailwayのURLを知っているだけではNotion登録APIを使えません。
- ただしURL自体はインターネットから到達可能です。
- 本格的にDDoSやbotを避けたい場合は、独自ドメインをCloudflareに載せてCloudflare Access、WAF、rate limitingを使うのが堅いです。
- iPhoneのモバイル回線はIPが変わるため、IP制限だけで守る運用はあまり向きません。
