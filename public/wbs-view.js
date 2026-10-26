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
      onSave: async (draft) => {
        if (isSaving()) throw Error('저장이 진행 중입니다.');
        onMutation();
        try {
          const { project: p } = await request('projects/' + draft.id, {
            method: 'PUT',
            body: { project: draft, revision: draft._revision },
          });
          acceptProject(p);
          onSaved();
          return p;
        } catch (error) {
          if (error.status === 401) onAuth(error.message);
          throw error;
        } finally {
          onSettled();
        }
      },
      onReload: async (id) => {
        if (isSaving()) throw Error('저장이 진행 중입니다.');
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
      pageHead('WORKSPACE', '업무와 일정', '업무를 입력하고, 일정을 조정하세요.', '') +
      dateToolbar(asOf) +
      this.markup(project, asOf)
    );
  }
}
