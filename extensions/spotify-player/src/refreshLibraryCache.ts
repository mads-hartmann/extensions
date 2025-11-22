import { showHUD } from "@raycast/api";
import { setSpotifyClient } from "./helpers/withSpotifyClient";
import { refreshCacheFromAPI } from "./helpers/libraryCache";
import { getErrorMessage } from "./helpers/getError";

export default async function Command() {
  await setSpotifyClient();

  try {
    await showHUD("Refreshing library cache...");
    await refreshCacheFromAPI();
    await showHUD("Library cache refreshed successfully");
  } catch (err) {
    const message = getErrorMessage(err);
    await showHUD(`Failed to refresh cache: ${message}`);
  }
}

