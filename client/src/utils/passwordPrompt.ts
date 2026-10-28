/**
 * App-wide "ask the signed-in admin for their password" channel, for actions
 * the server re-checks the password on (the database download). The prompt
 * dialog (components/PasswordPromptHost) is the only listener; anything can
 * call `requestAdminPassword`, which resolves to null if the dialog is cancelled.
 */
export interface PasswordRequest {
  /** Why the password is needed, and what was wrong with the last attempt. */
  message?: string;
  resolve: (password: string | null) => void;
}

type Listener = (request: PasswordRequest) => void;
let listener: Listener | null = null;

export function requestAdminPassword(message?: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (!listener) return resolve(null);
    listener({ message, resolve });
  });
}

export function subscribePasswordRequests(next: Listener): () => void {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}
