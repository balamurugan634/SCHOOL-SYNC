import { createServer, type Server, type Socket } from 'node:net';

/**
 * A tiny in-process SMTP server for tests and manual checks (no TLS, AUTH PLAIN/LOGIN). It records what it receives, can
 * demand credentials, reject recipients, slow down delivery and track overlapping deliveries.
 */
export interface StubMessage {
  from: string;
  to: string[];
  data: string;
  user: string | null;
}

export interface StubSmtpOptions {
  /** require AUTH with exactly these credentials */
  auth?: { user: string; pass: string };
  /** recipients containing this text are refused with 550 */
  rejectRecipient?: string;
  /** hold the final DATA reply for this long (ms) */
  deliveryDelayMs?: number;
}

export interface StubSmtp {
  port: number;
  host: string;
  messages: StubMessage[];
  /** the largest number of messages being received at the same instant */
  maxConcurrentData: number;
  close(): Promise<void>;
}

export async function startStubSmtp(opts: StubSmtpOptions = {}, port = 0): Promise<StubSmtp> {
  const messages: StubMessage[] = [];
  const sockets = new Set<Socket>();
  let inData = 0;
  const state = { maxConcurrentData: 0 };

  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => undefined);
    let buf = '';
    let mode: 'cmd' | 'data' | 'auth-user' | 'auth-pass' | 'auth-plain' = 'cmd';
    let user: string | null = null;
    let authUser = '';
    let from = '';
    let rcpts: string[] = [];
    let data = '';
    const send = (line: string) => sock.write(`${line}\r\n`);
    send('220 stub.local ESMTP ready');

    const finishAuth = (u: string, p: string) => {
      if (!opts.auth || (u === opts.auth.user && p === opts.auth.pass)) {
        user = u;
        send('235 2.7.0 Authentication successful');
      } else {
        // deliberately chatty, like real servers: this text must never reach an API response
        send(`535 5.7.8 Username and Password not accepted for ${u} (password was ${p.slice(0, 3)}***) stub-banner-7f3a`);
      }
    };

    const onLine = (line: string) => {
      if (mode === 'data') {
        if (line === '.') {
          mode = 'cmd';
          inData++;
          state.maxConcurrentData = Math.max(state.maxConcurrentData, inData);
          const done = () => {
            inData--;
            messages.push({ from, to: rcpts, data, user });
            data = '';
            rcpts = [];
            send('250 2.0.0 OK queued');
          };
          if (opts.deliveryDelayMs) setTimeout(done, opts.deliveryDelayMs);
          else done();
        } else data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
        return;
      }
      if (mode === 'auth-plain') {
        mode = 'cmd';
        const [, u = '', p = ''] = Buffer.from(line, 'base64').toString('utf8').split('\0');
        return finishAuth(u, p);
      }
      if (mode === 'auth-user') {
        authUser = Buffer.from(line, 'base64').toString('utf8');
        mode = 'auth-pass';
        return send('334 UGFzc3dvcmQ6');
      }
      if (mode === 'auth-pass') {
        mode = 'cmd';
        return finishAuth(authUser, Buffer.from(line, 'base64').toString('utf8'));
      }
      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
        sock.write('250-stub.local\r\n250-8BITMIME\r\n250 AUTH PLAIN LOGIN\r\n');
      } else if (upper.startsWith('AUTH PLAIN')) {
        const arg = line.slice(10).trim();
        if (arg) {
          const [, u = '', p = ''] = Buffer.from(arg, 'base64').toString('utf8').split('\0');
          finishAuth(u, p);
        } else {
          mode = 'auth-plain';
          send('334 ');
        }
      } else if (upper.startsWith('AUTH LOGIN')) {
        mode = 'auth-user';
        send('334 VXNlcm5hbWU6');
      } else if (upper.startsWith('MAIL FROM')) {
        if (opts.auth && !user) return send('530 5.7.0 Authentication required');
        from = /<([^>]*)>/.exec(line)?.[1] ?? '';
        send('250 2.1.0 OK');
      } else if (upper.startsWith('RCPT TO')) {
        const to = /<([^>]*)>/.exec(line)?.[1] ?? '';
        if (opts.rejectRecipient && to.includes(opts.rejectRecipient)) return send('550 5.1.1 No such mailbox here (stub-banner-7f3a)');
        rcpts.push(to);
        send('250 2.1.5 OK');
      } else if (upper === 'DATA') {
        mode = 'data';
        send('354 End data with <CR><LF>.<CR><LF>');
      } else if (upper === 'RSET' || upper === 'NOOP') send('250 OK');
      else if (upper === 'QUIT') {
        send('221 Bye');
        sock.end();
      } else send('502 5.5.2 Command not recognized');
    };

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (let i = buf.indexOf('\r\n'); i >= 0; i = buf.indexOf('\r\n')) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        onLine(line);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const actual = (server.address() as { port: number }).port;
  return {
    port: actual,
    host: '127.0.0.1',
    messages,
    get maxConcurrentData() {
      return state.maxConcurrentData;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
