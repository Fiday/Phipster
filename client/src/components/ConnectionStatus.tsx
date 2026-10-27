import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { socket } from "../lib/socket";

export function ConnectionStatus() {
  const { pathname } = useLocation();
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    socket.on("connect", online);
    socket.on("disconnect", offline);
    socket.on("connect_error", offline);
    return () => {
      socket.off("connect", online);
      socket.off("disconnect", offline);
      socket.off("connect_error", offline);
    };
  }, []);
  if (connected || (!pathname.startsWith("/join/") && pathname !== "/display")) return null;
  return <div className="connection-banner" role="status">Connection lost — reconnecting. Game actions are paused.</div>;
}
