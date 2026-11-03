import { configuredPinLength } from "../security/pinPolicy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import "./AdminUsersPage.css";
import "./WorkstationManagement.css";

function pinError(error:unknown):string {
  const code=(error as {code?:string})?.code;
  if(code==="PIN_LOCKED")return "PIN 管理已暫時鎖定，請 15 分鐘後再試。";
  if(code==="PIN_POLICY_CHANGED")return "PIN 政策已變更，請重新載入政策後再設定。";
  if(code==="PIN_WEAK")return "PIN 過於簡單或與舊 PIN 相同，請重新設定。";
  if(code==="PIN_RATE_LIMIT")return "操作過於頻繁，請稍後再試；不會自動重送。";
  return "操作未完成，請確認政策、正式密碼與鎖定狀態；不會自動重送。";
}
function PinPad({ value, onChange, maxLength, disabled }: { value: string; onChange: (value: string) => void; maxLength: number;disabled:boolean }) {
  const enter = (key: string) => {
    if (key === "清除") onChange("");
    else if (key === "⌫") onChange(value.slice(0, -1));
    else if (value.length < maxLength) onChange(value + key);
  };
  return <div style={{ maxWidth: 320 }}>
    <input aria-label="個人 PIN" type="password" inputMode="numeric" autoComplete="off"
      disabled={disabled} pattern="[0-9]*" value={value} maxLength={maxLength}
      onChange={e => onChange(e.target.value.replace(/[^0-9]/g, "").slice(0, maxLength))}
      style={{ textAlign: "center", fontSize: 24, letterSpacing: 6, width: "100%", marginBottom: 12 }} />
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
      {["1","2","3","4","5","6","7","8","9","清除","0","⌫"].map(key =>
        <button key={key} disabled={disabled} type="button" className="secondary-button"
          style={{ minHeight: 58, fontSize: 22, touchAction: "manipulation" }}
          aria-label={key === "⌫" ? "刪除一位" : key}
          onClick={() => enter(key)}>{key}</button>)}
    </div>
  </div>;
}

export function QuickPinEnrollmentPage() {
  const { accessToken } = useAuth();
  const identity=useRef(0),operation=useRef(0),inFlight=useRef(false);
  const [reload,setReload]=useState(0);
  const [length, setLength] = useState(6);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [stage, setStage] = useState<"enter" | "confirm">("enter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);

  const clearSecrets=()=>{setPassword("");setPin("");setConfirmPin("");setStage("enter");};
  useEffect(() => {
    const epoch=++identity.current;
    ++operation.current;clearSecrets();setReady(false);setError("");setNotice("");
    void apiRequest<{ pinLength: number }>("/auth/quick-pin/policy", {}, accessToken,()=>identity.current===epoch)
      .then(result => { if(identity.current===epoch){setLength(configuredPinLength(result.pinLength));setReady(true);} })
      .catch(()=>{if(identity.current===epoch){setReady(false);setError("無法確認 PIN 政策，禁止提交；請重新載入。");}});
    return()=>{++identity.current;++operation.current;};
  }, [accessToken,reload]);

  useEffect(()=>{
    const clear=()=>{++operation.current;clearSecrets();setNotice("");if(inFlight.current)setError("操作結果尚未確認，請勿重送；待要求結束後重新確認政策與 PIN 狀態。");};
    const hidden=()=>{if(document.hidden)clear();};
    window.addEventListener("pagehide",clear);window.addEventListener("uqp-interactive-clear",clear);document.addEventListener("visibilitychange",hidden);
    return()=>{window.removeEventListener("pagehide",clear);window.removeEventListener("uqp-interactive-clear",clear);document.removeEventListener("visibilitychange",hidden);};
  },[]);

  async function enroll(event: FormEvent) {
    event.preventDefault(); if(!ready||busy||inFlight.current)return; setError(""); setNotice("");
    if (stage === "enter") {
      if (pin.length !== length) { setError(`請輸入 ${length} 位數 PIN。`); return; }
      setStage("confirm"); return;
    }
    if (pin !== confirmPin) { setError("兩次 PIN 不一致，請重新確認。"); setConfirmPin(""); return; }
    inFlight.current=true;setBusy(true);
    const epoch=identity.current,seq=++operation.current;
    try {
      await apiRequest("/auth/quick-pin/enroll", { method: "POST", body: JSON.stringify({ password, pin }) }, accessToken,()=>identity.current===epoch);
      if(identity.current!==epoch||operation.current!==seq)return;
      setNotice("個人 PIN 已設定或更新，舊 PIN 已失效。工作站 PIN 快速登入尚未啟用。");
      setPassword(""); setPin(""); setConfirmPin(""); setStage("enter");
    } catch (error) { if(identity.current===epoch&&operation.current===seq){if((error as {code?:string})?.code==="PIN_POLICY_CHANGED")setReady(false);setError(pinError(error));} }
    finally { inFlight.current=false;if(identity.current===epoch&&operation.current===seq)clearSecrets();setBusy(false); }
  }

  async function revoke() {
    if (!password) { setError("請先輸入正式密碼。"); return; }
    if (!window.confirm("確定撤銷個人 PIN？")) return;
    if(!ready||busy||inFlight.current)return;
    inFlight.current=true;setBusy(true); setError(""); setNotice("");
    const epoch=identity.current,seq=++operation.current;
    try {
      await apiRequest("/auth/quick-pin/revoke", { method: "POST", body: JSON.stringify({ password }) }, accessToken,()=>identity.current===epoch);
      if(identity.current!==epoch||operation.current!==seq)return;
      setNotice("個人 PIN 已撤銷。"); setPassword(""); setPin(""); setConfirmPin(""); setStage("enter");
    } catch (error) { if(identity.current===epoch&&operation.current===seq)setError(pinError(error)); }
    finally { inFlight.current=false;if(identity.current===epoch&&operation.current===seq)clearSecrets();setBusy(false); }
  }

  return <main className="page-shell pin-panel">
    <div className="page-toolbar"><div><p className="eyebrow">Account Security</p><h1>設定或變更個人 PIN</h1>
      <p className="subtitle">可隨時以正式密碼重新設定個人 PIN；適用於本機帳號。</p></div>
      <Link className="secondary-button link-button" to="/">返回首頁</Link></div>
    {error && <section className="form-error" role="alert">{error}</section>}
    {notice && <section className="notice" role="status">{notice}</section>}
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>setReload(n=>n+1)}>重新載入 PIN 政策</button>
    <section className="admin-section"><form className="admin-form" onSubmit={enroll}>
      <label>正式登入密碼<input type="password" autoComplete="current-password" value={password}
        onChange={e => setPassword(e.target.value)} required /></label>
      <h2>{stage === "enter" ? "輸入新的個人 PIN" : "再次輸入 PIN 確認"}</h2>
      <p>{ready ? `目前設定為 ${length} 位數；建議至少 6 位。請避免生日、連續或重複數字。` : "尚未確認 PIN 政策，禁止提交。"}</p>
      {ready && <PinPad value={stage === "enter" ? pin : confirmPin}
        onChange={stage === "enter" ? setPin : setConfirmPin} maxLength={length} disabled={busy||!ready} />}
      <div className="form-actions">
        {stage === "confirm" && <button type="button" className="secondary-button"
          onClick={() => { setStage("enter"); setConfirmPin(""); setError(""); }}>返回修改</button>}
        <button type="submit" className="primary-button" disabled={!ready || busy || !password ||
          (stage === "enter" ? pin.length !== length : confirmPin.length !== length)}>
          {busy ? "處理中…" : stage === "enter" ? "下一步：確認 PIN" : "儲存新 PIN（取代舊 PIN）"}
        </button>
        <button type="button" className="secondary-button" disabled={busy || !ready || !password} onClick={revoke}>撤銷既有 PIN</button>
      </div>
    </form></section>
    <section className="notice">PIN 登入工作站功能尚未開放；敏感病患資料及匯出仍需符合正式帳號驗證與授權政策。</section>
  </main>;
}
