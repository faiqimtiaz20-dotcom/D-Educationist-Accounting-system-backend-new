import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { ApprovalStatus, ApprovalType, DocumentType } from '@prisma/client';
import { ApprovalsService } from './approvals.service';
import { DocumentsService } from './documents.service';
import { AuditQueryService } from './audit-query.service';
import { DecideApprovalDto } from './dto/operations.dto';
import {
  CurrentUser,
  RequirePermission,
  type AuthUserPayload,
} from '../common/decorators';
import { MODULE_CODES } from '../common/rbac';
import { resolveBranchScope } from '../common/branch-scope';

@Controller()
export class OperationsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly documents: DocumentsService,
    private readonly auditQuery: AuditQueryService,
  ) {}

  private scope(user: AuthUserPayload, req: Request, branchId?: string) {
    const scoped = req as Request & {
      branchScope?: ReturnType<typeof resolveBranchScope>;
    };
    return scoped.branchScope ?? resolveBranchScope(user, branchId);
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  @Get('approvals')
  @RequirePermission(MODULE_CODES.APPROVALS, 'read')
  listApprovals(
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('status') status?: ApprovalStatus,
    @Query('type') type?: ApprovalType,
  ) {
    return this.approvals.list(this.scope(user, req, branchId), {
      status,
      approvalType: type,
    });
  }

  @Get('approvals/:id')
  @RequirePermission(MODULE_CODES.APPROVALS, 'read')
  getApproval(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.approvals.get(id, this.scope(user, req));
  }

  @Post('approvals/:id/approve')
  @RequirePermission(MODULE_CODES.APPROVALS, 'limited')
  approve(
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.approvals.decide(
      id,
      ApprovalStatus.Approved,
      user,
      this.scope(user, req),
      dto.note,
    );
  }

  @Post('approvals/:id/reject')
  @RequirePermission(MODULE_CODES.APPROVALS, 'limited')
  reject(
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
    @CurrentUser() user: AuthUserPayload,
    @Req() req: Request,
  ) {
    return this.approvals.decide(
      id,
      ApprovalStatus.Rejected,
      user,
      this.scope(user, req),
      dto.note,
    );
  }

  // ── Documents (local disk under UPLOAD_DIR / ./uploads) ────────────────────

  @Get('documents')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listDocuments(
    @Query('linkedType') linkedType?: string,
    @Query('linkedId') linkedId?: string,
    @Query('docType') docType?: DocumentType,
  ) {
    return this.documents.list({ linkedType, linkedId, docType });
  }

  @Get('documents/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  getDocument(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @Get('documents/:id/download')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  async downloadDocument(@Param('id') id: string, @Res() res: Response) {
    const file = await this.documents.downloadStream(id);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.name)}"`,
    );
    if (file.sizeBytes != null) {
      res.setHeader('Content-Length', String(file.sizeBytes));
    }
    file.stream.pipe(res);
  }

  @Post('documents')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      name?: string;
      docType: DocumentType;
      linkedType: string;
      linkedId: string;
    },
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.documents.upload(file, body, user);
  }

  @Delete('documents/:id')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'full')
  deleteDocument(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserPayload,
  ) {
    return this.documents.remove(id, user);
  }

  // ── Audit trail ───────────────────────────────────────────────────────────

  @Get('audit-logs')
  @RequirePermission(MODULE_CODES.OPERATIONS, 'read')
  listAudit(
    @Query('module') module?: string,
    @Query('userId') userId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.auditQuery.list({
      module,
      userId,
      entityType,
      entityId,
      action: action as never,
      from,
      to,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
