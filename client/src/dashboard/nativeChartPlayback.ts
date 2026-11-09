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
