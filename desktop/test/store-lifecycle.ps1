$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or !$env:RUNNER_TEMP -or $env:GITHUB_RUN_ID -notmatch '^\d+$') { throw 'Disposable GitHub Windows runner required.' }
$desktopRoot = Split-Path $PSScriptRoot -Parent
$package = Get-Content -LiteralPath (Join-Path $desktopRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$output = Join-Path $desktopRoot ('dist/store-' + $package.version + '-win')
$evidence = Get-Content -LiteralPath (Join-Path $output 'store-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$identity = 'PMCanvas.CITest.' + $env:GITHUB_RUN_ID
if ($evidence.intendedFor -ne 'ci-test-only' -or $evidence.identity.identityName -ne $identity) { throw 'Only CI fixture packages may be installed.' }
if (Get-AppxPackage -Name $identity) { throw 'Preserve an existing package.' }
foreach ($name in @('pmcanvas-desktop', 'PM Canvas Desktop')) {
  if (Test-Path -LiteralPath (Join-Path $env:APPDATA $name)) { throw 'Preserve pre-existing user data.' }
}
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\df0635bf-66e1-510a-b0e5-9ed63f670162'
if (Test-Path -LiteralPath $registry) { throw 'Preserve an existing NSIS installation.' }
$work = Join-Path $env:RUNNER_TEMP ('pmcanvas-msix-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$expected = Join-Path $work 'expected.json'
$node = (Get-Command node.exe).Source
$controller = Join-Path $PSScriptRoot 'store-installed.mjs'
$checks = [Collections.Generic.List[string]]::new()
$cert = $null
function Check-Exit { if ($LASTEXITCODE -ne 0) { throw "Command failed: $LASTEXITCODE" } }
function Check-Preserved {
  $data = Get-Content -LiteralPath $expected -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($file in $data.hashes) {
    if ((Get-FileHash -LiteralPath $file.file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw 'Project/recovery/preferences changed during MSIX servicing.' }
  }
}
function Run-App($exe, $mode, $version, $registered) {
  Write-Output ('Store lifecycle: app ' + $mode + ', registered=' + $registered + ', version=' + $version)
  $request = Join-Path $work ('request-' + [guid]::NewGuid().ToString('N') + '.json')
  $result = $request + '.result.json'
  # Windows' package broker does not inherit the caller's GITHUB_* environment.
  # Forward only these non-secret CI markers, never tokens or signing credentials.
  $ciContext = @{ CI='true'; GITHUB_ACTIONS='true'; GITHUB_RUN_ID=$env:GITHUB_RUN_ID; RUNNER_TEMP=$env:RUNNER_TEMP; RUNNER_ENVIRONMENT=$env:RUNNER_ENVIRONMENT }
  @{ executable=$exe; mode=$mode; version=$version; expected=$expected; work=$work; ci=$ciContext } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $request -Encoding UTF8
  # Node JSON.parse does not accept a UTF8 BOM.
  [IO.File]::WriteAllText($request, (Get-Content -LiteralPath $request -Raw -Encoding UTF8), [Text.UTF8Encoding]::new($false))
  if ($registered) {
    $registeredPackage = Get-AppxPackage -Name $identity
    Invoke-CommandInDesktopPackage -PackageFamilyName $registeredPackage.PackageFamilyName -AppId 'PMCanvas' -Command $node -Args ('"' + $controller + '" "' + $request + '" "' + $result + '"') -PreventBreakaway
  } else {
    & $node $controller $request $result
    Check-Exit
  }
  $deadline = (Get-Date).AddSeconds(150)
  while (!(Test-Path -LiteralPath $result)) { if ((Get-Date) -gt $deadline) { throw 'Installed app test timed out.' }; Start-Sleep -Milliseconds 250 }
  $testResult = Get-Content -LiteralPath $result -Raw -Encoding UTF8 | ConvertFrom-Json
  if (!$testResult.ok) { throw $testResult.error }
}
try {
  Write-Output 'Store lifecycle: download and seed legacy installer'
  $baseline = Join-Path $work 'PMCanvas-Desktop-0.7.1-Windows-x64.exe'
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/jhoon-dev/PMCanvas/releases/download/desktop-v0.7.1/PMCanvas-Desktop-0.7.1-Windows-x64.exe' -OutFile $baseline
  if ((Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash.ToLowerInvariant() -ne '82ca271d86dff7e87a7e1d47850d378aae817994cc2ed168b79e0e89d7c6666c') { throw 'Baseline hash mismatch.' }
  $legacy = Join-Path $work 'legacy'
  Start-Process -FilePath $baseline -ArgumentList @('/S', '/currentuser', ('/D=' + $legacy)) -Wait -WindowStyle Hidden
  Run-App (Join-Path $legacy 'PM Canvas Desktop.exe') 'seed' '0.7.1' $false
  $checks.Add('Installed pinned NSIS 0.7.1 and saved Korean tasks, hierarchy, baseline, language and time zone.')
  $tools = Get-Content -LiteralPath (Join-Path $output 'ci-tools.json') -Raw | ConvertFrom-Json
  $makeappx = Join-Path $tools.kit 'makeappx.exe'
  $signtool = Join-Path $tools.kit 'signtool.exe'
  $file = Join-Path $output $evidence.artifacts[0].name
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $evidence.artifacts[0].sha256) { throw 'MSIX hash mismatch.' }
  $payload = Join-Path $work 'old-payload'
  Write-Output 'Store lifecycle: prepare lower-version MSIX servicing fixture'
  & $makeappx unpack /p $file /d $payload /q
  Check-Exit
  $manifestFile = Join-Path $payload 'AppxManifest.xml'
  [xml]$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8
  $manifest.Package.Identity.Version = '1.0.0.0'
  [IO.File]::WriteAllText($manifestFile, $manifest.OuterXml, [Text.UTF8Encoding]::new($false))
  foreach ($name in @('AppxBlockMap.xml', '[Content_Types].xml', 'AppxSignature.p7x')) { Remove-Item -LiteralPath (Join-Path $payload $name) -Force -ErrorAction SilentlyContinue }
  $old = Join-Path $work 'previous.msix'
  & $makeappx pack /d $payload /p $old /h SHA256 /q
  Check-Exit
  $new = Join-Path $work 'current.msix'
  Copy-Item -LiteralPath $file -Destination $new
  # A disposable CI-only certificate, never a public release signing identity.
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $evidence.identity.publisher -CertStoreLocation 'Cert:\CurrentUser\My' -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(2)
  $publicCert = Join-Path $work 'ci.cer'
  Export-Certificate -Cert $cert -FilePath $publicCert | Out-Null
  Import-Certificate -FilePath $publicCert -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople' | Out-Null
  foreach ($item in @($old, $new)) { & $signtool sign /fd SHA256 /s My /sha1 $cert.Thumbprint $item; Check-Exit }
  Write-Output 'Store lifecycle: register first MSIX'
  Add-AppxPackage -Path $old
  Check-Preserved
  $installed = Get-AppxPackage -Name $identity
  Run-App (Join-Path $installed.InstallLocation 'app\PM Canvas Desktop.exe') 'check' $package.version $true
  $checks.Add('Migrated the NSIS profile to a registered MSIX and verified Store identity, data and Excel export.')
  Write-Output 'Store lifecycle: update MSIX'
  Add-AppxPackage -Path $new
  Check-Preserved
  $installed = Get-AppxPackage -Name $identity
  Run-App (Join-Path $installed.InstallLocation 'app\PM Canvas Desktop.exe') 'check' $package.version $true
  $checks.Add('Updated MSIX package version while preserving external project, recovery, preferences and language.')
  Write-Output 'Store lifecycle: remove MSIX'
  Get-AppxPackage -Name $identity | Remove-AppxPackage
  Check-Preserved
  $checks.Add('Removed MSIX without deleting legacy profile or external projects.')
  Write-Output 'Store lifecycle: reinstall MSIX'
  Add-AppxPackage -Path $new
  Check-Preserved
  $installed = Get-AppxPackage -Name $identity
  Run-App (Join-Path $installed.InstallLocation 'app\PM Canvas Desktop.exe') 'check' $package.version $true
  $checks.Add('Reinstalled MSIX and reopened the same project and settings with Store update routing.')
  $report = @{ version=$package.version; commit=$evidence.commit; packageVersion=$evidence.packageVersion; mode='ci-test-only'; msixSha256=$evidence.artifacts[0].sha256; checks=$checks.ToArray(); verifiedAt=(Get-Date).ToUniversalTime().ToString('o') }
  [IO.File]::WriteAllText((Join-Path $desktopRoot 'test-results/store-install-validation.json'), ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
  $checks | ForEach-Object { Write-Output ('PASS: ' + $_) }
} finally {
  Get-AppxPackage -Name $identity | Remove-AppxPackage -ErrorAction Continue
  if ($cert) {
    foreach ($store in @('Cert:\CurrentUser\My', 'Cert:\LocalMachine\TrustedPeople')) { Remove-Item -LiteralPath (Join-Path $store $cert.Thumbprint) -Force -ErrorAction SilentlyContinue }
  }
  # The disposable runner is torn down after the job; host profiles are never recursively removed.
}
