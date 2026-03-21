; Nova AI - Inno Setup Script
; 이 스크립트를 사용하려면 Inno Setup 6를 설치하세요: https://jrsoftware.org/isinfo.php
;
; 사용법:
;   1. PyInstaller로 먼저 빌드: pyinstaller "NovaAI.spec"
;   2. Inno Setup Compiler에서 이 파일을 열고 컴파일
;   또는: iscc installer.iss

#define MyAppName "Nova AI"
#define MyAppVersion "2.1.1"
#define MyAppPublisher "Nova AI"
#define MyAppURL "https://github.com/nova-ai"
#define MyAppExeName "Nova AI.exe"
#define MyAppAssocName MyAppName
#define BuildDir "dist\Nova AI"
#define ReleaseDir "release"

[Setup]
; 앱 고유 ID (GUID) - 변경하지 마세요
AppId={{A3F8E2D1-7B4C-4E9A-B5D6-1C8F3A2E4D7B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; 설치 시 관리자 권한 불필요 (사용자 폴더에 설치 가능)
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
; 출력 설정
OutputDir=output
OutputBaseFilename=NovaAI_Setup_{#MyAppVersion}
; 압축 설정
Compression=lzma2/ultra64
SolidCompression=yes
; UI 설정
WizardStyle=modern
#ifexist "pabicon789.ico"
SetupIconFile=pabicon789.ico
#endif
#ifexist "wizard_image.png"
WizardImageFile=wizard_image.png
#endif
#ifexist "wizard_small.png"
WizardSmallImageFile=wizard_small.png
#endif
; 언어 설정
ShowLanguageDialog=auto
; 설치 전 라이선스/정보 페이지 (선택사항 - 필요시 주석 해제)
; LicenseFile=LICENSE.txt
; InfoBeforeFile=INSTALL_NOTE.txt
UninstallDisplayIcon={app}\{#MyAppExeName}
; 64비트 설정
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
; Quick Launch는 Windows 10+ 에서 지원하지 않으므로 제거

[Files]
; PyInstaller로 빌드된 모든 파일 포함
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; build_installer.bat가 생성한 배포용 런타임 설정 포함
Source: "{#ReleaseDir}\.env.runtime"; DestDir: "{app}"; Flags: ignoreversion
; 참고용 예시 파일(없으면 건너뜀)
Source: ".env.example"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "pabicon789.ico"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "pabicon789.png"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\pabicon789.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{app}\pabicon789.ico"
; Quick Launch 바로가기 제거 (Windows 10+ 미지원)

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
