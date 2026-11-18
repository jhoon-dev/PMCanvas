export function createAiUI({ api, ui, onState, onEditing }) {
  const form = document.querySelector('#aiSettingsForm'),
    e = form.elements;
  const status = document.querySelector('#aiSettingsStatus'),
    hint = document.querySelector('#aiKeyHint');
  let state = { model: 'gpt-4.1-mini', hasApiKey: false, revision: 0 },
    busy = false;
  const dirty = () =>
    !!e.apiKey.value || e.clearApiKey.checked || e.model.value.trim() !== state.model;
  const paint = () => {
    e.clearApiKey.disabled = !state.hasApiKey;
    e.apiKey.disabled = e.clearApiKey.checked;
    form.querySelector('[type=submit]').disabled = busy || !dirty();
    document.querySelector('#cancelAiSettings').disabled = busy || !dirty();
  };
  const populate = () => {
    e.apiKey.value = '';
    e.model.value = state.model;
    e.clearApiKey.checked = false;
    e.apiKey.placeholder = state.hasApiKey ? ui('등록됨 · 변경할 때만 입력') : '';
    hint.textContent = state.hasApiKey
      ? ui('API 키가 등록되어 있습니다. 빈칸으로 저장하면 기존 키를 유지합니다.')
      : ui('API 키를 등록하면 주간보고 AI 초안 생성을 사용할 수 있습니다.');
    paint();
  };
  const changed = () => {
    status.textContent = '';
    status.classList.remove('error');
    paint();
    onEditing(dirty());
  };
  form.addEventListener('input', changed);
  form.addEventListener('change', () => {
    if (e.clearApiKey.checked) e.apiKey.value = '';
    changed();
  });
  document.querySelector('#cancelAiSettings').onclick = () => {
    populate();
    status.textContent = '';
    onEditing(false);
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy || !dirty()) return;
    const body = {
      model: e.model.value.trim(),
      apiKey: e.apiKey.value.trim(),
      clearApiKey: e.clearApiKey.checked,
      revision: state.revision,
    };
    busy = true;
    form.querySelector('fieldset').disabled = true;
    paint();
    status.textContent = ui('저장 중…');
    status.classList.remove('error');
    try {
      state = await api.saveAiSettings(body);
      populate();
      onState(state);
      onEditing(false);
      status.textContent = ui('저장했습니다. 새 설정이 적용됐습니다.');
    } catch (error) {
      status.classList.add('error');
      status.textContent = ui(error.message);
    } finally {
      busy = false;
      form.querySelector('fieldset').disabled = false;
      paint();
      onEditing(dirty());
    }
  };
  populate();
  return {
    dirty,
    pending: () => busy,
    async load() {
      try {
        state = (await api.aiSettings?.()) || state;
        populate();
        onState(state);
      } catch (error) {
        status.classList.add('error');
        status.textContent = ui(error.message);
      }
    },
  };
}
