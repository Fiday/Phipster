import { useEffect, useState } from "react";
import { finishSpotifyLogin } from "../lib/spotify";
import { Logo } from "../components/Logo";

export function SpotifyCallback() {
  const [message, setMessage] = useState("Connecting Spotify…");
  useEffect(() => {
    finishSpotifyLogin(window.location.search)
      .then((returnTo) => window.location.replace(returnTo))
      .catch((e) => setMessage(e instanceof Error ? e.message : "Spotify connection failed"));
  }, []);
  return <main className="center-screen"><Logo /><p>{message}</p></main>;
}
