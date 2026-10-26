import { ui } from './i18n.js';
import { escapeHtml as esc } from './html.js';
import { taskHours, earned, validateProject } from './engine.js';
import { pageHead, btn, icon, avatar, num, pct, meter, empty, field } from './view-ui.js';
export function peopleView(p, s, asOf) {
  return (
    pageHead(
      'PROJECT TEAM',
      ui('참여인력'),
      ui('누가 어떤 일을 맡고 있는지, 투입 현황을 함께 확인하세요.'),
      btn(ui('＋ 참여인력 추가'), 'member', 'primary'),
    ) +
    '<div class="notice">' +
    icon('users') +
    ui(
      '<span>등급은 인력 분류에 사용합니다. 예상일은 근무시간·투입률·계획 일정·완료 기록으로 계산합니다.</span></div>',
    ) +
    (p.members.length
      ? '<section class="team-grid">' +
        p.members
          .map((m, idx) => {
            const ts = p.tasks.filter((t) => t.owner === m.id),
              total = ts.reduce((a, t) => a + taskHours(t), 0),
              done = ts.reduce((a, t) => a + earned(t, asOf), 0),
              pc = s.forecast.pace[m.id];
            return (
              '<article class="panel member-card"><div class="member-top">' +
              avatar(p, m, 'large') +
              '<button class="icon-button" data-edit-member="' +
              esc(m.id) +
              '" aria-label="' +
              esc(m.name) +
              ui(' 수정">') +
              icon('more') +
              '</button></div><h2>' +
              esc(m.name) +
              '</h2><div class="member-role">' +
              esc(m.role) +
              '<span>·</span><span class="grade">' +
              esc(m.grade) +
              ui('</span></div><div class="member-stats"><div><small>투입률</small><strong>') +
              m.allocation +
              ui('<em>%</em></strong></div><div><small>일 가용시간</small><strong>') +
              num((m.hours * m.allocation) / 100) +
              ui('<em>h</em></strong></div><div><small>담당 업무</small><strong>') +
              ts.length +
              ui(
                '<em>개</em></strong></div></div><div class="member-progress-label"><span>담당 업무 진척률</span><strong>',
              ) +
              (total ? pct(done / total) : '—') +
              '</strong></div>' +
              meter(total ? done / total : 0) +
              '<div class="member-foot">' +
              num(done) +
              ' / ' +
              num(total) +
              ui('h 완료 작업량</div><div class="pace-note">') +
              (pc.observed
                ? ui('최근 속도 반영 · 계획 대비 ') + num(pc.ratio * 100) + '%'
                : ui('계획 기준 추정 · 완료 기록 수집 중')) +
              '</div></article>'
            );
          })
          .join('') +
        '</section>'
      : empty(
          ui('함께할 인력을 추가해 주세요'),
          ui('이름과 역할, 등급, 투입률만 입력하면 시작할 수 있어요.'),
          'member',
          ui('참여인력 추가'),
        ))
  );
}

export function memberEditor(p, id = '') {
  const m = p.members.find((x) => x.id === id) || {
    name: '',
    role: '개발',
    grade: '중급',
    hours: 8,
    allocation: 100,
  };
  const title = id ? ui('참여인력 수정') : ui('참여인력 추가');
  const body =
    field(
      ui('이름'),
      'name',
      m.name,
      'text',
      ui('required maxlength="80" placeholder="참여인력 이름"'),
    ) +
    '<div class="form-grid">' +
    field(ui('역할'), 'role', m.role, 'text', 'required maxlength="40" list="roles"') +
    field(ui('등급'), 'grade', m.grade, 'text', 'required maxlength="40" list="grades"') +
    ui(
      '</div><datalist id="roles"><option>PM</option><option value="기획">기획</option><option value="개발">개발</option><option value="디자인">디자인</option><option>QA</option></datalist><datalist id="grades"><option value="특급">특급</option><option value="고급">고급</option><option value="중급">중급</option><option value="초급">초급</option></datalist><div class="form-grid">',
    ) +
    field(
      ui('하루 근무시간 (h)'),
      'hours',
      m.hours,
      'number',
      'required min=".1" max="16" step=".1"',
    ) +
    field(
      ui('프로젝트 투입률 (%)'),
      'allocation',
      m.allocation,
      'number',
      'required min="1" max="100" step="1"',
    ) +
    ui(
      '</div><div class="notice">등급은 직접 입력할 수 있습니다. 예상일 계산에는 근무시간과 투입률이 반영됩니다.</div>',
    );

  return { title, body };
}
export function updateMember(project, id, data, uid = () => crypto.randomUUID()) {
  const value = (n) => String(data.get(n) || '').trim();
  const m = {
    id: id || uid(),
    name: value('name'),
    role: value('role'),
    grade: value('grade'),
    hours: Number(value('hours')),
    allocation: Number(value('allocation')),
  };
  if (id) project.members[project.members.findIndex((x) => x.id === id)] = m;
  else project.members.push(m);
  validateProject(project);

  return project;
}
