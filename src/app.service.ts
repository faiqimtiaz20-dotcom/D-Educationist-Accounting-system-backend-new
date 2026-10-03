import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: "D' Educationist Accounting API",
      version: '0.15.0-m15',
      prefix: '/api/v1',
      milestone: 'M15',
      status:
        'Handover pack ready: UAT checklist, user guide, deploy runbook. Client sign-off pending.',
      health: '/api/v1/health',
      auth: {
        login: 'POST /api/v1/auth/login',
        refresh: 'POST /api/v1/auth/refresh',
        logout: 'POST /api/v1/auth/logout',
        me: 'GET /api/v1/auth/me',
      },
    };
  }
}
