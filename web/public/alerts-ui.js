import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
export const operationLabels = {
  backup: ui('DB 백업 실패'),
  restore: ui('복원 점검 실패'),
  mail: ui('메일 발송 실패'),
};
export function alertsBody({ settings, alerts, mailFailures = [] }) {
  const labels = {
    connection: ui('SMTP 연결 실패'),
    tls: ui('SMTP 보안 연결 실패'),
    auth: ui('SMTP 인증 실패'),
    recipient: ui('수신자 거부'),
    other: ui('기타 메일 실패'),
  };
  return (
    ui(
      '<p>백업·복원 점검·메일 발송 실패만 알립니다. 같은 종류는 묶어서 최대 한 시간에 한 번 발송하며, 실패한 알림 메일은 최대 3회 시도합니다.</p>',
    ) +
    '<div class="operation-alert-list">' +
    (alerts
      .filter((a) => a.occurrences > a.acknowledged)
      .map(
        (a) =>
          '<article class="account-section"><strong>' +
          esc(operationLabels[a.kind]) +
          '</strong><p>' +
          a.occurrences +
          ui('회 · ') +
          esc(a.lastAt) +
          '</p><p class="subtle">' +
          (a.attempts >= 3
            ? ui('알림 메일 재시도 한도에 도달했습니다. SMTP 설정을 확인하세요.')
            : a.notified >= a.occurrences
              ? ui('이메일 알림을 보냈습니다.')
              : ui('이메일 발송 대기 또는 재시도 중입니다.')) +
          '</p><button class="button small" data-alert-ack="' +
          esc(a.kind) +
          '" data-count="' +
          a.occurrences +
          ui('">확인 완료</button></article>'),
      )
      .join('') || ui('<p class="notice">확인할 운영 실패 알림이 없습니다.</p>')) +
    '</div>' +
    (mailFailures.length
      ? '<details class="account-section"><summary>' +
        ui('메일 실패 상세') +
        '</summary><p class="subtle">' +
        ui(
          '분류별 누적 횟수입니다. 명확한 수신자 거부는 운영 알림에서 제외하며, 이전 실패는 소급 분류하지 않습니다.',
        ) +
        '</p>' +
        mailFailures
          .map(
            (row) =>
              '<p><strong>' +
              esc(labels[row.category] || row.category) +
              '</strong> · ' +
              esc(row.occurrences) +
              ui('회 · ') +
              esc(row.lastAt) +
              '</p>',
          )
          .join('') +
        '</details>'
      : '') +
    '<form id="alertSettingsForm" class="server-form"><label class="toggle-label"><input type="checkbox" name="enabled" ' +
    (settings.enabled ? 'checked' : '') +
    ui(
      '>운영 실패 이메일 알림</label><label class="field">알림 받을 이메일<textarea name="recipients" rows="2" maxlength="4096">',
    ) +
    esc(settings.recipients.join(', ')) +
    ui(
      '</textarea><small>쉼표나 줄바꿈으로 최대 10개. 비워두면 활성 관리자에게 보냅니다.</small></label><p class="subtle">SMTP 장애에서는 알림 메일도 도착하지 않을 수 있습니다. 이 화면에서도 확인하세요. 확인 완료는 원인 해결을 뜻하지 않으며 이후 실패는 다시 표시합니다.</p><button class="button primary">설정 저장</button><p role="status" class="account-result"></p></form>',
    )
  );
}
export function createAlertsUi({ api, user, openInfo, dialog, toast, onChange = () => {} }) {
  return async function open() {
    if (!user()?.isAdmin || !dialog.canLeave()) return;
    openInfo(ui('운영 실패 알림'), ui('<div id="operationAlertsHost"><p>불러오는 중…</p></div>'));
    const host = document.querySelector('#operationAlertsHost');
    try {
      let state = await api('admin/alerts');
      if (!host.isConnected || !document.querySelector('#infoDialog').open) return;
      function paint() {
        onChange();
        host.innerHTML = alertsBody(state);
        const form = host.querySelector('form'),
          initial = new FormData(form);
        let busy = false;
        dialog.registerGuard({
          busy: () => busy,
          dirty: () =>
            form.elements.enabled.checked !== initial.has('enabled') ||
            form.elements.recipients.value !== initial.get('recipients'),
        });
        form.onsubmit = async (e) => {
          e.preventDefault();
          busy = true;
          form.querySelector('button').disabled = true;
          try {
            state = await api('admin/alerts', {
              method: 'PUT',
              body: {
                enabled: form.elements.enabled.checked,
                recipients: form.elements.recipients.value,
                revision: state.settings.revision,
              },
            });
            paint();
            toast(ui('운영 알림 설정을 저장했습니다.'));
          } catch (error) {
            form.querySelector('.account-result').textContent = ui(error.message);
          } finally {
            busy = false;
            if (form.isConnected) form.querySelector('button').disabled = false;
          }
        };
        host.querySelectorAll('[data-alert-ack]').forEach(
          (button) =>
            (button.onclick = async () => {
              if (!dialog.canLeave()) return;
              busy = true;
              button.disabled = true;
              try {
                state = await api('admin/alerts/acknowledge', {
                  method: 'POST',
                  body: { kind: button.dataset.alertAck, count: Number(button.dataset.count) },
                });
                paint();
              } catch (error) {
                toast(ui(error.message));
                button.disabled = false;
              } finally {
                busy = false;
              }
            }),
        );
      }
      paint();
    } catch (error) {
      host.textContent = ui(error.message);
    }
  };
}
