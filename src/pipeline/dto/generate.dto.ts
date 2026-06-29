import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  prompt!: string;

  /** Optional id returned by POST /upload, to embed a screen recording. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  demoUploadId?: string;
}
