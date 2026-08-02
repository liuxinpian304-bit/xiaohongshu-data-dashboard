import { Module } from '@nestjs/common'; import { AccountsController } from './accounts.controller'; import { AccountsService } from './accounts.service'; import { AuditService } from '../common/audit.service';
@Module({ controllers: [AccountsController], providers: [AccountsService, AuditService] }) export class AccountsModule {}
