using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
namespace Uqp.Kiosk.Agent;
public sealed class PlaybackForm:Form
{
    public string FailureCode{get;private set;}="NONE";
    readonly AgentSession session;readonly WebView2 view=new(){Dock=DockStyle.Fill};readonly System.Windows.Forms.Timer watchdog=new(){Interval=5000};
    readonly CancellationTokenSource lifetime=new();bool stopped=true,checking;int generation;
    public PlaybackForm(AgentSession session,Placement? requestedPlacement=null)
    {
        this.session=session;Text=$"UQP 固定播放 — 裝置 {session.Config.DeviceId}";AutoScaleMode=AutoScaleMode.Dpi;
        var place=requestedPlacement??session.Enrollment.SavedPlacement??session.Config.Placement;var screens=Screen.AllScreens.OrderBy(x=>x.DeviceName,StringComparer.Ordinal).ToArray();
        if(place.ScreenNumber<1||place.ScreenNumber>screens.Length)throw new InvalidDataException("SCREEN_UNAVAILABLE");
        var screen=screens[place.ScreenNumber-1];var origin=screen.Bounds.Contains(place.WindowX,place.WindowY)?new Point(place.WindowX,place.WindowY):screen.Bounds.Location;
        StartPosition=FormStartPosition.Manual;Bounds=new Rectangle(origin,new Size(place.WindowWidth,place.WindowHeight));
        if(place.Fullscreen){FormBorderStyle=FormBorderStyle.None;Bounds=screen.Bounds;}
        var toolbar=new FlowLayoutPanel{Dock=DockStyle.Top,AutoSize=true};
        var refresh=new Button{Text="重新整理"};refresh.Click+=async(_,_)=>await Resume();
        var forget=new Button{Text="清除此裝置本機授權"};forget.Click+=(_,_)=>{if(MessageBox.Show(this,"清除後須由管理者再次授權。","UQP",MessageBoxButtons.OKCancel)==DialogResult.OK){session.Forget();Stop();Close();}};
        toolbar.Controls.Add(refresh);toolbar.Controls.Add(forget);toolbar.Controls.Add(new Label{AutoSize=true,Text="本機註冊至 "+session.Enrollment.EnrollmentExpiresAtUtc.ToString("u")+"；裝置續期不會延長此註冊。"});Controls.Add(view);Controls.Add(toolbar);
        Load+=async(_,_)=>{try{await Initialize();await Resume();watchdog.Start();}catch(Exception error){FailureCode="INITIALIZE_"+error.GetType().Name+"_"+unchecked((uint)error.HResult).ToString("X8");Stop();}};
        watchdog.Tick+=async(_,_)=>{if(stopped||checking)return;checking=true;try{await session.Validate(lifetime.Token);}catch{Stop();}finally{checking=false;}};
        FormClosing+=(_,_)=>{watchdog.Stop();lifetime.Cancel();Stop();};FormClosed+=(_,_)=>{watchdog.Dispose();view.Dispose();session.Dispose();lifetime.Dispose();};
    }
    async Task Initialize()
    {
        // Never inherit a user environment that adds remote debugging, swaps the
        // browser executable or redirects the profile. Enterprise OS policy must
        // also protect WebView2 registry policies and the dedicated user account.
        foreach(string name in Environment.GetEnvironmentVariables().Keys)
            if(name.StartsWith("WEBVIEW2_",StringComparison.OrdinalIgnoreCase))Environment.SetEnvironmentVariable(name,null,EnvironmentVariableTarget.Process);
        var profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UQP","ManagedKiosk",session.Config.Digest,"webview");
        // No TCP listener, host object, web message or external browser bridge.
        var options=new CoreWebView2EnvironmentOptions("--disable-breakpad --disable-crash-reporter --disable-background-networking");
        var environment=await CoreWebView2Environment.CreateAsync(null,profile,options);await view.EnsureCoreWebView2Async(environment);
        var core=view.CoreWebView2;var settings=core.Settings;settings.AreDevToolsEnabled=false;settings.AreDefaultContextMenusEnabled=false;settings.AreHostObjectsAllowed=false;
        settings.IsWebMessageEnabled=false;settings.IsPasswordAutosaveEnabled=false;settings.IsGeneralAutofillEnabled=false;settings.IsStatusBarEnabled=false;
        core.NavigationStarting+=(_,e)=>{if(!(Uri.TryCreate(e.Uri,UriKind.Absolute,out var u)&&session.Config.IsDisplayUri(u))&&!(stopped&&e.Uri=="about:blank"))e.Cancel=true;};
        core.NavigationCompleted+=(_,e)=>{if(!stopped&&e.IsSuccess&&session.Config.IsDisplayUri(view.Source))view.Visible=true;};
        core.FrameNavigationStarting+=(_,e)=>e.Cancel=true;core.NewWindowRequested+=(_,e)=>e.Handled=true;core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        core.DownloadStarting+=(_,e)=>e.Cancel=true;core.ProcessFailed+=(_,_)=>Stop();
        core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.All);core.WebResourceRequested+=Resource;
    }
    async Task Resume()
    {
        try{await session.Validate(lifetime.Token);stopped=false;++generation;view.CoreWebView2.Navigate(AgentConfiguration.UiOrigin+session.Config.DisplayPath);}
        catch{Stop();}
    }
    void Stop()
    {
        stopped=true;++generation;view.Visible=false;
        if(view.CoreWebView2!=null){view.CoreWebView2.Stop();view.CoreWebView2.NavigateToString("<!doctype html><html lang=zh-Hant><meta charset=utf-8><title>UQP 播放停止</title><h1>播放已停止，患者資料已清除</h1><p>請確認網路、裝置到期、註冊期限與管理權限，再按重新整理。到期或撤銷不會自動重新核發。</p></html>");}
    }
    const string SecurityHeaders="Cache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\n";
    void Reply(CoreWebView2WebResourceRequestedEventArgs e,int status,string type,byte[] body)=>e.Response=view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(body,false),status,status==200?"OK":"Denied",SecurityHeaders+"Content-Type: "+type+"\r\n");
    async Task<byte[]> ReadBody(Stream? source,int limit)
    {
        using var result=new MemoryStream();if(source==null)return Array.Empty<byte>();var buffer=new byte[4096];int count;
        while((count=await source.ReadAsync(buffer,lifetime.Token))>0){if(result.Length+count>limit)throw new InvalidDataException();await result.WriteAsync(buffer.AsMemory(0,count),lifetime.Token);}return result.ToArray();
    }
    async void Resource(object? sender,CoreWebView2WebResourceRequestedEventArgs e)
    {
        using var deferred=e.GetDeferral();var attempt=generation;
        try{
            var uri=new Uri(e.Request.Uri);
            if(uri.GetLeftPart(UriPartial.Authority)!=AgentConfiguration.UiOrigin||stopped)throw new InvalidDataException();
            if(uri.AbsolutePath.StartsWith("/api/",StringComparison.Ordinal))
            {
                if(e.ResourceContext is not(CoreWebView2WebResourceContext.Fetch or CoreWebView2WebResourceContext.XmlHttpRequest)||!session.Config.IsDisplayUri(new Uri(view.Source.AbsoluteUri)))throw new InvalidDataException();
                var headers=e.Request.Headers;if(headers.Contains("Origin")&&headers.GetHeader("Origin")!=AgentConfiguration.UiOrigin)throw new InvalidDataException();
                var root=$"/api/dashboards/device/{session.Config.DashboardId}";byte[] data;
                if(e.Request.Method=="POST"&&uri.PathAndQuery==root+"/kiosk/session")
                {
                    var input=await ReadBody(e.Request.Content,256);
                    using var json=JsonDocument.Parse(input);if(json.RootElement.GetProperty("deviceId").GetInt32()!=session.Config.DeviceId)throw new InvalidDataException();
                    data=JsonSerializer.SerializeToUtf8Bytes(new{deviceId=session.Config.DeviceId,dashboardId=session.Config.DashboardId,authorizationExpiresAt=await session.Validate(lifetime.Token)});
                }
                else if(e.Request.Method=="POST"&&uri.PathAndQuery==root+"/kiosk/forget"){session.Forget();Reply(e,200,"application/json","{\"forgotten\":true}"u8.ToArray());Stop();return;}
                else if(e.Request.Method=="GET"&&uri.PathAndQuery==root+"/layout")data=(await session.Layout(lifetime.Token)).Body;
                else if(e.Request.Method=="POST"&&(uri.PathAndQuery==root+"/page"||System.Text.RegularExpressions.Regex.IsMatch(uri.PathAndQuery,$"^{root}/data-sources/[A-Za-z][A-Za-z0-9_]{{0,63}}/page$")))
                {
                    var input=await ReadBody(e.Request.Content,1048576);
                    data=(await session.Page(uri.PathAndQuery,input,lifetime.Token)).Body;
                }
                else if(e.Request.Method=="GET"&&uri.PathAndQuery=="/api/system-settings/branding")data=JsonSerializer.SerializeToUtf8Bytes(new{organizationName="",platformName="UQP",platformTitle="UQP Managed Kiosk",platformSubtitle=""});
                else throw new InvalidDataException();
                if(stopped||attempt!=generation)throw new OperationCanceledException();Reply(e,200,"application/json; charset=utf-8",data);return;
            }
            if(e.Request.Method!="GET")throw new InvalidDataException();
            if(uri.AbsolutePath=="/favicon.ico"){Reply(e,404,"image/x-icon",Array.Empty<byte>());return;}
            var asset=session.Config.IsDisplayUri(uri)?"index.html":uri.AbsolutePath.TrimStart('/');
            if(asset!="index.html"&&(!asset.StartsWith("assets/",StringComparison.Ordinal)||asset.Contains("..")||asset.Contains('%')||asset.Contains('\\')||uri.Query!=""))throw new InvalidDataException();
            var assembly=Assembly.GetExecutingAssembly();using var stream=assembly.GetManifestResourceStream(assembly.GetManifestResourceNames().Single(n=>n.Replace('\\','/')=="Ui/"+asset))??throw new InvalidDataException();using var contents=new MemoryStream();await stream.CopyToAsync(contents,lifetime.Token);
            var type=Path.GetExtension(asset) switch{".js"=>"text/javascript",".css"=>"text/css",".html"=>"text/html",".woff2"=>"font/woff2",".svg"=>"image/svg+xml",".png"=>"image/png",".jpg"=>"image/jpeg",".webp"=>"image/webp",_=>throw new InvalidDataException()};
            Reply(e,200,type+"; charset=utf-8",contents.ToArray());
        }catch(Exception error){FailureCode="RESOURCE_"+error.GetType().Name+"_"+unchecked((uint)error.HResult).ToString("X8");if(!stopped&&attempt==generation)Stop();Reply(e,403,"application/json","{\"error\":{\"code\":\"MANAGED_KIOSK_DENIED\"}}"u8.ToArray());}
    }
}
