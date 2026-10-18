Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Windows.Forms;
public class MiceHoleQAWnd : Form {
 protected override bool ShowWithoutActivation { get { return true; } }
 protected override CreateParams CreateParams { get { var p=base.CreateParams; p.ExStyle |= 0x08000000; return p; } }
 public MiceHoleQAWnd(){
   Text="MiceHole Background Capture QA";
   ShowInTaskbar=false; StartPosition=FormStartPosition.Manual;
   Location=new Point(2400,160); Size=new Size(460,240);
   Controls.Add(new Label(){Text="BACKGROUND QA CAPTURE",Location=new Point(15,15),Size=new Size(300,35)});
   var b=new Button(){Text="TEST CLICK",Location=new Point(15,55),Size=new Size(140,40)};
   var result=new Label(){Text="READY",Location=new Point(15,145),Size=new Size(300,30)};
   b.Click += (s,e)=>result.Text="CLICK_OK";
   Controls.Add(b);Controls.Add(result);
   var timer=new Timer();timer.Interval=180000;timer.Tick+=(s,e)=>Close();timer.Start();
 }
}
'@
$f=[MiceHoleQAWnd]::new()
[System.Windows.Forms.Application]::Run($f)
