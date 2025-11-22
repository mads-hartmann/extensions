# Implementation Plan: SQLite Caching for Spotify Library

## Overview
Implement SQLite-based caching for the Spotify library data (playlists, albums, artists, tracks, shows, episodes) to reduce API calls and improve performance. The cache will be refreshed automatically based on a configurable interval or manually via a command.

## Dependencies

### New Dependencies
- `sql.js` - SQLite compiled to WebAssembly for use in Raycast extensions
- `@types/sql.js` - TypeScript types for sql.js (if available)

Add to `package.json`:
```json
{
  "dependencies": {
    "sql.js": "^1.10.3"
  },
  "devDependencies": {
    "@types/sql.js": "^1.4.4"
  }
}
```

## File Structure

### New Files to Create

1. **`src/helpers/database.ts`**
   - Database initialization and connection management
   - Schema creation
   - Database utility functions (read/write operations)

2. **`src/helpers/libraryCache.ts`**
   - Cache management logic
   - Functions to check cache freshness
   - Functions to populate cache from API
   - Functions to read from cache

3. **`src/commands/refreshLibraryCache.tsx`**
   - New Raycast command for manually refreshing the cache
   - UI component to show refresh progress/status

### Files to Modify

1. **`package.json`**
   - Add sql.js dependency
   - Add new command entry for refresh cache

2. **`src/hooks/useYourLibrary.ts`**
   - Modify to read from database instead of API
   - Keep same return type and interface

3. **`package.json` (preferences section)**
   - Add preference for database path
   - Add preference for cache refresh interval (hours)

## Database Schema

### Tables

1. **`metadata`** - Stores cache metadata
   ```sql
   CREATE TABLE metadata (
     key TEXT PRIMARY KEY,
     value TEXT
   );
   ```
   - Keys: `last_refresh_timestamp`, `schema_version`

2. **`playlists`** - Stores playlist data
   ```sql
   CREATE TABLE playlists (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of SimplifiedPlaylistObject (stored as TEXT)
     cached_at INTEGER NOT NULL  -- Unix timestamp
   );
   ```

3. **`albums`** - Stores album data
   ```sql
   CREATE TABLE albums (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of SimplifiedAlbumObject (stored as TEXT)
     cached_at INTEGER NOT NULL
   );
   ```

4. **`artists`** - Stores artist data
   ```sql
   CREATE TABLE artists (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of ArtistObject (stored as TEXT)
     cached_at INTEGER NOT NULL
   );
   ```

5. **`tracks`** - Stores track data
   ```sql
   CREATE TABLE tracks (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of SimplifiedTrackObject (stored as TEXT)
     cached_at INTEGER NOT NULL
   );
   ```

6. **`shows`** - Stores show/podcast data
   ```sql
   CREATE TABLE shows (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of SimplifiedShowObject (stored as TEXT)
     cached_at INTEGER NOT NULL
   );
   ```

7. **`episodes`** - Stores episode data
   ```sql
   CREATE TABLE episodes (
     id TEXT PRIMARY KEY,
     data JSON NOT NULL,  -- JSON string of SimplifiedEpisodeObject (stored as TEXT)
     cached_at INTEGER NOT NULL
   );
   ```

**Note on JSON Type**: SQLite doesn't have a dedicated JSON column type - JSON data is stored as TEXT. However, you can declare columns with `JSON` type affinity (as shown above), which SQLite treats as TEXT but with JSON-specific optimizations and type hints. This is semantically clearer than using `TEXT` directly. The actual storage is identical - both are stored as TEXT internally.

## Implementation Steps

### Step 1: Add Dependencies
1. Install `sql.js` and `@types/sql.js`
2. Update `package.json` with new dependencies

### Step 2: Create Database Helper (`src/helpers/database.ts`)

**Responsibilities:**
- Initialize SQLite database connection
- Create database schema if it doesn't exist
- Provide functions to:
  - Get database instance (singleton pattern)
  - Execute queries (read/write)
  - Close database connection
  - Check if database is empty

**Key Functions:**
```typescript
- initDatabase(dbPath: string): Database
- getDatabase(): Database | null
- isDatabaseEmpty(): boolean
- closeDatabase(): void
- executeQuery(sql: string, params?: any[]): any
```

**Implementation Notes:**
- Use singleton pattern to maintain single database connection
- Load sql.js WASM file from node_modules
- Handle file system operations for reading/writing database file
- Use Raycast's environment API for file paths if needed

### Step 3: Create Library Cache Helper (`src/helpers/libraryCache.ts`)

**Responsibilities:**
- Check if cache needs refresh (based on interval preference)
- Populate cache from API data
- Read cache data and format to match API response structure
- Clear cache before full refresh

**Key Functions:**
```typescript
- shouldRefreshCache(): boolean
- refreshCacheFromAPI(): Promise<void>
- getCachedPlaylists(): Promise<{ items: SimplifiedPlaylistObject[] }>
- getCachedAlbums(): Promise<{ items: SimplifiedAlbumObject[] }>
- getCachedArtists(): Promise<{ items: ArtistObject[] }>
- getCachedTracks(): Promise<{ items: SimplifiedTrackObject[], total: number }>
- getCachedShows(): Promise<{ items: SimplifiedShowObject[] }>
- getCachedEpisodes(): Promise<{ items: SimplifiedEpisodeObject[] }>
- clearCache(): Promise<void>
```

**Implementation Notes:**
- Read preferences for database path and refresh interval
- Use existing API functions (getUserPlaylists, getMySavedAlbums, etc.)
- Store full JSON objects in database (JSON.stringify)
- Parse JSON when reading (JSON.parse)
- Update metadata table with last_refresh_timestamp
- Handle empty database case (return empty arrays)

### Step 4: Add Preferences to package.json

Add to the `yourLibrary` command preferences:
```json
{
  "name": "databasePath",
  "title": "Database Path",
  "description": "Path to the SQLite database file",
  "type": "textfield",
  "default": "/tmp/raycast-spotify-player.db",
  "required": false
},
{
  "name": "cacheRefreshInterval",
  "title": "Cache Refresh Interval (hours)",
  "description": "How often to automatically refresh the cache (in hours)",
  "type": "textfield",
  "default": "24",
  "required": false
}
```

### Step 5: Modify useYourLibrary Hook

**Changes:**
- Replace API calls with cache reads
- Check if cache is empty or needs refresh
- If empty or needs refresh, fetch from API and update cache
- Otherwise, read from database
- Keep exact same return type structure

**Logic Flow:**
1. Check if database is empty
2. If empty → fetch from API → save to database → return data
3. If not empty → check if refresh needed (based on interval)
4. If refresh needed → fetch from API → clear cache → save to database → return data
5. If refresh not needed → read from database → return data

**Implementation:**
- Import libraryCache helper functions
- Replace Promise.all with cache reads
- Maintain same data structure in return value
- Keep error handling similar to current implementation

### Step 6: Create Refresh Cache Command

**File:** `src/commands/refreshLibraryCache.tsx`

**Responsibilities:**
- Provide UI for manual cache refresh
- Show loading state during refresh
- Show success/error messages
- Force refresh regardless of interval

**Implementation:**
- Use Raycast's ActionPanel or Form for UI
- Call `refreshCacheFromAPI()` function
- Show toast notifications for success/error
- Optionally show progress indicator

**Add to package.json commands:**
```json
{
  "name": "refreshLibraryCache",
  "title": "Refresh Library Cache",
  "subtitle": "Spotify",
  "description": "Manually refresh the cached library data from Spotify API",
  "mode": "no-view"
}
```

## Data Flow

### Initial Load (Empty Database)
1. `useYourLibrary` hook called
2. `libraryCache.isDatabaseEmpty()` returns true
3. Fetch all data from API (getUserPlaylists, getMySavedAlbums, etc.)
4. `libraryCache.refreshCacheFromAPI()` saves all data to database
5. Return data to hook

### Subsequent Loads (Cache Exists)
1. `useYourLibrary` hook called
2. `libraryCache.isDatabaseEmpty()` returns false
3. `libraryCache.shouldRefreshCache()` checks interval
4. If refresh needed → fetch from API → clear cache → save to database
5. If refresh not needed → read from database
6. Return data to hook

### Manual Refresh
1. User triggers refresh command
2. `refreshLibraryCache` command calls `libraryCache.refreshCacheFromAPI()`
3. Clear all tables
4. Fetch all data from API
5. Save to database
6. Update metadata with new timestamp

## Error Handling

- Database initialization errors: Log and fall back to API
- Database read errors: Log and fall back to API
- Database write errors: Log error (no fallback per requirements)
- API fetch errors: Propagate to hook (existing error handling)
- Empty database: Automatically fetch from API

## Testing Considerations

1. Test with empty database (first run)
2. Test with populated database (subsequent runs)
3. Test cache refresh interval logic
4. Test manual refresh command
5. Test with invalid database path
6. Test with corrupted database file
7. Test with large datasets
8. Verify return types match existing hook interface

## Migration Notes

- No migration needed for existing users (database will be created on first run)
- If schema changes in future, change database path in preferences (per requirements)

## Performance Considerations

- Database reads should be faster than API calls
- Full refresh may take time for large libraries (consider showing progress)
- Database file size may grow with large libraries (JSON storage)
- Consider database file cleanup if needed

## Future Enhancements (Out of Scope)

- Incremental updates instead of full refresh
- Background refresh while showing cached data
- Database optimization (indexes, compression)
- Cache invalidation on specific events
- Multiple database support for different users

