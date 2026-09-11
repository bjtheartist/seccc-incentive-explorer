"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="p-16 text-center">
      <h2>Could not load the grants workspace.</h2>
      <button className="mt-4 rounded border px-4 py-2" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
