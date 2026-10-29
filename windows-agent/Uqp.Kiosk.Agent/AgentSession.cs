using System.Text.Json;
namespace Uqp.Kiosk.Agent;

public sealed class AgentSession:IDisposable
{
    public AgentConfiguration Config{get;}public Enrollment Enrollment{get;}
    readonly ChannelClient channel;readonly ProtectedVault vault;bool forgotten;
    public AgentSession(AgentConfiguration config,Enrollment enrollment,ProtectedVault vault)
    {
        Config=config;Enrollment=enrollment;this.vault=vault;channel=new ChannelClient(config,Convert.FromBase64String(enrollment.Pfx),enrollment.PfxPassword);
    }
    public static async Task<AgentSession> Enroll(AgentConfiguration config,ProtectedVault vault,byte[] pfx,string pfxPassword,string username,string password,bool confirmed)
    {
        if(!confirmed)throw new InvalidDataException();
        using var connection=new ChannelClient(config,pfx,pfxPassword);
        var login=await connection.Send(HttpMethod.Post,"/api/auth/login",JsonSerializer.SerializeToUtf8Bytes(new{username,password}));login.RequireSuccess();
        using var credentials=login.Json();var jwt=credentials.RootElement.GetProperty("accessToken").GetString()??throw new InvalidDataException();
        var state=await connection.Send(HttpMethod.Get,$"/api/dashboards/{config.DashboardId}/query-mode/v1",jwt:jwt);state.RequireSuccess();
        using var version=state.Json();if(version.RootElement.GetProperty("mode").GetString()!="QUERY_ONLY")throw new InvalidDataException("QUERY_ONLY_REQUIRED");
        var issued=await connection.Send(HttpMethod.Post,$"/api/dashboards/{config.DashboardId}/query-mode/v1/devices/{config.DeviceId}/credential",JsonSerializer.SerializeToUtf8Bytes(new{expectedVersion=version.RootElement.GetProperty("version").GetString()}),jwt:jwt);issued.RequireSuccess();
        using var grant=issued.Json();var token=grant.RootElement.GetProperty("token").GetString()??throw new InvalidDataException();
        var device=grant.RootElement.GetProperty("device");if(device.GetProperty("id").GetInt32()!=config.DeviceId||device.GetProperty("dashboardId").GetInt32()!=config.DashboardId)throw new InvalidDataException();
        var layout=await connection.Send(HttpMethod.Get,$"/api/dashboards/device/{config.DashboardId}/layout",token:token);layout.RequireSuccess();
        using var json=layout.Json();var metadata=json.RootElement.GetProperty("deviceAuthorization");
        var expires=new[]{DateTimeOffset.UtcNow.AddDays(365),connection.CertificateExpiry,layout.PeerExpiry}.Min();
        if(metadata.GetProperty("expiresAtUtc").ValueKind!=JsonValueKind.Null)expires=new[]{expires,metadata.GetProperty("expiresAtUtc").GetDateTimeOffset()}.Min();
        Placement? placement=null;
        var saved=await connection.Send(HttpMethod.Get,$"/api/dashboards/{config.DashboardId}/devices/{config.DeviceId}/playback-settings",jwt:jwt);saved.RequireSuccess();
        placement=JsonSerializer.Deserialize<Placement>(saved.Body,new JsonSerializerOptions{PropertyNameCaseInsensitive=true});
        var record=new Enrollment(config.Digest,ProtectedVault.Machine,Convert.ToBase64String(pfx),pfxPassword,token,expires,placement);
        vault.Save(record);return new AgentSession(config,record,vault);
    }
    void Live(){if(forgotten||Enrollment.EnrollmentExpiresAtUtc<=DateTimeOffset.UtcNow)throw new InvalidDataException("ENROLLMENT_EXPIRED");}
    public async Task<ChannelReply> Layout(CancellationToken cancel=default)
    {
        Live();using var timeout=CancellationTokenSource.CreateLinkedTokenSource(cancel);timeout.CancelAfter(TimeSpan.FromSeconds(8));
        var value=await channel.Send(HttpMethod.Get,$"/api/dashboards/device/{Config.DashboardId}/layout",token:Enrollment.Token,cancel:timeout.Token);value.RequireSuccess();Live();return value;
    }
    public async Task<long> Validate(CancellationToken cancel=default)
    {
        var reply=await Layout(cancel);using var json=reply.Json();var metadata=json.RootElement.GetProperty("deviceAuthorization");
        var serverNow=metadata.GetProperty("serverNowUtc").GetDateTimeOffset();
        var deadline=new[]{DateTimeOffset.UtcNow.AddSeconds(25),Enrollment.EnrollmentExpiresAtUtc,reply.PeerExpiry}.Min();
        if(metadata.GetProperty("expiresAtUtc").ValueKind!=JsonValueKind.Null){var remaining=metadata.GetProperty("expiresAtUtc").GetDateTimeOffset()-serverNow;deadline=new[]{deadline,DateTimeOffset.UtcNow+remaining}.Min();}
        if(deadline<=DateTimeOffset.UtcNow)throw new InvalidDataException();return deadline.ToUnixTimeMilliseconds();
    }
    public async Task<ChannelReply> Page(string path,byte[] body,CancellationToken cancel)
    {
        Live();var reply=await channel.Send(HttpMethod.Post,path,body,Enrollment.Token,cancel:cancel);reply.RequireSuccess();Live();return reply;
    }
    public void Forget(){forgotten=true;vault.Forget();channel.Dispose();}
    public void Dispose()=>channel.Dispose();
}
