import { SubAgentCommissionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCommissionDto {
  @IsUUID()
  subAgentId!: string;

  @IsUUID()
  studentId!: string;

  @IsUUID()
  invoiceId!: string;

  @IsUUID()
  branchId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  grossFee!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  rateGiven!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exchangeRate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  followOnBonus?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsEnum(SubAgentCommissionStatus)
  status?: SubAgentCommissionStatus;
}

export class UpdateCommissionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  grossFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  rateGiven?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exchangeRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  followOnBonus?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsEnum(SubAgentCommissionStatus)
  status?: SubAgentCommissionStatus;
}

export class CreatePaymentDto {
  @IsUUID()
  commissionId!: string;

  @IsUUID()
  bankAccountId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amountPkr!: number;

  @IsString()
  paymentDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;
}
