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
  ValidateNested,
} from 'class-validator';

export class JournalLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  accountCode!: string;

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
}

export class CreateJournalDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  entryDate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export { ApprovalStatus, JournalSourceType };
