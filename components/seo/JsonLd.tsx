/**
 * Renders a JSON-LD <script> tag. Server-component safe.
 * Escapes "<" to prevent breaking out of the script element.
 */
export function JsonLd({ data, id }: { data: object; id?: string }) {
  return (
    <script
      id={id}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
