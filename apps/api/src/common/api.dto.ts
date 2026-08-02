import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto { @IsString() @MinLength(1) @MaxLength(1024) @ApiProperty({ type: String, format: 'password' }) password!: string; }
export class AuthorizeAccountDto {
  @IsString() @MinLength(1) @MaxLength(50) @ApiProperty({ type: String }) connectorType!: string;
  @IsString() @MinLength(1) @MaxLength(200) @ApiProperty({ type: String }) platformId!: string;
  @IsOptional() @IsString() @MaxLength(200) @ApiPropertyOptional({ type: String }) displayName?: string;
  @IsString() @MinLength(1) @MaxLength(10_000) @ApiProperty({ type: String, writeOnly: true }) secret!: string;
  @IsString() @MinLength(1) @MaxLength(50) @ApiProperty({ type: String }) kind!: string;
}
export class ReauthorizeAccountDto { @IsString() @MinLength(1) @MaxLength(10_000) @ApiProperty({ type: String, writeOnly: true }) secret!: string; @IsString() @MinLength(1) @MaxLength(50) @ApiProperty({ type: String }) kind!: string; }
export class DeleteAccountDto { @IsOptional() @IsBoolean() @ApiPropertyOptional({ type: Boolean, default: true }) retainData?: boolean; }
export class CreateJobDto { @IsUUID() @ApiProperty({ type: String, format: 'uuid' }) accountId!: string; }
export class PaginationQueryDto { @IsOptional() @IsString() @MaxLength(200) @ApiPropertyOptional({ type: String }) cursor?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) @ApiPropertyOptional({ type: Number, default: 50 }) limit?: number; }
export class AccountQueryDto extends PaginationQueryDto { @IsOptional() @IsUUID() @ApiPropertyOptional({ type: String, format: 'uuid' }) accountId?: string; }
export class CommentQueryDto extends AccountQueryDto {
  @IsOptional() @IsArray() @ArrayNotEmpty() @IsUUID(undefined, { each: true }) @ApiPropertyOptional({ type: [String], format: 'uuid' }) accountIds?: string[];
  @IsOptional() @IsUUID() @ApiPropertyOptional({ type: String, format: 'uuid' }) noteId?: string;
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @ApiPropertyOptional({ type: String, format: 'date-time' }) from?: string;
  @IsOptional() @IsISO8601({ strict: true, strictSeparator: true }) @ApiPropertyOptional({ type: String, format: 'date-time' }) to?: string;
}
export class DashboardQueryDto { @IsOptional() @IsIn(['daily', 'weekly', 'monthly']) @ApiPropertyOptional({ type: String, enum: ['daily', 'weekly', 'monthly'] }) period?: string; }
export class PushKeysDto { @IsString() @MinLength(1) @MaxLength(4096) @ApiProperty({ type: String }) p256dh!: string; @IsString() @MinLength(1) @MaxLength(4096) @ApiProperty({ type: String }) auth!: string; }
export class PushSubscriptionRequestDto { @IsUUID() @ApiProperty({ type: String, format: 'uuid' }) accountId!: string; @IsString() @MaxLength(4096) @ApiProperty({ type: String, format: 'uri' }) endpoint!: string; @ValidateNested() @Type(() => PushKeysDto) @ApiProperty({ type: PushKeysDto }) keys!: PushKeysDto; }
export class NotificationQueryDto { @IsOptional() @IsUUID() @ApiPropertyOptional({ type: String, format: 'uuid' }) accountId?: string; }

export class PageInfoDto { @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null; @ApiProperty({ type: Boolean }) hasMore!: boolean; }
export class AccountDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) connectorType!: string; @ApiProperty({ type: String }) platformId!: string; }
export class SyncJobDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) status!: string; @ApiProperty({ type: String }) currentStage!: string; }
export class NoteDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) title!: string; @ApiProperty({ type: String, format: 'date-time' }) publishedAt!: string; }
export class CommentDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) content!: string; @ApiProperty({ type: Number }) likeCount!: number; }
export class ReportDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) reportType!: string; @ApiProperty({ type: String }) status!: string; }
export class NotificationDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String }) type!: string; @ApiProperty({ type: String }) title!: string; }
export class DashboardCardDto { @ApiProperty({ type: String }) key!: string; @ApiProperty({ type: String, nullable: true }) value!: string | null; @ApiProperty({ type: String }) availability!: string; }
export class DashboardResponseDto { @ApiProperty({ type: String }) period!: string; @ApiProperty({ type: [DashboardCardDto] }) cards!: DashboardCardDto[]; }
export class AuthCsrfResponseDto { @ApiProperty({ type: String }) csrfToken!: string; }
export class AuthLoginResponseDto extends AuthCsrfResponseDto { @ApiProperty({ type: Number }) expiresIn!: number; }
export class OkResponseDto { @ApiProperty({ type: Boolean }) ok!: boolean; }
export class AccountStateDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: Boolean }) active!: boolean; }
export class AccountDeletionDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: Boolean }) retainedBusinessData!: boolean; @ApiProperty({ type: Boolean }) credentialsDeleted!: boolean; @ApiProperty({ type: Boolean }) officialRevocationSupported!: boolean; }
export class PushSubscriptionResponseDto { @ApiProperty({ type: String, format: 'uuid' }) id!: string; @ApiProperty({ type: String, format: 'uuid' }) accountId!: string; @ApiProperty({ type: String, format: 'uri' }) endpoint!: string; }
export class BackgroundExportDto { @ApiProperty({ type: String, format: 'uuid' }) jobId!: string; @ApiProperty({ type: [String], format: 'uuid' }) jobIds!: string[]; }
export class PaginatedResponseDto { @ApiProperty({ type: 'array', items: { type: 'object' } }) items!: unknown[]; @ApiProperty({ type: PageInfoDto }) pageInfo!: PageInfoDto; }
export class ErrorDto { @ApiProperty({ type: Number }) statusCode!: number; @ApiProperty({ type: String }) message!: string; }
