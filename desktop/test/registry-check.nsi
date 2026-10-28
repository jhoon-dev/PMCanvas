Unicode true
!include LogicLib.nsh
!addplugindir "$%LOCALAPPDATA%\electron-builder\Cache\nsis\nsis-resources-3.4.1\plugins\x86-unicode"
!include "..\node_modules\app-builder-lib\templates\nsis\include\StdUtils.nsh"
!define /ifndef PROJECT_FILE ""
Name "PM Canvas installation registry check"
OutFile "..\test-results\PMCanvas-Registry-Check.exe"
RequestExecutionLevel user
SilentInstall silent

!define APP_KEY "df0635bf-66e1-510a-b0e5-9ed63f670162"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_KEY}"

Section
  ; Read-only diagnostic for comparing the desktop user's registry with shell checks.
  FileOpen $9 "$EXEDIR\windows-desktop-registry.txt" w
  FileWriteWord $9 0xFEFF
  UserInfo::GetName
  Pop $0
  FileWriteUTF16LE $9 "User=$0$\r$\n"
  FileWriteUTF16LE $9 "AppData=$APPDATA$\r$\n"
  FileWriteUTF16LE $9 "AppKey=${APP_KEY}$\r$\n"
  IfFileExists "$APPDATA\pmcanvas-desktop\recovery.json" recoveryPresent recoveryMissing
  recoveryPresent:
    ${StdUtils.HashFile} $0 "SHA2-256" "$APPDATA\pmcanvas-desktop\recovery.json"
    FileWriteUTF16LE $9 "Recovery.Exists=1$\r$\nRecovery.SHA256=$0$\r$\n"
    Goto recoveryDone
  recoveryMissing:
    FileWriteUTF16LE $9 "Recovery.Exists=0$\r$\nRecovery.SHA256=$\r$\n"
  recoveryDone:
  !if "${PROJECT_FILE}" != ""
    ${StdUtils.HashFile} $0 "SHA2-256" "${PROJECT_FILE}"
    FileWriteUTF16LE $9 "Project.Path=${PROJECT_FILE}$\r$\n"
    FileWriteUTF16LE $9 "Project.SHA256=$0$\r$\n"
  !endif
  System::Call 'kernel32::GetCurrentPackageFullName(*i 0 .r1, p 0) i .r0'
  FileWriteUTF16LE $9 "PackageIdentity.Result=$0$\r$\n"
  SetRegView 64
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "DisplayName"
  FileWriteUTF16LE $9 "HKCU64.DisplayName=$0$\r$\n"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "UninstallString"
  FileWriteUTF16LE $9 "HKCU64.UninstallString=$0$\r$\n"
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  FileWriteUTF16LE $9 "HKCU64.Version=$0$\r$\n"
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${UNINSTALL_KEY}", i 0, i 0x20019, *p .r1) i .r0'
  FileWriteUTF16LE $9 "NativeRegOpen.Result=$0$\r$\n"
  ${If} $0 == 0
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${EndIf}
  System::Call 'advapi32::RegOpenCurrentUser(i 0x20019, *p .r1) i .r0'
  FileWriteUTF16LE $9 "LiveRoot.Result=$0, Handle=$1$\r$\n"
  ${If} $0 == 0
    System::Call 'advapi32::RegOpenKeyExW(p r1, w "${UNINSTALL_KEY}", i 0, i 0x20019, *p .r2) i .r0'
    FileWriteUTF16LE $9 "LiveRoot.Default=$0$\r$\n"
    ${If} $0 == 0
      System::Call 'advapi32::RegCloseKey(p r2)'
    ${EndIf}
    System::Call 'advapi32::RegOpenKeyExW(p r1, w "${UNINSTALL_KEY}", i 0, i 0x20119, *p .r2) i .r0'
    FileWriteUTF16LE $9 "LiveRoot.View64=$0$\r$\n"
    ${If} $0 == 0
      System::Call 'advapi32::RegCloseKey(p r2)'
    ${EndIf}
    System::Call 'advapi32::RegOpenKeyExW(p r1, w "${UNINSTALL_KEY}", i 0, i 0x20219, *p .r2) i .r0'
    FileWriteUTF16LE $9 "LiveRoot.View32=$0$\r$\n"
    ${If} $0 == 0
      System::Call 'advapi32::RegCloseKey(p r2)'
    ${EndIf}
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${EndIf}
  ReadRegStr $0 HKCU "Software\${APP_KEY}" "InstallLocation"
  FileWriteUTF16LE $9 "HKCU64.Location=$0$\r$\n"
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Software\${APP_KEY}", i 0, i 0x20119, *p .r1) i .r0'
  FileWriteUTF16LE $9 "LocationRegOpen.Result=$0$\r$\n"
  ${If} $0 == 0
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${EndIf}
  SetRegView 32
  ReadRegStr $0 HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  FileWriteUTF16LE $9 "HKCU32.Version=$0$\r$\n"
  ReadRegStr $0 HKCU "Software\${APP_KEY}" "InstallLocation"
  FileWriteUTF16LE $9 "HKCU32.Location=$0$\r$\n"
  SetRegView 64
  ReadRegStr $0 HKLM "${UNINSTALL_KEY}" "DisplayVersion"
  FileWriteUTF16LE $9 "HKLM64.Version=$0$\r$\n"
  SetRegView 32
  ReadRegStr $0 HKLM "${UNINSTALL_KEY}" "DisplayVersion"
  FileWriteUTF16LE $9 "HKLM32.Version=$0$\r$\n"
  FileClose $9
SectionEnd
