import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';

export function accountRows(users, field) {
  return (
    users
      .map((user) => {
        const status = user.isAdmin
          ? ui('관리자')
          : user.registrationPending
            ? user.emailVerified
              ? ui('승인 대기')
              : ui('이메일 인증 대기')
            : user.registrationRejected
              ? ui('가입 거절')
              : user.isActive
                ? ui('활성')
                : ui('비활성');
        const review = user.registrationPending
          ? ui('<button class="button small primary" data-registration-review="') +
            String(esc(user.id)) +
            ui('">신청 검토</button>')
          : '';
        let controls = '';
        if (!user.isAdmin && !user.registrationPending && !user.registrationRejected) {
          const label = user.isActive ? ui('비활성화') : ui('다시 활성화');
          controls =
            ui(
              '<details class="account-controls"><summary>계정 관리</summary>\n        <p><button class="button small" data-user-status="',
            ) +
            String(esc(user.id)) +
            ui('" data-registration-pending="false" data-next-active="') +
            String(!user.isActive) +
            ui('" aria-label="') +
            String(esc(user.name)) +
            ui(' ') +
            String(label) +
            ui('">') +
            String(label) +
            ui('</button></p>');
          controls +=
            user.localLogin === false
              ? ui('<p class="subtle">비밀번호는 회사 인증 서비스에서 변경합니다.</p>')
              : ui('<form class="server-form" data-reset-user="') +
                String(esc(user.id)) +
                ui('"><p class="subtle">새 임시 비밀번호를 사용자에게 직접 전달하세요.</p>') +
                String(
                  field(
                    ui('새 임시 비밀번호'),
                    'password',
                    '',
                    'password',
                    'required minlength="12" maxlength="256" autocomplete="new-password"',
                  ),
                ) +
                ui(
                  '<button class="button">비밀번호 재설정</button><p class="account-result" role="status"></p></form>',
                );
          controls += '</details>';
        }
        const notices = [
          [
            ui('관리자 승인 요청'),
            user.registrationPending && user.reviewMailStatus,
            'data-retry-review',
          ],
          [ui('승인 안내'), user.approvalMailStatus, 'data-retry-notice'],
        ]
          .filter(([, state]) => state)
          .map(([label, state, retry]) =>
            state === 'failed'
              ? ui('<p class="form-error">') +
                String(label) +
                ui(' 메일 발송 실패 <button class="auth-link" ') +
                String(retry) +
                ui('="') +
                String(esc(user.id)) +
                ui('">다시 보내기</button></p>')
              : ui('<small>') +
                String(label) +
                ui(' 메일 · ') +
                String(
                  { sent: ui('SMTP 전달 완료'), pending: ui('발송 대기'), sending: ui('발송 중') }[
                    state
                  ] || ui('처리 중'),
                ) +
                ui('</small>'),
          )
          .join('');
        return `<article class="account-user"><div class="sharing-row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span><span class="badge neutral">${status}</span>${review}</div>
      ${user.registrationRejected ? ui('<details class="account-controls"><summary>거절 사유</summary><p>') + String(esc(user.rejectionReason || ui('미입력'))) + ui('</p></details>') : ''}
      ${notices.includes('form-error') ? notices : notices ? ui('<details class="account-controls"><summary>메일 발송 상태</summary>') + String(notices) + ui('</details>') : ''}${controls}</article>`;
      })
      .join('') || ui('<p class="calm-state">해당하는 계정이 없습니다.</p>')
  );
}
