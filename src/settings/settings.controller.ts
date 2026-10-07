import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/settings.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  get() {
    return this.settings.getAll();
  }

  @Patch()
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  update(
    @Body() dto: UpdateSettingsDto,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.settings.update(dto, user);
  }

  @Post('invoice-logo')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.settings.uploadInvoiceLogo(file, user.id);
  }

  @Delete('invoice-logo')
  @RequirePermission(MODULE_CODES.SETTINGS, 'full')
  removeLogo(@CurrentUser() user: AuthUserPayload) {
    return this.settings.removeInvoiceLogo(user.id);
  }

  @Get('invoice-logo')
  @RequirePermission(MODULE_CODES.SETTINGS, 'limited')
  async getLogo(@Res() res: Response) {
    const file = await this.settings.streamInvoiceLogo();
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    file.stream.pipe(res);
  }
}
