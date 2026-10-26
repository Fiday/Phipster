import { useEffect, useState } from "react";
import { socket } from "../lib/socket";
import type { RoomState } from "../types";

export function useRoomState(initial: RoomState | null = null) {
  const [state, setState] = useState<RoomState | null>(initial);
  useEffect(() => {
    const handler = (next: RoomState) => setState(next);
    socket.on("room:state", handler);
    return () => {
      socket.off("room:state", handler);
    };
  }, []);
  return [state, setState] as const;
}
