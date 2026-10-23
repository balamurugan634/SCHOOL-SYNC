import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';

let transport: Transporter | null | undefined;

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends via SMTP_URL when configured; otherwise logs (development). */
export async function sendMail(mail: Mail, log: { info: (o: object, m?: string) => void } = console as never): Promise<void> {
  if (transport === undefined) transport = config.SMTP_URL ? nodemailer.createTransport(config.SMTP_URL) : null;
  if (!transport) {
    log.info({ to: mail.to, subject: mail.subject, text: mail.text }, '[mail:dev] not sent (SMTP_URL unset)');
    return;
  }
  await transport.sendMail({ from: config.MAIL_FROM, ...mail });
}
