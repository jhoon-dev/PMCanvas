param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Baseline', 'Installed', 'Removed')]
  [string]$Mode,
  [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Programs\PM Canvas Desktop'),
  [string]$Snapshot = (Join-Path $PSScriptRoot '..\test-results\windows-install-baseline.json'),
  [string]$RegistryEvidence = '',
  [string]$ExpectedArchive = (Join-Path $PSScriptRoot '..\dist\win-unpacked\resources\app.asar'),
  [string[]]$PreserveFile = @()
)

# This verifier only reads installation state and writes evidence under test-results.
# Run the installer and uninstaller separately; existing installations are never removed here.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
$Snapshot = [IO.Path]::GetFullPath($Snapshot)
$executable = Join-Path $InstallDirectory 'PM Canvas Desktop.exe'
$uninstaller = Join-Path $InstallDirectory 'Uninstall PM Canvas Desktop.exe'
$archive = Join-Path $InstallDirectory 'resources\app.asar'
$expectedArchive = [IO.Path]::GetFullPath($ExpectedArchive)
$expectedVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$linkPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'PM Canvas Desktop.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'PM Canvas Desktop.lnk')
)

function Get-InstallEntries {
  $roots = @(
    @{ Path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'; Scope = 'user' },
    @{ Path = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'; Scope = 'machine' },
    @{ Path = 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'; Scope = 'machine32' }
  )
  foreach ($root in $roots) {
    if (!(Test-Path -LiteralPath $root.Path)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $root.Path) {
      $entry = Get-ItemProperty -LiteralPath $key.PSPath
      if ($entry.DisplayName -like 'PM Canvas Desktop *') {
        [PSCustomObject]@{
          Scope = $root.Scope
          Key = $key.PSPath
          DisplayName = $entry.DisplayName
          DisplayVersion = $entry.DisplayVersion
          UninstallString = $entry.UninstallString
        }
      }
    }
  }
}

function Get-FileEvidence([string]$File) {
  [PSCustomObject]@{
    Path = [IO.Path]::GetFullPath($File)
    Exists = (Test-Path -LiteralPath $File -PathType Leaf)
    SHA256 = $(if (Test-Path -LiteralPath $File -PathType Leaf) { (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash } else { $null })
  }
}

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

$entries = @(Get-InstallEntries)
if ($Mode -eq 'Baseline') {
  $recovery = Join-Path $env:APPDATA 'pmcanvas-desktop\recovery.json'
  $files = @($recovery) + @($PreserveFile)
  $baseline = [PSCustomObject]@{
    Version = 1
    CapturedAt = [DateTime]::UtcNow.ToString('o')
    InstallDirectory = $InstallDirectory
    Registered = $entries
    PreserveFiles = @($files | Select-Object -Unique | ForEach-Object { Get-FileEvidence $_ })
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $Snapshot) -Force | Out-Null
  $baseline | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Snapshot -Encoding UTF8
  Write-Output "PASS: baseline captured at $Snapshot"
  return
}

Assert-Condition (Test-Path -LiteralPath $Snapshot) 'Capture a baseline before installing or removing.'
$baseline = Get-Content -LiteralPath $Snapshot -Raw | ConvertFrom-Json
Assert-Condition ($baseline.Version -eq 1) 'Unsupported baseline format.'
Assert-Condition ($baseline.InstallDirectory -eq $InstallDirectory) 'Installation directory differs from the baseline.'
$checks = @()
$desktopRegistry = $null
if ($RegistryEvidence) {
  $evidenceFile = Get-Item -LiteralPath $RegistryEvidence -ErrorAction Stop
  Assert-Condition ($evidenceFile.LastWriteTimeUtc -gt [DateTime]::UtcNow.AddMinutes(-10)) 'Desktop registry evidence is stale; run the probe from Explorer again.'
  $desktopRegistry = @{}
  foreach ($line in Get-Content -LiteralPath $RegistryEvidence) {
    $parts = $line.Split('=', 2)
    if ($parts.Count -eq 2) { $desktopRegistry[$parts[0]] = $parts[1] }
  }
  Assert-Condition ($desktopRegistry['User'] -eq $env:USERNAME) 'Desktop registry evidence belongs to another user.'
  Assert-Condition ($desktopRegistry['AppKey'] -eq 'df0635bf-66e1-510a-b0e5-9ed63f670162') 'Desktop registry evidence belongs to another application.'
  Assert-Condition (!$desktopRegistry['HKLM64.Version'] -and !$desktopRegistry['HKLM32.Version']) 'Unexpected machine-wide installation.'
  $recoveryPath = Join-Path $env:APPDATA 'pmcanvas-desktop\recovery.json'
  $recoveryBefore = @($baseline.PreserveFiles | Where-Object { $_.Path -eq $recoveryPath })
  Assert-Condition ($recoveryBefore.Count -eq 1) 'Missing recovery baseline.'
  Assert-Condition (($desktopRegistry['Recovery.Exists'] -eq '1') -eq $recoveryBefore[0].Exists) 'Desktop recovery existence differs from the baseline.'
  if ($recoveryBefore[0].Exists) {
    Assert-Condition ($desktopRegistry['Recovery.SHA256'] -eq $recoveryBefore[0].SHA256) 'Desktop recovery content differs from the baseline.'
  }
  if ($desktopRegistry['Project.Path']) {
    $projectBefore = @($baseline.PreserveFiles | Where-Object { $_.Path -eq $desktopRegistry['Project.Path'] })
    Assert-Condition ($projectBefore.Count -eq 1 -and $desktopRegistry['Project.SHA256'] -eq $projectBefore[0].SHA256) 'Desktop project content differs from the baseline.'
  }
  $entries = @()
  if ($desktopRegistry['HKCU64.Version']) {
    $entries = @([PSCustomObject]@{
      Scope = 'user'
      Key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\df0635bf-66e1-510a-b0e5-9ed63f670162'
      DisplayName = $desktopRegistry['HKCU64.DisplayName']
      DisplayVersion = $desktopRegistry['HKCU64.Version']
      UninstallString = $desktopRegistry['HKCU64.UninstallString']
    })
  }
  $checks += 'Registry checked using fresh evidence from the Windows desktop user context.'
}
$installKeys = @(@($baseline.Registered) + @($entries) | ForEach-Object {
  $guid = ($_.Key -split '\\')[-1]
  if ($guid -match '^[0-9a-f-]{36}$') {
    $hive = $(if ($_.Scope -eq 'user') { 'HKCU:' } else { 'HKLM:' })
    Join-Path $hive ('Software\' + $guid)
  }
} | Select-Object -Unique)

foreach ($before in $baseline.PreserveFiles) {
  $after = Get-FileEvidence $before.Path
  Assert-Condition ($after.Exists -eq $before.Exists) "Preserved file existence changed: $($before.Path)"
  Assert-Condition ($after.SHA256 -eq $before.SHA256) "Preserved file content changed: $($before.Path)"
}
$checks += 'Project and recovery files match baseline SHA-256.'

if ($Mode -eq 'Installed') {
  foreach ($file in @($executable, $uninstaller, $archive)) {
    Assert-Condition (Test-Path -LiteralPath $file -PathType Leaf) "Missing installed file: $file"
  }
  Assert-Condition ($entries.Count -eq 1) 'Expected exactly one registered installation.'
  Assert-Condition ($entries[0].Scope -eq 'user') 'Expected a per-user installation.'
  Assert-Condition ($entries[0].DisplayVersion -eq $expectedVersion) 'Installed version differs from package.json.'
  Assert-Condition ($entries[0].UninstallString -like ('"' + $uninstaller + '"*')) 'Uninstall registration points to another directory.'
  Assert-Condition ($installKeys.Count -gt 0) 'Missing installer identity.'
  foreach ($installKey in $installKeys) {
    $location = $(if ($desktopRegistry) { $desktopRegistry['HKCU64.Location'] } else { (Get-ItemProperty -LiteralPath $installKey -ErrorAction Stop).InstallLocation })
    Assert-Condition ($location -eq $InstallDirectory) 'Installation location registration points to another directory.'
  }
  Assert-Condition ((Get-FileHash -LiteralPath $archive).Hash -eq (Get-FileHash -LiteralPath $expectedArchive).Hash) 'Installed ASAR differs from the built package.'
  $checks += 'Installed files, per-user registration, version and ASAR checksum are correct.'
  $shell = New-Object -ComObject WScript.Shell
  foreach ($link in $linkPaths) {
    Assert-Condition (Test-Path -LiteralPath $link -PathType Leaf) "Missing shortcut: $link"
    $shortcut = $shell.CreateShortcut($link)
    Assert-Condition ($shortcut.TargetPath -eq $executable) "Shortcut targets another executable: $link"
    Assert-Condition ($shortcut.WorkingDirectory -eq $InstallDirectory) "Shortcut working directory differs: $link"
  }
  $checks += 'Desktop and Start menu shortcuts target the installed executable.'
} else {
  Assert-Condition (!(Test-Path -LiteralPath $InstallDirectory)) 'Installation directory remains after removal.'
  Assert-Condition ($entries.Count -eq 0) 'Uninstall registry entries remain after removal.'
  foreach ($installKey in $installKeys) {
    if ($desktopRegistry) {
      Assert-Condition ($desktopRegistry['NativeRegOpen.Result'] -eq '2') 'Desktop uninstall registry key remains.'
      Assert-Condition ($desktopRegistry['LiveRoot.View64'] -eq '2' -and $desktopRegistry['LiveRoot.View32'] -eq '2') 'Desktop uninstall registry key remains in a registry view.'
      Assert-Condition ($desktopRegistry['LocationRegOpen.Result'] -eq '2') 'Desktop installation location registry key remains.'
    } else {
      Assert-Condition (!(Test-Path -LiteralPath $installKey)) "Installation location registry key remains: $installKey"
    }
  }
  foreach ($link in $linkPaths) {
    Assert-Condition (!(Test-Path -LiteralPath $link)) "Shortcut remains after removal: $link"
  }
  $checks += 'Installation directory, uninstall registration and shortcuts have been removed.'
}

$result = [PSCustomObject]@{
  Mode = $Mode
  CheckedAt = [DateTime]::UtcNow.ToString('o')
  InstallDirectory = $InstallDirectory
  RegistrySource = $(if ($desktopRegistry) { 'windows-explorer-probe' } else { 'direct-registry' })
  RegistryEvidenceSHA256 = $(if ($desktopRegistry) { (Get-FileHash -LiteralPath $RegistryEvidence -Algorithm SHA256).Hash } else { $null })
  Checks = $checks
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath ($Snapshot + '.' + $Mode + '.json') -Encoding UTF8
$checks | ForEach-Object { Write-Output "PASS: $_" }
