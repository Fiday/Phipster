import { io } from "socket.io-client";
import type { Ack } from "../types";

export const socket = io({ autoConnect: true });

// Game commands must not be buffered and replayed on a later turn.
export function emitRequest<T = undefined>(event: string, payload: object, callback: (ack: Ack<T>) => void) {
  if (!socket.connected) {
    callback({ ok: false, error: "Connection lost. Wait for reconnection, then try again." } as Ack<T>);
    return;
  }
  socket.timeout(10_000).emit(event, payload, (error: Error | null, ack: Ack<T>) => {
    callback(error
      ? { ok: false, error: "The server did not reply. Check the current game state before trying again." } as Ack<T>
      : ack);
  });
}
