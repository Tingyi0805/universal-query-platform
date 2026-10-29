namespace Uqp.Kiosk.Agent;
internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        Application.ThreadException+=(_,_)=>{MessageBox.Show("UQP 播放已停止。請關閉並確認安全設定。","UQP");Application.Exit();};
        try{
            using var identity=System.Security.Principal.WindowsIdentity.GetCurrent();
            if(identity.IsSystem||identity.Groups?.Any(group=>group.Value=="S-1-5-32-544")==true){MessageBox.Show("請使用受管理的標準 Windows 使用者執行；不支援 SYSTEM 或管理員帳號。","UQP");return;}
            if((args.Length!=2&&args.Length!=4)||args[0]!="--config")throw new InvalidDataException();
            Placement? placement=null;
            if(args.Length==4){if(args[2]!="--placement-base64"||args[3].Length>1024)throw new InvalidDataException();placement=System.Text.Json.JsonSerializer.Deserialize<Placement>(Convert.FromBase64String(args[3]),new System.Text.Json.JsonSerializerOptions{UnmappedMemberHandling=System.Text.Json.Serialization.JsonUnmappedMemberHandling.Disallow})??throw new InvalidDataException();if(placement.ScreenNumber<1||placement.ScreenNumber>32||placement.WindowWidth<200||placement.WindowWidth>16384||placement.WindowHeight<200||placement.WindowHeight>16384)throw new InvalidDataException();}
            var config=AgentConfiguration.Load(Path.GetFullPath(args[1]));
            using var single=new Mutex(true,"Local\\UQP.ManagedKiosk."+ProtectedVault.Machine+"."+config.Digest,out var first);
            if(!first){MessageBox.Show("此 Windows 使用者的裝置播放端已在執行。","UQP");return;}
            var vault=new ProtectedVault(config);Enrollment? enrollment=null;
            try{enrollment=vault.Load();}catch{MessageBox.Show("本機註冊無法恢復或已到期，須由管理者明確重新授權。","UQP");}
            AgentSession? session=enrollment==null?null:new AgentSession(config,enrollment,vault);
            if(session==null){using var setup=new EnrollmentForm(config,vault);if(setup.ShowDialog()!=DialogResult.OK)return;session=setup.Session;}
            if(session==null)return;using var playback=new PlaybackForm(session,placement);Application.Run(playback);
        }catch{MessageBox.Show("UQP Agent 無法啟動。請確認可信設定、原生執行環境及裝置註冊。","UQP");}
    }
}
