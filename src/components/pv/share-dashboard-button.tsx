"use client";

import { Check, Share2 } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";

type ShareDashboardButtonProps = {
  plantName: string;
};

function buildShareTitle(plantName: string): string {
  const name = plantName.trim();
  return name ? `PV Dash – ${name}` : "PV Dash";
}

async function shareOrCopyUrl(title: string, url: string): Promise<"shared" | "copied"> {
  const payloads: ShareData[] = [
    {
      title,
      text: "Solar-Dashboard: Erzeugung, Verbrauch und Speicher live im Blick.",
      url,
    },
    { title, url },
    { url },
  ];

  if (typeof navigator.share === "function") {
    for (const data of payloads) {
      if (typeof navigator.canShare === "function" && !navigator.canShare(data)) {
        continue;
      }
      await navigator.share(data);
      return "shared";
    }
  }

  await navigator.clipboard.writeText(url);
  return "copied";
}

export function ShareDashboardButton({ plantName }: ShareDashboardButtonProps) {
  const [copied, setCopied] = useState(false);

  const onShare = useCallback(async () => {
    const url = window.location.href;
    const title = buildShareTitle(plantName);

    try {
      const result = await shareOrCopyUrl(title, url);
      if (result === "copied") {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        // Kein Share und kein Clipboard — still ignorieren.
      }
    }
  }, [plantName]);

  const label = copied ? "Link kopiert" : "Dashboard teilen";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      className="rounded-full"
      onClick={() => void onShare()}
    >
      {copied ? (
        <Check className="size-[18px] text-chart-1" aria-hidden />
      ) : (
        <Share2 className="size-[18px]" aria-hidden />
      )}
    </Button>
  );
}
