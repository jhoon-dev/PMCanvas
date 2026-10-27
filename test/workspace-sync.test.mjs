import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { workspaceRequest, syncWorkspace } from '../server/workspace-sync.mjs';
import { workspaceKnowledge, applyWorkspaceSync } from '../public/workspace-cache.js';
import { PgRepository } from '../server/postgres.mjs';

const row = (member_id = null) => ({
  id: randomUUID(),
  name: '프로젝트',
  demo: false,
  revision: 1,
  role: 'owner',
  member_id,
  created_at: '2026-01-01',
  holidays: [],
  planning: {},
});
const document = (r) => ({
  id: r.id,
  name: r.name,
  demo: r.demo,
  _revision: r.revision,
  _role: r.role,
  members: [],
  holidays: [],
  tasks: [{ id: 'task', owner: r.member_id, items: [] }],
});
test('증분 조회는 선택 프로젝트와 변경된 내 업무만 읽고 서버 권한·담당자 변경을 반영', async () => {
  const a = row('m1'),
    b = row(),
    c = row('m2');
  const calls = [];
  const hydrate = async (wanted, mine) => {
    calls.push({ ids: wanted.map((p) => p.id), mine });
    return wanted.map(document);
  };
  const first = await syncWorkspace([a, b, c], workspaceRequest({ activeId: a.id }), hydrate);
  assert.equal(first.project.id, a.id);
  assert.equal(
    first.projects.some((p) => 'tasks' in p),
    false,
  );
  assert.deepEqual(first.myWork.ids, [a.id, c.id]);
  assert.equal(calls.filter((call) => call.ids.includes(b.id)).length, 0);
  const knowledge = {
    activeId: a.id,
    known: workspaceKnowledge([first.project]),
    mine: workspaceKnowledge(first.myWork.projects),
  };
  calls.length = 0;
  const stable = await syncWorkspace([a, b, c], workspaceRequest(knowledge), hydrate);
  assert.equal(stable.project, null);
  assert.deepEqual(stable.myWork.projects, []);
  assert.equal(calls.flatMap((call) => call.ids).length, 0);
  a.role = 'viewer';
  c.member_id = 'different-member';
  const changed = await syncWorkspace([a, b, c], workspaceRequest(knowledge), hydrate);
  assert.equal(changed.project._role, 'viewer');
  assert.equal(changed.myWork.projects.find((p) => p.id === c.id)._memberId, 'different-member');
  const revoked = await syncWorkspace([b], workspaceRequest(knowledge), hydrate);
  assert.equal(revoked.activeId, b.id);
  assert.deepEqual(revoked.myWork.ids, []);
  assert.equal(
    revoked.projects.some((p) => p.id === a.id),
    false,
  );
});
test('조회 지식의 위조·중복·잘못된 revision은 거부하고 미접근 프로젝트는 결과에 포함하지 않음', async () => {
  const p = row();
  for (const body of [
    null,
    { activeId: 'invalid' },
    { known: [{ id: p.id, revision: 0, role: 'owner' }] },
    { known: [{ id: p.id, revision: 1, role: 'admin' }] },
    {
      known: [
        { id: p.id, revision: 1, role: 'owner' },
        { id: p.id, revision: 1, role: 'owner' },
      ],
    },
  ])
    assert.throws(
      () => workspaceRequest(body),
      (e) => e.code === 'INVALID_WORKSPACE',
    );
  const result = await syncWorkspace(
    [],
    workspaceRequest({ activeId: p.id, known: [{ id: p.id, revision: 1, role: 'owner' }] }),
    async () => {
      throw Error('Must not hydrate inaccessible data');
    },
  );
  assert.deepEqual(result.projects, []);
  assert.equal(result.activeId, null);
});
test('브라우저 캐시는 변경된 비활성 프로젝트를 요약으로 교체하고 회수된 접근·담당 업무를 제거', () => {
  const a = row('m1'),
    b = row();
  const state = { projects: [document(a), document(b)], activeId: a.id };
  const mine = [{ ...document(a), _memberId: 'm1' }];
  const summary = (r) => ({
    id: r.id,
    name: r.name,
    demo: r.demo,
    _revision: r.revision,
    _role: r.role,
  });
  const updated = applyWorkspaceSync(state, mine, {
    projects: [summary(a), summary({ ...b, revision: 2 })],
    activeId: a.id,
    project: null,
    myWork: { ids: [], projects: [] },
  });
  assert.equal(updated.state.projects[1]._summary, true);
  assert.equal(updated.myProjects.length, 0);
  assert.equal(workspaceKnowledge(updated.state.projects).length, 1);
  assert.deepEqual(state.projects[1].tasks, document(b).tasks);
  assert.throws(() =>
    applyWorkspaceSync({ projects: [], activeId: null }, [], {
      projects: [summary(a)],
      activeId: a.id,
      project: null,
      myWork: { ids: [], projects: [] },
    }),
  );
});
test('일괄 SQL 조회는 프로젝트 10개·100개 모두 4회, 변경 없는 동기화는 1회', async () => {
  for (const count of [10, 100]) {
    const rows = Array.from({ length: count }, () => row('member'));
    let queries = 0;
    const c = {
      query: async (sql, args) => {
        queries++;
        if (sql.startsWith('SELECT p.')) return { rows };
        if (sql.startsWith('SELECT * FROM pm_projects'))
          return { rows: rows.filter((r) => args[0].includes(r.id)) };
        return { rows: [] };
      },
    };
    const repo = new PgRepository({});
    repo.transaction = async (fn) => fn(c);
    await repo.listProjects('fixture');
    assert.equal(queries, 4);
    queries = 0;
    await repo.myWork('fixture');
    assert.equal(queries, 4);
    queries = 0;
    await repo.workspace(
      'fixture',
      workspaceRequest({
        activeId: rows[0].id,
        known: rows.map((r) => ({ id: r.id, revision: r.revision, role: r.role })),
        mine: rows.map((r) => ({
          id: r.id,
          revision: r.revision,
          role: r.role,
          memberId: r.member_id,
        })),
      }),
    );
    assert.equal(queries, 1);
  }
});
