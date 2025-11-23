import { useContext } from "react";
import { LibraryDataContext } from "../contexts/LibraryDataContext";

type UseMyLibraryProps = {
  execute?: boolean;
  keepPreviousData?: boolean;
};

export function useYourLibrary(options: UseMyLibraryProps = {}) {
  const context = useContext(LibraryDataContext);

  if (!context) {
    throw new Error("useYourLibrary must be used within LibraryDataProvider");
  }

  return {
    myLibraryData: {
      playlists: context.data.playlists,
      albums: context.data.albums,
      artists: context.data.artists,
      tracks: context.data.tracks,
      shows: context.data.shows,
      episodes: context.data.episodes,
    },
    myLibraryError: context.error,
    myLibraryIsLoading: context.isLoading,
  };
}
