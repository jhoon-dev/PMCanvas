import { ui } from './i18n.js';

export function createAiSettingsUi({
  api,
  field,
  openInfo,
  user,
  onConfigured,
  showAuth,
  registerGuard,
}) {
  return async function openAiSettings() {
    if (!user()?.isAdmin) return;
    openInfo(ui('AI 연결 설정'), ui('<div id="aiSettingsHost">불러오는 중…</div>'));
    const host = document.querySelector('#aiSettingsHost');
    try {
      let { settings } = await api('admin/ai-settings');
      if (!host.isConnected) return;
      let busy = false;
      host.innerHTML =
        '<p>' +
        ui(
          '주간보고 AI 초안에 사용할 OpenAI API 키를 등록하세요. 이 서버의 편집 권한이 있는 사용자에게 적용되며 저장하면 바로 사용할 수 있습니다.',
        ) +
        '</p>' +
        '<form class="server-form" id="aiSettingsForm"><fieldset class="smtp-fields">' +
        field(
          'OpenAI API key',
          'apiKey',
          '',
          'password',
          'maxlength="4096" minlength="8" autocomplete="new-password" spellcheck="false" aria-describedby="aiKeyHint"',
        ) +
        '<p class="subtle" id="aiKeyHint"></p>' +
        field(
          ui('AI 모델'),
          'model',
          '',
          'text',
          'required maxlength="128" autocomplete="off" spellcheck="false"',
        ) +
        '<label class="mail-flag"><input type="checkbox" name="clearApiKey">' +
        ui('등록된 API 키 삭제') +
        '</label></fieldset>' +
        '<p class="subtle">' +
        ui(
          '키는 서버에 암호화해 저장하며 다시 표시하지 않습니다. API 사용 요금은 등록한 OpenAI 계정에 청구됩니다.',
        ) +
        '</p>' +
        '<button type="submit" class="button primary">' +
        ui('설정 저장') +
        '</button><p class="account-result" role="status"></p></form>';
      const form = host.querySelector('form'),
        e = form.elements,
        result = form.querySelector('[role=status]');
      const dirty = () =>
        !!e.apiKey.value || e.clearApiKey.checked || e.model.value.trim() !== settings.model;
      const refresh = () => {
        form.querySelector('button').disabled = busy || !dirty();
        e.clearApiKey.disabled = !settings.hasApiKey;
        e.apiKey.disabled = e.clearApiKey.checked;
      };
      const populate = () => {
        e.apiKey.value = '';
        e.apiKey.placeholder = settings.hasApiKey ? ui('등록됨 · 변경할 때만 입력') : '';
        e.model.value = settings.model;
        e.clearApiKey.checked = false;
        host.querySelector('#aiKeyHint').textContent = settings.hasApiKey
          ? ui('API 키가 등록되어 있습니다. 빈칸으로 저장하면 기존 키를 유지합니다.')
          : ui('API 키를 등록하면 주간보고 AI 초안 생성을 사용할 수 있습니다.');
        refresh();
      };
      form.addEventListener('input', () => {
        result.textContent = '';
        refresh();
      });
      form.addEventListener('change', () => {
        if (e.clearApiKey.checked) e.apiKey.value = '';
        refresh();
      });
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (busy || !dirty()) return;
        busy = true;
        const body = {
          model: e.model.value.trim(),
          apiKey: e.apiKey.value.trim(),
          clearApiKey: e.clearApiKey.checked,
          revision: settings.revision,
        };
        form.querySelector('fieldset').disabled = true;
        refresh();
        result.textContent = ui('저장 중…');
        try {
          ({ settings } = await api('admin/ai-settings', { method: 'PUT', body }));
          onConfigured(settings.hasApiKey);
          if (host.isConnected) {
            populate();
            result.textContent = ui('저장했습니다. 새 설정이 적용됐습니다.');
          }
        } catch (error) {
          if (host.isConnected) {
            result.textContent = ui(error.message);
            if (error.status === 401) {
              e.apiKey.value = '';
              document.querySelector('#infoDialog').close();
              showAuth(ui(error.message));
            }
          }
        } finally {
          busy = false;
          if (host.isConnected) {
            form.querySelector('fieldset').disabled = false;
            refresh();
          }
        }
      };
      registerGuard({ dirty, busy: () => busy });
      populate();
    } catch (error) {
      if (host.isConnected) host.textContent = ui(error.message);
    }
  };
}
