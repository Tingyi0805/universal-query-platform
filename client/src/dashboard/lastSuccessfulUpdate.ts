export const updatePositions = {BOTTOM_RIGHT:"右下",BOTTOM_LEFT:"左下",TOP_RIGHT:"右上",TOP_LEFT:"左上"} as const;
export function updateSettings(config?:Record<string,unknown>) {
  return {position:typeof config?.lastSuccessPosition==="string"&&Object.prototype.hasOwnProperty.call(updatePositions,config.lastSuccessPosition)?config.lastSuccessPosition as keyof typeof updatePositions:"BOTTOM_RIGHT" as const,
    format:config?.lastSuccessFormat==="DATE_TIME"?"DATE_TIME" as const:"TIME" as const};
}
export function deliveryTime(value:unknown):string|null {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return null;
  return new Date(value).toISOString()===(value.includes(".")?value:value.replace("Z",".000Z"))?value:null;
}
export function formatDeliveryTime(value:unknown,format:"TIME"|"DATE_TIME") {
  const time=deliveryTime(value);if(!time)return "尚無後端交付時間";
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(time));
  const part=(name:Intl.DateTimeFormatPartTypes)=>parts.find(p=>p.type===name)?.value??"";
  return (format==="DATE_TIME"?`${part("year")}-${part("month")}-${part("day")} `:"")+`${part("hour")}:${part("minute")}:${part("second")}`;
}
