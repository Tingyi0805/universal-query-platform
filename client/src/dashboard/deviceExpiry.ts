export function deviceExpiry(expiresAtUtc: string | null | undefined, now=Date.now()) {
  if(expiresAtUtc===null)return{band:"NONE",days:null,text:"未設定到期日"} as const;
  const expires=typeof expiresAtUtc==="string"?Date.parse(expiresAtUtc):NaN;
  if(!Number.isFinite(expires))return{band:"UNKNOWN",days:null,text:"到期資訊不完整，請重新載入"} as const;
  const delta=expires-now,days=Math.ceil(delta/86400000);
  if(delta<=0)return{band:"EXPIRED",days,text:"已到期，不可續期恢復舊授權"} as const;
  if(delta<=7*86400000)return{band:"DUE7",days,text:`7 天內到期（剩餘 ${days} 天）`} as const;
  if(delta<=30*86400000)return{band:"DUE30",days,text:`30 天內到期（剩餘 ${days} 天）`} as const;
  return{band:"ACTIVE",days,text:`剩餘 ${days} 天`} as const;
}
