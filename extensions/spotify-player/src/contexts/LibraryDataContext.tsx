import { createContext } from "react";
import {
  SimplifiedPlaylistObject,
  SimplifiedAlbumObject,
  ArtistObject,
  SimplifiedTrackObject,
  SimplifiedShowObject,
  SimplifiedEpisodeObject,
} from "../helpers/spotify.api";

export type LibraryData = {
  playlists: { items: SimplifiedPlaylistObject[] } | undefined;
  albums: { items: SimplifiedAlbumObject[] } | undefined;
  artists: { items: ArtistObject[] } | undefined;
  tracks: { items: SimplifiedTrackObject[]; total: number } | undefined;
  shows: { items: SimplifiedShowObject[] } | undefined;
  episodes: { items: SimplifiedEpisodeObject[] } | undefined;
};

export type LibraryDataContextType = {
  data: LibraryData;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
};

export const LibraryDataContext = createContext<LibraryDataContextType | null>(null);

