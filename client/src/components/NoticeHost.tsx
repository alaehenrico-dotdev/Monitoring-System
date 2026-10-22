import { useEffect, useRef, useState } from "react";
import { subscribeNotices, type AppNotice } from "../utils/notify";
import { Toast } from "./Toast";

/// More than this at once would bury the page; the oldest is dropped first.
const MAX_SHOWN = 4;

interface Shown extends AppNotice {
  id: number;
}

/**
 * Shows every `notify()` message as a toast - mounted once, at the top of the
 * app. Successes leave by themselves like any toast; a failure stays until it is
 * closed, since it is something the person may need to act on.
 */
export function NoticeHost() {
  const [shown, setShown] = useState<Shown[]>([]);
  const nextId = useRef(1);

  useEffect(
    () =>
      subscribeNotices((notice) => {
        const id = nextId.current++;
        setShown((cur) => [...cur, { ...notice, id }].slice(-MAX_SHOWN));
      }),
    [],
  );

  const dismiss = (id: number) => setShown((cur) => cur.filter((n) => n.id !== id));

  return (
    <>
      {shown.map((n) => (
        <Toast
          key={n.id}
          id={String(n.id)}
          message={n.message}
          variant={n.level}
          duration={n.level === "error" ? null : undefined}
          onDismiss={() => dismiss(n.id)}
        />
      ))}
    </>
  );
}
