param(
    [ValidatePattern('^[A-Za-z0-9_-]+$')]
    [string]$AvdName = 'PMCanvasAOSP35',
    [ValidateRange(5554, 5682)]
    [int]$Port = 5566,
    [ValidateRange(1, 8)]
    [int]$Cores = 1,
    [ValidateRange(1, 10)]
    [int]$HardwareTimeoutMultiplier = 1,
    [ValidateRange(0, 10000000)]
    [long]$TscKhz = 0,
    [string]$EmulatorPath = '',
    [switch]$Visible
)

$ErrorActionPreference = 'Stop'
if ($Port % 2) { throw 'Use an even emulator console port.' }
if ($TscKhz -gt 0 -and $TscKhz -lt 500000) {
    throw 'TscKhz must be the measured host TSC frequency in kHz, or zero to use the AVD defaults.'
}
$taskRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else {
    Join-Path $env:LOCALAPPDATA 'Android/Sdk'
}
$taskAdb = Join-Path $taskSdk 'platform-tools/adb.exe'
if (-not (Test-Path -LiteralPath $taskAdb)) { throw "Android SDK platform-tools not found: $taskAdb" }
if (-not $EmulatorPath) {
    $taskFixedEmulator = Join-Path $taskRepo 'test-results/android-emulator/emulator-37.3.6/emulator/emulator.exe'
    $EmulatorPath = if (Test-Path -LiteralPath $taskFixedEmulator) { $taskFixedEmulator } else {
        Join-Path $taskSdk 'emulator/emulator.exe'
    }
}
if (-not (Test-Path -LiteralPath $EmulatorPath)) { throw "Emulator not found: $EmulatorPath" }
$taskSerial = "emulator-$Port"
$taskDevices = & $taskAdb devices
if ($taskDevices -match "^$taskSerial\s+device$") {
    $taskRunningName = (& $taskAdb -s $taskSerial emu avd name | Select-Object -First 1).Trim()
    if ($taskRunningName -ne $AvdName) { throw "$taskSerial is already running AVD $taskRunningName." }
    if ($HardwareTimeoutMultiplier -gt 1) {
        $taskRunningMultiplier = (& $taskAdb -s $taskSerial shell getprop ro.hw_timeout_multiplier).Trim()
        if ($taskRunningMultiplier -ne "$HardwareTimeoutMultiplier") {
            throw 'The running AVD has different runtime timeout settings. Stop it and restart with the requested options.'
        }
    }
    Write-Output "$AvdName is already running as $taskSerial."
    return
}
if ($taskDevices -match "^$taskSerial\s+") { throw "$taskSerial is still starting or stopping. Wait before retrying." }

$env:ANDROID_HOME = $taskSdk
$env:ANDROID_SDK_ROOT = $taskSdk
$taskLogDir = Join-Path $taskRepo 'mobile/test-results/emulator'
New-Item -ItemType Directory -Force -Path $taskLogDir | Out-Null
$taskStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$taskStdout = Join-Path $taskLogDir "$AvdName-$taskStamp.stdout.log"
$taskStderr = Join-Path $taskLogDir "$AvdName-$taskStamp.stderr.log"
$taskArgs = @(
    '-avd', $AvdName, '-port', $Port, '-cores', $Cores,
    '-no-snapshot', '-no-audio', '-no-boot-anim',
    '-logcat', '*:S',
    '-gpu', 'swiftshader', '-feature', '-Vulkan', '-timezone', 'Asia/Seoul'
)
$taskWindowStyle = 'Hidden'
if ($Visible) { $taskWindowStyle = 'Normal' } else { $taskArgs += '-no-window' }
if ($TscKhz -gt 0) {
    $taskArgs += @('-qemu', '-append', "`"tsc=reliable tsc_early_khz=$TscKhz clocksource=tsc quiet loglevel=0`"")
}
$taskProcess = Start-Process -FilePath $EmulatorPath -ArgumentList $taskArgs -PassThru `
    -WindowStyle $taskWindowStyle -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr
Write-Output "Started $AvdName as $taskSerial (PID $($taskProcess.Id))."
Write-Output "Logs: $taskStdout"
if ($HardwareTimeoutMultiplier -gt 1) {
    & $taskAdb -s $taskSerial wait-for-device
    $taskDebuggable = (& $taskAdb -s $taskSerial shell getprop ro.debuggable).Trim()
    if ($taskDebuggable -ne '1') { throw 'Custom runtime timeouts require a debuggable test AVD.' }
    & $taskAdb -s $taskSerial shell su 0 setprop ro.hw_timeout_multiplier $HardwareTimeoutMultiplier
    $taskMultiplier = (& $taskAdb -s $taskSerial shell getprop ro.hw_timeout_multiplier).Trim()
    if ($taskMultiplier -ne "$HardwareTimeoutMultiplier") { throw 'Could not configure the test runtime timeout multiplier.' }
    & $taskAdb -s $taskSerial shell su 0 setprop sys.boot_completed 0
    if ($LASTEXITCODE -ne 0) { throw 'Could not reset the runtime startup guard.' }
    & $taskAdb -s $taskSerial shell su 0 setprop ctl.restart zygote
    if ($LASTEXITCODE -ne 0) { throw 'Could not restart the test Android runtime.' }
    Write-Output "Restarted the test runtime with hardware timeout multiplier $taskMultiplier."
}
Write-Output "After Android finishes booting: `$env:PM_ANDROID_SERIAL='$taskSerial'; npm run test:android"
