import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NoteExportService } from './note-export.service';
import { NotesService } from './notes.service';

@Module({ controllers: [NotesController], providers: [NotesService, NoteExportService] })
export class NotesModule {}
