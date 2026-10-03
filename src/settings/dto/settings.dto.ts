import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  whtRatePercent?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  enabledCurrencies?: string[];

  @IsOptional()
  @IsString()
  fiscalPeriodLockedUntil?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  orgName?: string;

  /** Invoice letterhead / email templates (tenant admin). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  invoiceAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoicePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceWebsite?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  invoiceFooter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceDocumentTitle?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  invoiceAccentColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceEmailSubject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  invoiceEmailBody?: string;
}
