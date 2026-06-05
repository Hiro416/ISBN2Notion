"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { barcodeToIsbn, isValidIsbn, normalizeIsbn } from "./lib/isbn";
import { BookLookup } from "./lib/types";

type Status = "Unread" | "Reading" | "Finished";

type RegisterForm = {
  whyBought: string;
  tags: string;
  status: Status;
};

type ScanState = "idle" | "starting" | "active" | "denied" | "unsupported";
type AuthState = "checking" | "authenticated" | "unauthenticated";

const defaultForm: RegisterForm = {
  whyBought: "",
  tags: "",
  status: "Unread",
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  const [loginMessage, setLoginMessage] = useState("合言葉を入れると蔵書カルテを開けます。");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const normalizedIsbn = useMemo(() => normalizeIsbn(isbn), [isbn]);
  const canLookup = isValidIsbn(normalizedIsbn) && !isLookingUp;

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
          : "登録しました。謎蔵書がまた一冊、観察対象になりました。",
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
          <p className="text-sm font-bold text-[#1f7a5f]">Private Library Gate</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-[#20231f]">謎蔵書クリニック</h1>
          <p className="mt-3 text-sm leading-6 text-[#697066]">
            {authState === "checking" ? "蔵書カルテを確認しています。" : loginMessage}
          </p>

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
          <p className="text-sm font-bold text-[#1f7a5f]">Medical Mystery Library</p>
          <h1 className="mt-1 text-3xl font-black leading-tight text-[#20231f]">謎蔵書クリニック</h1>
        </div>
        <div className="grid h-14 w-14 place-items-center rounded-[8px] border border-[#d8ded5] bg-white shadow-sm">
          <span className="text-2xl" aria-hidden="true">
            +
          </span>
          <span className="sr-only">蔵書登録</span>
        </div>
      </header>

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
          <div className="flex gap-4">
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
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-xl font-black leading-snug">{book.title}</h2>
              <p className="mt-2 text-sm text-[#697066]">{book.authors.join(", ") || "著者不明"}</p>
              <dl className="mt-3 grid gap-1 text-sm text-[#3d453b]">
                <div>
                  <dt className="inline font-bold">出版社: </dt>
                  <dd className="inline">{book.publisher || "不明"}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">出版日: </dt>
                  <dd className="inline">{book.publishedDate || "不明"}</dd>
                </div>
                <div>
                  <dt className="inline font-bold">ISBN: </dt>
                  <dd className="inline">{book.isbn}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="mt-5 grid gap-4">
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

            <button
              type="button"
              onClick={registerBook}
              disabled={isRegistering}
              className="min-h-14 rounded-[8px] bg-[#e8a23a] px-4 text-lg font-black text-[#20231f] shadow-sm active:scale-[0.99] disabled:bg-[#d8c098]"
            >
              {isRegistering ? "登録中..." : "Notionに登録"}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
