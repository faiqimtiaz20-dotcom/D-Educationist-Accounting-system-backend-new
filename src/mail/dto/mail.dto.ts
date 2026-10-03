import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';
import { SmtpAuthMode, SmtpProvider } from '@prisma/client';

export class UpsertSmtpPasswordDto {
  @IsEnum(SmtpProvider)
  provider!: SmtpProvider;

  @IsEmail()
  fromEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  fromName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  username?: string;

  /** App password / SMTP password. Omit to keep existing. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;
}

export class StartOauthDto {
  @IsEnum(SmtpProvider)
  provider!: SmtpProvider;
}

export class TestEmailDto {
  @IsEmail()
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
}

export { SmtpProvider, SmtpAuthMode };
