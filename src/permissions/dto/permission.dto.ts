import {
  IsArray,
  IsEnum,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PermissionLevel } from '@prisma/client';

class PermissionCellDto {
  @IsString()
  roleCode!: string;

  @IsString()
  moduleCode!: string;

  @IsEnum(PermissionLevel)
  level!: PermissionLevel;
}

export class UpdatePermissionMatrixDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionCellDto)
  cells!: PermissionCellDto[];
}
