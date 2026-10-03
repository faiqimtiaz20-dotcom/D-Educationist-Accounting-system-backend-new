import { InvoiceStatus, OtherInvoiceStatus, ReconciliationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InvoiceLineDto {
  @IsUUID()
  studentId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tuitionFee!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scholarship?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  commissionRate!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  bonus?: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  universityId?: string;

  @IsString()
  invoiceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsUUID()
  universityId?: string | null;

  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  poNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exchangeRate?: number | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines?: InvoiceLineDto[];
}

export class OtherInvoiceLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class CreateOtherInvoiceDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  invoiceDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  billTo!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsEnum(OtherInvoiceStatus)
  status?: OtherInvoiceStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OtherInvoiceLineDto)
  lines!: OtherInvoiceLineDto[];
}

export class UpdateOtherInvoiceDto {
  @IsOptional()
  @IsString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  billTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsEnum(OtherInvoiceStatus)
  status?: OtherInvoiceStatus;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OtherInvoiceLineDto)
  lines?: OtherInvoiceLineDto[];
}

export class CreateReceivableDto {
  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsUUID()
  invoiceId?: string | null;

  @IsUUID()
  bankAccountId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amountReceived!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  exchangeRate!: number;

  @IsString()
  receiptDate!: string;

  @IsOptional()
  @IsEnum(ReconciliationStatus)
  reconciliationStatus?: ReconciliationStatus;

  @IsOptional()
  @IsBoolean()
  isPartial?: boolean;

  @IsOptional()
  @IsBoolean()
  isBulkRemittance?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AllocationItemDto {
  @IsUUID()
  invoiceId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  allocatedAmount!: number;
}

export class ConfirmAllocationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationItemDto)
  allocations!: AllocationItemDto[];
}
