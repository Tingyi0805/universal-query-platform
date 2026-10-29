using System.Diagnostics;
using System.Text.Json;
using Uqp.Kiosk.Agent;
static void Check(bool condition){if(!condition)throw new InvalidOperationException("CHANNEL_CONTRACT_FAILED");}
var repo=Path.GetFullPath(args[0]);
using var child=Process.Start(new ProcessStartInfo("node","--import tsx src/modules/managedKiosk/managedFixture.ts --serve-managed-fixture"){WorkingDirectory=Path.Combine(repo,"server"),RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false})!;
string? directory=null;
try{
 using var setup=JsonDocument.Parse(await child.StandardOutput.ReadLineAsync()??throw new InvalidDataException());directory=setup.RootElement.GetProperty("directory").GetString()!;
 var config=AgentConfiguration.Load(Path.Combine(directory,"agent.json"));Check(config.Digest.Length==64);Check(JsonSerializer.Deserialize<AgentConfiguration>(JsonSerializer.Serialize(config))!.Digest==config.Digest);Check(!JsonSerializer.Serialize(config).Contains("Digest"));var pfx=File.ReadAllBytes(Path.Combine(directory,"client.pfx"));
 using var channel=new ChannelClient(config,pfx,"fixture-only");
 var login=await channel.Send(HttpMethod.Post,"/api/auth/login",JsonSerializer.SerializeToUtf8Bytes(new{username="manager",password="fixture-secret"}));login.RequireSuccess();
 using var json=login.Json();Check(json.RootElement.GetProperty("accessToken").GetString()=="fixture-session");
 var mode=await channel.Send(HttpMethod.Get,"/api/dashboards/1/query-mode/v1",jwt:"fixture-session");mode.RequireSuccess();
 using var version=mode.Json();var issued=await channel.Send(HttpMethod.Post,"/api/dashboards/1/query-mode/v1/devices/7/credential",JsonSerializer.SerializeToUtf8Bytes(new{expectedVersion=version.RootElement.GetProperty("version").GetString()}),jwt:"fixture-session");issued.RequireSuccess();
 using var grant=issued.Json();var token=grant.RootElement.GetProperty("token").GetString()!;
 var page=await channel.Send(HttpMethod.Post,"/api/dashboards/device/1/page","{\"page\":1}"u8.ToArray(),token);page.RequireSuccess();Check(System.Text.Encoding.UTF8.GetString(page.Body).Contains("合○Agent"));
 using(var tls12=new ChannelClient(config,pfx,"fixture-only",System.Security.Authentication.SslProtocols.Tls12)){(await tls12.Send(HttpMethod.Get,"/api/dashboards/device/1/layout",token:token)).RequireSuccess();}
 using var control=new HttpClient();var controlUri=$"http://127.0.0.1:{setup.RootElement.GetProperty("controlPort").GetInt32()}";
 using(var state=JsonDocument.Parse(await control.GetStringAsync(controlUri)))Check(!state.RootElement.GetProperty("leaked").GetBoolean());
 using(var response=await control.PostAsync(controlUri,new StringContent("{\"revoked\":true}")))response.EnsureSuccessStatusCode();
 bool denied=false;try{await channel.Send(HttpMethod.Get,"/api/dashboards/device/1/layout",token:token);}catch(IOException){denied=true;}Check(denied);
 var wrong=config with{ServerCertificateSha256=new string('A',64)};
 using var bad=new ChannelClient(wrong,pfx,"fixture-only");bool rejected=false;
 try{await bad.Send(HttpMethod.Post,"/api/auth/login","{}"u8.ToArray());}catch(HttpRequestException){rejected=true;}Check(rejected);
 rejected=false;try{await channel.Send(HttpMethod.Get,"/api/admin");}catch(InvalidDataException){rejected=true;}Check(rejected);
 Console.WriteLine("DOTNET_NODE_TLS12_TLS13_MTLS_LOGIN_ISSUE_PAGE_PIN_REVOKE_NO_PLAINTEXT_PASS");
}finally{child.Kill(true);await child.WaitForExitAsync();if(directory!=null)try{Directory.Delete(directory,true);}catch(IOException){}}
