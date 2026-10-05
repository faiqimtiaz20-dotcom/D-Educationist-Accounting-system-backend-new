import { GlAccountType } from '@prisma/client';
import {
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
} from 'class-validator';

export class CreateUniversityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  countryName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCommissionRate!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateTenantCountryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  isoCode?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTenantCountryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  isoCode?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUniversityDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  countryName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultCommissionRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSubAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  ntn?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  accountTitle?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  accountNo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultRatePercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSubAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  ntn?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  accountTitle?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  accountNo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  defaultRatePercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateVendorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  ntn?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  ntn?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateBankAccountDto {
  @IsUUID()
  branchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  bankName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  accountNo!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBankAccountDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  glAccountId?: string;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsUUID()
  glAccountId?: string;
}

export class UpsertFxRateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;

  @IsNumber()
  @Min(0)
  rateToPkr!: number;

  @IsOptional()
  @IsString()
  effectiveDate?: string;
}

export class UpdateCurrencyDto {
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;
}

export class CreateGlAccountDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEnum(GlAccountType)
  accountType!: GlAccountType;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sortOrder?: number;
}
