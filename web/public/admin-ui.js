import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { field } from './view-ui.js';
import { accountRows } from './account-ui.js';
import { DraftStore } from './draft-store.js';
import { workspaceOperations } from './operations-ui.js';
import { createMailSettingsUi } from './mail-settings-ui.js';
import { createSharingUi } from './sharing-ui.js';
import { createSecurityUi } from './security-ui.js';
export function createAdminUi({
  api,
  user,
  project,
  projects,
  wbs,
  hasUnsaved,
  isBusy,
  openInfo,
  toast,
  showAuth,
  dialog,
  canChange,
  reload,
  openTask,
  onMailEnabled,
  document = globalThis.document,
  location = globalThis.location,
  confirm = globalThis.confirm,
}) {
  const $ = (s) => document.querySelector(s);
  const sharing = createSharingUi({
    api,
    project,
    mappings: (p, a) => ops.mappings(p, a),
    openInfo,
    toast,
    showAuth,
    document,
    confirm,
  });
  const security = createSecurityUi({
    api,
    user,
    project,
    openInfo,
    toast,
    showAuth,
    securityNav: () => ops.securityNav(),
    document,
    confirm,
  });
  const openSharing = sharing.open,
    openConnections = security.connections,
    openSecurityAudit = security.audit;
  async function openAccount() {
    if (!user()) return showAuth();
    if (!dialog.canLeave()) return;
    openInfo(
      ui('계정 관리'),
      '<p><strong>' +
        esc(user().name) +
        '</strong><br>' +
        esc(user().email) +
        ui(
          '</p><button class="button" data-action="logout">로그아웃</button><section class="account-section"><label><input type="checkbox" id="draftPersist" ',
        ) +
        (DraftStore.persistent(user().id) ? 'checked' : '') +
        ui(
          '>브라우저를 닫은 후에도 초안 보관 (최대 8시간)</label><p>기본값은 현재 탭에서만 보관입니다. 보관 초안은 암호화되지 않으며 로그아웃 시 삭제됩니다.</p></section>',
        ) +
        (user().isAdmin
          ? ui(
              '<div class="admin-account-actions"><button class="button primary" data-action="admin">관리자 설정</button></div><p>관리자 인증 앱 MFA가 적용됩니다. 복구 코드는 한 번만 사용할 수 있습니다.</p>',
            )
          : '') +
        (user().isAdmin && $('#accountButton').dataset.alerts
          ? '<p class="notice"><button class="button" data-action="operation-alerts">' +
            ui('운영 실패 알림') +
            ' · ' +
            esc($('#accountButton').dataset.alerts) +
            '</button></p>'
          : '') +
        (user().localLogin === false
          ? ui(
              '<section class="account-section"><p>외부 인증 계정입니다. 비밀번호는 회사 인증 서버에서 변경해 주세요.</p></section>',
            )
          : ui(
              '<section class="account-section"><details><summary>내 비밀번호 변경</summary><p class="subtle">변경하면 모든 기기에서 로그아웃됩니다.</p><form id="changePasswordForm" class="server-form">',
            ) +
            field(
              ui('현재 비밀번호'),
              'currentPassword',
              '',
              'password',
              'required maxlength="256" autocomplete="current-password"',
            ) +
            field(
              ui('새 비밀번호'),
              'newPassword',
              '',
              'password',
              'required minlength="12" maxlength="256" autocomplete="new-password"',
            ) +
            field(
              ui('새 비밀번호 확인'),
              'confirmPassword',
              '',
              'password',
              'required minlength="12" maxlength="256" autocomplete="new-password"',
            ) +
            ui(
              '<button class="button primary">비밀번호 변경</button><p class="account-result" role="status"></p></form></details></section>',
            )),
    );
    dialog.guardForms($('#infoBody'));
  }
  let knownUsers = [];
  async function refreshUsers({ cached = false } = {}) {
    const list = $('#userList');
    if (!list) return;
    try {
      const { users } = cached ? { users: knownUsers } : await api('users');
      if (!list.isConnected) return;
      knownUsers = users;
      users.sort((a, b) => Number(b.registrationPending) - Number(a.registrationPending));
      list.innerHTML = accountRows(ops.filterUsers(users), field);
    } catch (error) {
      if (list.isConnected) list.textContent = ui(error.message);
    }
  }

  $('#infoBody').addEventListener('submit', async (e) => {
    if (
      !['createUserForm', 'changePasswordForm'].includes(e.target.id) &&
      !e.target.dataset.resetUser
    )
      return;
    e.preventDefault();
    const form = e.target,
      data = new FormData(form),
      button = form.querySelector('button');
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    button.disabled = true;
    try {
      if (form.id === 'createUserForm') {
        await api('users', {
          method: 'POST',
          body: {
            name: data.get('name'),
            email: data.get('email'),
            password: data.get('password'),
          },
        });
        form.reset();
        form.querySelector('.account-result').textContent = ui(
          '계정을 만들었습니다. 프로젝트 공유에서 추가할 수 있습니다.',
        );
        await refreshUsers();
      } else if (form.id === 'changePasswordForm') {
        if (isBusy() || hasUnsaved())
          throw Error(ui('현재 변경사항을 먼저 저장하거나 백업한 뒤 진행해 주세요.'));
        if (data.get('newPassword') !== data.get('confirmPassword'))
          throw Error(ui('새 비밀번호 확인이 일치하지 않습니다.'));
        await api('auth/password', {
          method: 'POST',
          body: {
            currentPassword: data.get('currentPassword'),
            newPassword: data.get('newPassword'),
          },
        });
        form.reset();
        $('#infoDialog').close();
        showAuth(ui('비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.'));
      } else if (form.dataset.resetUser) {
        if (!confirm(ui('이 사용자의 비밀번호를 재설정하고 모든 기기에서 로그아웃할까요?'))) return;
        await api('users/' + form.dataset.resetUser, {
          method: 'PATCH',
          body: { password: data.get('password') },
        });
        form.reset();
        form.querySelector('.account-result').textContent = ui(
          '비밀번호를 재설정했습니다. 사용자에게 새 비밀번호를 전달해 주세요.',
        );
      }
    } catch (error) {
      (form.querySelector('.account-result') || $('#shareResult')).textContent = ui(error.message);
      if (error.status === 401) {
        $('#infoDialog').close();
        showAuth(ui(error.message));
      }
    } finally {
      delete form.dataset.submitting;
      button.disabled = false;
    }
  });
  $('#infoBody').addEventListener('click', async (e) => {
    const reviewRetry = e.target.closest('[data-retry-review]');
    if (reviewRetry) {
      reviewRetry.disabled = true;
      try {
        await api('users/' + reviewRetry.dataset.retryReview + '/review-notice', {
          method: 'POST',
          body: {},
        });
        await refreshUsers();
        toast(ui('관리자 승인 요청 메일 발송을 다시 요청했습니다.'));
      } catch (error) {
        toast(ui(error.message));
        reviewRetry.disabled = false;
      }
      return;
    }
    const retry = e.target.closest('[data-retry-notice]');
    if (retry) {
      retry.disabled = true;
      try {
        await api('users/' + retry.dataset.retryNotice + '/approval-notice', {
          method: 'POST',
          body: {},
        });
        await refreshUsers();
        toast(ui('승인 안내 메일 발송을 다시 요청했습니다.'));
      } catch (error) {
        toast(ui(error.message));
        retry.disabled = false;
      }
      return;
    }
    const status = e.target.closest('[data-user-status]');
    if (status) {
      const isActive = status.dataset.nextActive === 'true';
      if (
        !confirm(
          status.dataset.registrationPending === 'true'
            ? ui('이메일과 소속을 확인한 계정의 가입을 승인할까요?')
            : isActive
              ? ui('이 계정을 다시 활성화할까요?')
              : ui(
                  '이 계정을 비활성화하고 모든 기기에서 로그아웃할까요? 프로젝트 데이터는 보존됩니다.',
                ),
        )
      )
        return;
      status.disabled = true;
      try {
        await api('users/' + status.dataset.userStatus, { method: 'PATCH', body: { isActive } });
        await refreshUsers();
        toast(
          status.dataset.registrationPending === 'true'
            ? ui('가입을 승인했습니다. 안내 메일을 발송합니다.')
            : isActive
              ? ui('계정을 활성화했습니다.')
              : ui('계정을 비활성화했습니다.'),
        );
      } catch (error) {
        toast(ui(error.message));
        status.disabled = false;
      }
      return;
    }
  });
  $('#infoBody').addEventListener('change', (e) => {
    if (e.target.id === 'draftPersist')
      try {
        DraftStore.setPersistent(user().id, e.target.checked);
        wbs.persistDraft();
      } catch {
        e.target.checked = !e.target.checked;
        toast(ui('초안 보관 설정을 바꾸지 못했습니다. 저장 공간 설정을 확인해 주세요.'));
      }
  });
  function logout() {
    if (isBusy()) {
      toast(ui('저장 완료 후 로그아웃해 주세요.'));
      return;
    }
    if (!dialog.canLeave()) return;
    if (hasUnsaved() && !confirm(ui('미저장 변경사항과 보관 초안을 삭제하고 로그아웃할까요?')))
      return;
    api('auth/logout', { method: 'POST', body: {} })
      .then(() => {
        DraftStore.clearUser(user().id);
        clearTimeout(wbs.draftTimer);
        wbs.draft = null;
        wbs.pending.clear();
        location.reload();
      })
      .catch((e) => toast(e.message));
  }

  $('#accountButton').addEventListener('click', openAccount);
  const openMailSettings = createMailSettingsUi({
    api,
    field,
    openInfo,
    user,
    onEnabled: onMailEnabled,
    showAuth,
    registerGuard: dialog.registerGuard,
  });
  const ops = workspaceOperations({
    dialog,
    api,
    esc,
    field,
    openInfo,
    toast,
    user,
    projects,
    refreshUsers,
    openMail: openMailSettings,
    openConnections,
    openAudit: openSecurityAudit,
    canChange,
    reload,
    openTask,
  });
  const trashButton = document.createElement('button');
  trashButton.className = 'button ghost small';
  trashButton.textContent = ui('휴지통');
  trashButton.id = 'trashButton';
  trashButton.onclick = () => {
    trashButton.closest('details').open = false;
    ops.trash();
  };
  document.querySelector('.top-file-menu .menu-popover').append(trashButton);

  return {
    open: ops.admin,
    summary: ops.summary,
    trash: ops.trash,
    account: openAccount,
    sharing: openSharing,
    connections: openConnections,
    audit: security.projectAudit,
    securityAudit: openSecurityAudit,
    mail: openMailSettings,
    logout,
  };
}
