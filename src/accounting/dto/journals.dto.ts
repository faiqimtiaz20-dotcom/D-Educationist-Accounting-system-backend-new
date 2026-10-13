import { ApprovalStatus, JournalSourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class JournalLineDto {
  /** Either accountCode or glAccountId is required. GET returns glAccountId. */
  @ValidateIf((o: JournalLineDto) => !o.glAccountId)
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  accountCode?: string;

  @ValidateIf((o: JournalLineDto) => !o.accountCode)
  @IsUUID()
  glAccountId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  debit!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  credit!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  memo?: string;

  /** Alias of memo. Clients that round-trip a fetched line send description. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;
}

export class CreateJournalDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  entryDate!: string;

  @ValidateIf((o: CreateJournalDto) => !o.narration)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  /** Alias of description. */
  @ValidateIf((o: CreateJournalDto) => !o.description)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  narration?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines!: JournalLineDto[];

  /** If true, create already Approved (posted). Default Pending draft. */
  @IsOptional()
  approveNow?: boolean;
}

export class UpdateJournalDto {
  @IsOptional()
  @IsString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  narration?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines?: JournalLineDto[];
}

export class ReverseJournalDto {
  @IsOptional()
  @IsString()
  reverseDate?: string;

  /** Alias of reverseDate. */
  @IsOptional()
  @IsString()
  entryDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /** Alias of reason. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export { ApprovalStatus, JournalSourceType };
