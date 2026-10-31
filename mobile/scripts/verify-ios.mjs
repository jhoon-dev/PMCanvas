import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mobile = fileURLToPath(new URL('../', import.meta.url));
const build = path.join(mobile, 'build');
let simulator;
function run(command, args, capture = false) {
  return execFileSync(command, args, {
    cwd: mobile,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 16 * 1024 * 1024,
  });
}
try {
  if (process.platform !== 'darwin') throw Error('Run iPhone native verification on macOS.');
  fs.mkdirSync(build, { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(mobile, 'capacitor.config.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(mobile, 'package.json')));
  const devices = JSON.parse(
    run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], true),
  ).devices;
  const found = Object.entries(devices)
    .filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([runtime, devices]) =>
      devices
        .filter((d) => d.isAvailable && d.name.startsWith('iPhone') && d.deviceTypeIdentifier)
        .map((device) => ({ runtime, device })),
    )[0];
  if (!found) throw Error('Install an iOS simulator runtime with an available iPhone device.');
  simulator = run(
    'xcrun',
    [
      'simctl',
      'create',
      'PMCanvas CI ' + Date.now(),
      found.device.deviceTypeIdentifier,
      found.runtime,
    ],
    true,
  ).trim();
  if (!/^[A-F0-9-]{36}$/i.test(simulator)) throw Error('Invalid simulator identifier.');
  run('xcrun', ['simctl', 'bootstatus', simulator, '-b']);
  const common = [
    '-project',
    'ios/App/App.xcodeproj',
    '-scheme',
    'App',
    '-derivedDataPath',
    'build/DerivedData',
    'CODE_SIGNING_ALLOWED=NO',
  ];
  run('xcodebuild', [
    ...common,
    '-sdk',
    'iphonesimulator',
    '-destination',
    'id=' + simulator,
    '-parallel-testing-enabled',
    'NO',
    '-resultBundlePath',
    'build/iPhoneTests.xcresult',
    'test',
  ]);
  run('xcrun', [
    'xcresulttool',
    'export',
    'attachments',
    '--path',
    'build/iPhoneTests.xcresult',
    '--output-path',
    'build/iPhone-test-attachments',
  ]);
  run('xcodebuild', [
    ...common,
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=iOS',
    '-archivePath',
    'build/PMCanvas-iPhone.xcarchive',
    'archive',
  ]);
  const archive = path.join(build, 'PMCanvas-iPhone.xcarchive');
  const app = path.join(archive, 'Products/Applications/App.app');
  const bundleId = run(
    'plutil',
    ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Info.plist')],
    true,
  ).trim();
  if (bundleId !== config.appId) throw Error('Unexpected iPhone bundle identifier.');
  if (!fs.existsSync(path.join(app, 'PrivacyInfo.xcprivacy')))
    throw Error('Privacy manifest missing from iPhone app.');
  for (const [source, name] of [
    [archive, 'PMCanvas-iPhone-unsigned-archive.zip'],
    [
      path.join(build, 'DerivedData/Build/Products/Debug-iphonesimulator/App.app'),
      'PMCanvas-iPhone-simulator.zip',
    ],
    [path.join(build, 'iPhoneTests.xcresult'), 'PMCanvas-iPhone-native-tests.zip'],
    [path.join(build, 'iPhone-test-attachments'), 'PMCanvas-iPhone-screenshots.zip'],
  ])
    run('ditto', ['-c', '-k', '--keepParent', source, path.join(build, name)]);
  fs.writeFileSync(
    path.join(build, 'ios-verification.json'),
    JSON.stringify(
      {
        bundleId,
        version: pkg.version,
        commit: run('git', ['rev-parse', 'HEAD'], true).trim(),
        nativeSimulatorTest: true,
        deviceArchive: true,
        signed: false,
        uploaded: false,
        published: false,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'PASS: native iPhone project creation, policy, relaunch persistence and unsigned device archive. Not a Store submission.',
  );
} catch (error) {
  console.error(
    error.status ? 'iPhone native verification failed. Review Xcode output.' : error.message,
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
