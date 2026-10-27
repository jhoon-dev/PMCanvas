import { ui } from './i18n.js';
import { WbsWorkspace } from './wbs-workspace.js';
import { pageHead, dateToolbar } from './view-ui.js';

// The application supplies session and persistence hooks; editing stays in WbsWorkspace.
export class WbsView extends WbsWorkspace {
  constructor({
    getDraftStore,
    getProject,
    request,
    isSaving,
    onMutation,
    onSettled,
    acceptProject,
    onSaved,
    onAuth,
    toast,
    onStatus,
    onRender,
    onDetails,
    resolveConflict,
  }) {
    super({
      getDraftStore,
      readExcel: async (file) => {
        const buffer = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (const b of buffer) binary += String.fromCharCode(b);
        return request('projects/' + getProject().id + '/import-excel', {
          method: 'POST',
          body: { file: btoa(binary) },
        });
      },
      toast,
      onStatus,
      onRender,
      onDetails,
      onConflict: resolveConflict
        ? async (base, mine) => {
            const { project: latest } = await request('projects/' + base.id);
            const resolved = await resolveConflict(base, mine, latest);
            if (resolved) acceptProject(latest);
            return resolved;
          }
        : undefined,
      onSave: async (draft) => {
        if (isSaving()) throw Error(ui('저장이 진행 중입니다.'));
        onMutation();
        try {
          const { project: p } = await request(
            'projects' + (draft._revision ? '/' + draft.id : ''),
            {
              method: draft._revision ? 'PUT' : 'POST',
              body: { project: draft, ...(draft._revision ? { revision: draft._revision } : {}) },
            },
          );
          acceptProject(p);
          onSaved();
          return p;
        } catch (error) {
          if (error.status === 401) onAuth(ui(error.message));
          throw error;
        } finally {
          onSettled();
        }
      },
      onReload: async (id) => {
        if (isSaving()) throw Error(ui('저장이 진행 중입니다.'));
        onMutation();
        try {
          const { project: p } = await request('projects/' + id);
          acceptProject(p);
          return p;
        } finally {
          onSettled();
        }
      },
    });
  }
  render(project, asOf) {
    return (
      pageHead('WORKSPACE', ui('업무와 일정'), ui('업무를 입력하고, 일정을 조정하세요.'), '') +
      dateToolbar(asOf) +
      this.markup(project, asOf)
    );
  }
}
