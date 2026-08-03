import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@xhs/database';
import { page } from '../common/pagination.dto';
@Injectable()
export class NotesService {
  async list(accountId:string|undefined,cursor:string|undefined,limit:number){return page(await prisma.note.findMany({where:{...(accountId?{accountId}:{}),...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:limit+1}),limit)}
  async detail(id:string){
    const note=await prisma.note.findUnique({where:{id}});if(!note)throw new NotFoundException('note not found');
    const snapshots=await prisma.metricSnapshot.findMany({where:{noteId:id,supersededAt:null},orderBy:[{capturedAt:'desc'},{observedAt:'desc'},{revision:'desc'}],include:{metricDefinition:true}});
    const seen=new Set<string>();
    const metrics=snapshots.flatMap(s=>{const d=s.metricDefinition;if(s.capturedAt<d.effectiveFrom||(d.effectiveTo&&s.capturedAt>=d.effectiveTo)||seen.has(d.key))return[];seen.add(d.key);return[{key:d.key,displayName:d.displayName,availability:s.availability,value:s.value?.toString()??null,source:s.source,observedAt:s.observedAt.toISOString(),capturedAt:s.capturedAt.toISOString(),definitionVersion:d.version}]});
    return{...note,metrics};
  }
}
