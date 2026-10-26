"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSetting } from "@/hooks/use-supabase-queries";
import { useWeather, useWeatherUnits } from "@/hooks/use-weather";
import { SETTINGS_KEYS } from "@/lib/settings-keys";
import {
  DEFAULT_WEATHER_EFFECTS,
  PREVIEW_MS,
  activeEffects,
  normalizeWeatherEffects,
  parsePreview,
  type EffectIntensity,
  type WeatherEffect,
} from "@/lib/weather-effects";

/**
 * Weather effects on Home (Settings -> Weather): snow, rain, a storm's glow,
 * frost when it is freezing, wind, fog and heat shimmer, from the current
 * weather and the family's thresholds (lib/weather-effects.ts).
 *
 * Nothing here catches a tap (pointer-events: none). What moves is drawn on
 * one canvas behind the widgets, at most 30 frames a second, with a capped
 * number of particles, and stops while the page is hidden; frost, fog, the
 * storm's glow and the warm edge are CSS layers. A device asking for reduced
 * motion gets the still layers only, and no glow.
 *
 * `?weather-preview=snow,wind` shows those effects for a minute, whatever the
 * weather: the settings page's Preview buttons open Home that way.
 */
export function WeatherEffects() {
  const { data: stored } = useSetting<unknown>(SETTINGS_KEYS.weatherEffects, DEFAULT_WEATHER_EFFECTS);
  const settings = useMemo(() => normalizeWeatherEffects(stored), [stored]);
  const { data: weather } = useWeather();
  const { system } = useWeatherUnits();
  const [preview, setPreview] = useState<WeatherEffect[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const url = new URL(window.location.href);
    const asked = parsePreview(url.searchParams.get("weather-preview"));
    if (asked.length === 0) return;
    setPreview(asked);
    url.searchParams.delete("weather-preview");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const timer = window.setTimeout(() => setPreview([]), PREVIEW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const effects = preview.length > 0 ? preview : activeEffects(weather, settings, system);
  if (effects.length === 0) return null;
  const on = new Set(effects);
  const intensity = settings.intensity;
  const strength = intensity === "normal" ? 1 : 0.6;
  // How hard the wind blows, against the family's threshold: 1 at it, up to 2.
  const windKmh = weather ? (system === "imperial" ? weather.windSpeed * 1.609344 : weather.windSpeed) : 0;
  const gust = on.has("wind") ? Math.min(2, Math.max(1, windKmh / Math.max(1, settings.windAtKmh))) : 0;
  const moving = (["snow", "rain", "wind", "heat"] as const).filter((e) => on.has(e));

  return (
    <div aria-hidden="true" data-testid="weather-effects" data-effects={effects.join(",")}>
      {on.has("fog") && (
        <div className="weather-fog pointer-events-none fixed inset-0 z-[5]" style={{ opacity: 0.55 * strength }} />
      )}
      {!reducedMotion && moving.length > 0 && (
        <EffectsCanvas effects={moving} intensity={intensity} gust={gust} />
      )}
      {on.has("freezing") && (
        <div className="weather-frost pointer-events-none fixed inset-0 z-20" style={{ opacity: strength }} />
      )}
      {on.has("heat") && (
        <div className="weather-heat pointer-events-none fixed inset-0 z-20" style={{ opacity: strength }} />
      )}
      {on.has("storm") && !reducedMotion && <StormGlow strength={strength} />}
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** A soft brightening now and then, never a flash: about a second, every 9 to 20 seconds. */
function StormGlow({ strength }: { strength: number }) {
  const [lit, setLit] = useState(false);
  useEffect(() => {
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        setLit(true);
        timer = window.setTimeout(() => {
          setLit(false);
          next();
        }, 900);
      }, 9_000 + Math.random() * 11_000);
    };
    next();
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className="weather-storm pointer-events-none fixed inset-0 z-20 transition-opacity duration-700 ease-out"
      style={{ opacity: lit ? 0.22 * strength : 0 }}
    />
  );
}

type Moving = "snow" | "rain" | "wind" | "heat";

interface Particle {
  kind: Moving | "leaf";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  spin: number;
  life: number;
}

/** Particles per effect, at "normal"; "subtle" draws a little over half. */
const COUNTS: Record<Moving, number> = { snow: 80, rain: 130, wind: 14, heat: 18 };
const FRAME_MS = 1000 / 30;

function EffectsCanvas({ effects, intensity, gust }: { effects: Moving[]; intensity: EffectIntensity; gust: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = effects.join(",");

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const share = intensity === "normal" ? 1 : 0.55;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const wind = gust; // 0 when calm
    const spawn = (kind: Particle["kind"], anywhere: boolean): Particle => {
      switch (kind) {
        case "snow":
          return { kind, x: rand(-50, width + 50), y: anywhere ? rand(0, height) : rand(-40, -5), vx: wind * rand(40, 90), vy: rand(22, 55), size: rand(1.4, 3.8), alpha: rand(0.55, 0.95), phase: rand(0, Math.PI * 2), spin: 0, life: 0 };
        case "rain":
          return { kind, x: rand(-100, width + 50), y: anywhere ? rand(0, height) : rand(-60, -10), vx: wind * rand(120, 220), vy: rand(520, 820), size: rand(10, 18), alpha: rand(0.25, 0.45), phase: 0, spin: 0, life: 0 };
        case "wind":
          return { kind, x: anywhere ? rand(0, width) : rand(-400, -100), y: rand(0, height), vx: rand(500, 900) * Math.max(1, wind), vy: rand(-15, 15), size: rand(120, 260), alpha: rand(0.1, 0.2), phase: rand(0, Math.PI * 2), spin: 0, life: 0 };
        case "leaf":
          return { kind, x: anywhere ? rand(0, width) : rand(-80, -20), y: rand(0, height * 0.9), vx: rand(180, 360) * Math.max(1, wind), vy: rand(-20, 30), size: rand(5, 9), alpha: rand(0.55, 0.85), phase: rand(0, Math.PI * 2), spin: rand(-4, 4), life: 0 };
        case "heat":
          return { kind, x: rand(0, width), y: anywhere ? rand(height * 0.55, height) : height + rand(0, 40), vx: 0, vy: -rand(25, 55), size: rand(40, 90), alpha: rand(0.06, 0.12), phase: rand(0, Math.PI * 2), spin: 0, life: 0 };
      }
    };
    const particles: Particle[] = [];
    for (const effect of effects) {
      const n = Math.round(COUNTS[effect] * share);
      for (let i = 0; i < n; i++) particles.push(spawn(effect, true));
      if (effect === "wind") for (let i = 0; i < Math.round(8 * share); i++) particles.push(spawn("leaf", true));
    }

    const offscreen = (p: Particle) =>
      p.y > height + 40 || p.x > width + 420 || p.x < -500 || (p.kind === "heat" && p.y < height * 0.45);

    const draw = (p: Particle, t: number) => {
      ctx.globalAlpha = p.alpha;
      switch (p.kind) {
        case "snow":
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = "#ffffff";
          ctx.fill();
          ctx.strokeStyle = "rgba(90, 120, 150, 0.35)";
          ctx.lineWidth = 0.6;
          ctx.stroke();
          break;
        case "rain": {
          const len = p.size;
          const k = len / Math.hypot(p.vx, p.vy);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k);
          ctx.strokeStyle = "rgb(120, 160, 200)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
          break;
        }
        case "wind": {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          const bend = Math.sin(t / 700 + p.phase) * 14;
          ctx.bezierCurveTo(p.x - p.size * 0.35, p.y + bend, p.x - p.size * 0.65, p.y - bend, p.x - p.size, p.y);
          ctx.strokeStyle = "rgb(150, 170, 190)";
          ctx.lineWidth = 1.4;
          ctx.stroke();
          break;
        }
        case "leaf":
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.phase);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
          ctx.fillStyle = "rgb(150, 140, 60)";
          ctx.fill();
          ctx.restore();
          break;
        case "heat": {
          ctx.beginPath();
          for (let i = 0; i <= 8; i++) {
            const yy = p.y - (p.size * i) / 8;
            const xx = p.x + Math.sin(t / 500 + p.phase + i * 0.9) * 6;
            if (i === 0) ctx.moveTo(xx, yy);
            else ctx.lineTo(xx, yy);
          }
          ctx.strokeStyle = "rgb(255, 150, 70)";
          ctx.lineWidth = 2;
          ctx.stroke();
          break;
        }
      }
    };

    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      frame = window.requestAnimationFrame(tick);
      if (t - last < FRAME_MS) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += (p.vx + (p.kind === "snow" ? Math.sin(t / 900 + p.phase) * 18 : 0)) * dt;
        p.y += (p.vy + (p.kind === "leaf" ? Math.sin(t / 400 + p.phase) * 40 : 0)) * dt;
        if (p.kind === "leaf") p.phase += p.spin * dt;
        if (offscreen(p)) particles[i] = spawn(p.kind, false);
        draw(particles[i], t);
      }
      ctx.globalAlpha = 1;
    };
    const start = () => {
      if (!frame && !document.hidden) frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // `key` stands for `effects`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, intensity, gust]);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[5] h-full w-full" />;
}
