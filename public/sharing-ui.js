import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { field } from './view-ui.js';
export function createSharingUi({
  api,
  project,
  mappings,
  openInfo,
  toast,
  showAuth,
  document = globalThis.document,
  confirm = globalThis.confirm,
}) {
  const $ = (s) => document.querySelector(s);
  async function openSharing() {
    const p = project();
    if (!p || p._role !== 'owner') {
      toast(ui('소유자만 접근 권한을 관리할 수 있습니다.'));
      return;
    }
    openInfo(ui('프로젝트 공유'), ui('<p>불러오는 중…</p>'));
    try {
      const { access } = await api('projects/' + p.id + '/access');
      $('#infoBody').innerHTML =
        ui(
          '<p class="subtle">참여인력 정보와 로그인 계정은 별도로 관리합니다. 등록된 계정의 이메일로 접근 권한을 부여하세요.</p>',
        ) +
        '<div class="sharing-list">' +
        access
          .map(
            (a) =>
              '<div class="sharing-row"><span><strong>' +
              esc(a.name) +
              '</strong><small>' +
              esc(a.email) +
              ' · ' +
              { owner: ui('소유자'), editor: ui('편집자'), viewer: ui('조회자') }[a.role] +
              '</small></span>' +
              (a.role === 'owner'
                ? ''
                : '<button class="button small" data-revoke-user="' +
                  esc(a.id) +
                  ui('">접근 해제</button>')) +
              '</div>',
          )
          .join('') +
        '</div>' +
        '<form id="shareForm" class="server-form">' +
        field(ui('사용자 이메일'), 'email', '', 'email', 'required') +
        ui(
          '<label class="field">권한<select name="role"><option value="editor">편집자 · 업무와 완료 체크 수정</option><option value="viewer">조회자 · 조회와 출력</option></select></label><button class="button primary">공유 권한 저장</button><p id="shareResult" role="status"></p></form>',
        ) +
        (await mappings(p, access));
    } catch (error) {
      $('#infoBody').textContent = ui(error.message);
    }
  }

  $('#infoBody').addEventListener('submit', async (e) => {
    if (e.target.id !== 'shareForm') return;
    e.preventDefault();
    const form = e.target,
      data = new FormData(form),
      button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('projects/' + project().id + '/access', {
        method: 'POST',
        body: { email: data.get('email'), role: data.get('role') },
      });
      await openSharing();
      toast(ui('프로젝트 접근 권한을 저장했습니다.'));
    } catch (error) {
      $('#shareResult').textContent = ui(error.message);
      if (error.status === 401) {
        $('#infoDialog').close();
        showAuth(ui(error.message));
      }
    } finally {
      button.disabled = false;
    }
  });
  $('#infoBody').addEventListener('click', async (e) => {
    const revoke = e.target.closest('[data-revoke-user]');
    if (!revoke) return;
    if (!confirm(ui('이 사용자의 프로젝트 접근 권한을 해제할까요?'))) return;
    revoke.disabled = true;
    try {
      await api('projects/' + project().id + '/access/' + revoke.dataset.revokeUser, {
        method: 'DELETE',
        body: {},
      });
      await openSharing();
    } catch (error) {
      toast(ui(error.message));
      revoke.disabled = false;
    }
  });
  return { open: openSharing };
}
