import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";

function PinPad({ value, onChange, maxLength }: { value: string; onChange: (value: string) => void; maxLength: number }) {
  const enter = (key: string) => {
    if (key === "清除") onChange("");
    else if (key === "⌫") onChange(value.slice(0, -1));
    else if (value.length < maxLength) onChange(value + key);
  };
  return <div style={{ maxWidth: 320 }}>
    <input aria-label="個人 PIN" type="password" inputMode="numeric" autoComplete="off"
      pattern="[0-9]*" value={value} maxLength={maxLength}
      onChange={e => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, maxLength))}
      style={{ textAlign: "center", fontSize: 24, letterSpacing: 6, width: "100%", marginBottom: 12 }} />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {["1","2","3","4","5","6","7","8","9","清除","0","⌫"].map(key =>
        <button key={key} type="button" className="secondary-button"
          style={{ minHeight: 58, fontSize: 22, touchAction: "manipulation" }}
          aria-label={key === "⌫" ? "刪除一位" : key}
          onClick={() => enter(key)}>{key}</button>)}
    </div>
  </div>;
}

export function QuickPinEnrollmentPage() {
  const { accessToken } = useAuth();
  const [length, setLength] = useState(6);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    apiRequest<{ pinLength: number }>("/auth/quick-pin/policy", {}, accessToken)
      .then(result => { setLength(result.pinLength); setReady(true); })
      .catch(err => setError(err instanceof Error ? err.message : "無法取得 PIN 長度設定"));
  }, [accessToken]);

  async function enroll(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    if (stage === "enter") {
      if (pin.length !== length) { setError(`請輸入 ${length} 位數 PIN。`); return; }
      setStage("confirm"); return;
    }
    if (pin !== confirmPin) { setError("兩次 PIN 不一致，請重新確認。"); setConfirmPin(""); return; }
    setBusy(true);
    try {
      await apiRequest("/auth/quick-pin/enroll", { method: "POST", body: JSON.stringify({ password, pin }) }, accessToken);
      setNotice("個人 PIN 已註冊。工作站 PIN 快速登入尚未啟用。");
      setPassword(""); setPin(""); setConfirmPin(""); setStage("enter");
    } catch (err) { setError(err instanceof Error ? err.message : "PIN 設定失敗"); }
    finally { setBusy(false); }
  }

  async function revoke() {
    if (!password) { setError("請先輸入正式密碼。"); return; }
    if (!window.confirm("確定撤銷個人 PIN？")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiRequest("/auth/quick-pin/revoke", { method: "POST", body: JSON.stringify({ password }) }, accessToken);
      setNotice("個人 PIN 已撤銷。"); setPassword(""); setPin(""); setConfirmPin(""); setStage("enter");
    } catch (err) { setError(err instanceof Error ? err.message : "撤銷失敗"); }
    finally { setBusy(false); }
  }

  return <main className="page-shell">
    <div className="page-toolbar"><div><p className="eyebrow">Account Security</p><h1>設定個人 PIN</h1>
      <p className="subtitle">使用正式密碼驗證後註冊；適用於本機帳號。</p></div>
      <Link className="secondary-button link-button" to="/">返回首頁</Link></div>
    {error && <section className="form-error" role="alert">{error}</section>}
    {notice && <section className="notice" role="status">{notice}</section>}
    <section className="admin-section"><form className="admin-form" onSubmit={enroll}>
      <label>正式登入密碼<input type="password" autoComplete="current-password" value={password}
        onChange={e => setPassword(e.target.value)} required /></label>
      <h2>{stage === "enter" ? "輸入新的個人 PIN" : "再次輸入 PIN 確認"}</h2>
      <p>目前設定為 {length} 位數；建議至少 6 位。請避免生日、連續或重複數字。</p>
      {ready && <PinPad value={stage === "enter" ? pin : confirmPin}
        onChange={stage === "enter" ? setPin : setConfirmPin} maxLength={length} />}
      <div className="form-actions">
        {stage === "confirm" && <button type="button" className="secondary-button"
          onClick={() => { setStage("enter"); setConfirmPin(""); setError(""); }}>返回修改</button>}
        <button type="submit" className="primary-button" disabled={!ready || busy || !password ||
          (stage === "enter" ? pin.length !== length : confirmPin.length !== length)}>
          {busy ? "處理中…" : stage === "enter" ? "下一步：確認 PIN" : "完成 PIN 註冊"}
        </button>
        <button type="button" className="secondary-button" disabled={busy || !password} onClick={revoke}>撤銷既有 PIN</button>
      </div>
    </form></section>
    <section className="notice">PIN 登入工作站功能尚未開放；敏感病患資料及匯出仍需符合正式帳號驗證與授權政策。</section>
  </main>;
}
