export const mailFailureCategories = ['connection', 'tls', 'auth', 'recipient', 'other'];
export const mailDeliveryMethods = [
  'sendReset',
  'sendVerification',
  'sendApproval',
  'sendReviewRequest',
  'sendTest',
];

// Never classify by localized error.message, and never retain an SMTP response/address.
export function classifyMailFailure(error, method) {
  const code = typeof error?.code === 'string' ? error.code : '';
  const causeCode = typeof error?.cause?.code === 'string' ? error.cause.code : '';
  const originalCode = typeof error?.originalCode === 'string' ? error.originalCode : '';
  const command = typeof error?.command === 'string' ? error.command.toUpperCase() : '';
  const responseCode =
    Number.isInteger(error?.responseCode) && error.responseCode >= 400 && error.responseCode <= 599
      ? error.responseCode
      : null;
  let category = 'other';
  if (
    [code, causeCode, originalCode].some(
      (c) =>
        c.startsWith('ERR_SSL_') ||
        [
          'ETLS',
          'EREQUIRETLS',
          'CERT_HAS_EXPIRED',
          'DEPTH_ZERO_SELF_SIGNED_CERT',
          'SELF_SIGNED_CERT_IN_CHAIN',
          'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
          'ERR_TLS_CERT_ALTNAME_INVALID',
          'CERT_NOT_YET_VALID',
          'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
        ].includes(c),
    )
  )
    category = 'tls';
  else if (
    ['EAUTH', 'ENOAUTH', 'EOAUTH2'].includes(code) ||
    command.startsWith('AUTH') ||
    [530, 535].includes(responseCode)
  )
    category = 'auth';
  else if (
    responseCode === 421 ||
    [
      'ECONNECTION',
      'ECONNREFUSED',
      'ECONNRESET',
      'EPIPE',
      'EDNS',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'ESOCKET',
      'EPROXY',
    ].includes(code)
  )
    category = 'connection';
  else if (code === 'EENVELOPE' && command === 'RCPT TO' && responseCode >= 500) {
    const status =
      typeof error.response === 'string'
        ? error.response.slice(0, 4096).match(/^5\d\d[ -]+(5\.[12]\.\d{1,3})(?:\s|$)/)?.[1]
        : null;
    // 550 alone can also mean a relay/policy failure; ambiguous failures still alert.
    if (status && /^(?:5\.1\.[1-6]|5\.2\.[12])$/.test(status)) category = 'recipient';
  }
  return { category, method, responseCode };
}
