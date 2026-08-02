import { Type } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
export const dtoPipe = (expectedType: Type<unknown>) => new ValidationPipe({ expectedType, transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true });
