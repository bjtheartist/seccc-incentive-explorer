/** Format and convert wall-clock input in the round's timezone, not the browser's. */
export function localTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function instantFromLocal(value: string, timezone: string) {
  if (!value) return null;
  const target = Date.parse(`${value}:00Z`);
  let timestamp = target;
  for (let i = 0; i < 3; i++)
    timestamp +=
      target -
      Date.parse(
        `${localTime(new Date(timestamp).toISOString(), timezone)}:00Z`,
      );
  const iso = new Date(timestamp).toISOString();
  if (localTime(iso, timezone) !== value)
    throw new Error(
      "This local time does not exist because the clocks change. Choose another time.",
    );
  return iso;
}
