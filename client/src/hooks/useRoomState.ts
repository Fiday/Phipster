import { useEffect, useState } from "react";
import { socket } from "../lib/socket";
import type { RoomState } from "../types";

export function useRoomState(code?: string) {
  const [state, setState] = useState<RoomState | null>(null);
  useEffect(() => {
    const handler = (next: RoomState) => setState(previous =>
      next.code === (code || previous?.code) ? next : previous);
    socket.on("room:state", handler);
    return () => {
      socket.off("room:state", handler);
    };
  }, [code]);
  return [state, setState] as const;
}
