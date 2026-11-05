type ScreenDocument = Document & {webkitFullscreenElement?:Element|null};
type ScreenRoot = HTMLElement & {webkitRequestFullscreen?:()=>void|Promise<void>};
export function dashboardFullscreenActive(doc:Document){return Boolean(doc.fullscreenElement || (doc as ScreenDocument).webkitFullscreenElement);}
export function dashboardFullscreenSupported(doc:Document){const root=doc.documentElement as ScreenRoot;return Boolean(root.requestFullscreen || root.webkitRequestFullscreen);}
export async function requestDashboardFullscreen(doc:Document):Promise<boolean>{
  const root=doc.documentElement as ScreenRoot;
  try{
    if(root.requestFullscreen)await root.requestFullscreen();
    else if(root.webkitRequestFullscreen)await root.webkitRequestFullscreen();
    else return false;
    return true;
  }catch{return false;}
}
