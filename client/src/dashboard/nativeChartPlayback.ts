// Native CHART playback policy for the EXISTING DashboardDisplayPage.
// A saved CHART is read only via the server-owned sealed Widget projection
// endpoint; never from raw Query page rows, local chart draft or ConfigJson.
//
// That endpoint is currently hard-OFF on the server. Device and user playback
// need their own independently reviewed Token/IP/privacy/audit proof path.
export const CHART_DEVICE_PLAYBACK_RELEASE_APPROVED=false as const;
export const CHART_USER_PLAYBACK_RELEASE_APPROVED=false as const;

export type NativeChartPlaybackContext=Readonly<{
  widgetType:string;
  dashboardId:number;widgetId:number;
  queryPreview:boolean;deviceMode:boolean;userRoute:boolean;
  previewAuthorized:boolean;online:boolean;hasDataWarning:boolean;
  accessTokenPresent:boolean;
  canDesignQuery:boolean;canExecuteQuery:boolean;
}>;

export function mayRequestSealedChartProjection(
  context:NativeChartPlaybackContext,
):boolean{
  // Existing /charts/v1/:widgetId/projection route is DESIGNER-JWT-only.
  // Do not send public device tokens/cookies, user-mode bearer tokens,
  // local Query source page rows, or unsigned client approval flags.
  return context.widgetType==="CHART" &&
    Number.isSafeInteger(context.dashboardId) && context.dashboardId>0 &&
    Number.isSafeInteger(context.widgetId) && context.widgetId>0 &&
    context.queryPreview && !context.deviceMode && !context.userRoute &&
    context.previewAuthorized && context.online && !context.hasDataWarning &&
    context.accessTokenPresent && context.canDesignQuery &&
    context.canExecuteQuery;
}

export function sealedChartProjectionPath(
  dashboardId:number,widgetId:number,
):string|null{
  if(!Number.isSafeInteger(dashboardId)||dashboardId<=0||
     !Number.isSafeInteger(widgetId)||widgetId<=0)return null;
  return `/dashboards/${dashboardId}/charts/v1/${widgetId}/projection`;
}

export type NativeDeviceChartContext=Readonly<{
  widgetType:string;dashboardId:number;widgetId:number;
  deviceMode:boolean;userRoute:boolean;queryPreview:boolean;
  activationRequired:boolean;previewAuthorized:boolean;
  online:boolean;hasDataWarning:boolean;
  deviceToken:string|null;expectedDeviceId?:number|null;
}>;

/** Device token is NEVER an Authorization bearer or a browser SQL claim.
 * The cookie-only kiosk sentinel is not a token. Server checks source IP,
 * live creator permissions, grant versions and expiry for every request.
 */
export function sealedDeviceChartProjectionHeaders(
  deviceToken:string|null,expectedDeviceId?:number|null,
):Record<string,string>|null{
  if(typeof deviceToken!=="string"||
     !/^[A-Za-z0-9_-]{43}$/.test(deviceToken)||
     (expectedDeviceId!=null&&(!Number.isSafeInteger(expectedDeviceId)||
       expectedDeviceId<1)))return null;
  return {
    "X-Dashboard-Device-Token":deviceToken,
    ...(expectedDeviceId==null?{}:
      {"X-UQP-Expected-Device-Id":String(expectedDeviceId)}),
  };
}
export function sealedDeviceChartProjectionPath(
  dashboardId:number,widgetId:number,
):string|null{
  if(!Number.isSafeInteger(dashboardId)||dashboardId<=0||
     !Number.isSafeInteger(widgetId)||widgetId<=0)return null;
  return `/dashboards/device/${dashboardId}/charts/v1/${widgetId}/projection`;
}
/** Separate public-device eligibility; deliberately cannot be unlocked
 * by a URL, JWT permission, runtime env or a dashboard configuration.
 * A later release must independently review the server's gate, privacy,
 * device Token/IP validation, cookie kiosk support, and real IIS UAT.
 */
export function mayRequestSealedDeviceChartProjection(
  context:NativeDeviceChartContext,
):boolean{
  return CHART_DEVICE_PLAYBACK_RELEASE_APPROVED &&
    context.widgetType==="CHART" &&
    context.deviceMode && !context.userRoute && !context.queryPreview &&
    !context.activationRequired && context.previewAuthorized &&
    context.online && !context.hasDataWarning &&
    sealedDeviceChartProjectionPath(context.dashboardId,context.widgetId)!==null &&
    sealedDeviceChartProjectionHeaders(
      context.deviceToken,context.expectedDeviceId)!==null;
}

export type NativeUserChartContext=Readonly<{
  widgetType:string;dashboardId:number;widgetId:number;
  userRoute:boolean;deviceMode:boolean;queryPreview:boolean;
  userMode:"QUERY_ONLY"|"LEGACY"|null;userSessionCurrent:boolean;
  previewAuthorized:boolean;online:boolean;hasDataWarning:boolean;
  accessTokenPresent:boolean;canViewQuery:boolean;canExecuteQuery:boolean;
}>;

/** Only a separately authorized signed-in Query user may ever call this
 * transport. It is distinct from the designer JWT route: no DESIGN_QUERY
 * permission, no device Token and no client-provided Query rows/claims.
 */
export function sealedUserChartProjectionPath(
  dashboardId:number,widgetId:number,
):string|null{
  if(!Number.isSafeInteger(dashboardId)||dashboardId<=0||
     !Number.isSafeInteger(widgetId)||widgetId<=0)return null;
  return `/dashboards/${dashboardId}/playback/v1/charts/${widgetId}/projection`;
}
export function mayRequestSealedUserChartProjection(
  context:NativeUserChartContext,
):boolean{
  return CHART_USER_PLAYBACK_RELEASE_APPROVED &&
    context.widgetType==="CHART" &&
    context.userRoute && !context.deviceMode && !context.queryPreview &&
    context.userMode==="QUERY_ONLY"&&context.userSessionCurrent&&
    context.previewAuthorized&&context.online&&!context.hasDataWarning&&
    context.accessTokenPresent&&context.canViewQuery&&
    context.canExecuteQuery&&
    sealedUserChartProjectionPath(context.dashboardId,context.widgetId)!==null;
}
