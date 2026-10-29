using System.Security.Cryptography;
using System.Text.Json;
namespace Uqp.Kiosk.Agent;

public sealed record Placement(int ScreenNumber=1,int WindowX=0,int WindowY=0,int WindowWidth=1920,int WindowHeight=1080,bool Fullscreen=true);
public sealed record AgentConfiguration(string ChannelEndpoint,string PublicPlaybackUrl,string ServerCertificateSha256,int DashboardId,int DeviceId,Placement Placement)
{
    public const string UiOrigin="https://uqp-kiosk.invalid";
    [System.Text.Json.Serialization.JsonIgnore]
    public string PublicOrigin=>new Uri(PublicPlaybackUrl).GetLeftPart(UriPartial.Authority);
    [System.Text.Json.Serialization.JsonIgnore]
    public string DisplayPath=>$"/display/dashboards/{DashboardId}?deviceId={DeviceId}";
    public static AgentConfiguration Load(string file)
    {
        var value=JsonSerializer.Deserialize<AgentConfiguration>(File.ReadAllBytes(file),new JsonSerializerOptions{UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow})??throw new InvalidDataException();
        value.Validate();return value;
    }
    public void Validate()
    {
        var endpoint=new Uri(ChannelEndpoint);var url=new Uri(PublicPlaybackUrl);
        if(endpoint.Scheme!="http"||endpoint.GetLeftPart(UriPartial.Authority)!=ChannelEndpoint||endpoint.UserInfo!=""||DashboardId<=0||DeviceId<=0||
           !new[]{"http","https"}.Contains(url.Scheme)||url.AbsoluteUri!=PublicPlaybackUrl||url.UserInfo!=""||url.AbsolutePath!=$"/display/dashboards/{DashboardId}"||url.Query!=$"?deviceId={DeviceId}"||url.Fragment!=""||
           !System.Text.RegularExpressions.Regex.IsMatch(ServerCertificateSha256,"^[A-F0-9]{64}$")||Placement.ScreenNumber<1||Placement.ScreenNumber>32||Placement.WindowWidth<200||Placement.WindowWidth>16384||Placement.WindowHeight<200||Placement.WindowHeight>16384)
            throw new InvalidDataException("MANAGED_CONFIGURATION_INVALID");
    }
    [System.Text.Json.Serialization.JsonIgnore]
    public string Digest=>Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(this)));
    public bool IsDisplayUri(Uri uri)=>uri.AbsoluteUri==UiOrigin+DisplayPath;
}
