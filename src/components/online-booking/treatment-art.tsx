/**
 * The drawing on a treatment's tile on the salon's page: nails in the salon's
 * own colour (--brand), so every salon's page looks like its own without a
 * photo. Decoration only: the tile's words say what it is.
 */

import type { CSSProperties } from "react";
import type { TileArt } from "@/lib/online-booking/salon-page";

/** The brand colour lightened towards white by `pct` per cent. */
const tint = (pct: number) => `color-mix(in srgb, var(--brand) ${100 - pct}%, white)`;
/** The brand colour darkened by `pct` per cent. */
const deep = (pct: number) => `color-mix(in srgb, var(--brand) ${100 - pct}%, black)`;

const shine: CSSProperties = { background: "rgba(255,255,255,0.42)" };
const lift = "0 14px 24px rgba(28,26,30,0.12)";

/** The tile's background, by drawing. */
export function artBackground(art: TileArt): string {
  return art === "gel" ? "#f6f1ef" : art === "pedicure" ? "#efe7e3" : art === "acrylic" ? tint(82) : tint(88);
}

export function TreatmentArt({ art }: { art: TileArt }) {
  if (art === "biab") {
    const nails = [
      { c: tint(45), y: 18 },
      { c: tint(25), y: 0 },
      { c: "var(--brand)", y: -10 },
      { c: tint(25), y: 6 },
    ];
    return (
      <div className="flex h-full items-center justify-center gap-[6%]">
        {nails.map((n, i) => (
          <div
            key={i}
            className="relative aspect-[46/74] w-[15%] rounded-[50%_50%_26%_26%/32%_32%_16%_16%]"
            style={{ background: n.c, marginTop: `${n.y}%`, boxShadow: lift }}
          >
            <div className="absolute left-[22%] top-[12%] h-[40%] w-[17%] rounded-full" style={shine} />
          </div>
        ))}
      </div>
    );
  }
  if (art === "gel") {
    return (
      <div className="flex h-full items-end justify-center gap-[9%] pb-[16%]">
        <div className="flex w-[30%] flex-col items-center">
          <div className="aspect-[26/64] w-[27%] rounded-t-md rounded-b-sm bg-[#1c1a1e]" />
          <div className="relative aspect-[96/104] w-full rounded-[27%]" style={{ background: "var(--brand)", boxShadow: lift }}>
            <div className="absolute left-[17%] top-[15%] h-[54%] w-[12%] rounded-full" style={{ background: "rgba(255,255,255,0.35)" }} />
          </div>
        </div>
        <div
          className="relative aspect-[54/86] w-[17%] rotate-[14deg] rounded-full"
          style={{ background: tint(60), boxShadow: lift }}
        >
          <div className="absolute left-[22%] top-[14%] h-[40%] w-[17%] rounded-full" style={shine} />
        </div>
      </div>
    );
  }
  if (art === "acrylic") {
    const nails = [
      { c: tint(55), r: -22 },
      { c: tint(30), r: 22 },
      { c: deep(15), r: 0 },
    ];
    return (
      <div className="relative h-full">
        {nails.map((n, i) => (
          <div
            key={i}
            className="absolute bottom-[18%] left-1/2 aspect-[48/150] w-[15%] rounded-md"
            style={{
              background: n.c,
              clipPath: "polygon(14% 0, 86% 0, 100% 100%, 0 100%)",
              transform: `translateX(-50%) rotate(${n.r}deg)`,
              transformOrigin: "50% 130%",
            }}
          />
        ))}
      </div>
    );
  }
  if (art === "pedicure") {
    const toes = [
      { w: 16, h: 18, b: 0 },
      { w: 11.5, h: 13, b: 6 },
      { w: 9.5, h: 11, b: 9 },
      { w: 8.5, h: 9.5, b: 9.5 },
      { w: 7, h: 8.5, b: 8.5 },
    ];
    return (
      <div className="flex h-full items-end justify-center gap-[4%] pb-[30%]">
        {toes.map((t, i) => (
          <div
            key={i}
            className="rounded-[40%_40%_34%_34%]"
            style={{ width: `${t.w}%`, aspectRatio: `${t.w} / ${t.h}`, marginBottom: `${t.b}%`, background: "var(--brand)", boxShadow: lift }}
          />
        ))}
      </div>
    );
  }
  // Nail art, and anything we can't name: a fan of shades.
  const fan = [
    { c: tint(78), r: -32 },
    { c: tint(50), r: -16 },
    { c: deep(25), r: 16 },
    { c: tint(25), r: 32 },
    { c: "var(--brand)", r: 0 },
  ];
  return (
    <div className="relative h-full">
      {fan.map((n, i) => (
        <div
          key={i}
          className="absolute bottom-[16%] left-1/2 aspect-[46/105] w-[16%] rounded-[50%_50%_28%_28%/30%_30%_14%_14%]"
          style={{
            background: n.c,
            transform: `translateX(-50%) rotate(${n.r}deg)`,
            transformOrigin: "50% 120%",
            boxShadow: lift,
            ...(art === "art" && i === 4
              ? { backgroundImage: `radial-gradient(circle at 50% 32%, white 0 9%, transparent 10%), radial-gradient(circle at 35% 58%, ${tint(60)} 0 7%, transparent 8%), radial-gradient(circle at 64% 62%, ${tint(60)} 0 7%, transparent 8%)` }
              : {}),
          }}
        />
      ))}
    </div>
  );
}
