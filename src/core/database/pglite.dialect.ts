import {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  QueryResult
} from 'kysely';
import type { PGlite } from '@electric-sql/pglite';

/**
 * Kysely dialect cho PGlite (PostgreSQL chạy nhúng trong tiến trình).
 * Dùng cho bản Desktop: không cần cài PostgreSQL riêng trên máy người dùng.
 * PGlite là kết nối đơn, tuần tự nên các lệnh BEGIN/COMMIT/ROLLBACK được
 * chuyển thẳng xuống engine giống như một kết nối Postgres thông thường.
 */
class PGliteConnection implements DatabaseConnection {
  constructor(private readonly client: PGlite) {}

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.client.query(compiledQuery.sql, compiledQuery.parameters as unknown[]);
    return {
      rows: (result.rows ?? []) as R[],
      numAffectedRows: BigInt(result.affectedRows ?? 0)
    };
  }

  streamQuery<R>(
    _compiledQuery: CompiledQuery,
    _chunkSize?: number
  ): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('Truy vấn dạng stream không được hỗ trợ với PGlite.');
  }
}

class PGliteDriver implements Driver {
  private connection: PGliteConnection | null = null;
  /** PGlite là kết nối đơn nên phải tự theo dõi trạng thái giao dịch. */
  private inTransaction = false;

  constructor(private readonly client: PGlite) {}

  async init(): Promise<void> {
    await this.client.waitReady;
    this.connection = new PGliteConnection(this.client);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.connection) throw new Error('Cơ sở dữ liệu nhúng chưa sẵn sàng.');
    return this.connection;
  }

  /**
   * Kysely yêu cầu Driver điều khiển giao dịch; DatabaseConnection của Kysely 0.27
   * không còn khai báo beginTransaction/commitTransaction. Ta phát lệnh SQL trực tiếp.
   */
  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    if (this.inTransaction) throw new Error('Giao dịch PGlite đã được bắt đầu trước đó.');
    await connection.executeQuery(CompiledQuery.raw('BEGIN'));
    this.inTransaction = true;
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    if (!this.inTransaction) throw new Error('Không có giao dịch PGlite nào đang mở để commit.');
    await connection.executeQuery(CompiledQuery.raw('COMMIT'));
    this.inTransaction = false;
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    if (!this.inTransaction) return;
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'));
    this.inTransaction = false;
  }

  async releaseConnection(): Promise<void> {
    // Kết nối đơn, không cần trả về pool
  }

  async destroy(): Promise<void> {
    this.connection = null;
    this.inTransaction = false;
    await this.client.close();
  }
}

export class PGliteDialect implements Dialect {
  constructor(private readonly client: PGlite) {}

  createDriver(): Driver {
    return new PGliteDriver(this.client);
  }

  createQueryCompiler(): PostgresQueryCompiler {
    return new PostgresQueryCompiler();
  }

  createAdapter(): PostgresAdapter {
    return new PostgresAdapter();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }
}
