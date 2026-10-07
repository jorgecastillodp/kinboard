"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TODO_ICONS } from "@/lib/todo-icons";
import { Checkbox } from "@/components/ui/checkbox";

export function TodoDecorationFields({
  icon,
  points,
  onIconChange,
  onPointsChange,
}: {
  icon: string;
  points: number;
  onIconChange: (icon: string) => void;
  onPointsChange: (points: number) => void;
}) {
  const t = useTranslations("todos");
  const pointsId = useId();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>{t("fieldIcon")}</Label>
        <div className="flex flex-wrap gap-1">
          <button type="button" onClick={() => onIconChange("")} aria-pressed={!icon} className={`rounded-md px-2 text-sm ${!icon ? "ring-1 ring-primary" : ""}`}>–</button>
          {TODO_ICONS.map((choice) => <button key={choice} type="button" onClick={() => onIconChange(choice)} aria-label={choice} aria-pressed={icon === choice} className={`rounded-md p-1 text-xl ${icon === choice ? "bg-primary/20 ring-1 ring-primary" : "bg-muted/30"}`}>{choice}</button>)}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={pointsId}>{t("fieldPoints")}</Label>
        <Input id={pointsId} type="number" min={0} max={10000} value={points} onChange={(event) => onPointsChange(Math.max(0, Math.min(10000, Number(event.target.value) || 0)))} />
        <p className="text-xs text-muted-foreground">{t("fieldPointsHint")}</p>
      </div>
    </div>
  );
}

/**
 * Show under Events on Home: lists the task in the Events widget on its day
 * (lib/task-events.ts). A bordered checkbox row, like Take turns beside it.
 */
export function TodoEventsField({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useTranslations("todos");
  const id = useId();
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/40 p-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(on) => onCheckedChange(on === true)} />
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium">{t("showInEventsLabel")}</span>
        <span className="text-xs text-muted-foreground">{t("showInEventsHint")}</span>
      </label>
    </div>
  );
}
