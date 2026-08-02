import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto { @ApiProperty({ type: String, format: 'password', minLength: 1, maxLength: 1024 }) password!: string; }
export class AuthorizeAccountDto {
  @ApiProperty({ type: String, maxLength: 50 }) connectorType!: string;
  @ApiProperty({ type: String, maxLength: 200 }) platformId!: string;
  @ApiPropertyOptional({ type: String, maxLength: 200 }) displayName?: string;
  @ApiProperty({ type: String, writeOnly: true, maxLength: 10_000 }) secret!: string;
  @ApiProperty({ type: String, maxLength: 50 }) kind!: string;
}
export class ReauthorizeAccountDto { @ApiProperty({ type: String, writeOnly: true, maxLength: 10_000 }) secret!: string; @ApiProperty({ type: String, maxLength: 50 }) kind!: string; }
export class DeleteAccountDto { @ApiPropertyOptional({ type: Boolean, default: true }) retainData?: boolean; }
export class CreateJobDto { @ApiProperty({ type: String, format: 'uuid' }) accountId!: string; }
export class PaginationQueryDto { @ApiPropertyOptional({ type: String }) cursor?: string; @ApiPropertyOptional({ type: String, minimum: 1, maximum: 200, default: 50 }) limit?: string; }
export class AccountQueryDto extends PaginationQueryDto { @ApiPropertyOptional({ type: String, format: 'uuid' }) accountId?: string; }
export class CommentQueryDto extends AccountQueryDto { @ApiPropertyOptional({ type: String, format: 'uuid' }) noteId?: string; @ApiPropertyOptional({ type: String, format: 'date-time' }) from?: string; @ApiPropertyOptional({ type: String, format: 'date-time' }) to?: string; }
export class DashboardQueryDto { @ApiPropertyOptional({ type: String, enum: ['daily', 'weekly', 'monthly'], default: 'daily' }) period?: string; }
export class PageInfoDto { @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null; @ApiProperty({ type: Boolean }) hasMore!: boolean; }
export class PaginatedResponseDto { @ApiProperty({ type: 'array', items: { type: 'object' } }) items!: unknown[]; @ApiProperty({ type: PageInfoDto }) pageInfo!: PageInfoDto; }
export class ErrorDto { @ApiProperty({ type: Number }) statusCode!: number; @ApiProperty({ type: String }) message!: string; }
