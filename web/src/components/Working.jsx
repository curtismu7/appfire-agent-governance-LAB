import { useEffect, useState } from "react";

// A visible "it is working" signal for a run: a turning ring and a seconds counter that keeps counting, so a slow run (a Real one signs in,
// exchanges tokens and calls the gateway) never looks frozen. The ring stops under reduced motion (the shared stylesheet does that), the counter
// still counts. The words stay still for a screen reader (role=status); the counter is hidden from it so it is not announced every second.
export function Spin({ small = false }) {
  return <span className={small ? "spin spin--sm" : "spin"} aria-hidden="true" />;
}

export default function Working({ label = "Working on it", testId }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="working" role="status" data-testid={testId}>
      <Spin />
      <span>{label}…</span>
      <span className="working__s" aria-hidden="true">{seconds} s</span>
    </span>
  );
}
