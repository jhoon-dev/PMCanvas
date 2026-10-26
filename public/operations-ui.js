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
}) {
  const body = () => document.querySelector('#infoBody');
  let userTab = 'pending',
    users = [],
    search = '',
    adminTab = '';
  const tabs = [
    ['pending', '가입 승인'],
    ['users', '사용자'],
    ['mail', '메일'],
    ['security', '인증·보안'],
    ['backups', '백업'],
  ];
  const time = (s) => (s ? new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '—');
  const nav = () =>
    '<nav class="admin-tabs" aria-label="관리자 설정">' +
    tabs
      .map(
        ([id, label]) =>
          '<button class="button small ' +
          (adminTab === id ? 'primary' : '') +
          '" data-admin-tab="' +
          id +
          '" aria-current="' +
          (adminTab === id ? 'page' : 'false') +
          '">' +
          label +
          '</button>',
      )
      .join('') +
    '</nav>';
  function mountNav() {
    if (!body().querySelector('.admin-tabs')) body().insertAdjacentHTML('afterbegin', nav());
    document.querySelector('#infoDialog .eyebrow').textContent = 'ADMINISTRATION';
  }
  async function summary() {
    if (!user()?.isAdmin) return;
    try {
      const s = await api('admin/summary');
      const b = document.querySelector('#accountButton');
      if (b) {
        b.dataset.pending = s.pending || '';
        b.textContent = (user().name || '계정') + (s.pending ? ' · 승인 ' + s.pending : '');
      }
    } catch {
      /* Account UI remains available if the summary cannot load. */
    }
  }
  async function admin(tab = 'pending') {
    if (!user()?.isAdmin) return;
    adminTab = tab;
    if (tab === 'mail') {
      await openMail();
      mountNav();
      return;
    }
    if (tab === 'security') {
      openInfo(
        '관리자 설정',
        '<div class="admin-security"><h3>인증과 보안</h3><p>관리자 로그인에는 인증 앱 MFA가 적용됩니다.</p><button class="button" data-admin-security="connections">SSO 연결 · 계정 매핑</button> <button class="button" data-admin-security="audit">보안 감사 로그</button></div>',
      );
      mountNav();
      return;
    }
    if (tab === 'backups') {
      await backups();
      return;
    }
    userTab = tab;
    search = '';
    openInfo(
      '관리자 설정',
      nav() +
        '<div id="userTools"><h3>' +
        (tab === 'pending' ? '가입 신청' : '사용자 계정') +
        '</h3><p id="approvalCount" class="subtle"></p><div class="admin-filters"><input id="userSearch" type="search" placeholder="이름 또는 이메일 검색" aria-label="사용자 검색"><select id="userStatus" aria-label="계정 상태">' +
        (tab === 'pending'
          ? '<option value="pending">이메일 인증 완료</option><option value="unverified">이메일 인증 대기</option>'
          : '<option value="all">전체 계정</option><option value="active">활성 계정</option><option value="inactive">비활성 계정</option><option value="rejected">가입 거절</option>') +
        '</select></div></div><div id="userList" aria-live="polite">불러오는 중…</div>' +
        (tab === 'users'
          ? '<details class="account-section"><summary>사용자 계정 직접 추가</summary><form id="createUserForm" class="server-form">' +
            field('이름', 'name', '', 'text', 'required maxlength="80"') +
            field('이메일', 'email', '', 'email', 'required autocomplete="off"') +
            field(
              '초기 비밀번호',
              'password',
              '',
              'password',
              'required minlength="12" maxlength="256" autocomplete="new-password"',
            ) +
            '<button class="button primary">계정 만들기</button><p class="account-result" role="status"></p></form></details>'
          : ''),
    );
    await refreshUsers();
  }
  function filterUsers(data) {
    users = data;
    const status = document.querySelector('#userStatus')?.value;
    if (!status) return data;
    const count = document.querySelector('#approvalCount');
    if (count)
      count.textContent =
        '승인 대기 ' +
        data.filter((u) => u.registrationPending && u.emailVerified).length +
        '명 · 이메일 인증 대기 ' +
        data.filter((u) => u.registrationPending && !u.emailVerified).length +
        '명';
    return data.filter(
      (u) =>
        (!search || (u.name + ' ' + u.email).toLowerCase().includes(search)) &&
        {
          pending: u.registrationPending && u.emailVerified,
          unverified: u.registrationPending && !u.emailVerified,
          active: u.isActive,
          inactive: !u.isActive && !u.registrationPending && !u.registrationRejected,
          rejected: u.registrationRejected,
          all: true,
        }[status],
    );
  }
  function decision(id) {
    const u = users.find((u) => u.id === id);
    if (!u) return;
    const owned = projects().filter((p) => p._role === 'owner');
    openInfo(
      '가입 신청 검토',
      '<p><strong>' +
        esc(u.name) +
        '</strong><br>' +
        esc(u.email) +
        '</p><form id="registrationDecision" data-user-id="' +
        esc(id) +
        '"><h3>승인 후 참여할 프로젝트 <span class="optional">선택</span></h3><p class="subtle">내가 소유한 프로젝트에 편집자 또는 조회자로 연결할 수 있습니다. 참여인력 연결은 프로젝트 공유에서 설정하세요.</p>' +
        owned
          .map(
            (p) =>
              '<div class="approval-project"><label><input type="checkbox" name="grant" value="' +
              esc(p.id) +
              '"> ' +
              esc(p.name) +
              '</label><select data-grant-role="' +
              esc(p.id) +
              '" aria-label="' +
              esc(p.name) +
              ' 권한"><option value="editor">편집자</option><option value="viewer">조회자</option></select></div>',
          )
          .join('') +
        (!owned.length
          ? '<p class="subtle">연결할 수 있는 소유 프로젝트가 없습니다. 계정 승인만 진행합니다.</p>'
          : '') +
        '<label class="field">거절 사유 <span class="optional">거절 시 관리자 기록용</span><textarea name="reason" maxlength="500" rows="2"></textarea></label><p class="account-result" role="alert"></p><div class="dialog-actions"><button type="button" class="button" data-admin-tab="pending">목록</button><span class="spacer"></span><button class="button danger ghost" name="decision" value="reject">가입 거절</button><button class="button primary" name="decision" value="approve" ' +
        (!u.emailVerified ? 'disabled' : '') +
        '>가입 승인</button></div></form>',
    );
  }
  async function backups() {
    openInfo('관리자 설정', '<p>백업 상태를 불러오는 중…</p>');
    try {
      const { settings: s, runs } = await api('admin/backups');
      if (adminTab !== 'backups') return;
      const latest = runs.find((r) => r.state === 'success'),
        verified = runs.find((r) => r.state === 'success' && r.verified),
        alive = s.workerSeenAt && Date.now() - new Date(s.workerSeenAt) < 120000;
      body().innerHTML =
        nav() +
        '<h3>자동 DB 백업</h3><p class="subtle">백업은 서버의 backups 폴더에 저장합니다. 복원 점검은 별도 임시 DB에서 실행합니다. 시간은 한국 표준시(KST) 기준입니다.</p><div class="backup-status"><p>작업 서비스: <strong>' +
        (alive ? '연결됨' : '연결 대기 · 서버 설정 확인') +
        '</strong></p><p>마지막 성공: ' +
        time(latest?.finishedAt) +
        '</p><p>마지막 복원 점검: ' +
        time(verified?.finishedAt) +
        '</p><p>다음 자동 실행: ' +
        (s.enabled ? time(s.nextRunAt) : '사용 안 함') +
        '</p></div><form id="backupSettings" data-revision="' +
        s.revision +
        '"><label class="toggle-label"><input name="enabled" type="checkbox" ' +
        (s.enabled ? 'checked' : '') +
        '> 매일 자동 백업</label><div class="form-grid">' +
        field(
          '실행 시각 (0–23시, KST)',
          'hour',
          s.hour,
          'number',
          'required min="0" max="23" step="1"',
        ) +
        field(
          '자동 백업 보관 일수',
          'retentionDays',
          s.retentionDays,
          'number',
          'required min="1" max="365" step="1"',
        ) +
        '</div><label class="toggle-label"><input name="verifyRestore" type="checkbox" ' +
        (s.verifyRestore ? 'checked' : '') +
        '> 백업 후 실제 복원 점검</label><p class="subtle">자동 생성한 DB 덤프에만 보관 기간을 적용합니다. 암호화 키와 수동 백업은 자동 삭제하지 않습니다.</p><p class="account-result" role="alert"></p><button class="button primary">설정 저장</button> <button class="button" type="button" id="runBackup" ' +
        (s.requested || (s.leaseUntil && new Date(s.leaseUntil) > new Date()) ? 'disabled' : '') +
        '>지금 백업</button> <button class="button ghost" type="button" data-admin-tab="backups">새로고침</button></form><h3>최근 실행</h3><div class="backup-runs">' +
        (runs.length
          ? runs
              .map(
                (r) =>
                  '<article class="account-user"><strong>' +
                  {
                    running: '실행 중',
                    success: r.verified ? '성공 · 복원 점검 통과' : '성공 · 파일 확인',
                    failed: '실패',
                  }[r.state] +
                  '</strong><small>' +
                  time(r.startedAt) +
                  (r.bytes ? ' · ' + (Number(r.bytes) / 1048576).toFixed(2) + ' MB' : '') +
                  '</small>' +
                  (r.message ? '<p class="form-error">' + esc(r.message) + '</p>' : '') +
                  '</article>',
              )
              .join('')
          : '<p>실행 이력이 없습니다.</p>') +
        '</div>';
    } catch (e) {
      body().textContent = e.message;
      mountNav();
    }
  }
  async function trash() {
    if (!canChange()) return;
    openInfo('휴지통', '<p>불러오는 중…</p>');
    try {
      const { items } = await api('trash');
      body().innerHTML =
        '<p class="subtle">삭제한 프로젝트와 업무는 30일 동안 보관됩니다. 프로젝트는 소유자만, 업무는 편집 권한이 있는 사용자가 복구할 수 있습니다.</p>' +
        (!items.length
          ? '<p>복구할 항목이 없습니다.</p>'
          : items
              .map(
                (i) =>
                  '<article class="account-user sharing-row"><span><strong>' +
                  esc(i.name) +
                  '</strong><small>' +
                  (i.type === 'project' ? '프로젝트' : '업무 ' + i.count + '개') +
                  ' · ' +
                  time(i.deletedAt) +
                  ' 삭제</small><small>' +
                  time(i.expiresAt) +
                  '까지 복구 가능</small></span><button class="button small" data-restore-type="' +
                  i.type +
                  '" data-restore-id="' +
                  esc(i.id) +
                  '">복구</button></article>',
              )
              .join(''));
    } catch (e) {
      body().textContent = e.message;
    }
  }
  async function mappings(p, access) {
    const { links } = await api('projects/' + p.id + '/member-accounts');
    return (
      '<section class="account-section"><h3>참여인력과 계정 연결</h3><p class="subtle">연결한 계정의 ‘내 업무’에 담당 업무를 모아 보여줍니다. 계정과 참여인력은 프로젝트마다 하나씩 연결합니다.</p>' +
      p.members
        .map(
          (m) =>
            '<label class="field">' +
            esc(m.name) +
            '<select data-member-account="' +
            esc(m.id) +
            '" data-member-project="' +
            esc(p.id) +
            '"><option value="">연결 안 함</option>' +
            access
              .map(
                (a) =>
                  '<option value="' +
                  esc(a.id) +
                  '" ' +
                  (links.some((l) => l.memberId === m.id && l.userId === a.id) ? 'selected' : '') +
                  '>' +
                  esc(a.name) +
                  ' · ' +
                  esc(a.email) +
                  '</option>',
              )
              .join('') +
            '</select></label>',
        )
        .join('') +
      (!p.members.length ? '<p>먼저 참여인력을 추가해 주세요.</p>' : '') +
      '</section>'
    );
  }
  document.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-admin-tab]');
    if (tab) {
      await admin(tab.dataset.adminTab);
      return;
    }
    const review = e.target.closest('[data-registration-review]');
    if (review) {
      decision(review.dataset.registrationReview);
      return;
    }
    const security = e.target.closest('[data-admin-security]');
    if (security) {
      await (security.dataset.adminSecurity === 'audit' ? openAudit() : openConnections());
      mountNav();
      return;
    }
    if (e.target.closest('#runBackup')) {
      const button = e.target.closest('button');
      button.disabled = true;
      try {
        await api('admin/backups/run', { method: 'POST', body: {} });
        toast('백업을 요청했습니다. 작업 서비스가 곧 실행합니다.');
        await backups();
      } catch (e) {
        toast(e.message);
        button.disabled = false;
      }
      return;
    }
    const restore = e.target.closest('[data-restore-id]');
    if (restore) {
      if (!canChange()) return;
      restore.disabled = true;
      try {
        const result = await api(
          'trash/' + restore.dataset.restoreType + '/' + restore.dataset.restoreId + '/restore',
          { method: 'POST', body: {} },
        );
        await reload(result.projectId);
        await trash();
        toast(
          result.adjustments?.length
            ? '복구했습니다. ' + result.adjustments.join(', ')
            : '복구했습니다.',
        );
      } catch (e) {
        toast(e.message);
        restore.disabled = false;
      }
      return;
    }
    const task = e.target.closest('[data-my-task]');
    if (task) openTask(task.dataset.myProject, task.dataset.myTask);
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'userSearch') {
      search = e.target.value.toLowerCase().trim();
      refreshUsers();
    }
  });
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'userStatus') await refreshUsers();
    const el = e.target.closest('[data-member-account]');
    if (el) {
      el.disabled = true;
      try {
        await api('projects/' + el.dataset.memberProject + '/member-accounts', {
          method: 'PUT',
          body: { memberId: el.dataset.memberAccount, userId: el.value || null },
        });
        toast('계정 연결을 저장했습니다.');
        await reload();
        const { links } = await api('projects/' + el.dataset.memberProject + '/member-accounts');
        body()
          .querySelectorAll('[data-member-account]')
          .forEach((select) => {
            select.value =
              links.find((l) => l.memberId === select.dataset.memberAccount)?.userId || '';
          });
      } catch (e) {
        toast(e.message);
      } finally {
        el.disabled = false;
      }
    }
  });
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!['registrationDecision', 'backupSettings'].includes(form.id)) return;
    e.preventDefault();
    const result = form.querySelector('.account-result'),
      buttons = form.querySelectorAll('button');
    buttons.forEach((b) => (b.disabled = true));
    try {
      const data = new FormData(form);
      if (form.id === 'registrationDecision') {
        const decision = e.submitter?.value;
        if (!['approve', 'reject'].includes(decision)) return;
        const grants =
          decision === 'approve'
            ? data
                .getAll('grant')
                .map((id) => ({
                  projectId: id,
                  role: [...form.querySelectorAll('[data-grant-role]')].find(
                    (s) => s.dataset.grantRole === id,
                  ).value,
                }))
            : [];
        await api('users/' + form.dataset.userId + '/registration', {
          method: 'POST',
          body: { decision, reason: data.get('reason'), grants },
        });
        await admin('pending');
        await summary();
        toast(
          decision === 'approve'
            ? '승인하고 프로젝트 권한을 부여했습니다.'
            : '가입 신청을 거절했습니다.',
        );
      } else {
        await api('admin/backups', {
          method: 'PUT',
          body: {
            enabled: data.has('enabled'),
            verifyRestore: data.has('verifyRestore'),
            hour: Number(data.get('hour')),
            retentionDays: Number(data.get('retentionDays')),
            revision: Number(form.dataset.revision),
          },
        });
        await backups();
        toast('백업 설정을 저장했습니다.');
      }
    } catch (error) {
      result.textContent = error.message;
    } finally {
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

export function myWorkView({ projects, esc, progress, today, projectMode }) {
  const tasks = projects.flatMap((p) => p.tasks.map((t) => ({ p, t }))),
    pending = tasks.filter(({ t }) => progress(t, today) < 1),
    late = pending.filter(({ t }) => t.end < today),
    current = pending.filter(({ t }) => t.end >= today && t.start <= today),
    future = pending.filter(({ t }) => t.start > today);
  const cards = (rows) =>
    rows
      .sort((a, b) => a.t.end.localeCompare(b.t.end))
      .map(
        ({ p, t }) =>
          '<button class="my-work-card panel" data-my-project="' +
          esc(p.id) +
          '" data-my-task="' +
          esc(t.id) +
          '"><span><small>' +
          esc(p.name) +
          '</small><strong>' +
          esc(t.name) +
          '</strong><small>' +
          esc(t.start) +
          ' — ' +
          esc(t.end) +
          '</small></span><b>' +
          Math.round(progress(t, today) * 100) +
          '%</b></button>',
      )
      .join('');
  return (
    '<section class="page-head"><div><span class="eyebrow">MY WORK</span><h1>내 업무</h1><p>프로젝트에 연결한 내 계정의 담당 업무를 한곳에서 확인하세요.</p></div></section>' +
    projectMode +
    '<div class="my-work-counts"><span>지연 <b>' +
    late.length +
    '</b></span><span>진행 일정 <b>' +
    current.length +
    '</b></span><span>예정 <b>' +
    future.length +
    '</b></span></div>' +
    (!tasks.length
      ? '<div class="empty-state"><h3>연결된 담당 업무가 없습니다</h3><p>프로젝트 소유자가 ‘프로젝트 공유 → 참여인력과 계정 연결’에서 내 계정을 연결하면 표시됩니다.</p></div>'
      : [
          ['지연된 업무', late],
          ['진행 일정', current],
          ['예정된 업무', future],
        ]
          .map(([label, rows]) =>
            rows.length
              ? '<section class="my-work-section"><h2>' +
                label +
                ' <small>' +
                rows.length +
                '</small></h2>' +
                cards(rows) +
                '</section>'
              : '',
          )
          .join('') +
        '<details class="my-work-section"><summary>완료한 업무 ' +
        (tasks.length - pending.length) +
        '개</summary>' +
        cards(tasks.filter(({ t }) => progress(t, today) === 1)) +
        '</details>')
  );
}
