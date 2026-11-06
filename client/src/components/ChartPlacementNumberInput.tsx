import {useState, type KeyboardEvent} from "react";

/** Let users type the entire number before clamping placement constraints.
 * The preview is updated only when editing finishes (blur/Enter).
 * Empty/invalid intermediate values are never committed as zero.
 */
export function ChartPlacementNumberInput({label,ariaLabel,value,min,onCommit}:{
  label:string;ariaLabel?:string;value:number;min:number;onCommit:(value:number)=>void;
}){
  const [editing,setEditing]=useState<string|null>(null);
  const finish=(raw:string)=>{
    setEditing(null);
    if(!/^\d+$/.test(raw.trim()))return;
    const valueToCommit=Number(raw.trim());
    if(Number.isSafeInteger(valueToCommit))onCommit(valueToCommit);
  };
  const keys=(event:KeyboardEvent<HTMLInputElement>)=>{
    if(event.key==="Enter")event.currentTarget.blur();
    if(event.key==="Escape"){
      event.preventDefault();
      event.currentTarget.value=String(value);
      event.currentTarget.blur();
    }
  };
  return <label>{label}
    <input aria-label={ariaLabel??label} type="number" inputMode="numeric" step={1} min={min}
      value={editing??String(value)}
      onChange={event=>setEditing(event.currentTarget.value)}
      onBlur={event=>finish(event.currentTarget.value)}
      onKeyDown={keys}/>
  </label>;
}
