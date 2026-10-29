using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;
namespace Uqp.Kiosk.Agent;

public sealed record Enrollment(string ConfigDigest,string Machine,string Pfx,string PfxPassword,string Token,DateTimeOffset EnrollmentExpiresAtUtc,Placement? SavedPlacement=null);
public sealed class ProtectedVault
{
    readonly AgentConfiguration config;readonly string directory;readonly byte[] entropy;
    public static string Machine=>Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        (Registry.GetValue(@"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography","MachineGuid",null) as string??throw new InvalidDataException())+"|"+WindowsIdentity.GetCurrent().User!.Value)));
    public ProtectedVault(AgentConfiguration config,string? root=null)
    {
        this.config=config;directory=Path.Combine(root??Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"UQP","ManagedKiosk",config.Digest);
        entropy=SHA256.HashData(Encoding.UTF8.GetBytes("UQP.ManagedKiosk.v1|"+config.Digest+"|"+Machine));
    }
    void CheckPath()
    {
        for(var item=new DirectoryInfo(directory);item!=null;item=item.Parent)
            if(item.Exists&&(item.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("VAULT_REPARSE_POINT");
        var file=Path.Combine(directory,"enrollment.dpapi");if(File.Exists(file)&&(File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0)throw new IOException("VAULT_REPARSE_POINT");
    }
    void Restrict()
    {
        CheckPath();Directory.CreateDirectory(directory);CheckPath();
        var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);
        foreach(var id in new[]{WindowsIdentity.GetCurrent().User!,new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null)})
            acl.AddAccessRule(new FileSystemAccessRule(id,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        acl.SetOwner(WindowsIdentity.GetCurrent().User!);new DirectoryInfo(directory).SetAccessControl(acl);
    }
    public void Save(Enrollment value)
    {
        Validate(value);Restrict();var plain=JsonSerializer.SerializeToUtf8Bytes(value);
        try
        {
            var cipher=ProtectedData.Protect(plain,entropy,DataProtectionScope.CurrentUser);var temporary=Path.Combine(directory,Guid.NewGuid()+".tmp");
            try{using(var stream=new FileStream(temporary,FileMode.CreateNew,FileAccess.Write,FileShare.None,4096,FileOptions.WriteThrough)){stream.Write(cipher);stream.Flush(true);}CheckPath();File.Move(temporary,Path.Combine(directory,"enrollment.dpapi"),true);}
            finally{if(File.Exists(temporary))File.Delete(temporary);CryptographicOperations.ZeroMemory(cipher);}
        }
        finally{CryptographicOperations.ZeroMemory(plain);}
    }
    void Validate(Enrollment value)
    {
        if(value.ConfigDigest!=config.Digest||value.Machine!=Machine||value.EnrollmentExpiresAtUtc<=DateTimeOffset.UtcNow||value.EnrollmentExpiresAtUtc>DateTimeOffset.UtcNow.AddDays(366)||
            !System.Text.RegularExpressions.Regex.IsMatch(value.Token,"^[A-Za-z0-9_-]{43}$"))throw new InvalidDataException("ENROLLMENT_INVALID");
    }
    public Enrollment? Load()
    {
        CheckPath();var file=Path.Combine(directory,"enrollment.dpapi");if(!File.Exists(file))return null;
        var cipher=File.ReadAllBytes(file);if(cipher.Length>131072)throw new InvalidDataException();
        var plain=ProtectedData.Unprotect(cipher,entropy,DataProtectionScope.CurrentUser);
        try{var value=JsonSerializer.Deserialize<Enrollment>(plain)??throw new InvalidDataException();Validate(value);return value;}
        finally{CryptographicOperations.ZeroMemory(plain);CryptographicOperations.ZeroMemory(cipher);}
    }
    public void Forget(){CheckPath();var file=Path.Combine(directory,"enrollment.dpapi");if(File.Exists(file))File.Delete(file);}
}
