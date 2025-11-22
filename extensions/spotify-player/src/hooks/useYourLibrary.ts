import { useCachedPromise } from "@raycast/utils";
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

type UseMyLibraryProps = {
  execute?: boolean;
  keepPreviousData?: boolean;
};

async function fetchLibraryData() {
  // Check if cache needs refresh
  const needsRefresh = await shouldRefreshCache();

  if (needsRefresh) {
    // Refresh cache from API
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

  return [playlistsData, albumsData, artistsData, tracksData, showsData, episodesData];
}

export function useYourLibrary(options: UseMyLibraryProps = {}) {
  const {
    data = [],
    error,
    isLoading,
  } = useCachedPromise(fetchLibraryData, [], {
    keepPreviousData: options?.keepPreviousData,
  });

  const [playlistsData, albumsData, artistsData, tracksData, showsData, episodesData] = data;

  return {
    myLibraryData: {
      playlists: playlistsData,
      albums: albumsData,
      artists: artistsData,
      tracks: tracksData,
      shows: showsData,
      episodes: episodesData,
    },
    myLibraryError: error,
    myLibraryIsLoading: isLoading,
  };
}
