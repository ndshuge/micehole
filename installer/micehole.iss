; MiceHole Universal private-release preview installer
#define AppName "MiceHole Universal"
#define AppVersion "0.1.0"
[Setup]
AppId={{06EF1EC2-BC39-49E8-9AE5-97978956A51E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=MiceHole Community Preview
DefaultDirName={localappdata}\Programs\MiceHole
DefaultGroupName=MiceHole Universal
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
OutputDir=..\dist\installer
OutputBaseFilename=MiceHole-Universal-0.1.0-Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=MiceHole Universal Preview
ChangesAssociations=no
ChangesEnvironment=no
[Files]
Source: "..\dist\stage\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\MiceHole Doctor"; Filename: "{app}\scripts\doctor.cmd"; WorkingDir: "{app}"
Name: "{autoprograms}\MiceHole Control"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\remote-control.ps1"""; WorkingDir: "{app}"
Name: "{autoprograms}\MiceHole Installation Folder"; Filename: "{app}"
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""{app}\scripts\setup-config.ps1"""; Flags: runhidden waituntilterminated
Filename: "{app}\README.md"; Description: "Read MiceHole README"; Flags: shellexec postinstall skipifsilent unchecked
