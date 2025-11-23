import { getPreferenceValues } from "@raycast/api";
import {
  getDatabase,
  isDatabaseEmpty,
  executeQuery,
  executeTransaction,
  clearCache,
  getMetadata,
  setMetadata,
  saveDatabase,
} from "./database";
import { getSpotifyClient } from "./withSpotifyClient";
import { iterate } from "./spotifyIterator";
import {
  SimplifiedPlaylistObject,
  SimplifiedAlbumObject,
  ArtistObject,
  SimplifiedTrackObject,
  SimplifiedShowObject,
  SimplifiedEpisodeObject,
  SavedAlbumObject,
  SavedTrackObject,
  SavedShowObject,
  SavedEpisodeObject,
} from "./spotify.api";

type Preferences = {
  databasePath?: string;
  cacheRefreshInterval?: string;
};

// Lock to prevent concurrent refresh operations
let refreshInProgress = false;
let refreshPromise: Promise<void> | null = null;

/**
 * Get preferences with defaults
 */
function getPreferences(): { databasePath: string; cacheRefreshInterval: number } {
  const prefs = getPreferenceValues<Preferences>();
  return {
    databasePath: prefs.databasePath || "/tmp/raycast-spotify-player.db",
    cacheRefreshInterval: parseInt(prefs.cacheRefreshInterval || "24", 10),
  };
}

/**
 * Check if cache needs to be refreshed based on interval
 */
export async function shouldRefreshCache(): Promise<boolean> {
  try {
    const { databasePath, cacheRefreshInterval } = getPreferences();

    // Check if database is empty
    const isEmpty = await isDatabaseEmpty(databasePath);
    if (isEmpty) {
      return true;
    }

    // Check last refresh timestamp
    const lastRefresh = await getMetadata(databasePath, "last_refresh_timestamp");
    if (!lastRefresh) {
      return true;
    }

    const lastRefreshTime = parseInt(lastRefresh, 10);
    const now = Date.now();
    const intervalMs = cacheRefreshInterval * 60 * 60 * 1000; // Convert hours to milliseconds

    return now - lastRefreshTime >= intervalMs;
  } catch (error) {
    console.error("Error checking if cache should refresh:", error);
    return true; // Default to refresh on error
  }
}

/**
 * Write items to database as they come from async generator
 * Processes items in small batches to avoid memory buildup
 */
async function streamItemsToDatabase<T extends { id?: string }>(
  dbPath: string,
  tableName: string,
  generator: AsyncGenerator<T[], void, unknown>,
  transform?: (item: T) => T,
  batchSize: number = 50,
): Promise<number> {
  let totalCount = 0;
  const timestamp = Date.now();
  let batch: Array<{ sql: string; params: any[] }> = [];

  try {
    for await (const items of generator) {
      for (const item of items) {
        if (item.id) {
          const transformedItem = transform ? transform(item) : item;
          batch.push({
            sql: `INSERT OR REPLACE INTO ${tableName} (id, data, cached_at) VALUES (?, ?, ?)`,
            params: [transformedItem.id, JSON.stringify(transformedItem), timestamp],
          });

          // Write in batches to avoid memory buildup
          if (batch.length >= batchSize) {
            await executeTransaction(dbPath, batch, false); // Don't save immediately
            totalCount += batch.length;
            batch = []; // Clear batch - help GC
          }
        }
      }
      // Explicitly nullify items array reference after processing
      // Note: items is from generator, we can't nullify it, but we've processed it
    }

    // Write remaining items
    if (batch.length > 0) {
      await executeTransaction(dbPath, batch, false); // Don't save immediately
      totalCount += batch.length;
      batch = []; // Clear batch - help GC
    }

    // Explicitly nullify batch reference
    batch = null as any;

    return totalCount;
  } catch (error) {
    console.error(`Error streaming items to ${tableName}:`, error);
    // Cleanup on error
    batch = null as any;
    throw error;
  }
}

/**
 * Generator wrapper functions for each data type
 */
async function* streamPlaylists(limit: number): AsyncGenerator<SimplifiedPlaylistObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const iterator = iterate<SimplifiedPlaylistObject>(limit, (input) => spotifyClient.getMePlaylists(input));
  for await (const items of iterator) {
    yield items;
  }
}

async function* streamAlbums(limit: number): AsyncGenerator<SimplifiedAlbumObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const iterator = iterate<SavedAlbumObject>(limit, (input) => spotifyClient.getMeAlbums(input));
  for await (const items of iterator) {
    const albums: SimplifiedAlbumObject[] = [];
    for (const albumItem of items ?? []) {
      if (albumItem?.album) {
        albums.push({
          ...albumItem.album,
        } as SimplifiedAlbumObject);
      }
    }
    yield albums;
    // Explicitly nullify to help GC
    albums.length = 0;
  }
}

async function* streamArtists(limit: number): AsyncGenerator<ArtistObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const batchSize = 50;
  let hasMore = true;
  let after: string | undefined = undefined;

  while (hasMore) {
    const response = await spotifyClient.getMeFollowing("artist", { limit: batchSize, after: after });
    const artists = response.artists.items || [];
    yield artists;
    after = artists[artists.length - 1]?.id || "";
    hasMore = artists.length > 0;
    if (artists.length >= limit) {
      break;
    }
  }
}

async function* streamTracks(limit: number): AsyncGenerator<SimplifiedTrackObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const iterator = iterate<SavedTrackObject>(limit, (input) => spotifyClient.getMeTracks(input));
  for await (const items of iterator) {
    const tracks: SimplifiedTrackObject[] = [];
    for (const trackItem of items) {
      if (trackItem.track) {
        tracks.push({
          ...trackItem.track,
        } as SimplifiedTrackObject);
      }
    }
    yield tracks;
    // Explicitly nullify to help GC
    tracks.length = 0;
  }
}

async function* streamShows(limit: number): AsyncGenerator<SimplifiedShowObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const iterator = iterate<SavedShowObject>(limit, (input) => spotifyClient.getMeShows(input));
  for await (const items of iterator) {
    const shows: SimplifiedShowObject[] = [];
    for (const showItem of items) {
      if (showItem.show) {
        shows.push({
          ...showItem.show,
        } as SimplifiedShowObject);
      }
    }
    yield shows;
    // Explicitly nullify to help GC
    shows.length = 0;
  }
}

async function* streamEpisodes(limit: number): AsyncGenerator<SimplifiedEpisodeObject[], void, unknown> {
  const { spotifyClient } = getSpotifyClient();
  const iterator = iterate<SavedEpisodeObject>(limit, (input) => spotifyClient.getMeEpisodes(input));
  for await (const items of iterator) {
    const episodes: SimplifiedEpisodeObject[] = [];
    for (const episodeItem of items) {
      if (episodeItem.episode) {
        episodes.push({
          ...episodeItem.episode,
        } as SimplifiedEpisodeObject);
      }
    }
    yield episodes;
    // Explicitly nullify to help GC
    episodes.length = 0;
  }
}

/**
 * Refresh cache from API using streaming approach
 * Uses a lock to prevent concurrent refresh operations
 */
export async function refreshCacheFromAPI(): Promise<void> {
  // If a refresh is already in progress, wait for it to complete
  if (refreshInProgress && refreshPromise) {
    return refreshPromise;
  }

  // Set lock and create promise
  refreshInProgress = true;
  refreshPromise = (async () => {
    const { databasePath } = getPreferences();

    try {
      // Clear existing cache
      await clearCache(databasePath);

      // Process each data type sequentially using streaming
      // This minimizes memory usage by processing one type at a time

      console.log("Streaming playlists to database...");
      await streamItemsToDatabase(databasePath, "playlists", streamPlaylists(300));
      saveDatabase(databasePath); // Save after each data type

      console.log("Streaming albums to database...");
      await streamItemsToDatabase(databasePath, "albums", streamAlbums(1000));
      saveDatabase(databasePath); // Save after each data type

      console.log("Streaming artists to database...");
      await streamItemsToDatabase(databasePath, "artists", streamArtists(300));
      saveDatabase(databasePath); // Save after each data type

      console.log("Streaming tracks to database...");
      await streamItemsToDatabase(databasePath, "tracks", streamTracks(50));
      saveDatabase(databasePath); // Save after each data type

      console.log("Streaming shows to database...");
      await streamItemsToDatabase(databasePath, "shows", streamShows(300));
      saveDatabase(databasePath); // Save after each data type

      console.log("Streaming episodes to database...");
      await streamItemsToDatabase(databasePath, "episodes", streamEpisodes(50));
      saveDatabase(databasePath); // Save after each data type

      // Update last refresh timestamp
      await setMetadata(databasePath, "last_refresh_timestamp", Date.now().toString());
    } catch (error) {
      console.error("Error refreshing cache from API:", error);
      throw error;
    } finally {
      // Release lock
      refreshInProgress = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Get cached playlists (limited to 50 items for display)
 */
export async function getCachedPlaylists(): Promise<{ items: SimplifiedPlaylistObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM playlists ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedPlaylistObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached playlists:", error);
    return { items: [] };
  }
}

/**
 * Get cached albums (limited to 50 items for display)
 */
export async function getCachedAlbums(): Promise<{ items: SimplifiedAlbumObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM albums ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedAlbumObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached albums:", error);
    return { items: [] };
  }
}

/**
 * Get cached artists (limited to 50 items for display)
 */
export async function getCachedArtists(): Promise<{ items: ArtistObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM artists ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as ArtistObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached artists:", error);
    return { items: [] };
  }
}

/**
 * Get cached tracks (limited to 50 items for display, but total count from all cached items)
 */
export async function getCachedTracks(): Promise<{ items: SimplifiedTrackObject[]; total: number }> {
  const { databasePath } = getPreferences();
  try {
    // Get limited items for display
    const results = await executeQuery(databasePath, "SELECT data FROM tracks ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedTrackObject);

    // Get total count from all cached tracks
    const countResult = await executeQuery(databasePath, "SELECT COUNT(*) as count FROM tracks");
    const total = countResult.length > 0 ? (countResult[0] as { count: number }).count : items.length;

    return { items, total };
  } catch (error) {
    console.error("Error getting cached tracks:", error);
    return { items: [], total: 0 };
  }
}

/**
 * Get cached shows (limited to 50 items for display)
 */
export async function getCachedShows(): Promise<{ items: SimplifiedShowObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM shows ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedShowObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached shows:", error);
    return { items: [] };
  }
}

/**
 * Get cached episodes (limited to 50 items for display)
 */
export async function getCachedEpisodes(): Promise<{ items: SimplifiedEpisodeObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM episodes ORDER BY cached_at DESC LIMIT 50");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedEpisodeObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached episodes:", error);
    return { items: [] };
  }
}
