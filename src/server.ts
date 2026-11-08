import { buildApp } from './app';
import { env } from './config/env.config';
import { runMigrations } from './core/database/migrate';

async function startServer() {
  const app = buildApp();

  try {
    // Khởi tạo bảng trước khi nhận request. Script dùng CREATE TABLE IF NOT EXISTS
    // nên chạy lại mỗi lần khởi động vẫn an toàn.
    await runMigrations();

    const address = await app.listen({
      port: env.PORT,
      host: env.HOST
    });
    console.log(`🚀 Hệ thống Tao-Trac-Nghiem AI đang chạy tại: ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

startServer();
