import { ApprovalStatus, ApprovalType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class DecideApprovalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateDocumentMetaDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsEnum(['Invoice', 'Receipt', 'Bill', 'Contract', 'Agreement'] as const)
  docType!: 'Invoice' | 'Receipt' | 'Bill' | 'Contract' | 'Agreement';

  @IsString()
  @MaxLength(40)
  linkedType!: string;

  @IsUUID()
  linkedId!: string;
}

export { ApprovalStatus, ApprovalType };
