import type {
    SyncEnginePersistenceAdapter,
    VersionedSyncData,
} from "../sync-engine-types";

/**
 * Configuration options for the SQLiteSyncAdapter
 */
export interface FileSyncAdapterConfig<TState> {
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

    /**
     * Enable debug logging
     */
    debug?: boolean;

    /**
     * Optional validation function for the loaded state
     * Returns true if valid, false if invalid
     */
    validateState?: (state: TState) => boolean;

    /**
     * Optional function to create initial state when needed
     * If not provided, an empty object will be used
     */
    createInitialState?: () => TState;
}

/**
 * Stores the entire TState (as JSON) plus the version in a single file.
 * This parallels the KV store's FileAdapter approach, but for WebSocket state.
 */
export class FileSyncAdapter<TState>
    implements SyncEnginePersistenceAdapter<TState> {
    private filePath: string;
    private backupsDir?: string;
    private debug: boolean;
    private validateState?: (state: TState) => boolean;
    private createInitialState: () => TState;

    constructor(config: FileSyncAdapterConfig<TState>) {
        this.filePath = config.filePath;
        this.backupsDir = config.backupsDir;
        this.debug = config.debug ?? false;
        this.validateState = config.validateState;
        this.createInitialState = config.createInitialState ?? (() => ({} as TState));
    }

    /**
     * Utility for debug logging. Only logs if debug is enabled.
     */
    private debugLog(...args: unknown[]): void {
        if (this.debug) {
            console.log("[SQLiteSyncAdapter]", ...args);
        }
    }

    /**
     * Creates a new versioned data object with initial state
     */
    private createInitialData(): VersionedSyncData<TState> {
        const state = this.createInitialState();
        return { state, version: 0 };
    }

    /**
     * Ensure the file exists (or create it). If it doesn't exist or if its contents
     * are invalid/empty, we'll use the initial state provider.
     */
    public async init(): Promise<void> {
        try {
            const file = Bun.file(this.filePath);
            const exists = await file.exists();
            this.debugLog("Initializing adapter with file:", this.filePath);

            if (!exists) {
                this.debugLog("File doesn't exist, creating with initial state");
                await this.writeData(this.createInitialData());
                return;
            }

            const contents = await file.text();
        if (!contents.trim()) {
                this.debugLog("Empty file, creating with initial state");
                await this.writeData(this.createInitialData());
                return;
            }

            try {
                const data = JSON.parse(contents) as VersionedSyncData<TState>;
                
                // Validate the state if a validator is provided
                if (this.validateState && !this.validateState(data.state)) {
                    this.debugLog("State validation failed, using initial state");
                    await this.writeData(this.createInitialData());
                    return;
                }

                this.debugLog("Successfully validated existing file contents");
            } catch (parseErr) {
                this.debugLog("Invalid JSON in file, using initial state:", parseErr);
                await this.writeData(this.createInitialData());
            }
        } catch (error) {
            this.debugLog("Error during initialization:", error);
            await this.writeData(this.createInitialData());
        }
    }

    /**
     * Load (state + version) from the JSON file.
     * If the file is invalid or doesn't exist, returns initial state.
     */
    public async load(): Promise<VersionedSyncData<TState>> {
        try {
            const file = Bun.file(this.filePath);
            const exists = await file.exists();
            
            if (!exists) {
                this.debugLog("File doesn't exist, returning initial state");
                return this.createInitialData();
            }

            const contents = await file.text();
            if (!contents.trim()) {
                this.debugLog("Empty file, returning initial state");
                return this.createInitialData();
            }

            const data = JSON.parse(contents) as VersionedSyncData<TState>;
            
            // Validate the state if a validator is provided
            if (this.validateState && !this.validateState(data.state)) {
                this.debugLog("State validation failed, returning initial state");
                return this.createInitialData();
            }

            this.debugLog("Successfully loaded state, version:", data.version);
            return data;
        } catch (error) {
            this.debugLog("Error loading state:", error);
            return this.createInitialData();
        }
    }

    /**
     * Save (state + version) to the JSON file.
     */
    public async save(state: TState, version: number): Promise<void> {
        this.debugLog("Saving state, version:", version);
        const data: VersionedSyncData<TState> = { state, version };
        await this.writeData(data);
    }

    /**
     * Optionally create a timestamped backup of the JSON file,
     * if `backupsDir` is set. If not, you can skip or log a warning.
     */
    public async backup(): Promise<void> {
        if (!this.backupsDir) {
            this.debugLog("No backupsDir specified, skipping backup");
            return;
        }

        try {
            await Bun.write(`${this.backupsDir}/.placeholder`, "");

            const timestamp = Date.now();
            const backupFileName = `backup-${timestamp}.json`;
            const backupPath = `${this.backupsDir}/${backupFileName}`;

            this.debugLog("Creating backup at:", backupPath);

            const mainFile = Bun.file(this.filePath);
            const data = await mainFile.arrayBuffer();

            await Bun.write(backupPath, data);
            this.debugLog("Backup created successfully");
        } catch (error) {
            this.debugLog("Backup failed:", error);
            throw error; // Re-throw to allow error handling upstream
        }
    }

    /**
     * Helper: write the entire object as JSON to disk.
     */
    private async writeData(data: VersionedSyncData<TState>): Promise<void> {
        try {
            this.debugLog("Writing data to file:", this.filePath);
            const serialized = JSON.stringify(data, null, 2);
            await Bun.write(this.filePath, serialized);
            this.debugLog("Successfully wrote data");
        } catch (error) {
            this.debugLog("Error writing data:", error);
            throw error; // Re-throw to allow error handling upstream
        }
    }
}