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
import { getUserPlaylists } from "../api/getUserPlaylists";
import { getMySavedAlbums } from "../api/getMySavedAlbums";
import { getFollowedArtists } from "../api/getFollowedArtists";
import { getMySavedTracks } from "../api/getMySavedTracks";
import { getMySavedShows } from "../api/getMySavedShows";
import { getMySavedEpisodes } from "../api/getMySavedEpisodes";
import {
  SimplifiedPlaylistObject,
  SimplifiedAlbumObject,
  ArtistObject,
  SimplifiedTrackObject,
  SimplifiedShowObject,
  SimplifiedEpisodeObject,
} from "./spotify.api";

type Preferences = {
  databasePath?: string;
  cacheRefreshInterval?: string;
};

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
 * Refresh cache from API
 */
export async function refreshCacheFromAPI(): Promise<void> {
  const { databasePath } = getPreferences();

  try {
    // Clear existing cache
    await clearCache(databasePath);

    // Fetch all data from API
    const [playlistsData, albumsData, artistsData, tracksData, showsData, episodesData] = await Promise.all([
      getUserPlaylists({ limit: 300 }),
      getMySavedAlbums({ limit: 300 }),
      getFollowedArtists({ limit: 300 }),
      getMySavedTracks({ limit: 50 }),
      getMySavedShows({ limit: 300 }),
      getMySavedEpisodes({ limit: 50 }),
    ]);

    const now = Date.now();
    const operations: Array<{ sql: string; params: any[] }> = [];

    // Insert playlists
    if (playlistsData?.items) {
      for (const playlist of playlistsData.items) {
        if (playlist.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO playlists (id, data, cached_at) VALUES (?, ?, ?)",
            params: [playlist.id, JSON.stringify(playlist), now],
          });
        }
      }
    }

    // Insert albums
    if (albumsData?.items) {
      for (const album of albumsData.items) {
        if (album.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO albums (id, data, cached_at) VALUES (?, ?, ?)",
            params: [album.id, JSON.stringify(album), now],
          });
        }
      }
    }

    // Insert artists
    if (artistsData?.items) {
      for (const artist of artistsData.items) {
        if (artist.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO artists (id, data, cached_at) VALUES (?, ?, ?)",
            params: [artist.id, JSON.stringify(artist), now],
          });
        }
      }
    }

    // Insert tracks
    if (tracksData?.items) {
      for (const track of tracksData.items) {
        if (track.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO tracks (id, data, cached_at) VALUES (?, ?, ?)",
            params: [track.id, JSON.stringify(track), now],
          });
        }
      }
    }

    // Insert shows
    if (showsData?.items) {
      for (const show of showsData.items) {
        if (show.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO shows (id, data, cached_at) VALUES (?, ?, ?)",
            params: [show.id, JSON.stringify(show), now],
          });
        }
      }
    }

    // Insert episodes
    if (episodesData?.items) {
      for (const episode of episodesData.items) {
        if (episode.id) {
          operations.push({
            sql: "INSERT OR REPLACE INTO episodes (id, data, cached_at) VALUES (?, ?, ?)",
            params: [episode.id, JSON.stringify(episode), now],
          });
        }
      }
    }

    // Execute all inserts in a transaction
    if (operations.length > 0) {
      await executeTransaction(databasePath, operations);
    }

    // Update last refresh timestamp
    await setMetadata(databasePath, "last_refresh_timestamp", now.toString());
  } catch (error) {
    console.error("Error refreshing cache from API:", error);
    throw error;
  }
}

/**
 * Get cached playlists
 */
export async function getCachedPlaylists(): Promise<{ items: SimplifiedPlaylistObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM playlists ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedPlaylistObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached playlists:", error);
    return { items: [] };
  }
}

/**
 * Get cached albums
 */
export async function getCachedAlbums(): Promise<{ items: SimplifiedAlbumObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM albums ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedAlbumObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached albums:", error);
    return { items: [] };
  }
}

/**
 * Get cached artists
 */
export async function getCachedArtists(): Promise<{ items: ArtistObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM artists ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as ArtistObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached artists:", error);
    return { items: [] };
  }
}

/**
 * Get cached tracks
 */
export async function getCachedTracks(): Promise<{ items: SimplifiedTrackObject[]; total: number }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM tracks ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedTrackObject);
    return { items, total: items.length };
  } catch (error) {
    console.error("Error getting cached tracks:", error);
    return { items: [], total: 0 };
  }
}

/**
 * Get cached shows
 */
export async function getCachedShows(): Promise<{ items: SimplifiedShowObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM shows ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedShowObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached shows:", error);
    return { items: [] };
  }
}

/**
 * Get cached episodes
 */
export async function getCachedEpisodes(): Promise<{ items: SimplifiedEpisodeObject[] }> {
  const { databasePath } = getPreferences();
  try {
    const results = await executeQuery(databasePath, "SELECT data FROM episodes ORDER BY cached_at DESC");
    const items = results.map((row) => JSON.parse(row.data as string) as SimplifiedEpisodeObject);
    return { items };
  } catch (error) {
    console.error("Error getting cached episodes:", error);
    return { items: [] };
  }
}
