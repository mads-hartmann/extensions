# Memory-Efficient Implementation Plan for SQLite Caching

## Overview
This plan focuses on making the SQLite caching implementation memory-efficient by:
1. Using async generators to write data incrementally to the database (streaming approach)
2. Implementing a singleton/context pattern for `useYourLibrary` to avoid duplicating library data in memory

## Problem Analysis

### Current Memory Issues

1. **Cache Population**: 
   - All API responses are fetched and stored in memory before writing
   - Large operations array built up before transaction
   - All data types fetched in parallel, keeping everything in memory simultaneously

2. **useYourLibrary Hook**:
   - Each call to `useYourLibrary` loads all data from database into memory
   - Multiple components using the hook duplicate the entire library in memory
   - No sharing of data between hook instances

## Solution Architecture

### Part 1: Streaming Database Population

Instead of collecting all data before writing, we'll:
- Use async generators directly from API functions
- Write items to database in small batches as they're fetched
- Process one data type at a time to minimize peak memory

### Part 2: Singleton Library Data Management

Implement a shared data store using:
- React Context for sharing library data across components
- Singleton pattern for the data cache
- Lazy loading - only load data when needed
- Reference counting to manage memory

## Implementation Details

### Step 1: Create Streaming Database Write Functions

**File**: `src/helpers/libraryCache.ts`

**New Functions**:
```typescript
/**
 * Write items to database as they come from async generator
 * Processes items in small batches to avoid memory buildup
 */
async function streamItemsToDatabase<T extends { id?: string }>(
  dbPath: string,
  tableName: string,
  generator: AsyncGenerator<T[], void, unknown>,
  transform?: (item: T) => T,
  batchSize: number = 100
): Promise<number>
```

**Key Features**:
- Accepts async generator directly
- Writes in batches (default 100 items)
- Optional transform function for data normalization
- Returns count of items written
- Saves database after each batch

### Step 2: Refactor refreshCacheFromAPI to Use Streaming

**Changes to `refreshCacheFromAPI()`**:

1. **Create generator functions** that wrap the existing API iterators:
   ```typescript
   async function* streamPlaylists(limit: number): AsyncGenerator<SimplifiedPlaylistObject[]>
   async function* streamAlbums(limit: number): AsyncGenerator<SimplifiedAlbumObject[]>
   async function* streamArtists(limit: number): AsyncGenerator<ArtistObject[]>
   async function* streamTracks(limit: number): AsyncGenerator<SimplifiedTrackObject[]>
   async function* streamShows(limit: number): AsyncGenerator<SimplifiedShowObject[]>
   async function* streamEpisodes(limit: number): AsyncGenerator<SimplifiedEpisodeObject[]>
   ```

2. **Process sequentially** (one type at a time):
   - Fetch and write playlists
   - Fetch and write albums
   - etc.

3. **Use streaming write function** for each type

**Memory Impact**:
- Before: All 6 data types + operations array in memory
- After: Only one batch (100 items) + current API response batch in memory

### Step 3: Create Library Data Context

**New File**: `src/contexts/LibraryDataContext.tsx`

**Purpose**: Provide singleton access to library data across all components

**Implementation**:
```typescript
type LibraryData = {
  playlists: { items: SimplifiedPlaylistObject[] } | undefined;
  albums: { items: SimplifiedAlbumObject[] } | undefined;
  artists: { items: ArtistObject[] } | undefined;
  tracks: { items: SimplifiedTrackObject[]; total: number } | undefined;
  shows: { items: SimplifiedShowObject[] } | undefined;
  episodes: { items: SimplifiedEpisodeObject[] } | undefined;
};

type LibraryDataContextType = {
  data: LibraryData;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};
```

**Features**:
- Singleton data store (only one instance in memory)
- Lazy loading (loads on first access)
- Shared across all components using the context
- Automatic refresh when cache is stale

### Step 4: Create Library Data Provider Component

**New File**: `src/components/LibraryDataProvider.tsx`

**Purpose**: Wrap the application and provide library data context

**Implementation**:
- Uses `useCachedPromise` internally to manage data loading
- Provides context to children
- Handles refresh logic
- Manages loading and error states

### Step 5: Refactor useYourLibrary Hook

**Changes to `src/hooks/useYourLibrary.ts`**:

```typescript
export function useYourLibrary(options: UseMyLibraryProps = {}) {
  const context = useContext(LibraryDataContext);
  
  if (!context) {
    throw new Error('useYourLibrary must be used within LibraryDataProvider');
  }
  
  return {
    myLibraryData: context.data,
    myLibraryError: context.error,
    myLibraryIsLoading: context.isLoading,
  };
}
```

### Step 6: Update Components to Use Provider

**Changes to `src/yourLibrary.tsx`**:
- Wrap component tree with `<LibraryDataProvider>`
- Components can now use `useYourLibrary` without duplicating data

**Changes to other components using library data**:
- Ensure they're within the provider
- Use `useYourLibrary` hook as before (no API changes)

## File Structure

### New Files
1. `src/contexts/LibraryDataContext.tsx` - Context definition
2. `src/components/LibraryDataProvider.tsx` - Provider component

### Modified Files
1. `src/helpers/libraryCache.ts` - Add streaming functions
2. `src/hooks/useYourLibrary.ts` - Use context instead of direct loading
3. `src/yourLibrary.tsx` - Wrap with provider
4. `src/components/View.tsx` - Potentially add provider here if used globally

## Implementation Steps

### Phase 1: Streaming Database Writes

1. ✅ Add `streamItemsToDatabase` function to `libraryCache.ts`
2. ✅ Create generator wrapper functions for each data type
3. ✅ Refactor `refreshCacheFromAPI` to use streaming
4. ✅ Test memory usage during cache refresh

### Phase 2: Singleton Data Management

1. ✅ Create `LibraryDataContext.tsx`
2. ✅ Create `LibraryDataProvider.tsx`
3. ✅ Refactor `useYourLibrary` to use context
4. ✅ Update `yourLibrary.tsx` to use provider
5. ✅ Test that multiple components share the same data instance

### Phase 3: Optimization

1. ✅ Add batch size configuration
2. ✅ Add memory usage logging (optional)
3. ✅ Test with large libraries
4. ✅ Verify no memory leaks

## Memory Efficiency Improvements

### Before
- **Cache Population**: ~6x library size in memory (all types + operations array)
- **Hook Usage**: Nx library size (N = number of components using hook)
- **Peak Memory**: Library size × (6 + N)

### After
- **Cache Population**: ~1 batch size (100 items) + current API batch
- **Hook Usage**: 1x library size (shared singleton)
- **Peak Memory**: Library size × 1 + batch size

### Estimated Memory Reduction
- For a library with 1000 items per type:
  - Before: ~6000 items in memory during refresh + N×6000 for components
  - After: ~200 items during refresh + 6000 shared
  - **Reduction**: ~97% during refresh, ~83% for multiple components

## Error Handling

1. **Streaming Errors**: 
   - Log batch that failed
   - Continue with next batch
   - Rollback transaction on critical error

2. **Context Errors**:
   - Provide fallback empty data
   - Show error state in UI
   - Allow manual refresh

## Testing Considerations

1. **Memory Testing**:
   - Monitor memory usage during cache refresh
   - Test with large libraries (1000+ items per type)
   - Verify no memory leaks over time

2. **Functionality Testing**:
   - Verify all data types are cached correctly
   - Test refresh functionality
   - Test multiple components using hook simultaneously
   - Verify data sharing works correctly

3. **Edge Cases**:
   - Empty library
   - Network errors during streaming
   - Database write failures
   - Concurrent refresh requests

## Migration Notes

- **Backward Compatibility**: The `useYourLibrary` hook API remains the same
- **No Breaking Changes**: Existing components continue to work
- **Gradual Migration**: Can be implemented incrementally

## Future Enhancements

1. **Incremental Updates**: Only refresh changed items instead of full refresh
2. **Background Refresh**: Refresh cache in background while showing stale data
3. **Data Compression**: Compress JSON data before storing
4. **Indexing**: Add database indexes for faster queries
5. **Pagination**: Load data in pages instead of all at once for very large libraries

