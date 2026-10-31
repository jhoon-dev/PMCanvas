import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const mobile = fileURLToPath(new URL('../', import.meta.url));
const device = process.argv[2];
let simulator;
const output = path.join(mobile, 'build/store-screenshots-' + device);
const result = path.join(mobile, 'build/Store-' + device + '.xcresult');
const attachments = path.join(mobile, 'build/Store-' + device + '-attachments');
const run = (command, args, capture = false) =>
  execFileSync(command, args, {
    cwd: mobile,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 32 * 1024 * 1024,
  });
try {
  if (
    process.platform !== 'darwin' ||
    !['iphone', 'ipad'].includes(device) ||
    process.argv.length !== 3
  )
    throw Error('Capture native Store screenshots on macOS for iphone or ipad.');
  if (fs.existsSync(output)) throw Error('Preserve the previous Store screenshots.');
  fs.mkdirSync(output, { recursive: true });
  const available = JSON.parse(
    run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], true),
  ).devices;
  const choices = Object.entries(available)
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, items]) =>
      items.filter((d) => d.isAvailable && d.deviceTypeIdentifier).map((d) => ({ runtime, ...d })),
    );
  const selected =
    device === 'iphone'
      ? choices.find((d) => d.name === 'iPhone 17 Pro') ||
        choices.find((d) => /^iPhone (?:16|15) Pro$/.test(d.name))
      : choices.find((d) => /iPad (?:Pro|Air).*13-inch|iPad Pro.*12\.9/.test(d.name));
  if (!selected) throw Error('An App Store screenshot size simulator is not installed.');
  simulator = run(
    'xcrun',
    [
      'simctl',
      'create',
      'PMCanvas Store ' + device + ' ' + Date.now(),
      selected.deviceTypeIdentifier,
      selected.runtime,
    ],
    true,
  ).trim();
  if (!/^[A-F0-9-]{36}$/i.test(simulator)) throw Error('Invalid simulator identifier.');
  run('xcrun', ['simctl', 'bootstatus', simulator, '-b']);
  run('xcrun', [
    'simctl',
    'status_bar',
    simulator,
    'override',
    '--time',
    '9:41',
    '--batteryState',
    'charged',
    '--batteryLevel',
    '100',
    '--wifiMode',
    'active',
    '--wifiBars',
    '3',
  ]);
  run('xcodebuild', [
    '-project',
    'ios/App/App.xcodeproj',
    '-scheme',
    'App',
    '-onlyUsePackageVersionsFromResolvedFile',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'id=' + simulator,
    '-derivedDataPath',
    'build/StoreDerivedData-' + device,
    '-parallel-testing-enabled',
    'NO',
    '-only-testing:AppUITests/AppUITests/testStoreScreenshots',
    '-resultBundlePath',
    result,
    'CODE_SIGNING_ALLOWED=NO',
    'test',
  ]);
  run('xcrun', [
    'xcresulttool',
    'export',
    'attachments',
    '--path',
    result,
    '--output-path',
    attachments,
  ]);
  const manifest = JSON.parse(fs.readFileSync(path.join(attachments, 'manifest.json')));
  const files = manifest.flatMap((test) => test.attachments || []);
  const screenshots = [];
  for (const [index, name] of ['overview', 'tasks', 'checklist', 'people'].entries()) {
    const item = files.find(
      (a) =>
        a.suggestedHumanReadableName?.startsWith('Store ' + name + '_') &&
        !a.isAssociatedWithFailure,
    );
    if (!item || path.basename(item.exportedFileName) !== item.exportedFileName)
      throw Error('Missing native screenshot: ' + name);
    const file = String(index + 1).padStart(2, '0') + '-' + name + '.jpg';
    run('sips', [
      '-s',
      'format',
      'jpeg',
      '-s',
      'formatOptions',
      '95',
      path.join(attachments, item.exportedFileName),
      '--out',
      path.join(output, file),
    ]);
    const dimensions = run(
      'sips',
      ['-g', 'pixelWidth', '-g', 'pixelHeight', path.join(output, file)],
      true,
    );
    const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]),
      height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
    const allowed = device === 'iphone' ? ['1179x2556', '1206x2622'] : ['2064x2752', '2048x2732'];
    if (!allowed.includes(width + 'x' + height))
      throw Error('Native screenshot has an unsupported App Store size.');
    screenshots.push({
      file,
      width,
      height,
      sha256: createHash('sha256')
        .update(fs.readFileSync(path.join(output, file)))
        .digest('hex'),
    });
  }
  fs.writeFileSync(
    path.join(output, 'screenshots.json'),
    JSON.stringify(
      {
        commit: run('git', ['rev-parse', 'HEAD'], true).trim(),
        device,
        simulatorName: selected.name,
        nativeUITest: true,
        nativeCapture: true,
        formatConversionOnly: true,
        format: 'JPEG',
        screenshots,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: native ' + device + ' Store screenshots, project creation and relaunch persistence.',
  );
} catch (error) {
  if (fs.existsSync(result))
    try {
      run('xcrun', [
        'xcresulttool',
        'export',
        'attachments',
        '--path',
        result,
        '--output-path',
        path.join(output, 'failure-attachments'),
      ]);
    } catch {}
  if (simulator)
    try {
      run('xcrun', ['simctl', 'io', simulator, 'screenshot', path.join(output, 'failure.png')]);
    } catch {}
  console.error(
    error.status
      ? 'Native Store screenshot verification failed. Review Xcode output.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (simulator && /^[A-F0-9-]{36}$/i.test(simulator)) {
    try {
      run('xcrun', ['simctl', 'shutdown', simulator], true);
    } catch {}
    try {
      run('xcrun', ['simctl', 'delete', simulator], true);
    } catch {}
  }
}
