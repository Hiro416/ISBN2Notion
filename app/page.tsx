"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { barcodeToIsbn, isValidIsbn, normalizeIsbn } from "./lib/isbn";
import { BookLookup } from "./lib/types";

type Status = "Unread" | "Reading" | "Finished";
type Storage = "中野" | "仙台" | "電子";

type RegisterForm = {
  whyBought: string;
  tags: string;
  storage: Storage;
  status: Status;
};

type ScanState = "idle" | "starting" | "active" | "denied" | "unsupported";
type AuthState = "checking" | "authenticated" | "unauthenticated";
type NotionConnectionState = "checking" | "connected" | "disconnected";

const defaultForm: RegisterForm = {
  whyBought: "",
  tags: "",
  storage: "仙台",
  status: "Unread",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyBook(): BookLookup {
  return {
    title: "",
    authors: [],
    publisher: "",
    publishedDate: "",
    thumbnail: "",
    isbn: "",
  };
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isbnInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastDetectedRef = useRef("");
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [isbn, setIsbn] = useState("");
  const [detectedIsbn, setDetectedIsbn] = useState("");
  const [book, setBook] = useState<BookLookup | null>(null);
  const [form, setForm] = useState<RegisterForm>(defaultForm);
  const [coverFailed, setCoverFailed] = useState(false);
  const [message, setMessage] = useState("ISBNを読む準備はできています。");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [password, setPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState("合言葉を入れると登録画面を開けます。");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [notionConnectionState, setNotionConnectionState] = useState<NotionConnectionState>("checking");
  const [notionDatabaseTitle, setNotionDatabaseTitle] = useState("");
  const [notionWorkspaceName, setNotionWorkspaceName] = useState("");
  const [notionMessage, setNotionMessage] = useState("Notionでログインしてください。");
  const [isDisconnectingNotion, setIsDisconnectingNotion] = useState(false);

  const normalizedIsbn = useMemo(() => normalizeIsbn(isbn), [isbn]);
  const canLookup = isValidIsbn(normalizedIsbn) && !isLookingUp;
  const canRegister = notionConnectionState === "connected" && !isRegistering;

  useEffect(() => {
    return () => controlsRef.current?.stop();
  }, []);

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/session", { cache: "no-store" });
        const data = await response.json();
        setAuthState(data.authenticated ? "authenticated" : "unauthenticated");
      } catch {
        setAuthState("unauthenticated");
      }
    }

    void checkSession();
  }, []);

  useEffect(() => {
    if (authState !== "authenticated") {
      return;
    }

    async function checkNotionConnection() {
      try {
        const params = new URLSearchParams(window.location.search);
        const oauthMessage = params.get("message");

        if (oauthMessage) {
          setNotionMessage(oauthMessage);
          window.history.replaceState({}, "", window.location.pathname);
        }

        const response = await fetch("/api/notion/connection", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok) {
          setNotionConnectionState("disconnected");
          setNotionMessage(data.error ?? "Notion接続を確認できませんでした。");
          return;
        }

        setNotionConnectionState(data.connected ? "connected" : "disconnected");
        setNotionDatabaseTitle(data.databaseTitle ?? "");
        setNotionWorkspaceName(data.workspaceName ?? "");
        setNotionMessage(
          data.connected
            ? "Notionに接続済みです。この端末から登録できます。"
            : oauthMessage || "Notionでログインしてください。",
        );
      } catch {
        setNotionConnectionState("disconnected");
        setNotionMessage("Notion接続を確認できませんでした。");
      }
    }

    void checkNotionConnection();
  }, [authState]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setIsLoggingIn(true);
      setLoginMessage("確認しています。");

      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        setLoginMessage(data.error ?? "ログインに失敗しました。");
        return;
      }

      setPassword("");
      setAuthState("authenticated");
      setLoginMessage("ログインしました。");
    } catch {
      setLoginMessage("通信に失敗しました。もう一度お試しください。");
    } finally {
      setIsLoggingIn(false);
    }
  }

  function connectNotion() {
    setNotionMessage("Notionの認可画面へ移動します。");
    window.location.href = "/api/notion/oauth/start";
  }

  async function disconnectNotion() {
    try {
      setIsDisconnectingNotion(true);
      const response = await fetch("/api/notion/connection", { method: "POST" });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        setNotionMessage(data.error ?? "Notion接続の解除に失敗しました。");
        return;
      }

      setNotionConnectionState("disconnected");
      setNotionWorkspaceName("");
      setNotionDatabaseTitle("");
      setNotionMessage("Notion接続を解除しました。");
    } catch {
      setNotionMessage("Notion接続の解除中に通信エラーが起きました。");
    } finally {
      setIsDisconnectingNotion(false);
    }
  }

  async function startScanner() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanState("unsupported");
      setMessage("このブラウザではカメラ読み取りが使えません。手入力でISBNを登録してください。");
      return;
    }

    try {
      setScanState("starting");
      setMessage("カメラを起動しています。背表紙の下あたりをそっと見せてください。");

      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const videoElement = videoRef.current;

      if (!videoElement) {
        setScanState("unsupported");
        setMessage("カメラプレビューを準備できませんでした。ISBNを手入力してください。");
        return;
      }

      controlsRef.current?.stop();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoElement,
        (result) => {
          if (!result) {
            return;
          }

          const candidate = barcodeToIsbn(result.getText());

          if (candidate === lastDetectedRef.current) {
            return;
          }

          if (!isValidIsbn(candidate)) {
            if (candidate.startsWith("192")) {
              setMessage("ISBNではなく価格コードを読んだようです。上側の978/979で始まるバーコードを狙ってください。");
            }

            return;
          }

          lastDetectedRef.current = candidate;
          setDetectedIsbn(candidate);
          setIsbn(candidate);
          setMessage(`ISBN ${candidate} を検出しました。書誌情報を確認します。`);
          void lookup(candidate);
        },
      );
      setScanState("active");
    } catch {
      setScanState("denied");
      setMessage("カメラ権限が使えませんでした。iPhoneの設定を確認するか、ISBNを手入力してください。");
    }
  }

  function stopScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanState("idle");
    setMessage("カメラを停止しました。");
  }

  function startNewBook() {
    setBook(emptyBook());
    setIsbn("");
    setDetectedIsbn("");
    setForm(defaultForm);
    setCoverFailed(false);
    lastDetectedRef.current = "";
    setMessage("書誌情報を手入力して登録できます。ISBNは数字だけで入力してください。");
    requestAnimationFrame(() => {
      titleInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      titleInputRef.current?.focus();
    });
  }

  function updateBook<K extends keyof BookLookup>(key: K, value: BookLookup[K]) {
    setBook((current) => (current ? { ...current, [key]: value } : current));
  }

  async function lookup(targetIsbn = normalizedIsbn) {
    const cleanIsbn = normalizeIsbn(targetIsbn);

    if (!isValidIsbn(cleanIsbn)) {
      setMessage("ISBNの形式が正しくありません。ISBN-10またはISBN-13を入力してください。");
      return;
    }

    try {
      setIsLookingUp(true);
      setBook(null);
      setCoverFailed(false);
      setMessage("書誌情報を探しています。openBD、NDL、Google Booksを順番に見ています。");

      const response = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isbn: cleanIsbn }),
      });
      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error ?? "書誌情報が見つかりませんでした。");
        return;
      }

      setBook(data);
      setCoverFailed(false);
      setIsbn(data.isbn);
      setMessage("登録前チェックです。買った理由やタグを少し足せます。");
    } catch {
      setMessage("通信に失敗しました。電波かサーバーの様子を見て、もう一度お試しください。");
    } finally {
      setIsLookingUp(false);
    }
  }

  async function submitLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await lookup();
  }

  async function registerBook() {
    if (!book) {
      return;
    }

    if (!book.title.trim()) {
      setMessage("タイトルを入力してください。");
      return;
    }

    if (!isValidIsbn(book.isbn)) {
      setMessage("ISBNの形式が正しくありません。ISBN-10またはISBN-13を入力してください。");
      return;
    }

    try {
      setIsRegistering(true);
      setMessage("Notionに登録しています。");

      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...book,
          isbn: normalizeIsbn(book.isbn),
          whyBought: form.whyBought,
          tags: splitList(form.tags),
          storage: form.storage,
          status: form.status,
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.ok) {
        setMessage(data.error ?? "Notionへの登録に失敗しました。");
        return;
      }

      setMessage(
        data.duplicate
          ? "既に登録済みです。Notionの同じページを見つけました。"
          : "登録しました。Notionに本を追加しました。",
      );

      if (!data.duplicate) {
        setBook(null);
        setForm(defaultForm);
        setDetectedIsbn("");
      }
    } catch {
      setMessage("Notionへの登録中に通信エラーが起きました。");
    } finally {
      setIsRegistering(false);
    }
  }

  if (authState !== "authenticated") {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md content-center px-4 py-8">
        <section className="rounded-[8px] border border-[#e2e6df] bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-[#1f7a5f]">Private Library</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-[#20231f]">ISBN2Notion</h1>
          <p className="mt-3 text-sm leading-6 text-[#697066]">
            {authState === "checking" ? "ログイン状態を確認しています。" : loginMessage}
          </p>
          <a
            href="/usage"
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-10 items-center rounded-[8px] border border-[#cfd8cf] bg-[#f7f8f6] px-3 text-sm font-bold text-[#3d453b]"
          >
            使い方を見る
          </a>

          {authState === "unauthenticated" ? (
            <form onSubmit={login} className="mt-5 grid gap-3">
              <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
                合言葉
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="min-h-12 rounded-[8px] border border-[#cfd8cf] bg-white px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
                />
              </label>
              <button
                type="submit"
                disabled={isLoggingIn || !password}
                className="min-h-14 rounded-[8px] bg-[#1f7a5f] px-4 text-lg font-black text-white shadow-sm active:scale-[0.99] disabled:bg-[#9aa79e]"
              >
                {isLoggingIn ? "確認中..." : "開く"}
              </button>
            </form>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-5 sm:py-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#1f7a5f]">Personal Library PWA</p>
          <h1 className="mt-1 text-3xl font-black leading-tight text-[#20231f]">ISBN2Notion</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="/usage"
            target="_blank"
            rel="noreferrer"
            className="grid h-14 place-items-center rounded-[8px] border border-[#d8ded5] bg-white px-3 text-sm font-bold text-[#3d453b] shadow-sm active:scale-[0.98]"
          >
            使い方
          </a>
          <button
            type="button"
            onClick={startNewBook}
            aria-label="新しい本を登録"
            title="新しい本を登録"
            className="grid h-14 w-14 place-items-center rounded-[8px] border border-[#d8ded5] bg-white shadow-sm active:scale-[0.98]"
          >
            <span className="text-2xl" aria-hidden="true">
              +
            </span>
          </button>
        </div>
      </header>

      <section className="rounded-[8px] border border-[#e2e6df] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-[#1f7a5f]">Notion Connection</p>
            <p className="mt-1 text-sm leading-6 text-[#3d453b]">
              {notionConnectionState === "checking"
                ? "Notion接続を確認しています。"
                : notionConnectionState === "connected"
                  ? `${notionWorkspaceName || "Notion"} / ${notionDatabaseTitle || "Library"} に接続済みです。`
                  : notionMessage}
            </p>
          </div>
          {notionConnectionState === "connected" ? (
            <button
              type="button"
              onClick={disconnectNotion}
              disabled={isDisconnectingNotion}
              className="min-h-10 shrink-0 rounded-[8px] border border-[#cfd8cf] bg-[#f7f8f6] px-3 text-sm font-bold text-[#3d453b] active:scale-[0.99] disabled:text-[#8a9288]"
            >
              {isDisconnectingNotion ? "解除中" : "解除"}
            </button>
          ) : null}
        </div>

        {notionConnectionState !== "connected" ? (
          <button
            type="button"
            onClick={connectNotion}
            className="mt-4 min-h-12 w-full rounded-[8px] bg-[#20231f] px-4 text-base font-bold text-white shadow-sm active:scale-[0.99]"
          >
            Notionでログイン
          </button>
        ) : null}
      </section>

      <section className="rounded-[8px] border border-[#e2e6df] bg-white p-4 shadow-sm">
        <div className="overflow-hidden rounded-[8px] border border-[#cfd8cf] bg-[#101612]">
          <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={scanState === "active" ? stopScanner : startScanner}
            className="min-h-12 rounded-[8px] bg-[#1f7a5f] px-4 py-3 text-base font-bold text-white shadow-sm active:scale-[0.99] disabled:bg-[#9aa79e]"
            disabled={scanState === "starting"}
          >
            {scanState === "active" ? "停止する" : "バーコードを読み取る"}
          </button>
          <button
            type="button"
            onClick={() => lookup()}
            className="min-h-12 rounded-[8px] border border-[#cfd8cf] bg-[#f7f8f6] px-4 py-3 text-base font-bold text-[#20231f] active:scale-[0.99] disabled:text-[#8a9288]"
            disabled={!canLookup}
          >
            ISBN検索
          </button>
        </div>

        <div className="mt-4 rounded-[8px] bg-[#f2f5f0] p-3 text-sm text-[#3d453b]" role="status">
          {message}
        </div>

        {detectedIsbn ? (
          <p className="mt-3 text-sm font-bold text-[#1f7a5f]">検出結果: {detectedIsbn}</p>
        ) : null}

        {(scanState === "denied" || scanState === "unsupported") && (
          <p className="mt-3 text-sm text-[#697066]">下のフォームにISBNを入力して登録できます。</p>
        )}
      </section>

      <form onSubmit={submitLookup} className="rounded-[8px] border border-[#e2e6df] bg-white p-4 shadow-sm">
        <label htmlFor="isbn" className="text-sm font-bold text-[#3d453b]">
          手入力ISBN
        </label>
        <div className="mt-2 flex gap-2">
          <input
            ref={isbnInputRef}
            id="isbn"
            value={isbn}
            onChange={(event) => setIsbn(event.target.value)}
            inputMode="text"
            autoComplete="off"
            placeholder="978..."
            className="min-h-12 min-w-0 flex-1 rounded-[8px] border border-[#cfd8cf] bg-white px-3 text-base outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
          />
          <button
            type="submit"
            disabled={!canLookup}
            className="min-h-12 rounded-[8px] bg-[#20231f] px-4 text-base font-bold text-white disabled:bg-[#9aa79e]"
          >
            探す
          </button>
        </div>
      </form>

      {book ? (
        <section className="rounded-[8px] border border-[#e2e6df] bg-white p-4 shadow-sm">
          <div className="grid gap-4">
            <div className="grid h-36 w-24 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-[#d8ded5] bg-[#eef3ec]">
              {book.thumbnail && !coverFailed ? (
                <img
                  src={book.thumbnail}
                  alt=""
                  className="h-full w-full object-cover"
                  onError={() => setCoverFailed(true)}
                />
              ) : (
                <span className="px-2 text-center text-xs font-bold text-[#697066]">NO COVER</span>
              )}
            </div>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Title
              <input
                ref={titleInputRef}
                value={book.title}
                onChange={(event) => updateBook("title", event.target.value)}
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Author
              <input
                value={book.authors.join(", ")}
                onChange={(event) => updateBook("authors", splitList(event.target.value))}
                placeholder="著者, 訳者"
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Cover
              <input
                value={book.thumbnail}
                onChange={(event) => {
                  updateBook("thumbnail", event.target.value);
                  setCoverFailed(false);
                }}
                inputMode="url"
                placeholder="https://..."
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
                Published
                <input
                  value={book.publishedDate}
                  onChange={(event) => updateBook("publishedDate", event.target.value)}
                  placeholder="2026-06-08"
                  className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
                />
              </label>

              <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
                ISBN
                <input
                  value={book.isbn}
                  onChange={(event) => updateBook("isbn", normalizeIsbn(event.target.value))}
                  inputMode="text"
                  placeholder="978..."
                  className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
                />
              </label>
            </div>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Publisher
              <input
                value={book.publisher}
                onChange={(event) => updateBook("publisher", event.target.value)}
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              memo
              <textarea
                value={form.whyBought}
                onChange={(event) => setForm((current) => ({ ...current, whyBought: event.target.value }))}
                placeholder="なぜ買ったのか。発作、講義、研究、深夜の好奇心など"
                rows={3}
                className="rounded-[8px] border border-[#cfd8cf] px-3 py-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Category
              <input
                value={form.tags}
                onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                placeholder="医学史, 統計, 謎"
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] px-3 text-base font-normal outline-none focus:border-[#1f7a5f] focus:ring-2 focus:ring-[#1f7a5f]/20"
              />
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              状態
              <select
                value={form.status}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as Status }))}
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] bg-white px-3 text-base font-normal outline-none focus:border-[#1f7a5f]"
              >
                <option value="Unread">Unread</option>
                <option value="Reading">Reading</option>
                <option value="Finished">Finished</option>
              </select>
            </label>

            <label className="grid gap-2 text-sm font-bold text-[#3d453b]">
              Storage
              <select
                value={form.storage}
                onChange={(event) => setForm((current) => ({ ...current, storage: event.target.value as Storage }))}
                className="min-h-12 rounded-[8px] border border-[#cfd8cf] bg-white px-3 text-base font-normal outline-none focus:border-[#1f7a5f]"
              >
                <option value="中野">中野</option>
                <option value="仙台">仙台</option>
                <option value="電子">電子</option>
              </select>
            </label>

            <button
              type="button"
              onClick={registerBook}
              disabled={!canRegister}
              className="min-h-14 rounded-[8px] bg-[#e8a23a] px-4 text-lg font-black text-[#20231f] shadow-sm active:scale-[0.99] disabled:bg-[#d8c098]"
            >
              {isRegistering ? "登録中..." : notionConnectionState === "connected" ? "Notionに登録" : "Notion接続が必要"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
