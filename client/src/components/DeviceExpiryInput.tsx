import { useEffect, useRef, useState } from "react";
import { CalendarClock } from "lucide-react";
import { parseTaipeiDateTime, taipeiDateTime, validDeviceExpiry } from "../dashboard/taipeiDateTime";

export function DeviceExpiryInput({ value, onChange, onValidityChange }: { value: string | null; onChange: (utc: string | null) => void; onValidityChange: (valid: boolean) => void }) {
  const [text, setText] = useState(() => taipeiDateTime(value));
  const [selection, setSelection] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setText(taipeiDateTime(value)); }, [value]);
  let parsed: string | null = null, valid = true;
  try { parsed = parseTaipeiDateTime(text); valid = validDeviceExpiry(parsed); } catch { valid = false; }
  useEffect(() => onValidityChange(valid), [valid, onValidityChange]);
  function change(next: string) {
    setText(next);
    try { onChange(parseTaipeiDateTime(next)); } catch { /* Keep invalid text visible; saving remains disabled. */ }
  }
  let selectionValid = false;
  try { selectionValid = !!selection && validDeviceExpiry(parseTaipeiDateTime(selection)); } catch { /* Invalid calendar date. */ }
  return <div className="uqp-expiry-input">
    <label htmlFor="device-expiry-taipei">授權到期時間（Asia/Taipei）</label>
    <div className="uqp-expiry-row">
      <input id="device-expiry-taipei" aria-label="裝置到期時間（Asia/Taipei）" aria-invalid={!valid} aria-describedby="device-expiry-help" placeholder="YYYY-MM-DD HH:mm" value={text} onChange={e => change(e.target.value)}/>
      <button type="button" aria-label="開啟到期日期時間選擇器" onClick={() => { setSelection(valid && text ? text : taipeiDateTime(new Date(Date.now() + 86400000).toISOString())); dialog.current?.showModal(); }}><CalendarClock aria-hidden="true" size={22}/></button>
    </div>
    <small id="device-expiry-help">YYYY-MM-DD HH:mm，24 小時制；留空為無到期日。修改後秒數設為 00。</small>
    {!valid && <p role="alert">請輸入有效且晚於現在的台北日期時間。</p>}
    <dialog ref={dialog} aria-label="選擇授權到期日期時間">
      <h3>授權到期時間 · Asia/Taipei</h3>
      <label>日期<input aria-label="到期日期" type="date" value={selection.slice(0,10)} onChange={e => setSelection(`${e.target.value} ${selection.slice(11)}`)}/></label>
      <div className="uqp-expiry-row">
        <label>時（24 小時）<select aria-label="到期小時" value={selection.slice(11,13)} onChange={e => setSelection(`${selection.slice(0,11)}${e.target.value}:${selection.slice(14)}`)}>{Array.from({length:24},(_,i)=>String(i).padStart(2,"0")).map(v=><option key={v}>{v}</option>)}</select></label>
        <label>分<select aria-label="到期分鐘" value={selection.slice(14,16)} onChange={e => setSelection(`${selection.slice(0,14)}${e.target.value}`)}>{Array.from({length:60},(_,i)=>String(i).padStart(2,"0")).map(v=><option key={v}>{v}</option>)}</select></label>
      </div>
      {!selectionValid && <p role="alert">請選擇有效且晚於現在的日期時間。</p>}
      <button type="button" disabled={!selectionValid} onClick={() => { change(selection); dialog.current?.close(); }}>套用到期時間</button>
      <button type="button" onClick={() => dialog.current?.close()}>取消日期選擇</button>
    </dialog>
  </div>;
}
