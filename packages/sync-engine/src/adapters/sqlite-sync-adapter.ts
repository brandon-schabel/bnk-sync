import { Database } from "bun:sqlite";
import type {
  SyncEnginePersistenceAdapter,
  VersionedSyncData,
} from "../sync-engine-types";

export interface SQLiteSyncAdapterConfig {
  path: string;
  tableName?: string;
}

/**
 * Stores the entire TState (as JSON) and version in a single SQLite row.
 */
export class SQLiteSyncAdapter<TState> implements SyncEnginePersistenceAdapter<TState> {
  private db: Database;
  private tableName: string;

  constructor(private config: SQLiteSyncAdapterConfig) {
    this.tableName = config.tableName ?? "websocket_state";
    this.db = new Database(config.path);
  }

  public async init(): Promise<void> {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id INTEGER PRIMARY KEY,
        data_json TEXT NOT NULL,
        version INTEGER NOT NULL
      )
    `);

    // Ensure we have a row with id=1
    this.db.run(`
      INSERT INTO ${this.tableName} (id, data_json, version)
      VALUES (1, '{}', 0)
      ON CONFLICT(id) DO NOTHING
    `);
  }

  public async load(): Promise<VersionedSyncData<TState>> {
    const row = this.db
      .query(`SELECT data_json, version FROM ${this.tableName} WHERE id = 1`)
      .get() as { data_json: string; version: number };

    return {
      state: row?.data_json ? (JSON.parse(row.data_json) as TState) : ({} as TState),
      version: row?.version ?? 0,
    };
  }

  public async save(state: TState, version: number): Promise<void> {
    const dataJson = JSON.stringify(state);
    this.db.run(
      `UPDATE ${this.tableName} SET data_json = ?, version = ? WHERE id = 1`,
      [dataJson, version]
    );
  }

  /**
   * Optional backup. For simplicity, we'll just copy the DB file.
   */
  public async backup(): Promise<void> {
    const backupPath = `backup-${Date.now()}-${this.config.path}`;
    await Bun.write(backupPath, await Bun.file(this.config.path).arrayBuffer());
  }
} 