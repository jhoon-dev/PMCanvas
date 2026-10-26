let csrf = '';
const root = new URL('./api/', location.href);
export async function api(path, { method = 'GET', body, responseType = 'json' } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }
  let response;
  try {
    response = await fetch(new URL(path.replace(/^\//, ''), root), {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw Object.assign(Error('서버에 연결하지 못했습니다. 연결을 확인한 후 다시 시도해 주세요.'), {
      status: 0,
    });
  }
  if (response.ok && responseType === 'blob') return response.blob();
  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(
      Error('서버 응답을 읽지 못했습니다. 접속 주소와 웹서버 설정을 확인해 주세요.'),
      { status: response.status || 0 },
    );
  }
  if (!response.ok)
    throw Object.assign(Error(result.error?.message || '요청을 처리하지 못했습니다.'), {
      status: response.status,
      code: result.error?.code,
    });
  if (result.csrf) csrf = result.csrf;
  return result;
}
