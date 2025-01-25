// packages/backend-websocket-manager/src/adapters/file-websocket-adapter.ts
import type {
    BackendWebSocketPersistenceAdapter,
    VersionedWebSocketData,
} from "../backend-websocket-types";

/**
 * Configuration options for the FileWebSocketAdapter
 */
export interface FileWebSocketAdapterConfig {
    /**
     * The file path where we store the JSON data.
     * Example: `my-websocket-state.json`
     */
    filePath: string;

    /**
     * (Optional) Directory in which to place backups.
     * Example: `./backups`
     */
    backupsDir?: string;
}

/**
 * Stores the entire TState (as JSON) plus the version in a single file.
 * This parallels the KV store’s FileAdapter approach, but for WebSocket state.
 */
export class FileWebSocketAdapter<TState>
    implements BackendWebSocketPersistenceAdapter<TState> {
    private filePath: string;
    private backupsDir?: string;

    constructor(config: FileWebSocketAdapterConfig) {
        this.filePath = config.filePath;
        this.backupsDir = config.backupsDir;
    }

    /**
     * Ensure the file exists (or create it). If it doesn’t exist, we’ll assume
     * a default state of `{}` with version=0.
     */
    public async init(): Promise<void> {
        try {
            // Attempt to stat the file to see if it exists
            const file = Bun.file(this.filePath);
            const info = await file.stat();

            if (!info || !info.size) {
                // File is empty or doesn’t exist => create with empty data
                const initialData: VersionedWebSocketData<TState> = {
                    state: {} as TState,
                    version: 0,
                };
                await this.writeData(initialData);
            }
        } catch {
            // If any error occurs (file not found, etc.), create a fresh file
            const initialData: VersionedWebSocketData<TState> = {
                state: {} as TState,
                version: 0,
            };
            await this.writeData(initialData);
        }
    }

    /**
     * Load (state + version) from the JSON file.
     */
    public async load(): Promise<VersionedWebSocketData<TState>> {
        try {
            const file = Bun.file(this.filePath);
            const contents = await file.text();
            if (!contents) {
                return { state: {} as TState, version: 0 };
            }
            return JSON.parse(contents) as VersionedWebSocketData<TState>;
        } catch (error) {
            // If something goes wrong, default to an empty object.
            console.error("[FileWebSocketAdapter] Error reading file:", error);
            return { state: {} as TState, version: 0 };
        }
    }

    /**
     * Save (state + version) to the JSON file.
     */
    public async save(state: TState, version: number): Promise<void> {
        const data: VersionedWebSocketData<TState> = { state, version };
        await this.writeData(data);
    }

    /**
     * Optionally create a timestamped backup of the JSON file,
     * if `backupsDir` is set. If not, you can skip or log a warning.
     */
    public async backup(): Promise<void> {
        if (!this.backupsDir) {
            // No backups directory provided, so do nothing or log
            console.warn("[FileWebSocketAdapter] No `backupsDir` specified. Skipping backup.");
            return;
        }

        try {
            // Ensure directory existence (Bun doesn’t provide a direct mkdirp yet,
            // so for a single-level dir we do a quick check).
            await Bun.write(`${this.backupsDir}/.placeholder`, "");

            // Generate a timestamp-based name
            const timestamp = Date.now();
            const backupFileName = `backup-${timestamp}.json`;
            const backupPath = `${this.backupsDir}/${backupFileName}`;

            // Read current file contents
            const mainFile = Bun.file(this.filePath);
            const data = await mainFile.arrayBuffer();

            // Write the backup file
            await Bun.write(backupPath, data);

            console.log(`[FileWebSocketAdapter] Backup created at ${backupPath}`);
        } catch (error) {
            console.error("[FileWebSocketAdapter] Backup failed:", error);
        }
    }

    /**
     * Helper: write the entire object as JSON to disk.
     */
    private async writeData(data: VersionedWebSocketData<TState>): Promise<void> {
        const serialized = JSON.stringify(data, null, 2);
        await Bun.write(this.filePath, serialized);
    }
}