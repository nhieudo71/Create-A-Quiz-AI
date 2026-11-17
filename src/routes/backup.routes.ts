import { FastifyInstance } from 'fastify';
import { BackupService } from '../modules/backup/backup.service';

export function registerBackupRoutes(
  app: FastifyInstance,
  backupService: BackupService,
  jsonBodyLimit: number
): void {
  // ============================================================================
  // 6. SAO LƯU & PHỤC HỒI DỮ LIỆU
  // ============================================================================
  app.get('/api/v1/backup/export', async (req, reply) => {
    const payload = await backupService.exportAll();
    const filename = `medquiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send({ success: true, data: payload });
  });

  app.get('/api/v1/backup/counts', async (req, reply) => {
    const counts = await backupService.currentCounts();
    return reply.send({ success: true, data: counts });
  });

  app.post('/api/v1/backup/preview', {
    bodyLimit: jsonBodyLimit,
    handler: async (req, reply) => {
      const summary = await backupService.previewPayload(req.body);
      return reply.send({ success: true, data: summary });
    }
  });

  app.post('/api/v1/backup/restore', {
    bodyLimit: jsonBodyLimit,
    handler: async (req, reply) => {
      const result = await backupService.restoreAll(req.body);
      return reply.send({ success: true, data: result });
    }
  });
}
