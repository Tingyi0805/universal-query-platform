using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
namespace Uqp.Kiosk.Agent;

public sealed record ChannelReply(HttpStatusCode Status,byte[] Body,DateTimeOffset PeerExpiry)
{
    public JsonDocument Json()=>JsonDocument.Parse(Body);
    public void RequireSuccess(){if((int)Status<200||(int)Status>299)throw new HttpRequestException("MANAGED_REQUEST_DENIED");}
}
public sealed class ChannelClient:IDisposable
{
    readonly AgentConfiguration config;readonly HttpClient http;readonly X509Certificate2 certificate;
    public DateTimeOffset CertificateExpiry=>certificate.NotAfter.ToUniversalTime();
    public ChannelClient(AgentConfiguration config,byte[] pfx,string password,SslProtocols protocols=SslProtocols.Tls12|SslProtocols.Tls13)
    {
        this.config=config;config.Validate();if(protocols==SslProtocols.None||(protocols&~(SslProtocols.Tls12|SslProtocols.Tls13))!=0)throw new InvalidDataException("LEGACY_TLS_DENIED");// Schannel requires a user key provider; ephemeral key handles fail on Windows.
        // No Exportable/PersistKeySet/MachineKeySet and no certificate-store install.
        certificate=X509CertificateLoader.LoadPkcs12(pfx,password,OperatingSystem.IsWindows()?X509KeyStorageFlags.UserKeySet:X509KeyStorageFlags.EphemeralKeySet);
        if(!certificate.HasPrivateKey||DateTime.UtcNow<certificate.NotBefore.ToUniversalTime()||DateTime.UtcNow>=certificate.NotAfter.ToUniversalTime())throw new InvalidDataException("CLIENT_CERTIFICATE_INVALID");
        var handler=new SocketsHttpHandler{UseCookies=false,UseProxy=false,AllowAutoRedirect=false,MaxConnectionsPerServer=6,PooledConnectionLifetime=TimeSpan.FromSeconds(20),MaxResponseHeadersLength=32};
        handler.SslOptions=new SslClientAuthenticationOptions{
            TargetHost="uqp-kiosk.internal",EnabledSslProtocols=protocols,AllowRenegotiation=false,AllowTlsResume=false,
            ClientCertificates=new X509CertificateCollection{certificate},RemoteCertificateValidationCallback=(_sender,cert,_chain,errors)=>PinnedServer(cert,errors,config.ServerCertificateSha256)};
        handler.ConnectCallback=async(context,cancel)=>{
            if(context.DnsEndPoint.Host!="uqp-kiosk.internal"||context.DnsEndPoint.Port!=443)throw new InvalidDataException();
            var endpoint=new Uri(config.ChannelEndpoint);var tcp=new Socket(SocketType.Stream,ProtocolType.Tcp);
            try{
                await tcp.ConnectAsync(endpoint.DnsSafeHost,endpoint.Port,cancel);var stream=new NetworkStream(tcp,true);
                await stream.WriteAsync(Encoding.ASCII.GetBytes("CONNECT uqp-kiosk.internal:443 HTTP/1.1\r\nHost: uqp-kiosk.internal:443\r\n\r\n"),cancel);
                var bytes=new List<byte>();var one=new byte[1];
                while(bytes.Count<8192){if(await stream.ReadAsync(one,cancel)!=1)throw new IOException();bytes.Add(one[0]);if(bytes.Count>=4&&bytes.TakeLast(4).SequenceEqual(new byte[]{13,10,13,10}))break;}
                if(!Encoding.ASCII.GetString(bytes.ToArray()).Equals("HTTP/1.1 200 Connection Established\r\n\r\n",StringComparison.Ordinal))throw new IOException("CHANNEL_CONNECT_DENIED");
                return stream;
            }catch{tcp.Dispose();throw;}
        };
        http=new HttpClient(handler){BaseAddress=new Uri("https://uqp-kiosk.internal"),Timeout=TimeSpan.FromSeconds(75)};
    }
    public static bool PinnedServer(X509Certificate? cert,SslPolicyErrors errors,string pin)
    {
        if(cert==null||(errors&(SslPolicyErrors.RemoteCertificateNameMismatch|SslPolicyErrors.RemoteCertificateNotAvailable))!=0)return false;
        using var leaf=X509CertificateLoader.LoadCertificate(cert.GetRawCertData());
        return DateTime.UtcNow>=leaf.NotBefore.ToUniversalTime()&&DateTime.UtcNow<leaf.NotAfter.ToUniversalTime()&&
            CryptographicOperations.FixedTimeEquals(SHA256.HashData(leaf.RawData),Convert.FromHexString(pin))&&
            leaf.Extensions.OfType<X509EnhancedKeyUsageExtension>().Any(x=>x.EnhancedKeyUsages.Cast<Oid>().Any(oid=>oid.Value=="1.3.6.1.5.5.7.3.1"));
    }
    public async Task<ChannelReply> Send(HttpMethod method,string path,byte[]? body=null,string? token=null,string? jwt=null,CancellationToken cancel=default)
    {
        if(!AllowedPath(method,path))throw new InvalidDataException("CHANNEL_PATH_DENIED");
        using var request=new HttpRequestMessage(method,path){Version=HttpVersion.Version11,VersionPolicy=HttpVersionPolicy.RequestVersionExact};
        var nonce=Guid.NewGuid().ToString();request.Headers.Host="uqp-kiosk.internal:443";
        request.Headers.Add("X-UQP-Agent-Request-Id",nonce);request.Headers.Add("X-UQP-Agent-Time",DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(System.Globalization.CultureInfo.InvariantCulture));request.Headers.Add("X-UQP-Public-Origin",config.PublicOrigin);
        if(token!=null)request.Headers.Add("X-Dashboard-Device-Token",token);
        if(jwt!=null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",jwt);
        if(method==HttpMethod.Post){request.Content=new ByteArrayContent(body??"{}"u8.ToArray());request.Content.Headers.ContentType=new MediaTypeHeaderValue("application/json");}
        using var response=await http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,cancel);
        if(!response.Headers.TryGetValues("X-UQP-Agent-Request-Id",out var ids)||ids.Single()!=nonce||!response.Headers.TryGetValues("X-UQP-Agent-Enrollment-Expires",out var expiry)||!DateTimeOffset.TryParse(expiry.Single(),System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.RoundtripKind,out var deadline))throw new IOException("CHANNEL_PROOF_DENIED");
        using var data=new MemoryStream();using var source=await response.Content.ReadAsStreamAsync(cancel);var buffer=new byte[8192];int count;
        while((count=await source.ReadAsync(buffer,cancel))>0){if(data.Length+count>16*1024*1024)throw new IOException("CHANNEL_RESPONSE_LIMIT");await data.WriteAsync(buffer.AsMemory(0,count),cancel);}
        return new ChannelReply(response.StatusCode,data.ToArray(),deadline);
    }
    bool AllowedPath(HttpMethod method,string path)
    {
        var root=$"/api/dashboards/device/{config.DashboardId}";
        return method==HttpMethod.Get&&path==root+"/layout"||method==HttpMethod.Post&&(path==root+"/page"||System.Text.RegularExpressions.Regex.IsMatch(path,$"^{root}/data-sources/[A-Za-z][A-Za-z0-9_]{{0,63}}/page$"))||
            method==HttpMethod.Post&&path=="/api/auth/login"||method==HttpMethod.Get&&path==$"/api/dashboards/{config.DashboardId}/query-mode/v1"||
            method==HttpMethod.Post&&path==$"/api/dashboards/{config.DashboardId}/query-mode/v1/devices/{config.DeviceId}/credential"||
            method==HttpMethod.Get&&path==$"/api/dashboards/{config.DashboardId}/devices/{config.DeviceId}/playback-settings";
    }
    public void Dispose(){http.Dispose();certificate.Dispose();}
}
