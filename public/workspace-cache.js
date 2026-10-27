// Both workspace and My work reads share one order across account changes and writes.
export class WorkspaceReadGate {
  sequence = 0;
  begin(accountId, revision) {
    return { accountId, revision, sequence: ++this.sequence };
  }
  invalidate() {
    this.sequence++;
  }
  accepts(ticket, accountId, revision) {
    return (
      ticket.accountId === accountId &&
      ticket.revision === revision &&
      ticket.sequence === this.sequence
    );
  }
}

export const workspaceKnowledge = (projects) =>
  projects
    .filter((p) => !p._summary)
    .map((p) => ({
      id: p.id,
      revision: p._revision,
      role: p._role,
      ...(p._memberId ? { memberId: p._memberId } : {}),
    }));

export function applyWorkspaceSync(state, mine, data) {
  const cached = new Map(state.projects.map((p) => [p.id, p]));
  const projects = data.projects.map((summary) => {
    if (data.project?.id === summary.id) return data.project;
    const previous = cached.get(summary.id);
    if (
      previous &&
      !previous._summary &&
      previous._revision === summary._revision &&
      previous._role === summary._role
    )
      return { ...previous, ...summary };
    return { ...summary, _summary: true, holidays: [], members: [], tasks: [] };
  });
  const previousMine = new Map(mine.map((p) => [p.id, p]));
  for (const p of data.myWork.projects) previousMine.set(p.id, p);
  const myProjects = data.myWork.ids.map((id) => previousMine.get(id)).filter(Boolean);
  if (data.activeId && !projects.some((p) => p.id === data.activeId && !p._summary))
    throw Error('The selected project was not loaded.');
  const metadata = (values) => values.map((p) => [p.id, p.name, p.demo, p._revision, p._role]);
  return {
    state: { version: 1, projects, activeId: data.activeId },
    myProjects,
    changed:
      state.activeId !== data.activeId ||
      !!data.project ||
      !!data.myWork.projects.length ||
      JSON.stringify(metadata(state.projects)) !== JSON.stringify(metadata(projects)) ||
      JSON.stringify(mine.map((p) => p.id)) !== JSON.stringify(data.myWork.ids),
  };
}
