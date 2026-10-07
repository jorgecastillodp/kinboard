/**
 * Whether a forecast day has a chance of rain to show: any number, 0% included.
 *
 * The weather provider reports a chance (`pop`, 0 to 1) on every forecast
 * item, so a dry day has a figure of its own, and showing only the days above
 * 0% made a dry day look like one nobody had forecast: the widget showed
 * Sunday's 20% and nothing under the other five days. Only a day whose
 * figure is missing shows nothing, rather than a made-up 0%.
 */
export function rainChanceShown(precipProbability: number | null | undefined): precipProbability is number {
  return typeof precipProbability === "number" && Number.isFinite(precipProbability);
}
