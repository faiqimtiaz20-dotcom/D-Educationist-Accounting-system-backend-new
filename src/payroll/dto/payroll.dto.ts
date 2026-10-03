import { ApprovalStatus, ReimbursementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateEmployeeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName!: string;

  @IsUUID()
  branchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  designation!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basicSalary!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  allowances?: number;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankAccount?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  designation?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basicSalary?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  allowances?: number;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  bankAccount?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ProcessPayrollDto {
  @IsString()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsUUID()
  branchId!: string;
}

export class PayrollImportLineDto {
  @IsString()
  @MinLength(1)
  employeeName!: string;

  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsString()
  designation!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  basicSalary!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  allowances!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  grossSalary!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salaryTax!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  netSalary!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  reimbursements!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalPayable!: number;
}

export class PayrollImportBranchGroupDto {
  @IsUUID()
  branchId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollImportLineDto)
  lines!: PayrollImportLineDto[];
}

export class ImportPayrollDto {
  @IsString()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollImportBranchGroupDto)
  branchGroups!: PayrollImportBranchGroupDto[];
}

export class CreateReimbursementDto {
  @IsUUID()
  employeeId!: string;

  @IsUUID()
  branchId!: string;

  @IsEnum(ReimbursementType)
  reimbursementType!: ReimbursementType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  reimbursementDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateReimbursementStatusDto {
  @IsEnum(ApprovalStatus)
  status!: ApprovalStatus;
}
