import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUserPayload,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('take') take?: string,
  ) {
    return this.notifications.listForUser(user.id, {
      unreadOnly: unreadOnly === 'true' || unreadOnly === '1',
      take: take ? Number(take) : undefined,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUserPayload) {
    const count = await this.notifications.unreadCount(user.id);
    return { count };
  }

  @Patch(':id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.notifications.markRead(id, user.id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthUserPayload) {
    return this.notifications.markAllRead(user.id);
  }
}
