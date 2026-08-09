"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The demo recording (DESIGN-DIRECTION.md §3): a scripted Playwright run
 * against the REAL deployed site (scripts/record-demo.mjs), not a screencast
 * of a person clicking. Server-rendered markup defaults to a plain,
 * JS-independent `<video controls>` — nothing autoplays without JS, and the
 * page keeps working with JS disabled (SPEC §4's D3 rule applies to `/`).
 * Once mounted, this swaps to the DESIGN-DIRECTION shape (autoplay, muted,
 * loop, playsinline, no controls) UNLESS the visitor's OS prefers reduced
 * motion, in which case it never autoplays: the poster frame stays, alongside
 * a link to open the file directly.
 */
export function DemoVideo({
  src,
  poster,
  width,
  height,
  label,
}: {
  src: string;
  poster: string;
  width: number;
  height: number;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<"loading" | "autoplay" | "reduced-motion">("loading");

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setMode(query.matches ? "reduced-motion" : "autoplay");
    const onChange = (event: MediaQueryListEvent): void => {
      setMode(event.matches ? "reduced-motion" : "autoplay");
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    if (mode !== "autoplay") return;
    // Autoplay is a browser policy decision (mobile Safari in particular can
    // still refuse it even though the element is muted); a rejected promise
    // here is expected and harmless — the poster frame plus controls (added
    // below when JS never ran, or the visible play affordance) remain.
    videoRef.current?.play().catch(() => undefined);
  }, [mode]);

  if (mode === "reduced-motion") {
    return (
      <div>
        <img src={poster} alt="" width={width} height={height} className="w-full border border-rule" />
        <p className="mt-2 text-sm">
          Motion is reduced on this device.{" "}
          <a href={src} className="underline underline-offset-2 hover:text-amber">
            Open the recording ({label})
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      width={width}
      height={height}
      muted
      loop
      playsInline
      controls={mode === "loading"}
      className="w-full border border-rule"
      aria-label={label}
    >
      <a href={src}>Open the recording ({label})</a>
    </video>
  );
}
