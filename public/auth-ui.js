import { escapeHtml as esc } from './html.js';
import { field } from './view-ui.js';

export function readAuthLink(hash) {
  if (hash.startsWith('#verify-email'))
    return { kind: 'verify', token: hash.match(/^#verify-email=([A-Za-z0-9_-]{43})$/)?.[1] || '' };
  if (hash.startsWith('#reset-password'))
    return { kind: 'reset', token: hash.match(/^#reset-password=([A-Za-z0-9_-]{43})$/)?.[1] || '' };
  return null;
}
export function loginRequest({ email, password, provider = '', user = null, unsaved = false }) {
  if (unsaved && user && email.trim().toLowerCase() !== user.email)
    throw Error('저장하지 못한 변경사항이 있습니다. 기존 계정으로 다시 로그인해 주세요.');
  if (unsaved && provider) throw Error('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
  return {
    path: provider ? 'auth/directory' : 'auth/login',
    body: provider ? { provider, username: email, password } : { email, password },
  };
}
export function createAuthUi({
  api,
  user,
  hasUnsaved,
  isBusy,
  acceptUser,
  refreshWorkspace,
  openInfo,
  approvalPending,
  onApproval,
  toast,
  document = globalThis.document,
  location = globalThis.location,
  history = globalThis.history,
}) {
  const $ = (s) => document.querySelector(s),
    landing = readAuthLink(location.hash);
  let emailVerificationToken = landing?.kind === 'verify' ? landing.token : '',
    passwordResetToken = landing?.kind === 'reset' ? landing.token : '',
    resetEmailEnabled = false,
    loginProvider = '',
    registrationPolicy = { mode: 'disabled', domains: [] };
  if (landing) history.replaceState(null, '', location.pathname + location.search);
  function showAuth(message = '') {
    $('#authGate').hidden = false;
    $('#forgotPasswordForm')?.remove();
    $('#resetPasswordForm')?.remove();
    $('#registrationForm')?.remove();
    $('#verifyEmailForm')?.remove();
    $('#resendVerificationForm')?.remove();
    $('#loginForm').hidden = false;
    $('#authError').textContent = message;
    if (user()) $('#loginEmail').value = user().email;
  }
  async function initializeAuthentication() {
    const messages = {
      SSO_FAILED: '외부 인증에 실패했거나 요청이 만료되었습니다. 다시 시작해 주세요.',
      IDENTITY_UNLINKED: '관리자에게 외부 계정 연결을 요청해 주세요.',
      DOMAIN_DENIED: '허용된 조직 계정이 아닙니다.',
      ACCOUNT_DISABLED: '비활성화된 계정입니다. 관리자에게 문의해 주세요.',
      UNVERIFIED_EMAIL: '인증 서버의 이메일 검증 설정을 관리자에게 확인해 주세요.',
    };
    const url = new URL(location.href),
      error = url.searchParams.get('authError');
    if (error) {
      $('#authError').textContent = messages[error] || messages.SSO_FAILED;
      url.searchParams.delete('authError');
      history.replaceState(null, '', url);
    }
    try {
      const { providers, registration, passwordReset } = await api('auth/providers');
      resetEmailEnabled = !!passwordReset?.enabled;
      registrationPolicy = registration || registrationPolicy;
      $('#registerButton').hidden = registrationPolicy.mode !== 'approval';
      $('#registrationDisabled').hidden = registrationPolicy.mode === 'approval';
      if (!providers.length) return;
      const group = document.createElement('div');
      group.className = 'federated-logins';
      group.innerHTML = providers
        .filter((p) => p.type !== 'ldap')
        .map(
          (p) =>
            '<button type="button" class="button sso-login" data-sso-provider="' +
            esc(p.id) +
            '">' +
            esc(p.label) +
            '로 로그인</button>',
        )
        .join('');
      const directory = providers.filter((p) => p.type === 'ldap');
      if (directory.length)
        group.innerHTML +=
          '<label class="field">로그인 방식<select id="loginProvider"><option value="">PM Canvas 계정</option>' +
          directory
            .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>')
            .join('') +
          '</select></label>';
      $('#loginEmail').closest('label').before(group);
      group.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sso-provider]');
        if (!b) return;
        if (hasUnsaved() || isBusy()) {
          $('#authError').textContent =
            '현재 변경사항을 먼저 저장하거나 백업한 뒤 외부 로그인을 진행해 주세요.';
          return;
        }
        location.assign(
          new URL('./api/auth/sso/' + b.dataset.ssoProvider + '/start', location.href),
        );
      });
      group.querySelector('select')?.addEventListener('change', (e) => {
        loginProvider = e.target.value;
        const input = $('#loginEmail');
        input.type = loginProvider ? 'text' : 'email';
        input.closest('label').firstChild.textContent = loginProvider
          ? '디렉터리 사용자명'
          : '이메일';
        input.value = '';
        $('#authError').textContent = '';
      });
    } catch {
      $('#authError').textContent =
        '외부 인증 목록을 불러오지 못했습니다. 연결을 확인하거나 PM Canvas 계정으로 로그인해 주세요.';
    }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const request = loginRequest({
        email: $('#loginEmail').value,
        password: $('#loginPassword').value,
        provider: loginProvider,
        user: user(),
        unsaved: hasUnsaved(),
      });
      const session = await api(request.path, { method: 'POST', body: request.body });
      $('#loginPassword').value = '';
      if (session.mfaRequired) {
        showMfaLogin(session);
        return;
      }
      await completeBrowserLogin(session);
    } catch (error) {
      $('#authError').textContent = error.message;
      if (error.code === 'EMAIL_UNVERIFIED') {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'auth-link';
        link.dataset.resendVerification = '';
        link.textContent = '인증 메일 다시 받기';
        $('#authError').append(link);
      }
    } finally {
      button.disabled = false;
    }
  });
  async function completeBrowserLogin(session) {
    acceptUser(session.user);
    $('#authGate').hidden = true;
    $('#loginForm').hidden = false;
    $('#mfaForm')?.remove();
    await refreshWorkspace();
    if (session.recoveryCodes) {
      openInfo(
        'MFA 복구 코드를 보관하세요',
        '<p>인증 앱을 사용할 수 없을 때 아래 코드를 한 번씩 사용할 수 있습니다. 안전한 오프라인 장소에 보관하세요. 이 화면에서만 표시합니다.</p><pre>' +
          session.recoveryCodes.map(esc).join('\n') +
          '</pre>',
      );
      if (approvalPending())
        $('#infoDialog').addEventListener(
          'close',
          () => {
            onApproval().catch((error) => toast(error.message));
          },
          { once: true },
        );
    } else await onApproval();
  }
  function showMfaLogin(challenge) {
    $('#loginForm').hidden = true;
    $('#mfaForm')?.remove();
    const form = document.createElement('form');
    form.id = 'mfaForm';
    form.className = 'auth-card';
    form.innerHTML =
      '<h2>관리자 2단계 인증</h2>' +
      (challenge.enrollment
        ? '<p>인증 앱에 아래 설정 키를 등록하고 표시되는 6자리 코드를 입력하세요.</p><label class="field">설정 키<input id="mfaSecret" readonly value="' +
          esc(challenge.secret) +
          '"></label><p>계정: PMCanvas · SHA1 · 6자리 · 30초</p>'
        : '<p>인증 앱 코드 또는 일회용 복구 코드를 입력하세요.</p>') +
      '<label class="field">인증 코드<input id="mfaCode" autocomplete="one-time-code" maxlength="64" required autofocus></label><p class="form-error" role="alert"></p><button class="button primary">인증</button><button class="button" type="button" id="cancelMfa">다시 로그인</button>';
    $('#authGate').append(form);
    $('#mfaCode').focus();
    $('#cancelMfa').onclick = () => {
      form.remove();
      $('#loginForm').hidden = false;
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const session = await api('auth/mfa/verify', {
          method: 'POST',
          body: { challenge: challenge.challenge, code: $('#mfaCode').value },
        });
        await completeBrowserLogin(session);
      } catch (error) {
        form.querySelector('.form-error').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function returnToLogin(email = '') {
    $('#registrationForm')?.remove();
    $('#forgotPasswordForm')?.remove();
    $('#resetPasswordForm')?.remove();
    $('#verifyEmailForm')?.remove();
    $('#resendVerificationForm')?.remove();
    passwordResetToken = '';
    emailVerificationToken = '';
    $('#loginForm').hidden = false;
    $('#loginPassword').value = '';
    $('#authError').textContent = '';
    if (email) {
      loginProvider = '';
      const select = $('#loginProvider');
      if (select) select.value = '';
      $('#loginEmail').type = 'email';
      $('#loginEmail').closest('label').firstChild.textContent = '이메일';
      $('#loginEmail').value = email;
      $('#loginPassword').focus();
    } else $('#loginEmail').focus();
  }
  $('#registerButton').addEventListener('click', () => {
    if (registrationPolicy.mode !== 'approval') return;
    if (user() && hasUnsaved()) {
      toast('현재 계정의 변경사항을 먼저 저장하거나 백업해 주세요.');
      return;
    }
    $('#loginForm').hidden = true;
    $('#loginPassword').value = '';
    $('#registrationForm')?.remove();
    const form = document.createElement('form');
    form.id = 'registrationForm';
    form.className = 'auth-card';
    form.innerHTML =
      '<span class="eyebrow">PM CANVAS</span><h1>회원가입</h1><p>이메일 인증과 관리자 승인 후 사용할 수 있어요.</p>' +
      (registrationPolicy.domains.length
        ? '<p class="registration-domains">가입 가능 이메일: ' +
          registrationPolicy.domains.map(esc).join(', ') +
          '</p>'
        : '') +
      field('이메일', 'email', '', 'email', 'required maxlength="254" autocomplete="email"') +
      '<small>메일의 인증 링크에서 이름과 비밀번호를 한 번만 입력합니다.</small><p class="form-error" role="alert"></p><button class="button primary" type="submit">인증 메일 보내기</button><button class="auth-link" type="button" data-resend-verification>이미 신청했나요? 인증 메일 다시 받기</button><button class="auth-link" type="button" data-registration-back>로그인으로 돌아가기</button>';
    $('#authGate').append(form);
    form.elements.email.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]'),
        error = form.querySelector('.form-error'),
        data = new FormData(form);
      error.textContent = '';

      button.disabled = true;
      try {
        const result = await api('auth/register', {
          method: 'POST',
          body: Object.fromEntries(data),
        });
        const email = String(data.get('email'));
        form.reset();
        form.innerHTML =
          '<span class="eyebrow">PM CANVAS</span><h1>신청 완료</h1><p role="status">' +
          esc(result.message) +
          '</p><small>인증 링크는 30분 동안 유효합니다. 승인 결과도 메일로 알려드립니다.</small><button class="auth-link" type="button" data-resend-verification>인증 메일 다시 받기</button><button class="button primary" type="button" data-registration-back>로그인으로 돌아가기</button>';
        form.querySelector('[data-registration-back]').dataset.email = email;
        form.querySelector('[data-resend-verification]').dataset.email = email;
        form.querySelector('h1').tabIndex = -1;
        form.querySelector('h1').focus();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  });
  $('#authGate').addEventListener('click', (e) => {
    const button = e.target.closest('[data-registration-back]');
    if (button) returnToLogin(button.dataset.email || '');
  });

  function authFlowForm(id) {
    $('#authGate').hidden = false;
    $('#loginForm').hidden = true;
    $('#loginPassword').value = '';
    for (const key of [
      'registrationForm',
      'forgotPasswordForm',
      'resetPasswordForm',
      'verifyEmailForm',
      'resendVerificationForm',
      'mfaForm',
    ])
      $('#' + key)?.remove();
    const form = document.createElement('form');
    form.id = id;
    form.className = 'auth-card';
    $('#authGate').append(form);
    return form;
  }
  function showResendVerification(email = '') {
    if (user() && hasUnsaved()) {
      toast('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
      return;
    }
    emailVerificationToken = '';
    const form = authFlowForm('resendVerificationForm');
    form.innerHTML =
      '<span class="eyebrow">PM CANVAS</span><h1>인증 메일 다시 받기</h1><p>가입 신청에 사용한 이메일을 입력하세요.</p>' +
      field('이메일', 'email', email, 'email', 'required maxlength="254" autocomplete="email"') +
      '<p class="form-error" role="alert"></p><button type="submit" class="button primary">인증 메일 보내기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
    form.elements.email.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]'),
        error = form.querySelector('.form-error');
      button.disabled = true;
      error.textContent = '';
      try {
        const result = await api('auth/resend-verification', {
          method: 'POST',
          body: { email: form.elements.email.value },
        });
        form.reset();
        form.innerHTML =
          '<span class="eyebrow">PM CANVAS</span><h1>메일을 확인해 주세요</h1><p role="status">' +
          esc(result.message) +
          '</p><small>가장 최근에 받은 링크를 30분 안에 사용하세요.</small><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
        form.querySelector('h1').tabIndex = -1;
        form.querySelector('h1').focus();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  function showEmailVerification() {
    const form = authFlowForm('verifyEmailForm');
    form.innerHTML =
      '<span class="eyebrow">PM CANVAS</span><h1>이메일 인증</h1><p>본인의 이름과 로그인 비밀번호를 설정하면 인증이 완료됩니다.</p>' +
      field('이름', 'name', '', 'text', 'required maxlength="80" autocomplete="name"') +
      field(
        '로그인 비밀번호',
        'newPassword',
        '',
        'password',
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      field(
        '비밀번호 확인',
        'confirmPassword',
        '',
        'password',
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      '<small>비밀번호는 12자 이상으로 설정하세요. 인증 후 관리자 승인이 필요합니다.</small><p class="form-error" role="alert">' +
      (emailVerificationToken ? '' : '유효하지 않은 링크입니다. 인증 메일을 다시 요청해 주세요.') +
      '</p><button type="submit" class="button primary" ' +
      (emailVerificationToken ? '' : 'disabled') +
      '>이메일 인증 완료</button><button type="button" class="auth-link" data-resend-verification>인증 메일 다시 받기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
    form.elements.name.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]'),
        error = form.querySelector('.form-error'),
        data = new FormData(form);
      error.textContent = '';
      if (data.get('newPassword') !== data.get('confirmPassword')) {
        error.textContent = '비밀번호 확인이 일치하지 않습니다.';
        form.elements.confirmPassword.focus();
        return;
      }
      button.disabled = true;
      try {
        const result = await api('auth/verify-email', {
          method: 'POST',
          body: { ...Object.fromEntries(data), token: emailVerificationToken },
        });
        emailVerificationToken = '';
        form.reset();
        form.innerHTML =
          '<span class="eyebrow">PM CANVAS</span><h1>이메일 인증 완료</h1><p role="status">' +
          esc(result.message) +
          '</p><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
        form.querySelector('h1').tabIndex = -1;
        form.querySelector('h1').focus();
      } catch (err) {
        error.textContent = err.message;
        if (err.code === 'VERIFICATION_INVALID') {
          emailVerificationToken = '';
          form.reset();
        }
      } finally {
        button.disabled = !emailVerificationToken;
      }
    };
  }
  $('#authGate').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resend-verification]');
    if (b)
      showResendVerification(b.dataset.email || (!loginProvider ? $('#loginEmail').value : ''));
  });
  function showForgotPassword() {
    if (user() && hasUnsaved()) {
      toast('현재 변경사항을 먼저 저장하거나 백업해 주세요.');
      return;
    }
    passwordResetToken = '';
    const form = authFlowForm('forgotPasswordForm');
    form.innerHTML =
      '<span class="eyebrow">PM CANVAS</span><h1>비밀번호 찾기</h1><p>가입한 이메일로 재설정 링크를 보내드려요.</p>' +
      field('이메일', 'email', '', 'email', 'required maxlength="254" autocomplete="email"') +
      '<small>회사 SSO·AD 계정은 회사 인증 서비스에서 변경하세요.</small><p class="form-error" role="alert">' +
      (resetEmailEnabled
        ? ''
        : '현재 이메일 재설정을 사용할 수 없습니다. 관리자에게 문의해 주세요.') +
      '</p><button type="submit" class="button primary" ' +
      (resetEmailEnabled ? '' : 'disabled') +
      '>재설정 메일 보내기</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
    if (!loginProvider) form.elements.email.value = $('#loginEmail').value;
    form.elements.email.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]'),
        error = form.querySelector('.form-error');
      button.disabled = true;
      error.textContent = '';
      try {
        const result = await api('auth/forgot-password', {
          method: 'POST',
          body: { email: form.elements.email.value },
        });
        form.reset();
        form.innerHTML =
          '<span class="eyebrow">PM CANVAS</span><h1>메일을 확인해 주세요</h1><p role="status">' +
          esc(result.message) +
          '</p><small>링크는 15분 동안 사용할 수 있어요.</small><button type="button" class="button primary" data-registration-back>로그인으로 돌아가기</button>';
        form.querySelector('h1').tabIndex = -1;
        form.querySelector('h1').focus();
      } catch (err) {
        error.textContent = err.message;
      } finally {
        button.disabled = !resetEmailEnabled;
      }
    };
  }
  $('#forgotPasswordButton').addEventListener('click', showForgotPassword);
  function showPasswordReset() {
    const form = authFlowForm('resetPasswordForm');
    form.innerHTML =
      '<span class="eyebrow">PM CANVAS</span><h1>새 비밀번호 설정</h1><p>변경하면 모든 기기에서 로그아웃됩니다.</p>' +
      field(
        '새 비밀번호',
        'newPassword',
        '',
        'password',
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      field(
        '새 비밀번호 확인',
        'confirmPassword',
        '',
        'password',
        'required minlength="12" maxlength="256" autocomplete="new-password"',
      ) +
      '<small>12자 이상으로 입력하세요.</small><p class="form-error" role="alert">' +
      (passwordResetToken
        ? ''
        : '유효하지 않은 링크입니다. 비밀번호 재설정을 다시 요청해 주세요.') +
      '</p><button type="submit" class="button primary" ' +
      (passwordResetToken ? '' : 'disabled') +
      '>비밀번호 변경</button><button type="button" class="auth-link" data-request-reset>재설정 메일 다시 요청</button><button type="button" class="auth-link" data-registration-back>로그인으로 돌아가기</button>';
    form.elements.newPassword.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const button = form.querySelector('[type=submit]'),
        error = form.querySelector('.form-error'),
        password = form.elements.newPassword.value,
        confirmPassword = form.elements.confirmPassword.value;
      error.textContent = '';
      if (password !== confirmPassword) {
        error.textContent = '비밀번호 확인이 일치하지 않습니다.';
        form.elements.confirmPassword.focus();
        return;
      }
      button.disabled = true;
      try {
        await api('auth/reset-password', {
          method: 'POST',
          body: { token: passwordResetToken, newPassword: password, confirmPassword },
        });
        passwordResetToken = '';
        form.reset();
        form.innerHTML =
          '<span class="eyebrow">PM CANVAS</span><h1>비밀번호를 변경했습니다</h1><p role="status">새 비밀번호로 다시 로그인해 주세요.</p><button class="button primary" type="button" data-registration-back>로그인하기</button>';
        form.querySelector('h1').tabIndex = -1;
        form.querySelector('h1').focus();
      } catch (err) {
        error.textContent = err.message;
        if (err.code === 'RESET_INVALID') {
          passwordResetToken = '';
          form.reset();
        }
      } finally {
        button.disabled = !passwordResetToken;
      }
    };
  }
  $('#authGate').addEventListener('click', (e) => {
    if (e.target.closest('[data-request-reset]')) showForgotPassword();
  });

  function handleHash() {
    const link = readAuthLink(location.hash);
    if (!link) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (hasUnsaved() || isBusy()) {
      toast(
        link.kind === 'verify'
          ? '현재 변경사항을 저장한 뒤 인증 링크를 다시 열어 주세요.'
          : '현재 변경사항을 저장한 뒤 이메일의 재설정 링크를 다시 열어 주세요.',
      );
      return true;
    }
    if (link.kind === 'verify') {
      emailVerificationToken = link.token;
      showEmailVerification();
    } else {
      passwordResetToken = link.token;
      showPasswordReset();
    }
    return true;
  }
  return {
    show: showAuth,
    initialize: initializeAuthentication,
    handleHash,
    setMailEnabled: (enabled) => {
      resetEmailEnabled = enabled;
    },
    start: (boot) =>
      initializeAuthentication().finally(() =>
        landing?.kind === 'verify'
          ? showEmailVerification()
          : landing?.kind === 'reset'
            ? showPasswordReset()
            : boot(),
      ),
  };
}
