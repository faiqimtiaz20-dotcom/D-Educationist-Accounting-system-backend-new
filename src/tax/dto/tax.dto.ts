import { TaxType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateTaxRecordDto {
  @IsEnum(TaxType)
  taxType!: TaxType;

  @IsString()
  @Matches(PERIOD_RE, { message: 'period must be YYYY-MM' })
  period!: string;

  @IsUUID()
  branchId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateTaxRecordDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
