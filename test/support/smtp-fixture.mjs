import tls from 'node:tls';
import { once } from 'node:events';
import { generate } from 'selfsigned';

// A loopback TLS SMTP receiver for integration tests; never forwards mail.
export async function smtpFixture() {
  const cert = await generate([{ name: 'commonName', value: 'localhost' }], {
      days: 1,
      keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }],
    }),
    messages = [],
    sockets = new Set();
  const server = tls.createServer({ key: cert.private, cert: cert.cert }, (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 localhost Test SMTP\r\n');
    let buffer = '',
      data = null;
    socket.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(data.join('\r\n'));
            data = null;
            socket.write('250 Message accepted\r\n');
          } else data.push(line.replace(/^\.\./, '.'));
          continue;
        }
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO')
          socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 1048576\r\n');
        else if (command === 'AUTH')
          socket.write(
            Buffer.from(line.split(' ')[2] || '', 'base64').toString() ===
              '\0fixture\0test-only-secret'
              ? '235 Authentication successful\r\n'
              : '535 Authentication failed\r\n',
          );
        else if (['MAIL', 'RCPT', 'RSET', 'NOOP', 'HELO'].includes(command))
          socket.write('250 OK\r\n');
        else if (command === 'DATA') {
          data = [];
          socket.write('354 Send message\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n');
        } else socket.write('502 Not implemented\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    ca: cert.cert,
    messages,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}
export function mailText(message) {
  const body = message.slice(message.indexOf('\r\n\r\n') + 4);
  const decoded = /^Content-Transfer-Encoding: base64\r?$/im.test(message)
    ? Buffer.from(body, 'base64').toString('utf8')
    : body
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decoded;
}
export function resetLink(message) {
  return mailText(message).match(/https?:\/\/[^\s<>]+#reset-password=[A-Za-z0-9_-]{43}/)?.[0];
}
export function verificationLink(message) {
  return mailText(message).match(/https?:\/\/[^\s<>]+#verify-email=[A-Za-z0-9_-]{43}/)?.[0];
}
