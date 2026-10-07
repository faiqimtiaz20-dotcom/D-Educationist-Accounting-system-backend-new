import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

const SERVICE_HOST: Record<string, string> = {
  gmail: 'smtp.gmail.com',
};

/**
 * Cloud hosts (e.g. Railway) often lack outbound IPv6. Nodemailer may pick an
 * AAAA record and fail with ENETUNREACH — connect using a resolved IPv4 instead.
 */
export async function preferIpv4Transport(
  options: SMTPTransport.Options,
): Promise<SMTPTransport.Options> {
  if (process.env.SMTP_FORCE_IPV4 === '0') {
    return options;
  }

  let hostname = options.host;
  if (!hostname && options.service) {
    hostname = SERVICE_HOST[options.service.toLowerCase()] ?? options.service;
  }
  if (!hostname || isIP(hostname)) {
    return options;
  }

  try {
    const addrs = await dns.resolve4(hostname);
    if (!addrs.length) return options;
    const ip = addrs[0]!;
    return {
      ...options,
      host: ip,
      tls: {
        ...(options.tls ?? {}),
        servername: options.tls?.servername ?? hostname,
      },
    };
  } catch {
    return options;
  }
}
