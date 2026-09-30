"use client";

import { useEffect, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { useTranslations } from "next-intl";
import { GripVertical, ListOrdered, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useVisibleNavItems } from "@/hooks/use-visible-nav-items";
import { setNavOrder, clearNavOrder } from "@/lib/nav-order";
import { getHiddenNavItems, setHiddenNavItems, setSettingsIconOnly } from "@/lib/nav-visibility";
import { useHiddenNavItems, useSettingsIconOnly } from "@/hooks/use-hidden-nav-items";
import { Switch } from "@/components/ui/switch";
import { useFamilyStore } from "@/stores/family-store";

/**
 * Nav items the switch never unlocks.
 *
 * A device with no way Home and no way into Settings cannot be recovered
 * from the UI at all — the only way back is clearing site data, which on a
 * wall panel means finding a keyboard. These two stay fixed everywhere.
 */
const ALWAYS_FIXED: readonly string[] = ["/", "/settings"];

/**
 * Locked on ordinary devices, unlockable in kiosk mode.
 *
 * The default lock exists so a family member cannot accidentally hide the
 * surfaces everyone else relies on. A kiosk is the opposite case: it is
 * curated once by whoever mounted it, and a wall display that only ever
 * shows the gate has no use for a shopping list it cannot be shopped from.
 */
const FIXED_UNLESS_KIOSK: readonly string[] = ["/calendar", "/shopping"];

export default function NavigationSettingsPage() {
  const t = useTranslations("settings.navigation");
  const tNav = useTranslations("nav");
  const visibleItems = useVisibleNavItems(true);
  const hiddenItems = useHiddenNavItems();
  const settingsIconOnly = useSettingsIconOnly();
  const { device } = useFamilyStore();
  const isKiosk = device?.is_kiosk ?? false;

  // Local working copy. Initialized from useVisibleNavItems (which already
  // reflects the saved order); subsequent drags update local state, and
  // we persist on each commit so the bottom nav reflects the change live.
  const [order, setOrder] = useState<readonly string[]>(() =>
    visibleItems.map((i) => i.href),
  );

  // Sync if upstream visibility changes (e.g., a plugin gets toggled
  // in another tab). Only resets the order when the underlying set
  // changes — preserves an in-progress drag otherwise.
  useEffect(() => {
    const visibleSet = new Set(visibleItems.map((i) => i.href));
    const currentSet = new Set(order);
    const same =
      visibleSet.size === currentSet.size &&
      [...visibleSet].every((h) => currentSet.has(h));
    if (!same) setOrder(visibleItems.map((i) => i.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems]);

  const handleReorder = (next: string[]) => {
    setOrder(next);
    setNavOrder(next);
  };

  const handleReset = () => {
    clearNavOrder();
    setOrder(visibleItems.map((i) => i.href));
  };

  // Map key explicitly widened to `string` — visibleItems is `typeof
  // NAV_ITEMS` whose element type carries href as a literal-union, and
  // `.get(href)` with `href: string` would otherwise fail to type-check.
  const itemsByHref = new Map<string, (typeof visibleItems)[number]>(
    visibleItems.map((i) => [i.href, i]),
  );

  return (
    <main
      id="main-content"
      className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset"
    >
      <div className="relative z-10 max-w-2xl mx-auto space-y-6">
        <PageHeader
          title={t("title")}
          icon={ListOrdered}
        />

        <p className="text-sm text-muted-foreground">{t("intro")}</p>

        <Card className="p-2">
          <Reorder.Group
            axis="y"
            values={order as string[]}
            onReorder={handleReorder}
            className="space-y-1"
          >
            {order.map((href) => {
              const item = itemsByHref.get(href);
              if (!item) return null;
              return (
                <NavItemRow
                  key={href}
                  href={href}
                  isKiosk={isKiosk}
                  Icon={item.icon}
                  label={tNav(item.labelKey as never)}
                  enabled={!hiddenItems.includes(href)}
                  onEnabledChange={(enabled) => {
                    const next = new Set(getHiddenNavItems());
                    if (enabled) next.delete(href);
                    else next.add(href);
                    setHiddenNavItems([...next]);
                  }}
                />
              );
            })}
          </Reorder.Group>
        </Card>
        <p className="text-xs text-muted-foreground">
          {t(isKiosk ? "fixedItemsHintKiosk" : "fixedItemsHint")}
        </p>

        <Card className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="font-medium">{t("settingsIconOnly")}</p>
            <p className="text-sm text-muted-foreground">{t("settingsIconOnlyHint")}</p>
          </div>
          <Switch checked={settingsIconOnly} onCheckedChange={setSettingsIconOnly} aria-label={t("settingsIconOnly")} />
        </Card>

        <Button
          variant="outline"
          onClick={handleReset}
          className="w-full"
        >
          <RotateCcw className="size-4 mr-2" />
          {t("reset")}
        </Button>

        <p className="text-xs text-muted-foreground">{t("perDeviceHint")}</p>
      </div>
    </main>
  );
}

function NavItemRow({
  href,
  Icon,
  label,
  enabled,
  isKiosk,
  onEnabledChange,
}: {
  href: string;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  enabled: boolean;
  isKiosk: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  // Per-item dragControls + dragListener=false constrains the drag
  // affordance to the explicit handle, so taps on the row body don't
  // accidentally pick up a drag (matters on touch).
  const controls = useDragControls();
  const t = useTranslations("settings.navigation");

  return (
    <Reorder.Item
      value={href}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-3 rounded-md bg-white/[0.02] hover:bg-accent/50 px-3 py-2 select-none"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground p-1 -ml-1"
        aria-label={t("dragToReorder")}
      >
        <GripVertical className="size-4" />
      </button>
      <Icon className="size-5" />
      <span className="text-sm font-medium">{label}</span>
      <Switch className="ml-auto" checked={enabled} onCheckedChange={onEnabledChange} disabled={ALWAYS_FIXED.includes(href) || (!isKiosk && FIXED_UNLESS_KIOSK.includes(href))} aria-label={t("showItem", { label })} />
    </Reorder.Item>
  );
}
