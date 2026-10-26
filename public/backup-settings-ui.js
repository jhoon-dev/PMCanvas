import { escapeHtml as esc } from './html.js';

const displayTime = (value, zone) =>
  value
    ? esc(new Date(value).toLocaleString('ko-KR', { timeZone: zone || 'Asia/Seoul' }))
    : '아직 없음';
export function backupOverview({ settings: s, runs, summary = {} }) {
  const running = runs.some((run) => run.state === 'running'),
    connected = s.workerSeenAt && Date.now() - new Date(s.workerSeenAt) < 120000,
    last = runs[0];
  const label = running
    ? '백업 중'
    : s.requested
      ? '실행 대기 중'
      : last?.state === 'failed'
        ? '최근 백업 실패'
        : connected
          ? '백업 준비 완료'
          : '작업 서비스 연결 대기';
  return `<div class="backup-status" role="status"><strong>${label}</strong>
    <p>마지막 성공 · ${displayTime(summary.lastSuccessAt || runs.find((r) => r.state === 'success')?.finishedAt, s.timeZone)}</p>
    <p>복원 점검 · ${displayTime(summary.lastVerifiedAt || runs.find((r) => r.verified && r.state === 'success')?.finishedAt, s.timeZone)}</p>
    <p>${s.enabled ? '다음 실행 · ' + displayTime(s.nextRunAt, s.timeZone) : '자동 백업 꺼짐'} <small>${esc(s.timeZone || 'Asia/Seoul')}</small></p>
    ${!connected ? '<p class="subtle">서버의 백업 서비스가 실행 중인지 확인해 주세요.</p>' : ''}
    ${last?.state === 'failed' ? `<p class="form-error">${esc(last.message)}</p>` : ''}</div>`;
}
export function backupRunRows(runs, zone) {
  return (
    runs
      .map(
        (
          run,
        ) => `<article class="account-user"><strong>${{ running: '실행 중', failed: '실패', success: run.verified ? '성공 · 복원 점검 통과' : '성공 · 파일 확인' }[run.state] || '확인 중'}</strong>
    <small>${displayTime(run.startedAt, zone)}${run.bytes ? ' · ' + (Number(run.bytes) / 1048576).toFixed(2) + ' MB' : ''}</small>
    ${run.message ? `<p class="form-error">${esc(run.message)}</p>` : ''}
    ${run.keyFingerprint ? `<small>복원 키 식별자 · ${esc(run.keyFingerprint.slice(0, 16))}</small>` : ''}</article>`,
      )
      .join('') || '<p class="subtle">아직 실행 이력이 없습니다.</p>'
  );
}
export function createBackupSettingsUi({ api, field, openInfo, toast, dialog }) {
  let timer;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  document.querySelector('#infoDialog').addEventListener('close', stop);
  async function open(nav) {
    stop();
    openInfo('관리자 설정', nav + '<div id="backupHost">백업 상태를 불러오는 중…</div>');
    const host = document.querySelector('#backupHost');
    let busy = false;
    try {
      let data = await api('admin/backups');
      if (!host.isConnected) return;
      const s = data.settings;
      host.innerHTML = `<h3>백업</h3><div id="backupOverview"></div><button class="button primary" id="runBackup" type="button">지금 백업</button><p id="backupResult" role="status" class="account-result"></p>
        <details class="account-section" id="backupConfig"><summary>자동 백업 설정</summary>
        <form id="backupSettings" data-revision="${s.revision}"><fieldset class="settings-fields">
        <label class="toggle-label"><input name="enabled" type="checkbox" ${s.enabled ? 'checked' : ''}>매일 자동 백업</label>
        <div class="form-grid">${field('실행 시각 (0–23시)', 'hour', s.hour, 'number', 'required min="0" max="23" step="1"')}${field('보관 기간 (일)', 'retentionDays', s.retentionDays, 'number', 'required min="1" max="365" step="1"')}</div>
        ${field('시간대', 'timeZone', s.timeZone || 'Asia/Seoul', 'text', 'required maxlength="100" list="backupTimeZones"')}<datalist id="backupTimeZones"><option>Asia/Seoul</option><option>UTC</option><option>Asia/Tokyo</option><option>America/New_York</option><option>Europe/London</option></datalist>
        <label class="toggle-label"><input name="verifyRestore" type="checkbox" ${s.verifyRestore ? 'checked' : ''}>백업 후 실제 복원 점검</label><p class="subtle">별도 임시 DB에 복원해 점검합니다. 운영 데이터는 변경하지 않습니다.</p>
        </fieldset><button class="button primary" type="submit">설정 저장</button><p class="account-result" role="alert"></p></form></details>
        <details class="account-section"><summary>최근 실행 이력</summary><div id="backupRuns" class="backup-runs"></div></details>
        <details class="account-section"><summary>백업 파일과 복원 키 보관</summary><p>DB 덤프는 서버의 backups 폴더에 저장합니다. 복원에 필요한 암호화 키는 별도로 보관하세요. 키는 덤프 폴더에 복사하지 않습니다.</p><p class="subtle">기존 키 사본은 업데이트 시 recovery-keys로 옮깁니다. 덤프와 키의 외부 보관 장소도 분리하세요.</p></details>`;
      const form = host.querySelector('#backupSettings'),
        result = form.querySelector('.account-result'),
        button = host.querySelector('#runBackup'),
        status = host.querySelector('#backupResult');
      const values = () => {
        const v = new FormData(form);
        return {
          enabled: v.has('enabled'),
          verifyRestore: v.has('verifyRestore'),
          hour: Number(v.get('hour')),
          retentionDays: Number(v.get('retentionDays')),
          timeZone: v.get('timeZone'),
          revision: Number(form.dataset.revision),
        };
      };
      let original = JSON.stringify(values());
      const dirty = () => JSON.stringify(values()) !== original;
      const update = () => {
        host.querySelector('#backupOverview').innerHTML = backupOverview(data);
        host.querySelector('#backupRuns').innerHTML = backupRunRows(
          data.runs,
          data.settings.timeZone,
        );
        button.disabled =
          busy ||
          dirty() ||
          data.settings.requested ||
          (data.settings.leaseUntil && new Date(data.settings.leaseUntil) > new Date());
        form.querySelector('button').disabled = busy || !dirty();
        if (dirty()) status.textContent = '변경한 설정을 먼저 저장해 주세요.';
        else if (status.textContent === '변경한 설정을 먼저 저장해 주세요.')
          status.textContent = '';
      };
      const poll = async () => {
        if (!host.isConnected || !document.querySelector('#infoDialog').open) return;
        if (!busy && document.visibilityState === 'visible')
          try {
            data = await api('admin/backups');
            if (host.isConnected) update();
          } catch {
            /* Keep the saved form and allow the next refresh to recover. */
          }
        if (host.isConnected) timer = setTimeout(poll, 5000);
      };
      dialog.registerGuard({ dirty, busy: () => busy });
      form.addEventListener('input', update);
      form.addEventListener('change', update);
      button.onclick = async () => {
        if (button.disabled) return;
        busy = true;
        update();
        try {
          await api('admin/backups/run', { method: 'POST', body: {} });
          data = await api('admin/backups');
          status.textContent = '백업을 요청했습니다. 최대 30초 안에 시작합니다.';
        } catch (error) {
          status.textContent = error.message;
        } finally {
          busy = false;
          if (host.isConnected) update();
        }
      };
      form.onsubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const payload = values();
        busy = true;
        update();
        form.querySelector('fieldset').disabled = true;
        try {
          data = await api('admin/backups', { method: 'PUT', body: payload });
          form.dataset.revision = data.settings.revision;
          form.querySelector('fieldset').disabled = false;
          original = JSON.stringify(values());
          result.textContent = '설정을 저장했습니다.';
          toast('백업 설정을 저장했습니다.');
        } catch (error) {
          result.textContent = error.message;
        } finally {
          busy = false;
          form.querySelector('fieldset').disabled = false;
          update();
        }
      };
      update();
      timer = setTimeout(poll, 5000);
    } catch (error) {
      if (host.isConnected) host.textContent = error.message;
    }
  }
  return { open, stop };
}
