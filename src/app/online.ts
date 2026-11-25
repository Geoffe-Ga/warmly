/**
 * Whether the device says it has a network connection.
 */
import { useEffect, useState } from "preact/hooks";

/**
 * Follow the browser's online and offline events.
 *
 * "Online" here is only what the browser reports: a connection to some
 * network, not proof that any server can be reached. It is used to reassure
 * the person while offline, never to decide whether to save.
 *
 * @returns Whether the browser reports a connection.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
