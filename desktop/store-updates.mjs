import { execFile } from 'node:child_process';
import path from 'node:path';

// Read-only Store discovery. Installation remains in the Store's own consent UI.
const script = `
$ErrorActionPreference='Stop'
$stage='runtime'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null=[Windows.Services.Store.StoreContext,Windows.Services.Store,ContentType=WindowsRuntime]
  $null=[Windows.Services.Store.StorePackageUpdate,Windows.Services.Store,ContentType=WindowsRuntime]
  $stage='identity'
  $package=[Windows.ApplicationModel.Package,Windows.ApplicationModel,ContentType=WindowsRuntime]::Current
  $stage='query'
  $context=[Windows.Services.Store.StoreContext]::GetDefault()
  $resultType=[System.Collections.Generic.IReadOnlyList[Windows.Services.Store.StorePackageUpdate]]
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  } | Select-Object -First 1
  $operation=$context.GetAppAndOptionalStorePackageUpdatesAsync()
  $task=$method.MakeGenericMethod($resultType).Invoke($null,@($operation))
  if(!$task.Wait(12000)) { throw 'Store query timed out' }
  $main=@($task.Result | Where-Object { $_.Package.Id.FamilyName -eq $package.Id.FamilyName })
  if($main.Count -gt 0) { [Console]::Out.Write('{"supported":true,"available":true}') }
  else { [Console]::Out.Write('{"supported":true,"available":false}') }
} catch { [Console]::Out.Write('{"supported":false,"available":false,"reason":"'+$stage+'"}') }
`;

export async function checkStoreUpdates({
  packaged = process.windowsStore,
  platform = process.platform,
  run = execFile,
} = {}) {
  if (!packaged || platform !== 'win32') return { supported: false, available: false };
  return new Promise((resolve, reject) => {
    run(
      path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-MTA',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      { windowsHide: true, timeout: 20000, maxBuffer: 16384, encoding: 'utf8' },
      (error, stdout) => {
        if (error) return reject(Error('Store update check unavailable.'));
        try {
          const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
          if (typeof result.supported !== 'boolean' || typeof result.available !== 'boolean')
            throw Error();
          resolve(result);
        } catch {
          reject(Error('Invalid Store update response.'));
        }
      },
    );
  });
}
