import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { EmployeesService } from './employees.service';
import { ReimbursementsService } from './reimbursements.service';

@Module({
  imports: [AccountingModule],
  controllers: [PayrollController],
  providers: [PayrollService, EmployeesService, ReimbursementsService],
  exports: [PayrollService, EmployeesService, ReimbursementsService],
})
export class PayrollModule {}
