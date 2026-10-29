using System.Diagnostics;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;
using Uqp.Kiosk.Agent;

internal static class Program
{
    static string stage="START";
    static void Check(bool condition){if(!condition)throw new InvalidDataException("WINDOWS_AGENT_CONTRACT_FAILED");}
    [STAThread]
    static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);Application.EnableVisualStyles();
        try{return args[0]=="--probe"?Probe(args[1],args[2],args[3]):Run(args[0]).GetAwaiter().GetResult();}
        catch{Console.WriteLine("WINDOWS_AGENT_TEST_FAILED_STAGE="+stage);return 1;}
    }
    static async Task<int> Run(string repo)
    {
        using var child=Process.Start(new ProcessStartInfo("node","--import tsx src/modules/managedKiosk/managedFixture.ts --serve-managed-fixture"){WorkingDirectory=Path.Combine(repo,"server"),RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false})!;
        string? directory=null;
        try{
            using var setup=JsonDocument.Parse(await child.StandardOutput.ReadLineAsync()??throw new InvalidDataException());directory=setup.RootElement.GetProperty("directory").GetString()!;
            var configFile=Path.Combine(directory,"agent.json");var config=AgentConfiguration.Load(configFile);var vault=new ProtectedVault(config);
            stage="NATIVE_ENROLLMENT";using var session=await AgentSession.Enroll(config,vault,File.ReadAllBytes(Path.Combine(directory,"client.pfx")),"fixture-only","manager","fixture-secret",true);
            stage="DPAPI_ACL";var token=session.Enrollment.Token;Check(vault.Load()?.Token==token);
            var root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UQP","ManagedKiosk",config.Digest);var file=Path.Combine(root,"enrollment.dpapi");
            var cipher=File.ReadAllBytes(file);Check(!System.Text.Encoding.UTF8.GetString(cipher).Contains(token));
            var rules=new DirectoryInfo(root).GetAccessControl().GetAccessRules(true,true,typeof(SecurityIdentifier));
            var allowed=new[]{WindowsIdentity.GetCurrent().User!.Value,new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null).Value};
            Check(rules.Cast<FileSystemAccessRule>().All(r=>!r.IsInherited&&allowed.Contains(r.IdentityReference.Value)));
            var modified=(byte[])cipher.Clone();modified[^1]^=1;File.WriteAllBytes(file,modified);bool denied=false;try{vault.Load();}catch(System.Security.Cryptography.CryptographicException){denied=true;}Check(denied);File.WriteAllBytes(file,cipher);
            denied=false;try{vault.Save(session.Enrollment with{Machine="other-machine"});}catch(InvalidDataException){denied=true;}Check(denied);
            var wrong=config with{PublicPlaybackUrl="http://different.example/display/dashboards/1?deviceId=7"};var wrongRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UQP","ManagedKiosk",wrong.Digest);Directory.CreateDirectory(wrongRoot);File.WriteAllBytes(Path.Combine(wrongRoot,"enrollment.dpapi"),cipher);
            denied=false;try{new ProtectedVault(wrong).Load();}catch(System.Security.Cryptography.CryptographicException){denied=true;}Check(denied);Directory.Delete(wrongRoot,true);
            var control=$"http://127.0.0.1:{setup.RootElement.GetProperty("controlPort").GetInt32()}";using var client=new HttpClient();
            for(int i=0;i<2;i++){
                stage="BROWSER_PROCESS_"+i;if(i==0){using var outage=await client.PostAsync(control,new StringContent("{\"unavailable\":true}"));outage.EnsureSuccessStatusCode();}var output=Path.Combine(directory,"probe-"+i+".json");
                var start=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false};start.ArgumentList.Add("--probe");start.ArgumentList.Add(configFile);start.ArgumentList.Add(output);start.ArgumentList.Add(control);
                using var probe=Process.Start(start)!;
                if(i==0){var until=DateTime.UtcNow.AddSeconds(30);bool observed=false;while(DateTime.UtcNow<until){using var health=JsonDocument.Parse(await client.GetStringAsync(control));if(health.RootElement.GetProperty("unavailableChecks").GetInt32()>0){observed=true;break;}await Task.Delay(100);}Check(observed);using var online=await client.PostAsync(control,new StringContent("{\"unavailable\":false}"));online.EnsureSuccessStatusCode();}
                using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(90));await probe.WaitForExitAsync(timeout.Token);Check(probe.ExitCode==0);Check(File.ReadAllText(output)=="PASS");
            }
            using var state=JsonDocument.Parse(await client.GetStringAsync(control));Check(state.RootElement.GetProperty("issued").GetInt32()==1);Check(!state.RootElement.GetProperty("leaked").GetBoolean());
            using(var restored=await client.PostAsync(control,new StringContent("{\"revoked\":false}")))restored.EnsureSuccessStatusCode();
            stage="LOCAL_FORGET";session.Forget();Check(vault.Load()==null);denied=false;try{await session.Validate();}catch(InvalidDataException){denied=true;}Check(denied);
            Console.WriteLine("WINDOWS_DPAPI_ACL_MACHINE_ORIGIN_TAMPER_PASS");
            Console.WriteLine("WINDOWS_REAL_WEBVIEW_F5_PROCESS_PROFILE_RESTART_NO_TOKEN_DOM_STORAGE_URL_PASS");
            Console.WriteLine("WINDOWS_WEBVIEW_BOOT_OUTAGE_RECOVERY_FOREIGN_NAVIGATION_AND_REVOCATION_LATCH_PASS (not OS reboot acceptance)");
            return 0;
        }
        finally{child.Kill(true);await child.WaitForExitAsync();if(directory!=null)try{Directory.Delete(directory,true);}catch(IOException){}}
    }
    static int Probe(string file,string output,string control)
    {
        Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS","--remote-debugging-port=39291 --no-sandbox",EnvironmentVariableTarget.Process);
        var config=AgentConfiguration.Load(file);var vault=new ProtectedVault(config);var session=new AgentSession(config,vault.Load()??throw new InvalidDataException(),vault);
        using var form=new PlaybackForm(session);bool finished=false,failed=false;
        form.Shown+=async(_,_)=>{
            try{
                var view=(WebView2)typeof(PlaybackForm).GetField("view",BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(form)!;
                async Task WaitFor(Func<Task<bool>> predicate,int seconds=30){var until=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<until){if(await predicate())return;await Task.Delay(100);}throw new TimeoutException();}
                stage="WEBVIEW_READY";await WaitFor(async()=>view.CoreWebView2!=null&&view.Visible&&(JsonSerializer.Deserialize<string>(await view.ExecuteScriptAsync("document.body.innerText"))??"").Contains("合○Agent"));
                Check(Environment.GetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")==null);
                stage="NO_SECRET_SURFACES";var surface=await view.ExecuteScriptAsync("JSON.stringify([document.documentElement.outerHTML,document.cookie,localStorage,sessionStorage,location.href])");Check(!surface.Contains(session.Enrollment.Token));
                stage="F5";var navigated=new TaskCompletionSource();view.CoreWebView2.NavigationCompleted+=(_,_)=>navigated.TrySetResult();view.Reload();await navigated.Task.WaitAsync(TimeSpan.FromSeconds(30));await WaitFor(async()=>view.Visible&&(JsonSerializer.Deserialize<string>(await view.ExecuteScriptAsync("document.body.innerText"))??"").Contains("合○Agent"));
                if(output.EndsWith("probe-1.json",StringComparison.Ordinal)){
                    stage="READ_ONLY_NETWORK_RECOVERY";using var client=new HttpClient();
                    using(var outage=await client.PostAsync(control,new StringContent("{\"unavailable\":true}")))outage.EnsureSuccessStatusCode();
                    stage="OUTAGE_VIEW_CLEAR";await WaitFor(()=>Task.FromResult(!view.Visible),20);
                    using(var online=await client.PostAsync(control,new StringContent("{\"unavailable\":false}")))online.EnsureSuccessStatusCode();
                    stage="RECOVERY_NEW_DOCUMENT";await WaitFor(async()=>view.Visible&&(JsonSerializer.Deserialize<string>(await view.ExecuteScriptAsync("document.body.innerText"))??"").Contains("合○Agent"));
                    stage="REVOCATION_PURGE";using var result=await client.PostAsync(control,new StringContent("{\"revoked\":true}"));result.EnsureSuccessStatusCode();
                    await WaitFor(()=>Task.FromResult(!view.Visible),20);Check(!view.Visible);
                    using(var restored=await client.PostAsync(control,new StringContent("{\"revoked\":false}")))restored.EnsureSuccessStatusCode();await Task.Delay(5500);Check(!view.Visible);
                }
                // Isolate an intentional foreign-origin security refusal from
                // transient-outage recovery: a security refusal may lock playback.
                stage="FOREIGN_NAVIGATION";view.CoreWebView2.Navigate("https://evil.invalid/");await Task.Delay(300);Check(view.Source.GetLeftPart(UriPartial.Authority)==AgentConfiguration.UiOrigin);
                File.WriteAllText(output,"PASS");finished=true;
            }catch{Console.WriteLine("WINDOWS_AGENT_PROBE_FAILED_STAGE="+stage+"_"+form.FailureCode);failed=true;}finally{form.Close();}
        };
        Application.Run(form);return finished&&!failed?0:1;
    }
}
