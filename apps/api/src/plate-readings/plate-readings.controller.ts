import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlateReadingsService } from './plate-readings.service.js';

interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png']);

@Controller('plate-readings')
export class PlateReadingsController {
  constructor(private readonly readings: PlateReadingsService) {}

  /** multipart, campo "image" (JPEG/PNG até 8 MB). Devolve o request_id para polling. */
  @Post()
  @UseInterceptors(FileInterceptor('image', { limits: { fileSize: MAX_BYTES } }))
  submit(@UploadedFile() image?: UploadedImage) {
    if (!image) throw new BadRequestException('Envie a imagem no campo "image".');
    if (!ALLOWED.has(image.mimetype)) throw new BadRequestException('Formato inválido: use JPEG ou PNG.');
    return this.readings.submit(image);
  }

  @Get(':requestId')
  result(@Param('requestId') requestId: string) {
    return this.readings.result(requestId);
  }
}
