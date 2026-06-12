# ISBN2Notion Developer README

iPhoneでISBNバーコードを読み取り、openBD、国立国会図書館サーチ、Google Books API、Open Library APIから書誌情報を取得して、Notion Databaseに登録する個人用PWAです。DBは持たず、Notionをそのまま蔵書DBとして使います。国内ISBNの書影は版元ドットコムの画像URLもフォールバックに使います。

一般ユーザー向けの使い方は [README.md](./README.md) に分けています。アプリ内の `/usage` からも同じREADMEを参照できます。

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

## 環境変数

`.env.example` をコピーして `.env` を作ります。

```bash
cp .env.example .env
```

```env
NOTION_OAUTH_CLIENT_ID=
NOTION_OAUTH_CLIENT_SECRET=
NOTION_OAUTH_REDIRECT_URI=
NOTION_OAUTH_COOKIE_SECRET=
BOOKS_APP_PASSWORD=
```

重要: Notionトークン、OAuth client secret、Cookie secretに `NEXT_PUBLIC_` を付けないでください。ブラウザ側へ出してはいけません。
`NOTION_OAUTH_CLIENT_ID` と `NOTION_OAUTH_CLIENT_SECRET` は画面登録のOAuth接続で使います。
`NOTION_OAUTH_REDIRECT_URI` は本番URLを固定したい場合だけ設定します。未設定ならアクセス元のOriginから自動生成します。
`BOOKS_APP_PASSWORD` はアプリを開くための合言葉です。iPhoneで初回アクセス時に入力すると、HTTPOnly Cookieでログイン状態を保持します。

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

## 分離した機能

メールから購入情報を読み取り、AIで抽出してNotionへ自動登録する機能は本体から分離しました。
分離先アプリは [book-mail-importer](https://github.com/Hiro416/book-mail-importer) です。

ISBN2Notion本体は、ISBN検索とユーザー確認後のNotion登録だけを扱います。

## セキュリティ

- フロントエンドはISBNと登録内容だけをAPIへ送ります。
- Notion API呼び出しは必ずサーバー側Route Handlerから行います。
- 画面登録用のNotion OAuth access tokenはHTTPOnly Cookieへ暗号化して保存します。
- `BOOKS_APP_PASSWORD` でログインした端末だけが `/api/lookup` と `/api/books` を使えます。
- ログイン状態はHTTPOnly Cookieで管理します。JavaScriptからCookie値は読めません。
- APIには簡易レート制限を入れています。ただしアプリ内レート制限はRailwayインスタンス単位の防御であり、大規模なDDoS対策はCloudflareなどの前段で行ってください。
- Notionトークンに `NEXT_PUBLIC_` を付けないでください。

公開URLの扱い:

- RailwayのURLを知っているだけではNotion登録APIを使えません。
- ただしURL自体はインターネットから到達可能です。
- 本格的にDDoSやbotを避けたい場合は、独自ドメインをCloudflareに載せてCloudflare Access、WAF、rate limitingを使うのが堅いです。
- iPhoneのモバイル回線はIPが変わるため、IP制限だけで守る運用はあまり向きません。
