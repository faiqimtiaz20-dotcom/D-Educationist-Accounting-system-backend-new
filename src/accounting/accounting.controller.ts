import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApprovalStatus, JournalSourceType } from '@prisma/client';
import { JournalsService } from './journals.service';
import { GlInquiryService } from './gl-inquiry.service';
import { PartyLedgersService } from './party-ledgers.service';
import {
  CreateJournalDto,
  ReverseJournalDto,
  UpdateJournalDto,
} from './dto/journals.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class AccountingController {
  constructor(
    private readonly journals: JournalsService,
    private readonly gl: GlInquiryService,
    private readonly ledgers: PartyLedgersService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Journals ──────────────────────────────────────────────────────────────

  @Get('journal-entries')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  listJournals(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('sourceType') sourceType?: JournalSourceType,
    @Query('approvalStatus') approvalStatus?: ApprovalStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.journals.list(this.scope(user, req, branchId), {
      sourceType,
      approvalStatus,
      from,
      to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('journal-entries/:id')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  getJournal(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.get(id, this.scope(user, req));
  }

  @Post('journal-entries')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  createJournal(
    @Body() dto: CreateJournalDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.create(
      dto,
      user,
      this.scope(user, req, dto.branchId),
    );
  }

  @Patch('journal-entries/:id')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  updateJournal(
    @Param('id') id: string,
    @Body() dto: UpdateJournalDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.update(id, dto, user, this.scope(user, req));
  }

  @Post('journal-entries/:id/approve')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  approveJournal(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.approve(id, user, this.scope(user, req));
  }

  @Post('journal-entries/:id/reverse')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  reverseJournal(
    @Param('id') id: string,
    @Body() dto: ReverseJournalDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.reverse(id, dto, user, this.scope(user, req));
  }

  @Delete('journal-entries/:id')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'full')
  deleteJournal(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.journals.remove(id, user, this.scope(user, req));
  }

  // ── GL inquiry ────────────────────────────────────────────────────────────

  @Get('gl/trial-balance')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  trialBalance(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.gl.trialBalance(this.scope(user, req, branchId), from, to);
  }

  @Get('gl/chart')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  chart(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.gl.chartWithBalances(this.scope(user, req, branchId));
  }

  @Get('gl/accounts/:code/activity')
  @RequirePermission(MODULE_CODES.JOURNAL_ENTRIES, 'read')
  accountActivity(
    @Param('code') code: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.gl.accountActivity(
      code,
      this.scope(user, req, branchId),
      from,
      to,
    );
  }

  // ── Party ledgers ─────────────────────────────────────────────────────────

  @Get('ledgers/students/:id')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'read')
  studentLedger(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.ledgers.studentLedger(id, this.scope(user, req, branchId));
  }

  @Get('ledgers/vendors/:id')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'read')
  vendorLedger(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.ledgers.vendorLedger(id, this.scope(user, req, branchId));
  }

  @Get('ledgers/sub-agents/:id')
  @RequirePermission(MODULE_CODES.TAX_COMPLIANCE, 'read')
  subAgentLedger(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
  ) {
    return this.ledgers.subAgentLedger(id, this.scope(user, req, branchId));
  }
}
