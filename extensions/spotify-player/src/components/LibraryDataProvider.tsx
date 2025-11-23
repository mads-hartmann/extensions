import { ReactNode, useRef } from "react";
import { useCachedPromise } from "@raycast/utils";
import { LibraryDataContext, LibraryData } from "../contexts/LibraryDataContext";
import {
  shouldRefreshCache,
  refreshCacheFromAPI,
  getCachedPlaylists,
  getCachedAlbums,
  getCachedArtists,
  getCachedTracks,
  getCachedShows,
  getCachedEpisodes,
} from "../helpers/libraryCache";

type LibraryDataProviderProps = {
  children: ReactNode;
};

// Module-level lock to prevent concurrent fetchLibraryData calls
let fetchInProgress = false;
let fetchPromise: Promise<LibraryData> | null = null;

async function fetchLibraryData(): Promise<LibraryData> {
  // If a fetch is already in progress, return the existing promise
  if (fetchInProgress && fetchPromise) {
    return fetchPromise;
  }

  // Set lock and create promise
  fetchInProgress = true;
  fetchPromise = (async () => {
    try {
      // Check if cache needs refresh
      const needsRefresh = await shouldRefreshCache();

      if (needsRefresh) {
        // Refresh cache from API (this function also has its own lock)
        await refreshCacheFromAPI();
      }

      // Read from cache
      const [playlistsData, albumsData, artistsData, tracksData, showsData, episodesData] = await Promise.all([
        getCachedPlaylists(),
        getCachedAlbums(),
        getCachedArtists(),
        getCachedTracks(),
        getCachedShows(),
        getCachedEpisodes(),
      ]);

      return {
        playlists: playlistsData,
        albums: albumsData,
        artists: artistsData,
        tracks: tracksData,
        shows: showsData,
        episodes: episodesData,
      };
    } finally {
      // Release lock
      fetchInProgress = false;
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

export function LibraryDataProvider({ children }: LibraryDataProviderProps) {
  const { data, error, isLoading, revalidate } = useCachedPromise(
    fetchLibraryData,
    [],
    {
      keepPreviousData: true,
    },
  );

  const refresh = async () => {
    await refreshCacheFromAPI();
    revalidate();
  };

  const contextValue = {
    data: data || {
      playlists: undefined,
      albums: undefined,
      artists: undefined,
      tracks: undefined,
      shows: undefined,
      episodes: undefined,
    },
    isLoading,
    error: error as Error | null,
    refresh,
  };

  return <LibraryDataContext.Provider value={contextValue}>{children}</LibraryDataContext.Provider>;
}

