import fs from 'node:fs';
import path from 'node:path';
import {
  SetupError,
  REPOSITORY,
  ENVIRONMENT,
  APPLE_CERTIFICATES,
  newWorkspace,
  secureDirectory,
  createCsr,
  officialAuthorities,
  exportP12,
  registerP12,
  registerNotarization,
  password,
  session,
  opensslPath,
  requirePrivateRuntime,
} from './mac-signing-core.mjs';
import { hiddenInput, question } from './mac-signing-prompt.mjs';

const say = (message) => process.stdout.write(message + '\n');
const safeError = (error) =>
  say(
    error instanceof SetupError
      ? error.message
      : '작업에 실패했습니다. 원본 파일은 보존됩니다. 파일·암호·권한을 확인한 뒤 같은 단계를 다시 실행하세요.',
  );
const chosenPath = async (label) => path.resolve((await question(label)).replace(/^"(.*)"$/, '$1'));
async function newPassword(label) {
  const first = password(await hiddenInput(label + ' (공백 없이 영문·숫자·기호 16~128자): '));
  if (first !== (await hiddenInput('같은 암호 재입력: ')))
    throw new SetupError('입력한 두 암호가 일치하지 않습니다.');
  return first;
}
function appleInstructions(folder) {
  say('\nApple에서 직접 할 단계:');
  say('1. 활성 Apple Developer Program의 Account Holder로 아래 페이지에 로그인합니다.');
  say(APPLE_CERTIFICATES);
  say('2. Certificates → + → Developer ID Application을 선택합니다.');
  say('3. 아래 CSR만 업로드하고 발급된 .cer를 다운로드합니다. 개인 키는 업로드하지 않습니다.');
  say(path.join(folder, 'PMCanvas.certSigningRequest'));
  say('4. 이 스크립트를 다시 실행해 같은 작업 폴더와 메뉴 2를 선택합니다.');
}
async function chooseWorkspace(base) {
  const existing = fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^PMCanvas-MacSigning-[a-z0-9]+$/i.test(entry.name))
    .map((entry) => path.join(base, entry.name))
    .sort();
  if (!existing.length) return newWorkspace(base);
  say('0. 새 작업 폴더');
  for (let i = 0; i < existing.length; i++) say(`${i + 1}. ${path.basename(existing[i])}`);
  const answer = await question('이어 할 작업 번호 (새 작업은 0): ');
  if (answer === '0') return newWorkspace(base);
  const index = Number(answer) - 1;
  if (!/^\d+$/.test(answer) || !Number.isInteger(index) || !existing[index])
    throw new SetupError('작업 번호를 확인하세요.');
  secureDirectory(existing[index]);
  return existing[index];
}
async function main() {
  if (process.argv.length > 2) {
    if (process.argv.length === 3 && process.argv[2] === '--help') {
      say('Windows Mac 서명 설정: npm --prefix desktop run signing:setup');
      say(
        'CSR 생성 → Apple Developer ID Application 발급 안내 → P12 변환 → GitHub Environment Secrets 등록',
      );
      say(
        '개인 키·CSR·P12는 Git 밖의 사용자 전용 LocalAppData 폴더에 보관합니다. 암호 인수·로그·클립보드를 사용하지 않습니다.',
      );
      return;
    }
    throw new SetupError('명령 인수로 암호·키를 받지 않습니다. --help 또는 인수 없이 실행하세요.');
  }
  if (process.platform !== 'win32') throw new SetupError('이 설정 도구는 Windows용입니다.');
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.CI === 'true')
    throw new SetupError('Windows의 대화형 PowerShell 또는 터미널에서 실행하세요.');
  requirePrivateRuntime();
  const openssl = opensslPath();
  if (!process.env.LOCALAPPDATA) throw new SetupError('Windows LOCALAPPDATA 경로를 확인하세요.');
  const folder = await chooseWorkspace(path.resolve(process.env.LOCALAPPDATA));
  say('\nPM Canvas Mac 서명 설정');
  say(`GitHub 대상: ${REPOSITORY} / Environment: ${ENVIRONMENT}`);
  say('작업 폴더: ' + folder);
  say('암호는 표시하거나 저장하지 않습니다. 입력 중 화면이 바뀌지 않아도 정상입니다.');
  while (true) {
    say('\n1. 개인 키와 CSR 생성 / Apple 발급 안내');
    say('2. Apple에서 받은 인증서를 확인하고 P12 생성');
    say('3. P12와 P12 암호를 GitHub Secrets에 등록');
    say('4. 공증 자격 증명을 GitHub Secrets에 등록');
    say('5. Apple 인증서 발급 안내 다시 보기');
    say('0. 종료 (다음 실행에서 이어 하기)');
    const action = await question('번호: ');
    if (action === '0') break;
    try {
      if (action === '1') {
        say('개인 키 암호 A는 P12 암호 B와 별개입니다. 비밀번호 관리자에 보관하세요.');
        const email = await hiddenInput('Apple 개발자 계정 이메일 (숨김 입력): ');
        const keyPassword = await newPassword('개인 키 암호 A');
        createCsr(folder, email, keyPassword, openssl);
        say('개인 키와 CSR을 생성했습니다. 기존 키를 다시 생성하지 마세요.');
        appleInstructions(folder);
      } else if (action === '2') {
        session(folder);
        const certificate = await chosenPath('다운로드한 Apple .cer의 전체 경로: ');
        const keyPassword = await hiddenInput('개인 키 암호 A: ');
        const p12Password = await newPassword('GitHub에 등록할 P12 암호 B');
        say('Apple 공식 중간 인증서와 발급 인증서·개인 키 일치를 확인합니다.');
        exportP12(
          folder,
          certificate,
          keyPassword,
          p12Password,
          await officialAuthorities(),
          openssl,
        );
        say('P12를 생성하고 검증했습니다. 다음 단계에는 암호 B를 입력하세요.');
      } else if (action === '3') {
        say(`등록 대상: ${REPOSITORY} / ${ENVIRONMENT} / MAC_CSC_LINK, MAC_CSC_KEY_PASSWORD`);
        registerP12(folder, await hiddenInput('P12 암호 B: '), undefined, openssl);
        say('P12와 암호를 GitHub에 등록했습니다. 값은 출력하지 않습니다.');
      } else if (action === '4') {
        say('1. Apple 계정 + 앱 전용 암호 / 2. App Store Connect Team API 키');
        const mode = await question('공증 방식: ');
        if (mode === '1') {
          say(
            'account.apple.com → 로그인 및 보안 → 앱 전용 암호를 생성하세요. 평소 로그인 암호를 입력하지 마세요.',
          );
          registerNotarization({
            mode: 'apple',
            email: await hiddenInput('Apple 계정 이메일: '),
            teamId: await hiddenInput('Membership details의 10자리 Team ID: '),
            appPassword: await hiddenInput('앱 전용 암호: '),
          });
        } else if (mode === '2') {
          say(
            'App Store Connect → Users and Access → Integrations → Team Keys에서 App Manager 권한 키를 만드세요.',
          );
          say(
            'P8 원본은 Git 밖에 보관하세요. 다른 공증 방식의 Secret은 도구가 자동 삭제하지 않습니다.',
          );
          registerNotarization({
            mode: 'api',
            keyFile: await chosenPath('P8 파일 전체 경로: '),
            keyId: await hiddenInput('Team Key ID: '),
            issuer: await hiddenInput('Issuer ID (Team ID와 다름): '),
          });
        } else throw new SetupError('공증 방식을 확인하세요.');
        say('공증 Secret 그룹을 등록했습니다.');
      } else if (action === '5') appleInstructions(folder);
      else throw new SetupError('메뉴 번호를 확인하세요.');
    } catch (error) {
      safeError(error);
    }
  }
  say('원본 키와 P12는 사용자 전용 작업 폴더에 보존했습니다.');
  say(
    '등록 후 Actions → Desktop verification and builds: main / platform=mac / signed=true / unsigned=false / publish=false로 먼저 검증하세요.',
  );
}
try {
  await main();
} catch (error) {
  safeError(error);
  process.exitCode = 1;
}
