import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TenantStatus } from '@prisma/client';

export class CreateTenantDto {
  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Z0-9_-]+$/i, {
    message: 'code must be alphanumeric (plus _-)',
  })
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  adminPassword!: string;

  @IsString()
  @MaxLength(120)
  adminFullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  branchCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  branchCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  orgName?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(TenantStatus)
  status?: TenantStatus;
}

export class TenantStatusDto {
  @IsEnum(TenantStatus)
  status!: TenantStatus;
}
