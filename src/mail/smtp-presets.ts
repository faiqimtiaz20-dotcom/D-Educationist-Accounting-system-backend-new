import { SmtpProvider } from '@prisma/client';

export type SmtpPreset = {
  host: string;
  port: number;
  secure: boolean;
};

export function smtpPreset(provider: SmtpProvider): SmtpPreset | null {
  switch (provider) {
    case 'GMAIL':
      return { host: 'smtp.gmail.com', port: 465, secure: true };
    case 'MICROSOFT365':
    case 'OUTLOOK':
      // Outlook.com + Microsoft 365 both use Office SMTP
      return { host: 'smtp.office365.com', port: 587, secure: false };
    default:
      return null;
  }
}

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL =
  'https://www.googleapis.com/oauth2/v2/userinfo';
/** SMTP + send scope for Gmail */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://mail.google.com/',
].join(' ');

export const MS_AUTH_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
export const MS_TOKEN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MS_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';
/** Offline + SMTP send for Outlook / M365 */
export const MS_SCOPES = [
  'openid',
  'email',
  'offline_access',
  'https://outlook.office.com/SMTP.Send',
  'User.Read',
].join(' ');
