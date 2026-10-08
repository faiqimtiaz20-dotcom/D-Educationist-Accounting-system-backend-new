import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/** Roles that may be assigned via POST/PATCH /users (never TENANT_ADMIN / CRM). */
export const ASSIGNABLE_USER_ROLE_CODES = [
  'BRANCH_MANAGER',
  'ACCOUNTANT',
  'CASHIER',
  'COUNSELLOR',
  'READ_ONLY',
] as const;

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  fullName!: string;

  /** Rejected at validation — Branch Manager cannot escalate to TENANT_ADMIN. */
  @IsIn(ASSIGNABLE_USER_ROLE_CODES, {
    message:
      'roleCode must be one of BRANCH_MANAGER, ACCOUNTANT, CASHIER, COUNSELLOR, READ_ONLY',
  })
  roleCode!: string;

  @IsUUID()
  branchId!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsIn(ASSIGNABLE_USER_ROLE_CODES, {
    message:
      'roleCode must be one of BRANCH_MANAGER, ACCOUNTANT, CASHIER, COUNSELLOR, READ_ONLY',
  })
  roleCode?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
