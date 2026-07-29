import { ExternalLink, RefreshCw, X } from "lucide-react";
import type {
  CountyReliefRecipient,
  CountyReliefRecipientsStatus,
} from "@/lib/community-investment-layer";
import { formatAwardedAmount } from "./map-helpers";

export type CountyReliefRecipientsPanelStatus =
  | CountyReliefRecipientsStatus
  | "loading"
  | "error";

interface CountyReliefRecipientsPanelProps {
  zipCode: string;
  status: CountyReliefRecipientsPanelStatus;
  recipients: CountyReliefRecipient[];
  sourceLink: string | null;
  onClose: () => void;
  onRetry: () => void;
}

export default function CountyReliefRecipientsPanel({
  zipCode,
  status,
  recipients,
  sourceLink,
  onClose,
  onRetry,
}: CountyReliefRecipientsPanelProps) {
  const isReady = status === "ready";
  const safeSourceLink =
    sourceLink && /^https?:\/\//i.test(sourceLink) ? sourceLink : null;

  return (
    <aside
      role="dialog"
      aria-labelledby="county-relief-recipients-title"
      className="fixed inset-x-3 top-[72px] bottom-3 z-[60] flex flex-col overflow-hidden border border-[#0C1B33]/12 bg-white/98 shadow-2xl backdrop-blur md:absolute md:inset-x-auto md:top-3 md:right-3 md:bottom-3 md:z-[35] md:w-[390px]"
    >
      <header className="flex items-start justify-between gap-4 border-b border-[#0C1B33]/10 px-4 py-4">
        <div className="min-w-0">
          <div className="font-mono-bureau text-[8px] uppercase tracking-normal text-[#0E7490]">
            Admin - historical county awards
          </div>
          <h2
            id="county-relief-recipients-title"
            className="mt-1 text-base font-semibold text-[#0C1B33]"
          >
            Recipients in {zipCode}
          </h2>
          <p className="mt-1 text-[11px] leading-relaxed text-[#5A6478]">
            Cook County 2023 Source Grant award records. The program is complete
            and is not a current funding opportunity.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close historical recipients"
          title="Close"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center border border-[#0C1B33]/10 text-[#0C1B33]/55 transition-colors hover:bg-[#0C1B33]/5 hover:text-[#0C1B33]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {status === "loading" && (
          <div className="flex h-full min-h-40 items-center justify-center">
            <div className="text-center">
              <span className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-[#0E7490]/20 border-t-[#0E7490]" />
              <p className="mt-3 font-mono-bureau text-[9px] uppercase tracking-normal text-[#0C1B33]/45">
                Loading recipient records
              </p>
            </div>
          </div>
        )}

        {status === "unauthorized" && (
          <PanelMessage
            title="Admin session expired"
            body="Sign in again before opening recipient-level records."
            onRetry={onRetry}
          />
        )}

        {(status === "unavailable" || status === "error") && (
          <PanelMessage
            title="Recipient records unavailable"
            body="The ZIP summary remains available, but the recipient list could not be loaded."
            onRetry={onRetry}
          />
        )}

        {isReady && recipients.length === 0 && (
          <div className="py-8 text-center">
            <p className="text-sm font-medium text-[#0C1B33]">
              No recipient records found
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#5A6478]">
              The source list has no Chicago recipient rows for ZIP {zipCode}.
            </p>
          </div>
        )}

        {isReady && recipients.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 pb-2">
              <span className="font-mono-bureau text-[9px] uppercase tracking-normal text-[#0C1B33]/45">
                {recipients.length.toLocaleString("en-US")} award{" "}
                {recipients.length === 1 ? "record" : "records"}
              </span>
              <span className="text-[9px] text-[#0C1B33]/35">Source precision: ZIP</span>
            </div>
            <ol className="border-t border-[#0C1B33]/8">
              {recipients.map((recipient) => (
                <li
                  key={recipient.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 border-b border-[#0C1B33]/8 py-3"
                >
                  <span className="min-w-0 break-words text-[12px] font-medium leading-snug text-[#0C1B33]">
                    {recipient.businessName}
                  </span>
                  <span className="whitespace-nowrap text-right">
                    <span className="block font-mono-bureau text-[7px] uppercase tracking-normal text-[#0C1B33]/35">
                      Historical award
                    </span>
                    <span className="mt-0.5 block text-[11px] font-semibold text-[#0C1B33]/75">
                      {formatAwardedAmount(recipient.historicalAwardAmount)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <footer className="border-t border-[#0C1B33]/10 px-4 py-3">
        <p className="text-[9px] leading-relaxed text-[#0C1B33]/40">
          Names are loaded only for this ZIP. No street address is inferred from
          the county awardee list.
        </p>
        {safeSourceLink && (
          <a
            href={safeSourceLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-medium text-[#2563EB] hover:underline"
          >
            Official awardee list
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </footer>
    </aside>
  );
}

function PanelMessage({
  title,
  body,
  onRetry,
}: {
  title: string;
  body: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center text-center">
      <div className="max-w-64">
        <p className="text-sm font-medium text-[#0C1B33]">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-[#5A6478]">{body}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 border border-[#0C1B33]/12 px-3 py-2 font-mono-bureau text-[9px] uppercase tracking-normal text-[#0C1B33]/65 hover:bg-[#0C1B33]/5"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    </div>
  );
}
