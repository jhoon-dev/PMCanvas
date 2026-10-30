export function createUpdateUI({ api, root = document, ui, settings = {}, onOpen, onError }) {
  const $ = (selector) => root.querySelector(selector);
  let value = { status: 'idle', channel: 'github' },
    saving = false,
    applying = false;
  let auto = settings.checkUpdatesOnStart !== false;
  const dismissed = new Set();
  if (settings.recovery) {
    $('#settingsRecovery').hidden = false;
    $('#settingsRecovery').textContent = ui(
      settings.recovery.backupCreated
        ? '설정 오류를 복구해 실행했습니다. 원본 설정 사본은 이 PC에 보관했습니다. 시간대와 업데이트 설정을 확인해 주세요.'
        : '설정을 읽지 못해 기본값으로 실행했습니다. 원본 파일은 유지됩니다. 설정을 저장하려면 파일 접근 권한과 크기를 확인해 주세요.',
    );
  }
  function render(next = value) {
    value = next;
    const store = value.channel === 'microsoft-store';
    const waiting = ['checking', 'downloading'].includes(value.status);
    $('#currentVersion').textContent = ui('현재 버전: ') + (value.currentVersion || '—');
    $('#lastUpdateCheck').textContent = value.checkedAt
      ? ui('마지막 확인: ') +
        new Date(value.checkedAt).toLocaleString(root.documentElement.lang || 'ko')
      : '';
    $('#autoCheckUpdates').checked = auto;
    $('#autoCheckUpdates').disabled = saving;
    $('#checkUpdates').disabled = waiting || applying;
    $('#installUpdate').textContent = ui(
      store
        ? 'Microsoft Store에서 업데이트'
        : value.status === 'downloaded'
          ? '설치 파일 열기'
          : '업데이트 다운로드',
    );
    $('#installUpdate').disabled =
      waiting || applying || (!store && !(value.available && value.downloadAvailable));
    $('#openRelease').hidden = store || value.error === 'verification';
    $('#updateInstructions').textContent = ui(
      store
        ? 'Microsoft Store에서 업데이트합니다. 변경사항을 저장한 뒤 진행하세요.'
        : '프로젝트를 저장하고 앱을 종료한 뒤 설치를 마무리하세요. 프로젝트 파일과 PC 설정은 유지됩니다.',
    );
    let status;
    if (value.status === 'checking') status = ui('새 버전을 확인하고 있습니다.');
    else if (value.status === 'downloading')
      status = ui('업데이트를 다운로드하고 검증하고 있습니다.');
    else if (value.status === 'downloaded')
      status = ui('다운로드와 검증을 완료했습니다. 설치 파일을 열어 업데이트하세요.');
    else if (value.status === 'error')
      status = ui(
        value.error === 'verification'
          ? '업데이트의 발행자를 확인하지 못했습니다. 설치를 중단했습니다. 나중에 다시 확인해 주세요.'
          : value.error === 'download'
            ? '다운로드 또는 검증에 실패했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'
            : '업데이트를 확인하지 못했습니다. 네트워크 연결을 확인하거나 나중에 다시 시도해 주세요.',
      );
    else if (value.status === 'unsupported')
      status = ui(
        'Store에서 업데이트 상태를 확인하지 못했습니다. Microsoft Store에서 직접 확인할 수 있습니다.',
      );
    else if (value.available)
      status = value.version
        ? ui('새 버전: ') +
          value.version +
          (value.downloadAvailable ? '' : ui(' · 이 운영체제의 설치 파일을 준비 중입니다.'))
        : ui('새 업데이트가 있습니다.');
    else if (value.status === 'current')
      status =
        ui(
          store
            ? '현재 사용 가능한 업데이트가 없습니다.'
            : value.version
              ? '현재 최신 버전입니다. '
              : '공개된 데스크톱 버전이 아직 없습니다.',
        ) + (!store && value.version ? value.currentVersion : '');
    else status = ui('업데이트 확인을 눌러 새 버전을 확인하세요.');
    $('#updateStatus').textContent =
      ['downloading', 'downloaded'].includes(value.status) && value.version
        ? ui('새 버전: ') + value.version + ' · ' + status
        : status;
    $('#updateProgress').hidden = value.status !== 'downloading';
    if (value.progress?.total) {
      $('#updateProgress').max = value.progress.total;
      $('#updateProgress').value = value.progress.received;
    } else $('#updateProgress').removeAttribute('value');
    const key = value.channel + ':' + value.version;
    const notice = value.available && (store || value.downloadAvailable) && !dismissed.has(key);
    $('#updateNotice').hidden = !notice;
    $('#updateNoticeText').textContent =
      ui('새 업데이트가 있습니다.') + (value.version ? ' ' + value.version : '');
  }
  async function check() {
    render({ ...value, status: 'checking', error: null });
    try {
      render(await api.checkUpdates());
    } catch {
      render({ ...value, status: 'error', error: 'check' });
    }
  }
  $('#closeUpdate').onclick = () => $('#updateDialog').close();
  $('#checkUpdates').onclick = () => {
    void check();
  };
  $('#showUpdate').onclick = onOpen;
  $('#dismissUpdate').onclick = () => {
    dismissed.add(value.channel + ':' + value.version);
    render();
  };
  $('#openRelease').onclick = () => {
    void api.openRelease().catch(onError);
  };
  $('#autoCheckUpdates').onchange = async (event) => {
    const desired = event.target.checked;
    saving = true;
    render();
    try {
      auto = (await api.setUpdatePreference(desired)).checkUpdatesOnStart;
    } catch (error) {
      onError(error);
    } finally {
      saving = false;
      render();
    }
  };
  $('#installUpdate').onclick = async () => {
    if (applying) return;
    applying = true;
    render();
    try {
      if (value.channel === 'microsoft-store' || value.status === 'downloaded')
        await api.applyUpdate();
      else render(await api.downloadUpdate());
    } catch (error) {
      onError(error);
    } finally {
      applying = false;
      render();
    }
  };
  api.onUpdate?.(render);
  render();
  return {
    async initialise() {
      if (api.updateState) render(await api.updateState());
    },
    async open(checkNow = false) {
      if (!$('#updateDialog').open) $('#updateDialog').showModal();
      if (checkNow) await check();
    },
  };
}
