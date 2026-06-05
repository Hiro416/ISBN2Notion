# 謎蔵書クリニック

iPhoneでISBNバーコードを読み取り、openBD、国立国会図書館サーチ、Google Books API、Open Library APIから書誌情報を取得して、Notion Databaseに登録する個人用PWAです。DBは持たず、Notionをそのまま蔵書DBとして使います。国内ISBNの書影は版元ドットコムの画像URLもフォールバックに使います。

## 構成

- Next.js App Router
- TypeScript
- Tailwind CSS
- `@zxing/browser` によるバーコード読み取り
- openBD、国立国会図書館サーチ、Google Books API、Open Library API
- Notion API
- Railwayデプロイ想定

## Notion Databaseプロパティ

Notion Databaseに以下のプロパティを作成してください。名前と型を一致させる必要があります。

| Property | Type |
| --- | --- |
| Title | title |
| Authors | rich_text |
| ISBN | rich_text |
| Publisher | rich_text |
| PublishedDate | rich_text |
| Thumbnail | url |
| Status | select |
| Tags | multi_select |
| WhyBought | rich_text |
| RelatedProject | multi_select |
| Rating | number |

`Status` の選択肢は `Unread`, `Reading`, `Finished` を用意してください。

## Notion Integrationの作り方

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
BOOKS_APP_PASSWORD=
```

重要: Notionトークンに `NEXT_PUBLIC_` を付けないでください。ブラウザ側へ出してはいけません。
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
NOTION_TOKEN=secret_xxx
NOTION_DATABASE_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
BOOKS_APP_PASSWORD=long-random-password
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
  "relatedProject": ["診断推論"],
  "status": "Unread",
  "rating": null
}
```

登録前にNotion DatabaseをISBNでqueryします。同じISBNが既にあれば新規作成せず、成功レスポンスとして `duplicate: true` を返します。

## セキュリティ

- フロントエンドはISBNと登録内容だけをAPIへ送ります。
- Notion API呼び出しは必ずサーバー側Route Handlerから行います。
- `NOTION_TOKEN` と `NOTION_DATABASE_ID` は `.env` またはRailway Variablesに置きます。
- `BOOKS_APP_PASSWORD` でログインした端末だけが `/api/lookup` と `/api/books` を使えます。
- ログイン状態はHTTPOnly Cookieで管理します。JavaScriptからCookie値は読めません。
- APIには簡易レート制限を入れています。ただしアプリ内レート制限はRailwayインスタンス単位の防御であり、大規模なDDoS対策はCloudflareなどの前段で行ってください。
- Notionトークンに `NEXT_PUBLIC_` を付けないでください。

公開URLの扱い:

- RailwayのURLを知っているだけではNotion登録APIを使えません。
- ただしURL自体はインターネットから到達可能です。
- 本格的にDDoSやbotを避けたい場合は、独自ドメインをCloudflareに載せてCloudflare Access、WAF、rate limitingを使うのが堅いです。
- iPhoneのモバイル回線はIPが変わるため、IP制限だけで守る運用はあまり向きません。
