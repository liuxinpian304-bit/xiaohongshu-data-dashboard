import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database'; import { AuditService } from '../common/audit.service'; import { page } from '../common/pagination.dto';
@Injectable() export class JobsService {
  constructor(private audit:AuditService){}
  async list(cursor:string|undefined,limit:number){return page(await prisma.syncJob.findMany({where:cursor?{id:{gt:cursor}}:undefined,orderBy:{id:'asc'},take:limit+1}),limit)}
  async create(accountId:string){if(!(await prisma.account.count({where:{id:accountId}})))throw new NotFoundException('managed account not found');const job=await prisma.syncJob.create({data:{accountId}});await this.audit.record('sync.started','SyncJob',job.id,{accountId});return job}
  async cancel(id:string){const updated=await prisma.$transaction(async tx=>{const claimed=await tx.syncJob.updateMany({where:{id,status:{in:['pending','running']}},data:{status:'failed',error:'cancelled by administrator',completedAt:new Date()}});if(claimed.count===0){const existing=await tx.syncJob.findUnique({where:{id},select:{id:true}});if(!existing)throw new NotFoundException('job not found');throw new ConflictException('job is already complete')}return tx.syncJob.findUniqueOrThrow({where:{id}})});await this.audit.record('sync.cancelled','SyncJob',id);return updated}
}
