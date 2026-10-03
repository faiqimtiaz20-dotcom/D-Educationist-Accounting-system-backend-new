import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { UsersModule } from './users/users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { SettingsModule } from './settings/settings.module';
import { MastersModule } from './masters/masters.module';
import { StudentsModule } from './students/students.module';
import { RevenueModule } from './revenue/revenue.module';
import { PayablesModule } from './payables/payables.module';
import { CashModule } from './cash/cash.module';
import { AccountingModule } from './accounting/accounting.module';
import { TaxModule } from './tax/tax.module';
import { PayrollModule } from './payroll/payroll.module';
import { ApprovalsSyncModule } from './operations/approvals-sync.module';
import { OperationsModule } from './operations/operations.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ReportsModule } from './reports/reports.module';
import { TenantsModule } from './tenants/tenants.module';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { PermissionsGuard } from './common/permissions.guard';
import { CrmBoundaryGuard } from './common/crm-boundary.guard';
import { BranchScopeInterceptor } from './common/branch-scope.interceptor';
import { TenantScopeInterceptor } from './common/tenant-scope.interceptor';
import { AuditMutationInterceptor } from './common/audit-mutation.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    AuditModule,
    ApprovalsSyncModule,
    AuthModule,
    BranchesModule,
    UsersModule,
    PermissionsModule,
    SettingsModule,
    MastersModule,
    StudentsModule,
    RevenueModule,
    PayablesModule,
    CashModule,
    AccountingModule,
    TaxModule,
    PayrollModule,
    OperationsModule,
    DashboardModule,
    ReportsModule,
    TenantsModule,
    MailModule,
    NotificationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CrmBoundaryGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantScopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: BranchScopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditMutationInterceptor },
  ],
})
export class AppModule {}
