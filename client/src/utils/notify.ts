/**
 * A tiny app-wide "show this toast" channel, for messages that do not belong to
 * any one page: something the server did on its own (a scheduled backup), or
 * something a file download started in the background. NoticeHost, mounted once,
 * is the only listener; anything can call `notify`.
 */
export interface AppNotice {
  level: "success" | "error" | "info";
  message: string;
}

type Listener = (notice: AppNotice) => void;
const listeners = new Set<Listener>();

export function notify(notice: AppNotice): void {
  for (const listener of listeners) listener(notice);
}

export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
