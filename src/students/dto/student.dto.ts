import { ApplicationStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  studentCode!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  fullName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  cnicPassport!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contact?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID()
  counsellorId?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  country!: string;

  @IsUUID()
  universityId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  course!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  intake!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  studentGroup?: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  applicationStatus?: ApplicationStatus;

  @IsOptional()
  @IsUUID()
  subAgentId?: string | null;

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
  expectedCommissionRate!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currencyCode!: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  studentCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cnicPassport?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contact?: string | null;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @ValidateIf((_, v) => v != null && v !== '')
  @IsUUID()
  counsellorId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsUUID()
  universityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  course?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  intake?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  studentGroup?: string | null;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  applicationStatus?: ApplicationStatus;

  @IsOptional()
  @IsUUID()
  subAgentId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  tuitionFee?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  scholarship?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  expectedCommissionRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currencyCode?: string;
}

export class ListStudentsQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  counsellorId?: string;

  @IsOptional()
  @IsUUID()
  universityId?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsString()
  intake?: string;

  @IsOptional()
  @IsString()
  q?: string;

  /** When set, response is `{ items, total, take, skip }` instead of a bare array. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}
