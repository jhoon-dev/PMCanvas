import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { url as inspectorUrl } from 'node:inspector';
import {
  X509Certificate,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto';

export const REPOSITORY = 'jhoon-dev/PMCanvas';
const githubRepository = 'github.com/' + REPOSITORY;
export const ENVIRONMENT = 'desktop-release';
export const APPLE_CERTIFICATES = 'https://developer.apple.com/account/resources/certificates/list';
export const APPLE_AUTHORITIES = Object.freeze([
  {
    file: 'DeveloperIDG2CA.cer',
    sha256: 'f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a',
  },
  {
    file: 'DeveloperIDCA.cer',
    sha256: '7afc9d01a62f03a2de9637936d4afe68090d2de18d03f29c88cfb0b1ba63587f',
  },
]);
export class SetupError extends Error {}
const fail = (message) => {
  throw new SetupError(message);
};
export const digest = (data) => createHash('sha256').update(data).digest('hex');

export function requirePrivateRuntime() {
  if (
    Object.entries(process.env).some(
      ([name, value]) => /^(?:NODE_DEBUG|NODE_OPTIONS|NODE_V8_COVERAGE)$/i.test(name) && value,
    ) ||
    inspectorUrl() ||
    process.execArgv.some(
      (arg) =>
        /^(?:-r|--(?:inspect(?:-brk|-wait)?|debug(?:-brk)?|trace-events-enabled|require|import|loader|experimental-loader|heapsnapshot-signal|heap-prof|cpu-prof|report-on-fatalerror|report-on-signal|report-uncaught-exception))(?:=|$)/.test(
          arg,
        ) || /^--heapsnapshot-near-heap-limit=[1-9]/.test(arg),
    )
  )
    fail('Node 디버그·추적 설정을 해제한 새 터미널에서 실행하세요. 비밀값 입력 전에 중단했습니다.');
}

// Never forward external command output/errors: they can contain credentials or environment data.
export function quietRun(
  binary,
  args,
  { input, secrets = {}, cwd, label = '명령 실행 실패', timeout = 120000, spawn = spawnSync } = {},
) {
  // NODE_DEBUG=child_process logs spawn options in this parent process, before child env filtering.
  requirePrivateRuntime();
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(?:NODE_OPTIONS|NODE_DEBUG|GH_DEBUG|DEBUG|GIT_TRACE.*|GIT_CURL_VERBOSE|OPENSSL_TRACE|SSLKEYLOGFILE|CSC_.*|WIN_CSC_.*|MAC_CSC_.*|APPLE_.*|PM_SIGNING_.*)$/i.test(
          key,
        ),
    ),
  );
  Object.assign(env, secrets);
  const bytes = input === undefined ? undefined : Buffer.from(input);
  let result;
  try {
    result = spawn(binary, args, {
      env,
      cwd,
      input: bytes,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      result.stdout?.fill(0);
      fail(label);
    }
    return result.stdout || Buffer.alloc(0);
  } catch {
    fail(label);
  } finally {
    bytes?.fill(0);
    result?.stderr?.fill(0);
    for (const key of Object.keys(secrets)) delete env[key];
  }
}

export function opensslPath() {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git/usr/bin/openssl.exe'),
          'openssl.exe',
        ]
      : [
          '/opt/homebrew/opt/openssl@3/bin/openssl',
          '/usr/local/opt/openssl@3/bin/openssl',
          'openssl',
        ];
  for (const candidate of candidates)
    try {
      if (/^OpenSSL 3\./.test(quietRun(candidate, ['version']).toString())) return candidate;
    } catch {}
  fail('OpenSSL 3을 찾지 못했습니다. Git for Windows 설치를 확인하세요.');
}

export function password(value) {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{16,128}$/.test(value))
    fail('암호는 공백 없이 영문·숫자·기호 16~128자로 입력하세요.');
  return value;
}

// Every component is checked: worktrees, junctions and a repository above the chosen folder count.
export function privatePath(file, { directory = false, max = 65536 } = {}) {
  if (!path.isAbsolute(file) || (process.platform === 'win32' && !/^[a-z]:\\/i.test(file)))
    fail('로컬 절대 경로를 선택하세요.');
  let current = path.resolve(file);
  const stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) fail('심볼릭 링크·정션 경로는 사용할 수 없습니다.');
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1 || stat.size > max)
    fail('일반 파일 또는 작업 폴더만 사용할 수 있습니다.');
  while (true) {
    if (fs.lstatSync(current).isSymbolicLink()) fail('심볼릭 링크·정션 경로는 사용할 수 없습니다.');
    if (fs.existsSync(path.join(current, '.git')))
      fail('서명 자료는 Git 저장소 밖에 보관해야 합니다.');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(file);
}

export function secureDirectory(folder, create = false) {
  privatePath(folder, { directory: true });
  if (process.platform === 'win32') {
    const sid = quietRun('whoami.exe', ['/user', '/fo', 'csv', '/nh'])
      .toString()
      .match(/S-1-[0-9-]+/)?.[0];
    if (!sid) fail('현재 Windows 사용자 SID를 확인할 수 없습니다.');
    const script = `
$ErrorActionPreference="Stop"
$sid=[System.Security.Principal.SecurityIdentifier]::new($env:PM_SIGNING_SID)
if($env:PM_SIGNING_CREATE -eq "true") {
  $new=[System.Security.AccessControl.DirectorySecurity]::new()
  $new.SetAccessRuleProtection($true,$false)
  $new.SetOwner($sid)
  $rule=[System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid,[System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.InheritanceFlags]"ContainerInherit,ObjectInherit",
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow)
  $new.AddAccessRule($rule)
  [IO.Directory]::SetAccessControl($env:PM_SIGNING_FOLDER,$new)
}
$a=[IO.Directory]::GetAccessControl($env:PM_SIGNING_FOLDER)
if (!$a.AreAccessRulesProtected) { exit 1 }
$ok=$false
foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
  if($r.AccessControlType -ne "Allow" -or $r.IdentityReference.Value -ne $env:PM_SIGNING_SID) { exit 1 }
  $full=[System.Security.AccessControl.FileSystemRights]::FullControl
  if(($r.FileSystemRights -band $full) -eq $full) { $ok=$true }
}
if(!$ok) { exit 1 }
`;
    quietRun(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        secrets: {
          PM_SIGNING_FOLDER: folder,
          PM_SIGNING_SID: sid,
          PM_SIGNING_CREATE: String(create),
        },
        label: '작업 폴더가 현재 사용자 전용이 아닙니다. 권한을 확인하세요.',
      },
    );
  } else {
    if (create) fs.chmodSync(folder, 0o700);
    if ((fs.statSync(folder).mode & 0o077) !== 0)
      fail('작업 폴더 권한은 사용자 전용이어야 합니다.');
  }
}

export function newWorkspace(base) {
  privatePath(base, { directory: true });
  const folder = fs.mkdtempSync(path.join(base, 'PMCanvas-MacSigning-'));
  secureDirectory(folder, true);
  return folder;
}

export function saveNew(file, bytes) {
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
}
const read = (file, max = 65536) => fs.readFileSync(privatePath(file, { max }));
const stateFile = (folder) => path.join(folder, 'state.json');
export function session(folder) {
  secureDirectory(folder);
  const state = JSON.parse(read(stateFile(folder)).toString());
  if (
    state.tool !== 'PMCanvas Mac signing' ||
    state.version !== 1 ||
    !/^[a-f0-9]{64}$/.test(state.keySha256 || '') ||
    !/^[a-f0-9]{64}$/.test(state.csrSha256 || '')
  )
    fail('이 도구로 만든 작업 폴더가 아닙니다.');
  for (const [name, hash] of [
    ['developer-id.key.pem', state.keySha256],
    ['PMCanvas.certSigningRequest', state.csrSha256],
  ])
    if (digest(read(path.join(folder, name))) !== hash)
      fail('개인 키 또는 CSR이 변경되었습니다. 원본을 확인하세요.');
  return state;
}
function updateState(folder, state) {
  const file = path.join(folder, 'state-' + randomUUID() + '.tmp');
  saveNew(file, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(file, stateFile(folder));
}

export function locked(folder, operation) {
  secureDirectory(folder);
  const file = path.join(folder, 'setup.lock');
  if (fs.existsSync(file)) {
    const previous = JSON.parse(read(file));
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
      fail('작업 잠금 파일을 확인하세요.');
    let alive = true;
    try {
      process.kill(previous.pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') alive = false;
    }
    if (alive) fail('다른 설정 작업이 실행 중입니다. 먼저 종료하세요.');
    fs.unlinkSync(file);
  }
  saveNew(file, JSON.stringify({ pid: process.pid }));
  try {
    return operation();
  } finally {
    fs.unlinkSync(file);
  }
}

export function createCsr(folder, email, passphrase, openssl = opensslPath()) {
  password(passphrase);
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(email))
    fail('개발자 계정 이메일 형식을 확인하세요.');
  return locked(folder, () => {
    if (fs.readdirSync(folder).some((name) => name !== 'setup.lock'))
      fail('빈 새 작업 폴더에서만 개인 키를 생성합니다.');
    const key = path.join(folder, 'developer-id.key.pem'),
      csr = path.join(folder, 'PMCanvas.certSigningRequest');
    const config = path.join(folder, 'request.conf');
    saveNew(
      config,
      `[req]\nprompt = no\ndistinguished_name = dn\n[dn]\nCN = PM Canvas Developer ID\nemailAddress = ${email}\n`,
    );
    try {
      quietRun(
        openssl,
        [
          'genpkey',
          '-algorithm',
          'RSA',
          '-pkeyopt',
          'rsa_keygen_bits:2048',
          '-aes-256-cbc',
          '-out',
          key,
          '-pass',
          'stdin',
        ],
        {
          input: passphrase + '\n',
          label: '개인 키 생성에 실패했습니다. 이 폴더를 보존하고 새 작업 폴더에서 재시도하세요.',
        },
      );
      quietRun(
        openssl,
        [
          'req',
          '-new',
          '-sha256',
          '-passin',
          'stdin',
          '-keyform',
          'PEM',
          '-key',
          key,
          '-out',
          csr,
          '-config',
          config,
        ],
        {
          input: passphrase + '\n',
          label: 'CSR 생성에 실패했습니다. 기존 개인 키는 보존했습니다.',
        },
      );
      quietRun(openssl, ['req', '-in', csr, '-noout', '-verify']);
      const privateKey = createPrivateKey({ key: read(key), passphrase });
      const publicKeySha256 = digest(
        createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
      );
      saveNew(
        stateFile(folder),
        JSON.stringify(
          {
            tool: 'PMCanvas Mac signing',
            version: 1,
            createdAt: new Date().toISOString(),
            keySha256: digest(read(key)),
            csrSha256: digest(read(csr)),
            publicKeySha256,
          },
          null,
          2,
        ) + '\n',
      );
      return csr;
    } finally {
      fs.unlinkSync(config);
    }
  });
}

export async function officialAuthorities(fetcher = fetch) {
  const certificates = [];
  for (const item of APPLE_AUTHORITIES) {
    const response = await fetcher('https://www.apple.com/certificateauthority/' + item.file, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) fail('Apple 중간 인증서를 다운로드하지 못했습니다. 네트워크를 확인하세요.');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 32768) fail('Apple 인증서 응답 크기가 올바르지 않습니다.');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (digest(bytes) !== item.sha256)
      fail('Apple 중간 인증서 지문이 다릅니다. 도구 업데이트가 필요합니다.');
    certificates.push(new X509Certificate(bytes));
  }
  return certificates;
}

export function exportP12(
  folder,
  certificateFile,
  keyPassword,
  p12Password,
  authorities,
  openssl = opensslPath(),
) {
  password(keyPassword);
  password(p12Password);
  return locked(folder, () => {
    const state = session(folder),
      keyBytes = read(path.join(folder, 'developer-id.key.pem'));
    const cert = new X509Certificate(read(certificateFile));
    const key = createPrivateKey({ key: keyBytes, passphrase: keyPassword });
    if (!cert.checkPrivateKey(key))
      fail('Apple 인증서와 원래 개인 키가 일치하지 않습니다. CSR을 확인하세요.');
    if (
      !/^CN=Developer ID Application: /m.test(cert.subject) ||
      !cert.keyUsage?.includes('1.3.6.1.5.5.7.3.3')
    )
      fail('Developer ID Application 코드 서명 인증서가 아닙니다.');
    const now = Date.now(),
      valid = (c) => Date.parse(c.validFrom) <= now && Date.parse(c.validTo) > now;
    const issuer = authorities.find(
      (ca) => ca.ca && cert.checkIssued(ca) && cert.verify(ca.publicKey) && valid(ca),
    );
    if (!issuer || !valid(cert)) fail('유효한 Apple 발급 인증서가 아니거나 만료되었습니다.');
    const output = path.join(folder, 'PMCanvas-DeveloperID.p12');
    if (fs.existsSync(output)) fail('기존 P12는 덮어쓰지 않습니다. 이미 만든 파일을 등록하세요.');
    const leaf = path.join(folder, 'certificate.pem'),
      ca = path.join(folder, 'issuer.pem'),
      temp = path.join(folder, 'bundle.partial');
    for (const file of [leaf, ca, temp])
      if (fs.existsSync(file)) fail('이전 변환 파일이 있습니다. 작업 폴더를 확인하세요.');
    saveNew(leaf, cert.toString());
    saveNew(ca, issuer.toString());
    try {
      quietRun(
        openssl,
        [
          'pkcs12',
          '-export',
          '-inkey',
          path.join(folder, 'developer-id.key.pem'),
          '-in',
          leaf,
          '-certfile',
          ca,
          '-out',
          temp,
          '-name',
          'PMCanvas Developer ID Application',
          '-keypbe',
          'PBE-SHA1-3DES',
          '-certpbe',
          'PBE-SHA1-3DES',
          '-macalg',
          'sha1',
          '-iter',
          '100000',
          '-passin',
          'stdin',
          '-passout',
          'stdin',
        ],
        {
          input: keyPassword + '\n' + p12Password + '\n',
          label: 'P12 변환에 실패했습니다. 암호와 원본 키를 확인하세요.',
        },
      );
      quietRun(openssl, ['pkcs12', '-in', temp, '-noout', '-passin', 'stdin'], {
        input: p12Password + '\n',
        label: 'P12 검증에 실패했습니다.',
      });
      fs.renameSync(temp, output);
      updateState(folder, {
        ...state,
        certificateSha256: digest(cert.raw),
        p12Sha256: digest(read(output)),
      });
      return output;
    } finally {
      // Never remove the original encrypted key, CSR or a completed P12 on failure.
      for (const file of [leaf, ca, temp]) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });
}

const secretNames = new Set([
  'MAC_CSC_LINK',
  'MAC_CSC_KEY_PASSWORD',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_API_KEY_BASE64',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
]);
export function sendSecret(name, value, run = quietRun) {
  if (!secretNames.has(name)) fail('허용되지 않은 Secret 이름입니다.');
  run('gh', ['secret', 'set', name, '--repo', githubRepository, '--env', ENVIRONMENT], {
    input: value,
    label: 'GitHub Secret 등록에 실패했습니다. 로그인·권한·네트워크를 확인하고 다시 등록하세요.',
  });
}

export function registerP12(folder, passphrase, run = quietRun, openssl = opensslPath()) {
  password(passphrase);
  return locked(folder, () => {
    const state = session(folder),
      file = path.join(folder, 'PMCanvas-DeveloperID.p12'),
      bytes = read(file);
    if (!state.p12Sha256 || digest(bytes) !== state.p12Sha256)
      fail('P12가 변경되었거나 이 작업에서 만든 파일이 아닙니다.');
    quietRun(openssl, ['pkcs12', '-in', file, '-noout', '-passin', 'stdin'], {
      input: passphrase + '\n',
      label: 'P12 암호가 일치하지 않습니다.',
    });
    run('gh', ['auth', 'status', '--hostname', 'github.com'], {
      label: '먼저 다른 터미널에서 gh auth login을 완료하세요.',
    });
    try {
      sendSecret('MAC_CSC_LINK', bytes.toString('base64'), run);
      sendSecret('MAC_CSC_KEY_PASSWORD', passphrase, run);
    } finally {
      bytes.fill(0);
    }
  });
}

export function registerNotarization(config, run = quietRun) {
  let values, other;
  if (config.mode === 'api') {
    if (
      !/^[A-Z0-9]{10}$/.test(config.keyId) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(config.issuer)
    )
      fail('Team Key ID와 Issuer ID를 확인하세요.');
    const bytes = read(config.keyFile, 16384);
    try {
      const key = createPrivateKey(bytes);
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1')
        fail('올바른 App Store Connect P8 키가 아닙니다.');
      values = {
        APPLE_API_KEY_BASE64: bytes.toString('base64'),
        APPLE_API_KEY_ID: config.keyId,
        APPLE_API_ISSUER: config.issuer,
      };
    } finally {
      bytes.fill(0);
    }
    other = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  } else if (config.mode === 'apple') {
    if (
      !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(config.email) ||
      !/^[A-Z0-9]{10}$/.test(config.teamId) ||
      !/^[a-z]{4}(?:-[a-z]{4}){3}$/.test(config.appPassword)
    )
      fail('Apple 계정·앱 전용 암호·Team ID 형식을 확인하세요.');
    values = {
      APPLE_ID: config.email,
      APPLE_APP_SPECIFIC_PASSWORD: config.appPassword,
      APPLE_TEAM_ID: config.teamId,
    };
    other = ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  } else fail('공증 인증 방식을 선택하세요.');
  run('gh', ['auth', 'status', '--hostname', 'github.com'], {
    label: '먼저 gh auth login을 완료하세요.',
  });
  // Never silently delete another credential group. Mixed groups must be resolved explicitly.
  const existing = [
    ...JSON.parse(
      run(
        'gh',
        ['secret', 'list', '--repo', githubRepository, '--env', ENVIRONMENT, '--json', 'name'],
        {
          label: 'GitHub Environment Secret 이름을 확인하지 못했습니다.',
        },
      ).toString(),
    ),
    ...JSON.parse(
      run('gh', ['secret', 'list', '--repo', githubRepository, '--json', 'name'], {
        label: 'GitHub 저장소 Secret 이름을 확인하지 못했습니다.',
      }).toString(),
    ),
  ];
  if (existing.some((item) => other.includes(item.name)))
    fail(
      '다른 공증 방식의 Secret이 남아 있습니다. GitHub desktop-release 또는 저장소 Secret에서 그 그룹을 제거한 뒤 다시 등록하세요.',
    );
  for (const [name, value] of Object.entries(values)) sendSecret(name, value, run);
}
