namespace Uqp.Kiosk.Agent;
public sealed class EnrollmentForm:Form
{
    readonly AgentConfiguration config;readonly ProtectedVault vault;
    readonly TextBox user=new(),password=new(){UseSystemPasswordChar=true},pfx=new(),pfxPassword=new(){UseSystemPasswordChar=true};
    readonly CheckBox confirmed=new(){Text="確認重新核發此裝置憑證；先前憑證將失效",AutoSize=true};
    readonly Button submit=new(){Text="安全登入並授權",AutoSize=true};readonly Label status=new(){AutoSize=true};
    public AgentSession? Session{get;private set;}
    public EnrollmentForm(AgentConfiguration config,ProtectedVault vault)
    {
        this.config=config;this.vault=vault;Text=$"UQP 管理者首次授權 — 裝置 {config.DeviceId}";Width=580;Height=460;StartPosition=FormStartPosition.CenterScreen;
        var grid=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,Padding=new Padding(16),AutoScroll=true};Controls.Add(grid);
        void Row(string title,Control control){var n=grid.RowCount++;grid.Controls.Add(new Label{Text=title,AutoSize=true},0,n);control.Dock=DockStyle.Top;grid.Controls.Add(control,1,n);}
        Row("已佈署的裝置 PFX",pfx);var browse=new Button{Text="選取憑證檔",AutoSize=true};browse.Click+=(_,_)=>{using var file=new OpenFileDialog{Filter="裝置憑證|*.pfx;*.p12",CheckFileExists=true};if(file.ShowDialog(this)==DialogResult.OK)pfx.Text=file.FileName;};Row("",browse);
        Row("PFX 密碼",pfxPassword);Row("管理者帳號",user);Row("管理者密碼",password);Row("",confirmed);Row("",submit);Row("",status);
        submit.Click+=async(_,_)=>await Enroll();FormClosed+=(_,_)=>{password.Clear();pfxPassword.Clear();};
    }
    async Task Enroll()
    {
        if(!confirmed.Checked){status.Text="請先確認重新核發影響。";return;}submit.Enabled=false;status.Text="正在驗證加密通道與管理權限…";
        try{var bytes=File.ReadAllBytes(pfx.Text);if(bytes.Length>65536)throw new InvalidDataException();try{Session=await AgentSession.Enroll(config,vault,bytes,pfxPassword.Text,user.Text,password.Text,true);}finally{System.Security.Cryptography.CryptographicOperations.ZeroMemory(bytes);}DialogResult=DialogResult.OK;Close();}
        catch{status.Text="授權未完成。請確認可信設定、憑證、時鐘、帳密、裝置狀態及 Query-only 權限。";}
        finally{password.Clear();pfxPassword.Clear();submit.Enabled=true;}
    }
}
