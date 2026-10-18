"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  blockedAsMixedContent,
  dashboardFrameUrl,
  EMBED_HELP_URL,
  FRAME_SLOW_MS,
} from "@/lib/ha-embed";
import type { HaEmbeddedDashboard } from "@/types/home-assistant";

interface HaDashboardFrameProps {
  dashboard: HaEmbeddedDashboard;
  /** The address a browser opens Home Assistant at (`embedBaseUrl`). */
  baseUrl: string | undefined;
}

/**
 * One Home Assistant dashboard, drawn by Home Assistant inside a frame that
 * fills the rest of the screen. Kinboard cannot see into it: when Home
 * Assistant refuses to be shown inside another page, the browser puts its own
 * error page in the frame, so a load that takes long gets a hint pointing at
 * the setting that allows it.
 *
 * No `sandbox`: this is the household's own Home Assistant, which needs its
 * scripts, its storage (to stay signed in) and its forms. Camera and
 * microphone stay unavailable in here — Kinboard's Permissions-Policy turns
 * them off for the page and every frame in it, so a camera card's talk button
 * cannot work in a tab.
 */
export function HaDashboardFrame({ dashboard, baseUrl }: HaDashboardFrameProps) {
  const t = useTranslations("homeAutomation");
  const src = dashboardFrameUrl(baseUrl, dashboard);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  // The page's protocol is only known in the browser; the first render is the server's.
  const [mixed, setMixed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    setMixed(src !== null && blockedAsMixedContent(window.location.protocol, src));
    const timer = setTimeout(() => setSlow(true), FRAME_SLOW_MS);
    return () => clearTimeout(timer);
  }, [src]);

  if (src === null || mixed) {
    return (
      <div role="alert" className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-warning/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-sm">{src === null ? t("dashboardNoAddress") : t("dashboardMixedContent")}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href="/settings/homeassistant/dashboards">{t("dashboardSettingsLink")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-border bg-card"
      style={{ height: "calc(100dvh - var(--nav-spacing) - 14rem)", minHeight: "24rem" }}
    >
      <iframe
        key={src}
        src={src}
        title={t("dashboardFrameTitle", { name: dashboard.title })}
        className="absolute inset-0 size-full border-0"
        allow="fullscreen; autoplay"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card p-6 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{t("dashboardLoading", { name: dashboard.title })}</p>
          {slow && (
            <p className="max-w-md text-sm text-muted-foreground">
              {t("dashboardSlowHint")}{" "}
              <a href={EMBED_HELP_URL} target="_blank" rel="noopener noreferrer" className="underline">
                {t("dashboardHelpLink")}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
