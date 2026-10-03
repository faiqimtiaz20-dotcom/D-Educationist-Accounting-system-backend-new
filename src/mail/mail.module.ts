import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MailController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
