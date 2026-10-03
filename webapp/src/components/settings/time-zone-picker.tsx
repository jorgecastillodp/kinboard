"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  filterTimeZones,
  matchesTimeZoneQuery,
  timeIn,
  timeZoneOption,
  timeZoneOptions,
  zoneLabel,
} from "@/lib/time-zones";

interface TimeZonePickerProps {
  /** The family's zone; null for automatic. */
  value: string | null;
  /** The server's zone, which automatic means; undefined until it has loaded. */
  serverZone: string | undefined;
  /** A zone, or null for automatic. */
  onPick: (zone: string | null) => void;
  disabled?: boolean;
}

/**
 * The family's time zone, for Settings → Language. A searchable list inside
 * the card rather than a popover or a select: on the wall tablet the
 * on-screen keyboard covers a popover, and a select cannot be searched from
 * a touch screen — with four hundred zones, it would have to be scrolled.
 */
export function TimeZonePicker({ value, serverZone, onPick, disabled }: TimeZonePickerProps) {
  const t = useTranslations("settings.language");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => new Date());
  const panel = useRef<HTMLDivElement>(null);

  // The clock on the current choice moves on while the page is open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // The list opens below the button, often under the fold of the tablet's
  // screen: bring it into view, clear of the bottom navigation.
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  // Made when the list opens — an offset is a formatter per zone — not on
  // every keystroke.
  const options = useMemo(() => (open ? timeZoneOptions(new Date(), [value]) : []), [open, value]);
  const shown = useMemo(() => filterTimeZones(options, query), [options, query]);

  const automaticLabel = serverZone
    ? t("timeZoneAutomatic", { zone: zoneLabel(serverZone) })
    : t("timeZoneAutomaticLoading");
  const serverOption = serverZone ? timeZoneOption(serverZone, now) : null;
  // Automatic is found by its own words as well as by the server's zone.
  const showAutomatic = serverOption
    ? matchesTimeZoneQuery(serverOption, query, automaticLabel)
    : query.trim() === "" || automaticLabel.toLowerCase().includes(query.trim().toLowerCase());

  const current = value ?? serverZone;
  const currentOption = current ? timeZoneOption(current, now) : null;

  function pick(zone: string | null) {
    setOpen(false);
    setQuery("");
    if (zone !== value) onPick(zone);
  }

  const row = (key: string, label: string, offset: string | undefined, selected: boolean, zone: string | null) => (
    <button
      key={key}
      type="button"
      onClick={() => pick(zone)}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected && "font-medium",
      )}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {offset}
        <Check className={cn("h-4 w-4 text-primary", !selected && "invisible")} aria-hidden />
      </span>
    </button>
  );

  return (
    <div>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        data-testid="time-zone-current"
        className="w-full justify-between h-auto py-3 px-4"
      >
        {/* Two lines, so a phone shows the zone's whole name rather than its offset. */}
        <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
          <span className="max-w-full truncate">{value ? zoneLabel(value) : automaticLabel}</span>
          {currentOption && (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">
              {`${currentOption.offset} · ${timeIn(currentOption.zone, locale, now)}`}
            </span>
          )}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>

      {open && (
        <div ref={panel} className="mt-3 space-y-2 scroll-mb-[calc(var(--nav-spacing)_+_1rem)]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && shown.length === 1) pick(shown[0].zone);
              }}
              placeholder={t("timeZoneSearch")}
              aria-label={t("timeZoneSearch")}
              className="pl-9"
            />
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain rounded-md border divide-y" data-testid="time-zone-list">
            {showAutomatic && row("automatic", automaticLabel, serverOption?.offset, value === null, null)}
            {shown.map((option) => row(option.zone, option.label, option.offset, option.zone === value, option.zone))}
            {!showAutomatic && shown.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t("timeZoneNone", { query: query.trim() })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
