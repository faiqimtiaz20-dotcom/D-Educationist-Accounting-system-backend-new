import {
  ApprovalStatus,
  BankTransactionType,
  ChequeStatus,
  ContraEntryType,
  PettyCashEntryType,
  ReconciliationStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreatePettyCashDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  entryDate!: string;

  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsEnum(PettyCashEntryType)
  entryType!: PettyCashEntryType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  principal!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salesTax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  srbSst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  incomeTax?: number;
}

export class UpdatePettyCashDto {
  @IsOptional()
  @IsString()
  entryDate?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(PettyCashEntryType)
  entryType?: PettyCashEntryType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  principal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salesTax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  srbSst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  incomeTax?: number;
}

export class CreateExpenseDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendorName?: string;

  @IsUUID()
  categoryId!: string;

  @IsString()
  expenseDate!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  principal!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salesTax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  srbSst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  incomeTax?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  paymentMode!: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  vendorName?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  principal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salesTax?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  srbSst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  gst?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  incomeTax?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  paymentMode?: string;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  chequeNo?: string;
}

export class CreateBankTxnDto {
  @IsUUID()
  bankAccountId!: string;

  @IsString()
  txnDate!: string;

  @IsEnum(BankTransactionType)
  txnType!: BankTransactionType;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID()
  counterpartyBankAccountId?: string;

  @IsOptional()
  @IsEnum(ReconciliationStatus)
  reconciliationStatus?: ReconciliationStatus;
}

export class UpdateBankTxnDto {
  @IsOptional()
  @IsEnum(ReconciliationStatus)
  reconciliationStatus?: ReconciliationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreateChequeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  chequeNo!: string;

  @IsUUID()
  bankAccountId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  payee!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsString()
  issueDate!: string;
}

export class UpdateChequeStatusDto {
  @IsEnum(ChequeStatus)
  status!: ChequeStatus;

  @IsOptional()
  @IsString()
  clearedDate?: string;
}

export class CreateContraDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  entryDate!: string;

  @IsEnum(ContraEntryType)
  contraType!: ContraEntryType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsUUID()
  fromBankAccountId?: string;

  @IsOptional()
  @IsUUID()
  toBankAccountId?: string;

  @IsOptional()
  @IsBoolean()
  fromIsCash?: boolean;

  @IsOptional()
  @IsBoolean()
  toIsCash?: boolean;
}

export { ApprovalStatus };
