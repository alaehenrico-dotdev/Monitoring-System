import { useEffect, useState, type FormEvent } from "react";
import { subscribePasswordRequests, type PasswordRequest } from "../utils/passwordPrompt";
import { Modal } from "./Modal";
import { Button, TextInput } from "./ui";
import { colors } from "../theme";

/// Mounted once at the top of the app: asks for the signed-in user's password
/// whenever something calls `requestAdminPassword`.
export function PasswordPromptHost() {
  const [request, setRequest] = useState<PasswordRequest | null>(null);
  const [password, setPassword] = useState("");

  useEffect(
    () =>
      subscribePasswordRequests((next) => {
        setPassword("");
        setRequest(next);
      }),
    [],
  );

  if (!request) return null;

  const finish = (value: string | null) => {
    request.resolve(value);
    setRequest(null);
    setPassword("");
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password) finish(password);
  };

  return (
    <Modal title="Confirm your password" onClose={() => finish(null)} width={400}>
      <form onSubmit={submit}>
        <div style={{ fontSize: "calc(13.5px * var(--ae-fs, 1))", lineHeight: 1.55 }}>
          {request.message ?? "Enter your password to continue."}
        </div>
        <TextInput
          type="password"
          autoFocus
          autoComplete="current-password"
          aria-label="Your password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", marginTop: 12, boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
          <Button type="button" variant="secondary" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!password} style={{ color: colors.cream }}>
            Continue
          </Button>
        </div>
      </form>
    </Modal>
  );
}
