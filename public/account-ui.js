import { escapeHtml as esc } from './html.js';

export function accountRows(users, field) {
  return (
    users
      .map((user) => {
        const status = user.isAdmin
          ? '관리자'
          : user.registrationPending
            ? user.emailVerified
              ? '승인 대기'
              : '이메일 인증 대기'
            : user.registrationRejected
              ? '가입 거절'
              : user.isActive
                ? '활성'
                : '비활성';
        const review = user.registrationPending
          ? `<button class="button small primary" data-registration-review="${esc(user.id)}">신청 검토</button>`
          : '';
        let controls = '';
        if (!user.isAdmin && !user.registrationPending && !user.registrationRejected) {
          const label = user.isActive ? '비활성화' : '다시 활성화';
          controls = `<details class="account-controls"><summary>계정 관리</summary>
        <p><button class="button small" data-user-status="${esc(user.id)}" data-registration-pending="false" data-next-active="${!user.isActive}" aria-label="${esc(user.name)} ${label}">${label}</button></p>`;
          controls +=
            user.localLogin === false
              ? '<p class="subtle">비밀번호는 회사 인증 서비스에서 변경합니다.</p>'
              : `<form class="server-form" data-reset-user="${esc(user.id)}"><p class="subtle">새 임시 비밀번호를 사용자에게 직접 전달하세요.</p>${field('새 임시 비밀번호', 'password', '', 'password', 'required minlength="12" maxlength="256" autocomplete="new-password"')}<button class="button">비밀번호 재설정</button><p class="account-result" role="status"></p></form>`;
          controls += '</details>';
        }
        const notices = [
          [
            '관리자 승인 요청',
            user.registrationPending && user.reviewMailStatus,
            'data-retry-review',
          ],
          ['승인 안내', user.approvalMailStatus, 'data-retry-notice'],
        ]
          .filter(([, state]) => state)
          .map(([label, state, retry]) =>
            state === 'failed'
              ? `<p class="form-error">${label} 메일 발송 실패 <button class="auth-link" ${retry}="${esc(user.id)}">다시 보내기</button></p>`
              : `<small>${label} 메일 · ${{ sent: 'SMTP 전달 완료', pending: '발송 대기', sending: '발송 중' }[state] || '처리 중'}</small>`,
          )
          .join('');
        return `<article class="account-user"><div class="sharing-row"><span><strong>${esc(user.name)}</strong><small>${esc(user.email)}</small></span><span class="badge neutral">${status}</span>${review}</div>
      ${user.registrationRejected ? `<details class="account-controls"><summary>거절 사유</summary><p>${esc(user.rejectionReason || '미입력')}</p></details>` : ''}
      ${notices.includes('form-error') ? notices : notices ? `<details class="account-controls"><summary>메일 발송 상태</summary>${notices}</details>` : ''}${controls}</article>`;
      })
      .join('') || '<p class="calm-state">해당하는 계정이 없습니다.</p>'
  );
}
