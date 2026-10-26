import { escapeHtml as esc } from './html.js';
import { field } from './view-ui.js';
export function createSecurityUi({
  api,
  user,
  project,
  openInfo,
  toast,
  showAuth,
  securityNav,
  document = globalThis.document,
  confirm = globalThis.confirm,
}) {
  const $ = (s) => document.querySelector(s);
  async function openConnections() {
    if (!user()?.isAdmin) return;
    openInfo('SSO 연결과 계정 매핑', '<p>불러오는 중…</p>');
    try {
      const { providers, identities } = await api('auth/connections');
      $('#infoBody').innerHTML =
        '<p>인증 연결은 서버의 AUTH_CONFIG_FILE 컨피그에서 설정합니다. 변경 후 앱을 재시작하세요.</p>' +
        (providers.length
          ? providers
              .map(
                (p) =>
                  '<article class="connection-card"><strong>' +
                  esc(p.label) +
                  ' · ' +
                  esc(p.type.toUpperCase()) +
                  '</strong><p class="subtle">자동 계정 생성 ' +
                  (p.autoProvision ? '사용' : '사용 안 함') +
                  ' · 허용 도메인 ' +
                  esc(p.allowedDomains.join(', ') || '개별 계정 매핑') +
                  '</p>' +
                  (p.callbackUrl
                    ? '<p>콜백 주소<br><code>' + esc(p.callbackUrl) + '</code></p>'
                    : '') +
                  (p.metadataUrl
                    ? '<a class="button small" href="' +
                      esc(p.metadataUrl) +
                      '" target="_blank" rel="noopener">SAML SP 메타데이터</a>'
                    : '') +
                  '</article>',
              )
              .join('')
          : '<div class="notice">등록된 인증 연결이 없습니다. 컨피그에 연결을 추가하면 이곳과 로그인 화면에 표시됩니다.</div>') +
        '<h3>연결된 외부 계정</h3>' +
        identities
          .map((i) => {
            const p = providers.find((p) => p.key === i.providerKey);
            return (
              '<article class="connection-card"><strong>' +
              esc(i.name) +
              ' · ' +
              esc(i.email) +
              '</strong><p>' +
              esc(p?.label || '이전 설정의 연결') +
              '</p><code>' +
              esc(i.subject) +
              '</code>' +
              (p
                ? '<div class="identity-actions"><button class="button small" data-unlink-provider="' +
                  esc(p.id) +
                  '" data-unlink-subject="' +
                  esc(i.subject) +
                  '">연결 해제</button></div>'
                : '') +
              '</article>'
            );
          })
          .join('') +
        (providers.length
          ? '<form id="linkIdentityForm" class="server-form"><h3>기존 계정에 외부 ID 연결</h3><p class="subtle">이메일만 일치한다고 자동 연결하지 않습니다. 인증 서버에서 확인한 불변 고유 ID를 입력하세요. OIDC는 sub, SAML은 영구 NameID, AD는 objectGUID의 base64:값입니다. 비상 복구용 관리자 계정에는 연결할 수 없습니다.</p><label class="field">인증 연결<select name="provider">' +
            providers
              .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>')
              .join('') +
            '</select></label>' +
            field('기존 사용자 이메일', 'email', '', 'email', 'required') +
            field(
              '외부 고유 ID',
              'subject',
              '',
              'text',
              'required maxlength="1024" autocomplete="off"',
            ) +
            '<button class="button primary">외부 계정 연결</button><p class="account-result" role="status"></p></form>'
          : '');
    } catch (error) {
      $('#infoBody').textContent = error.message;
    }
    securityNav();
  }
  async function openAudit() {
    const p = project();
    if (!p) return;
    openInfo('프로젝트 변경 이력', '<p>불러오는 중…</p>');
    $('#infoDialog').classList.add('report-dialog');
    try {
      const { events } = await api('projects/' + p.id + '/events');
      const labels = { project: '프로젝트', member: '참여인력', task: '업무', item: '세부 작업' },
        actions = { create: '추가', update: '수정', delete: '삭제' };
      $('#infoBody').innerHTML =
        '<p class="subtle">최근 100건의 서버 저장 이력입니다. 완료 체크 취소·삭제 전 내용도 보관합니다.</p>' +
        (events.length
          ? events
              .map(
                (event) =>
                  '<article class="audit-entry"><strong>' +
                  esc(event.actor) +
                  ' · ' +
                  esc(new Date(event.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })) +
                  '</strong><small>버전 ' +
                  event.revision +
                  ' · ' +
                  esc(
                    {
                      'project.created': '프로젝트 생성',
                      'project.updated': '프로젝트 수정',
                      'access.granted': '접근 권한 부여',
                      'access.revoked': '접근 권한 해제',
                    }[event.type] || '변경',
                  ) +
                  '</small><ul>' +
                  event.changes
                    .slice(0, 10)
                    .map(
                      (c) =>
                        '<li>' +
                        esc(labels[c.entity] || '접근 권한') +
                        ' ' +
                        esc(actions[c.action] || '변경') +
                        ' · ' +
                        esc(
                          c.after?.title ||
                            c.before?.title ||
                            c.after?.name ||
                            c.before?.name ||
                            c.email ||
                            c.userId ||
                            '',
                        ) +
                        (c.entity === 'item' && c.before?.doneDate !== c.after?.doneDate
                          ? ' <span class="muted">완료일 ' +
                            esc(c.before?.doneDate || '미완료') +
                            ' → ' +
                            esc(c.after?.doneDate || '미완료') +
                            '</span>'
                          : '') +
                        '</li>',
                    )
                    .join('') +
                  '</ul>' +
                  (event.changes.length > 10
                    ? '<p class="subtle">외 ' + (event.changes.length - 10) + '개 변경</p>'
                    : '') +
                  '</article>',
              )
              .join('')
          : '<div class="calm-state">저장 이력이 없습니다.</div>');
    } catch (error) {
      $('#infoBody').textContent = error.message;
    }
  }
  async function openSecurityAudit() {
    try {
      const { events } = await api('auth/security-events');
      openInfo(
        '인증·계정 관리 감사 로그',
        '<p>최근 200건 · 보관 기간 90일 · IP는 해시로 저장합니다. 비밀번호·MFA 키·인증 코드는 기록하지 않습니다.</p>' +
          events
            .map(
              (e) =>
                '<article class="audit-entry"><strong>' +
                esc(e.kind) +
                '</strong><small>' +
                esc(new Date(e.at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })) +
                '</small><p>' +
                esc(e.details.code || e.details.change || '') +
                '</p></article>',
            )
            .join(''),
      );
    } catch (error) {
      toast(error.message);
    }
  }

  $('#infoBody').addEventListener('submit', async (e) => {
    if (e.target.id !== 'linkIdentityForm') return;
    e.preventDefault();
    const form = e.target,
      data = new FormData(form),
      button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('auth/connections', {
        method: 'POST',
        body: {
          provider: data.get('provider'),
          email: data.get('email'),
          subject: data.get('subject'),
        },
      });
      await openConnections();
      toast('외부 계정을 연결했습니다.');
    } catch (error) {
      form.querySelector('.account-result').textContent = error.message;
      if (error.status === 401) {
        $('#infoDialog').close();
        showAuth(error.message);
      }
    } finally {
      button.disabled = false;
    }
  });
  $('#infoBody').addEventListener('click', async (e) => {
    const unlink = e.target.closest('[data-unlink-provider]');
    if (unlink) {
      if (
        !confirm(
          '외부 계정 연결을 해제하고 이 사용자의 로그인 세션을 종료할까요? 자동 계정 생성을 사용하는 연결에서는 재로그인 시 새 계정 생성 정책이 적용됩니다.',
        )
      )
        return;
      unlink.disabled = true;
      try {
        await api('auth/connections', {
          method: 'DELETE',
          body: { provider: unlink.dataset.unlinkProvider, subject: unlink.dataset.unlinkSubject },
        });
        await openConnections();
      } catch (error) {
        toast(error.message);
        unlink.disabled = false;
      }
      return;
    }
  });
  return { connections: openConnections, projectAudit: openAudit, audit: openSecurityAudit };
}
