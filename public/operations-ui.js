import { createBackupSettingsUi } from './backup-settings-ui.js';

export function workspaceOperations({
  api,
  esc,
  field,
  openInfo,
  toast,
  user,
  projects,
  refreshUsers,
  openMail,
  openConnections,
  openAudit,
  canChange,
  reload,
  openTask,
  dialog,
}) {
  const body = () => document.querySelector('#infoBody');
  let users = [],
    search = '',
    adminTab = '',
    pendingCount = 0,
    screen = 0;
  const backup = createBackupSettingsUi({ api, field, openInfo, toast, dialog });
  const tabs = [
    ['users', '사용자'],
    ['mail', '메일'],
    ['security', '인증·보안'],
    ['backups', '백업'],
  ];
  const nav = () =>
    `<nav class="admin-tabs" aria-label="관리자 설정">${tabs.map(([id, label]) => `<button class="button small ${adminTab === id ? 'primary' : ''}" data-admin-tab="${id}" aria-current="${adminTab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>`;
  function mountNav() {
    if (!body().querySelector('.admin-tabs')) body().insertAdjacentHTML('afterbegin', nav());
    document.querySelector('#infoDialog .eyebrow').textContent = '관리자 설정';
  }
  async function summary() {
    if (!user()?.isAdmin) return;
    try {
      const s = await api('admin/summary');
      pendingCount = s.pending;
      const b = document.querySelector('#accountButton');
      b.dataset.pending = s.pending || '';
      b.textContent = (user().name || '계정') + (s.pending ? ' · 승인 ' + s.pending : '');
    } catch {
      /* The account menu remains usable when the summary is unavailable. */
    }
  }
  async function admin(tab = 'users') {
    if (!user()?.isAdmin || !dialog.canLeave()) return;
    const initialStatus = tab === 'pending' ? 'pending' : pendingCount ? 'pending' : 'all';
    adminTab = tab === 'pending' ? 'users' : tab;
    const generation = ++screen;
    backup.stop();
    if (adminTab === 'mail') {
      await openMail();
      if (generation === screen && body().querySelector('#mailSettingsHost')) mountNav();
      return;
    }
    if (adminTab === 'backups') {
      await backup.open(nav());
      return;
    }
    if (adminTab === 'security') {
      openInfo(
        '관리자 설정',
        nav() +
          '<h3>인증과 보안</h3><p class="subtle">관리자 로그인에는 인증 앱 MFA가 적용됩니다.</p><button class="button" data-admin-security="connections">회사 로그인 연결</button> <button class="button" data-admin-security="audit">보안 감사 로그</button>',
      );
      return;
    }
    search = '';
    openInfo(
      '관리자 설정',
      nav() +
        `<h3>사용자 관리</h3><p id="approvalCount" class="subtle"></p><div class="admin-filters"><input id="userSearch" type="search" placeholder="이름 또는 이메일" aria-label="사용자 검색"><select id="userStatus" aria-label="계정 상태"><option value="all">전체 계정</option><option value="pending">승인 대기</option><option value="unverified">이메일 인증 대기</option><option value="active">활성 계정</option><option value="inactive">비활성 계정</option><option value="rejected">가입 거절</option></select></div><div id="userList" aria-live="polite">불러오는 중…</div><details class="account-section"><summary>사용자 직접 추가</summary><form id="createUserForm" class="server-form">${field('이름', 'name', '', 'text', 'required maxlength="80"')}${field('이메일', 'email', '', 'email', 'required autocomplete="off"')}${field('초기 비밀번호', 'password', '', 'password', 'required minlength="12" maxlength="256" autocomplete="new-password"')}<button class="button primary">계정 만들기</button><p class="account-result" role="status"></p></form></details>`,
    );
    body().querySelector('#userStatus').value = initialStatus;
    await refreshUsers();
  }
  function filterUsers(data) {
    users = data;
    const status = body().querySelector('#userStatus')?.value;
    if (!status) return data;
    const pending = data.filter((u) => u.registrationPending && u.emailVerified).length,
      unverified = data.filter((u) => u.registrationPending && !u.emailVerified).length;
    body().querySelector('#approvalCount').textContent =
      `승인 대기 ${pending}명 · 이메일 인증 대기 ${unverified}명`;
    return data.filter(
      (u) =>
        (!search || (u.name + ' ' + u.email).toLowerCase().includes(search)) &&
        {
          all: true,
          pending: u.registrationPending && u.emailVerified,
          unverified: u.registrationPending && !u.emailVerified,
          active: u.isActive,
          inactive: !u.isActive && !u.registrationPending && !u.registrationRejected,
          rejected: u.registrationRejected,
        }[status],
    );
  }
  function decision(id) {
    const u = users.find((u) => u.id === id);
    if (!u || !dialog.canLeave()) return;
    backup.stop();
    ++screen;
    const owned = projects().filter((p) => p._role === 'owner');
    openInfo(
      '가입 신청 검토',
      `<p><strong>${esc(u.name)}</strong><br>${esc(u.email)}</p><form id="registrationDecision" data-user-id="${esc(id)}">
      ${u.emailVerified ? `<p class="subtle">이메일 인증을 완료했습니다. 소속을 확인한 뒤 승인해 주세요.</p><details class="account-section"><summary>프로젝트에 바로 초대하기 <span class="optional">선택</span></summary>${owned.map((p) => `<div class="approval-project"><label><input type="checkbox" name="grant" value="${esc(p.id)}">${esc(p.name)}</label><select data-grant-role="${esc(p.id)}" aria-label="${esc(p.name)} 권한" disabled><option value="editor">편집자</option><option value="viewer">조회자</option></select></div>`).join('') || '<p class="subtle">내가 소유한 프로젝트가 없습니다. 승인 후 소유자에게 공유를 요청하세요.</p>'}</details>` : '<p class="notice">이메일 인증 대기 중입니다. 인증을 마치면 승인할 수 있습니다.</p>'}
      <p class="account-result" role="alert"></p><div class="dialog-actions"><button type="button" class="button" data-admin-tab="pending">목록으로</button><span class="spacer"></span><button class="button primary" name="decision" value="approve" ${u.emailVerified ? '' : 'disabled'}>가입 승인</button></div>
      <details class="account-section"><summary>가입 거절</summary><label class="field">거절 사유 <span class="optional">관리자 기록용</span><textarea name="reason" maxlength="500" rows="2"></textarea></label><button class="button danger ghost" name="decision" value="reject">거절 확정</button></details></form>`,
    );
    const form = body().querySelector('#registrationDecision');
    dialog.registerGuard({
      busy: () => form.dataset.submitting === 'true',
      dirty: () =>
        Array.from(form.querySelectorAll('[name=grant]')).some((c) => c.checked) ||
        !!form.elements.reason.value.trim(),
    });
  }
  async function trash() {
    if (!canChange() || !dialog.canLeave()) return;
    backup.stop();
    const generation = ++screen;
    openInfo('휴지통', '<p>불러오는 중…</p>');
    try {
      const { items } = await api('trash');
      if (generation !== screen) return;
      body().innerHTML =
        '<p class="subtle">삭제한 항목은 30일 동안 복구할 수 있습니다.</p>' +
        (items.length
          ? items
              .map(
                (i) =>
                  `<article class="account-user sharing-row"><span><strong>${esc(i.name)}</strong><small>${i.type === 'project' ? '프로젝트' : '업무 ' + Number(i.count) + '개'} · ${esc(new Date(i.deletedAt).toLocaleDateString('ko-KR'))} 삭제</small><small>${esc(new Date(i.expiresAt).toLocaleDateString('ko-KR'))}까지 복구 가능</small></span><button class="button small" data-restore-type="${esc(i.type)}" data-restore-id="${esc(i.id)}">복구</button></article>`,
              )
              .join('')
          : '<div class="calm-state">복구할 항목이 없습니다.</div>');
    } catch (error) {
      if (generation === screen) body().textContent = error.message;
    }
  }
  async function mappings(p, access) {
    const { links } = await api('projects/' + p.id + '/member-accounts');
    return `<details class="account-section"><summary>내 업무에 담당 계정 연결 <small>${links.length}/${p.members.length}명 연결</small></summary><p class="subtle">연결한 계정의 ‘내 업무’에 담당 업무가 표시됩니다. 계정은 인력 한 명에만 연결할 수 있습니다.</p>${
      p.members
        .map(
          (m) =>
            `<label class="field">${esc(m.name)}<select data-member-account="${esc(m.id)}" data-member-project="${esc(p.id)}"><option value="">연결 안 함</option>${access
              .map((a) => {
                const linked = links.find((l) => l.userId === a.id),
                  used = linked && linked.memberId !== m.id;
                return `<option value="${esc(a.id)}" ${linked?.memberId === m.id ? 'selected' : ''} ${used ? 'disabled' : ''}>${esc(a.name)} · ${esc(a.email)}${used ? ' (다른 인력에 연결됨)' : ''}</option>`;
              })
              .join('')}</select></label>`,
        )
        .join('') || '<p>먼저 참여인력을 추가해 주세요.</p>'
    }</details>`;
  }
  document.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-admin-tab]');
    if (tab) {
      await admin(tab.dataset.adminTab);
      return;
    }
    const review = event.target.closest('[data-registration-review]');
    if (review) {
      decision(review.dataset.registrationReview);
      return;
    }
    const security = event.target.closest('[data-admin-security]');
    if (security) {
      const generation = screen;
      await (security.dataset.adminSecurity === 'audit' ? openAudit() : openConnections());
      if (generation === screen) mountNav();
      return;
    }
    const restore = event.target.closest('[data-restore-id]');
    if (restore) {
      if (!canChange()) return;
      restore.disabled = true;
      try {
        const r = await api(
          'trash/' + restore.dataset.restoreType + '/' + restore.dataset.restoreId + '/restore',
          { method: 'POST', body: {} },
        );
        await reload(r.projectId);
        await trash();
        toast(
          r.adjustments?.length ? '복구했습니다. ' + r.adjustments.join(', ') : '복구했습니다.',
        );
      } catch (error) {
        toast(error.message);
        restore.disabled = false;
      }
      return;
    }
    const task = event.target.closest('[data-my-task]');
    if (task) openTask(task.dataset.myProject, task.dataset.myTask);
  });
  document.addEventListener('input', (event) => {
    if (event.target.id === 'userSearch') {
      search = event.target.value.toLowerCase().trim();
      refreshUsers({ cached: true });
    }
  });
  document.addEventListener('change', async (event) => {
    if (event.target.id === 'userStatus') await refreshUsers({ cached: true });
    if (event.target.name === 'grant') {
      const form = event.target.form;
      for (const select of form.querySelectorAll('[data-grant-role]'))
        select.disabled = !Array.from(form.querySelectorAll('[name=grant]')).some(
          (c) => c.checked && c.value === select.dataset.grantRole,
        );
    }
    const select = event.target.closest('[data-member-account]');
    if (!select) return;
    select.disabled = true;
    try {
      await api('projects/' + select.dataset.memberProject + '/member-accounts', {
        method: 'PUT',
        body: { memberId: select.dataset.memberAccount, userId: select.value || null },
      });
      await reload();
      const panel = select.closest('details'),
        p = projects().find((p) => p.id === select.dataset.memberProject),
        { access } = await api('projects/' + p.id + '/access');
      panel.outerHTML = await mappings(p, access);
      const replacement = body().querySelector('[data-member-account]')?.closest('details');
      if (replacement) replacement.open = true;
      toast('내 업무 연결을 저장했습니다.');
    } catch (error) {
      toast(error.message);
    } finally {
      select.disabled = false;
    }
  });
  document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (form.id !== 'registrationDecision') return;
    event.preventDefault();
    const decision = event.submitter?.value;
    if (!['approve', 'reject'].includes(decision)) return;
    form.dataset.submitting = 'true';
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const values = new FormData(form),
        grants =
          decision === 'approve'
            ? values.getAll('grant').map((id) => ({
                projectId: id,
                role: Array.from(form.querySelectorAll('[data-grant-role]')).find(
                  (s) => s.dataset.grantRole === id,
                ).value,
              }))
            : [];
      await api('users/' + form.dataset.userId + '/registration', {
        method: 'POST',
        body: { decision, reason: values.get('reason') || '', grants },
      });
      dialog.resetGuard();
      await summary();
      await admin('pending');
      toast(
        decision === 'approve'
          ? grants.length
            ? '승인하고 프로젝트에 초대했습니다.'
            : '가입을 승인했습니다.'
          : '가입 신청을 거절했습니다.',
      );
    } catch (error) {
      form.querySelector('.account-result').textContent = error.message;
    } finally {
      form.dataset.submitting = 'false';
      buttons.forEach((b) => (b.disabled = false));
    }
  });
  return {
    admin,
    summary,
    filterUsers,
    trash,
    mappings,
    securityNav: () => {
      if (adminTab === 'security') mountNav();
    },
  };
}
