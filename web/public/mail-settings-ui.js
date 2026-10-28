import { ui } from './i18n.js';
export function createMailSettingsUi({
  api,
  field,
  openInfo,
  user,
  onEnabled,
  showAuth,
  registerGuard,
}) {
  const $ = (selector) => document.querySelector(selector);
  return async function openMailSettings() {
    if (!user()?.isAdmin) return;
    openInfo(ui('이메일 발송 설정'), ui('<div id="mailSettingsHost">불러오는 중…</div>'));
    $('#infoDialog').classList.add('mail-settings-dialog');
    $('#infoDialog .eyebrow').textContent = ui('관리자 설정');
    const host = $('#mailSettingsHost'),
      q = (selector) => host.querySelector(selector);
    try {
      let { settings } = await api('admin/mail-settings');
      if (!host.isConnected) return;
      let busy = false,
        initialized = false;
      host.innerHTML =
        ui(
          '<p>가입 인증·관리자 승인 요청·승인 안내·비밀번호 재설정에 사용할 메일 서버를 설정하세요. 저장하면 바로 적용됩니다.</p><form id="mailSettingsForm" class="server-form"><fieldset class="smtp-fields"><label class="mail-flag"><input name="enabled" type="checkbox">이메일 발송 사용</label><label class="field">승인 요청 수신 이메일<textarea name="reviewRecipients" rows="2" maxlength="4096" placeholder="admin@example.com, team@example.com" aria-describedby="reviewRecipientsHint"></textarea></label><p class="subtle" id="reviewRecipientsHint">쉼표나 줄바꿈으로 구분해 최대 10개. 비워두면 활성 관리자들의 등록 이메일로 보냅니다.</p><details id="smtpConnection" class="account-section"><summary>SMTP 서버 연결</summary><div class="mail-settings-grid">',
        ) +
        field(
          ui('SMTP 서버'),
          'host',
          '',
          'text',
          'maxlength="253" placeholder="smtp.example.com" autocomplete="off"',
        ) +
        field(ui('포트'), 'port', '', 'number', 'required min="1" max="65535"') +
        ui(
          '<label class="field">보안 연결<select name="security"><option value="starttls">STARTTLS · 보통 587번</option><option value="tls">TLS · 보통 465번</option></select></label>',
        ) +
        field(
          ui('발신 이메일'),
          'from',
          '',
          'email',
          'maxlength="254" placeholder="pmcanvas@example.com"',
        ) +
        ui(
          '</div><label class="mail-flag"><input name="authEnabled" type="checkbox">SMTP 인증 사용</label><div class="mail-settings-grid" id="smtpAuthFields">',
        ) +
        field(ui('인증 계정'), 'username', '', 'text', 'maxlength="254" autocomplete="off"') +
        field(
          ui('SMTP 비밀번호'),
          'smtpPassword',
          '',
          'password',
          'maxlength="4096" autocomplete="new-password"',
        ) +
        ui(
          '</div><p class="subtle" id="smtpPasswordHint"></p></details></fieldset><div class="mail-save-row"><button type="submit" class="button primary">설정 저장</button><span id="mailEnabledStatus" class="subtle"></span></div><p class="account-result" role="status" id="mailSaveResult"></p></form><section class="account-section"><h3>테스트 메일</h3><p class="subtle" id="mailTestHint"></p><form id="mailTestForm" class="server-form">',
        ) +
        field(
          ui('받는 이메일'),
          'to',
          user().email,
          'email',
          'required maxlength="254" autocomplete="email"',
        ) +
        ui(
          '<button class="button" type="submit">테스트 메일 보내기</button><p class="account-result" role="status" id="mailTestResult"></p></form></section>',
        );
      const form = q('#mailSettingsForm'),
        test = q('#mailTestForm'),
        e = form.elements;
      const value = () => ({
        enabled: e.enabled.checked,
        host: e.host.value.trim(),
        port: Number(e.port.value),
        secure: e.security.value === 'tls',
        from: e.from.value.trim(),
        authEnabled: e.authEnabled.checked,
        username: e.username.value.trim(),
        password: e.smtpPassword.value,
        reviewRecipients: e.reviewRecipients.value,
        revision: settings.revision,
      });
      const dirty = () => {
        const v = value();
        return (
          !!v.password ||
          v.reviewRecipients.trim() !== (settings.reviewRecipients || []).join(', ') ||
          ['enabled', 'host', 'port', 'secure', 'from', 'authEnabled', 'username'].some(
            (k) => v[k] !== settings[k],
          )
        );
      };
      const refresh = () => {
        const changed = dirty();
        form.querySelector('[type=submit]').disabled = busy || !changed;
        test.querySelector('[type=submit]').disabled = busy || changed || !settings.enabled;
        q('#mailTestHint').textContent = changed
          ? ui('변경한 설정을 먼저 저장해 주세요.')
          : settings.enabled
            ? ui('저장된 설정으로 테스트 메일을 보냅니다.')
            : ui('이메일 발송을 켜고 저장하면 테스트할 수 있어요.');
        e.host.required = e.from.required = e.enabled.checked;
        e.username.required = e.enabled.checked && e.authEnabled.checked;
        e.username.disabled = e.smtpPassword.disabled = !e.authEnabled.checked;
        q('#smtpAuthFields').hidden = !e.authEnabled.checked;
        q('#smtpPasswordHint').textContent = !e.authEnabled.checked
          ? ui('인증을 끄고 저장하면 등록된 계정과 비밀번호를 삭제합니다.')
          : settings.hasPassword
            ? ui(
                '비밀번호가 등록되어 있습니다. 빈칸이면 기존 값을 유지합니다. 서버나 계정을 바꿀 때는 다시 입력하세요.',
              )
            : ui('인증을 사용하는 메일 서버라면 비밀번호를 입력하세요.');
      };
      const populate = () => {
        if (!initialized) {
          q('#smtpConnection').open = !settings.host || !settings.from;
          initialized = true;
        }
        q('#smtpConnection summary').textContent =
          ui('SMTP 서버 연결 · ') + (settings.host ? ui('설정됨') : ui('설정 필요'));
        e.enabled.checked = settings.enabled;
        e.host.value = settings.host;
        e.port.value = settings.port;
        e.security.value = settings.secure ? 'tls' : 'starttls';
        e.from.value = settings.from;
        e.authEnabled.checked = settings.authEnabled;
        e.username.value = settings.username;
        e.reviewRecipients.value = (settings.reviewRecipients || []).join(', ');
        e.smtpPassword.value = '';
        e.smtpPassword.placeholder = settings.hasPassword ? ui('등록됨 · 변경할 때만 입력') : '';
        q('#smtpPasswordHint').textContent = settings.hasPassword
          ? ui(
              '비밀번호가 등록되어 있습니다. 빈칸이면 기존 값을 유지합니다. 서버나 계정을 바꿀 때는 다시 입력하세요.',
            )
          : ui('인증을 사용하는 메일 서버라면 비밀번호를 입력하세요.');
        q('#mailEnabledStatus').textContent = settings.enabled
          ? ui('발송 사용 중')
          : ui('발송 중지');
        refresh();
      };
      form.addEventListener('input', () => {
        q('#mailTestResult').textContent = '';
        q('#mailSaveResult').textContent = '';
        refresh();
      });
      form.addEventListener('change', (event) => {
        if (event.target === e.security && ['', '465', '587'].includes(e.port.value))
          e.port.value = e.security.value === 'tls' ? '465' : '587';
        refresh();
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        busy = true;
        const data = value();
        q('fieldset').disabled = true;
        refresh();
        q('#mailSaveResult').textContent = ui('저장 중…');
        try {
          ({ settings } = await api('admin/mail-settings', { method: 'PUT', body: data }));
          onEnabled(settings.enabled);
          if (host.isConnected) {
            populate();
            q('#mailSaveResult').textContent = ui('저장했습니다. 새 설정이 적용됐습니다.');
            q('#mailTestResult').textContent = '';
          }
        } catch (error) {
          if (host.isConnected) {
            q('#mailSaveResult').textContent = ui(error.message);
            if (error.status === 401) {
              e.smtpPassword.value = '';
              $('#infoDialog').close();
              showAuth(ui(error.message));
            }
          }
        } finally {
          busy = false;
          if (host.isConnected) {
            q('fieldset').disabled = false;
            refresh();
          }
        }
      };
      test.onsubmit = async (event) => {
        event.preventDefault();
        if (busy || dirty() || !settings.enabled) return;
        busy = true;
        refresh();
        test.elements.to.disabled = true;
        q('#mailTestResult').textContent = ui('테스트 메일 발송 중…');
        try {
          const result = await api('admin/mail-settings/test', {
            method: 'POST',
            body: { to: test.elements.to.value },
          });
          if (host.isConnected) q('#mailTestResult').textContent = ui(result.message);
        } catch (error) {
          if (host.isConnected) {
            q('#mailTestResult').textContent = ui(error.message);
            if (error.status === 401) {
              $('#infoDialog').close();
              showAuth(ui(error.message));
            }
          }
        } finally {
          busy = false;
          if (host.isConnected) {
            test.elements.to.disabled = false;
            refresh();
          }
        }
      };
      registerGuard({ dirty, busy: () => busy });
      populate();
    } catch (error) {
      if (host.isConnected) host.textContent = ui(error.message);
    }
  };
}
