"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isInfoBannerActiveNow } from "@/lib/dev-settings-shared";
import { infoBannerStore } from "@/lib/info-banner";

/** Hinweis oberhalb der Wetterkarte. Die Höhe folgt dem Text, ohne feste Zeilenzahl. */
export function InfoBanner() {
  const text = useSyncExternalStore(
    infoBannerStore.subscribe,
    infoBannerStore.getSnapshot,
    infoBannerStore.getServerSnapshot,
  );
  const schedule = useSyncExternalStore(
    infoBannerStore.subscribeSchedule,
    infoBannerStore.getScheduleSnapshot,
    infoBannerStore.getScheduleServerSnapshot,
  );
  const dismissed = useSyncExternalStore(
    infoBannerStore.subscribeDismissed,
    infoBannerStore.getDismissedSnapshot,
    infoBannerStore.getDismissedServerSnapshot,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (!isInfoBannerActiveNow(text, schedule, nowMs) || dismissed === text) return null;

  return (
    <Card className="shadow-card rounded-2xl">
      <CardContent className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed whitespace-pre-wrap break-words text-card-foreground">
          {text}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-label="Hinweis schliessen"
          onClick={() => infoBannerStore.dismiss()}
        >
          <X />
        </Button>
      </CardContent>
    </Card>
  );
}
