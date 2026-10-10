import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMailDeliveryDto {
  @IsIn(['direct', 'cloudways'])
  mode!: 'direct' | 'cloudways';

  /** Cloudways send URL. Empty string clears stored URL (falls back to env). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string | null;

  /**
   * API key. Omit to keep existing. Empty string clears stored key (falls back to env).
   * Never returned by GET.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string | null;
}

export class TestMailRelayDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  to!: string;
}
