"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

type Artwork =
  | "instructions"
  | "emergency"
  | "sideGuide"
  | "holster"
  | "steps"
  | "badgeA"
  | "badgeB";

const SAFETY_ROWS = [
  [
    "لطفاً پیش از اتصال به خودرو، مطمئن شوید",
    "که دوشاخه و سوکت خودرو تمیز و خشک‌اند",
    "و کابل شارژ آسیب ندیده است.",
  ],
  [
    "دوشاخه هنگام شارژ در سوکت قفل می‌شود.",
    "دوشاخه را به‌زور از خودرو جدا نکنید.",
  ],
  [
    "در صورت مشاهدهٔ دود یا شرایط غیرعادی،",
    "بی‌درنگ دکمهٔ توقف اضطراری را فشار دهید.",
  ],
  [
    "پس از پایان شارژ، از آزاد بودن قفل",
    "سوکت مطمئن شوید؛ سپس دوشاخه را",
    "از خودرو جدا کنید.",
  ],
];

let fontReady: Promise<FontFace> | undefined;
function loadPrintFont() {
  if (!fontReady) {
    const font = new FontFace(
      "ChargerPrint",
      "url(/fonts/Vazirmatn-Regular.ttf)",
    );
    fontReady = font.load().then((face) => {
      document.fonts.add(face);
      return face;
    });
  }
  return fontReady;
}

/** Canvas text retains Arabic shaping; awaiting the bundled font avoids permanently
 * baking a fallback font into the GPU texture on the first render. */
function text(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  size: number,
  color = "#f4f4ee",
) {
  ctx.save();
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.font = `${size}px ChargerPrint, sans-serif`;
  ctx.fillStyle = color;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * size * 1.65));
  ctx.restore();
}

function connector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(-45, -14);
  ctx.lineTo(12, -14);
  ctx.lineTo(34, 4);
  ctx.lineTo(20, 18);
  ctx.lineTo(1, 1);
  ctx.lineTo(-45, 1);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(5, 5);
  ctx.lineTo(24, 39);
  ctx.lineTo(13, 46);
  ctx.lineTo(-7, 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-45, -7);
  ctx.bezierCurveTo(-75, -7, -70, 47, -29, 48);
  ctx.stroke();
  ctx.restore();
}

function warningIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
) {
  ctx.fillStyle = "#b64032";
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y + r * 0.8);
  ctx.lineTo(x - r, y + r * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff9dd";
  ctx.textAlign = "center";
  ctx.font = `bold ${r * 1.25}px sans-serif`;
  ctx.fillText("!", x, y + r * 0.4);
}

function drawArtwork(
  kind: Artwork,
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);
  if (kind === "instructions") {
    // Contactless reader at the top; four text/pictogram pairs below, as on the field unit.
    ctx.strokeStyle = "#eeeae0";
    ctx.lineWidth = 7;
    ctx.save();
    ctx.translate(w / 2, 77);
    ctx.rotate(-0.6);
    ctx.strokeRect(-26, -18, 52, 36);
    ctx.restore();
    for (const r of [43, 60]) {
      ctx.beginPath();
      ctx.arc(w / 2, 77, r, -0.8, 0.8);
      ctx.stroke();
    }
    SAFETY_ROWS.forEach((lines, i) => {
      const y = 220 + i * 205;
      const cx = w - 75;
      ctx.fillStyle = "#eeeae0";
      ctx.beginPath();
      ctx.arc(cx, y, 56, 0, Math.PI * 2);
      ctx.fill();
      if (i === 2) {
        ctx.fillStyle = "#25272c";
        ctx.beginPath();
        ctx.arc(cx - 6, y, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = "22px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#eeeae0";
        ctx.fillText("STOP", cx - 6, y + 8);
      } else connector(ctx, cx, y - 5, 1, "#25272c");
      ctx.strokeStyle = "#25272c";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(cx - 53, y - 53);
      ctx.lineTo(cx + 53, y + 53);
      ctx.stroke();
      text(ctx, lines, w - 150, y - 30, 24);
    });
  } else if (kind === "emergency") {
    ctx.fillStyle = "#e8bd25";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#fff9dd";
    ctx.fillRect(14, 9, w - 28, h - 18);
    ctx.strokeStyle = "#bd4639";
    ctx.lineWidth = 6;
    ctx.strokeRect(17, 12, w - 34, h - 24);
    warningIcon(ctx, w / 2, 51, 30);
    text(ctx, ["توقف اضطراری"], w - 42, 125, 60, "#b64032");
    text(ctx, ["فقط در مواقع اضطراری استفاده شود"], w - 35, 190, 29, "#b64032");
    text(
      ctx,
      [
        "استفادهٔ غیرضروری از این دکمه موجب توقف",
        "شارژ می‌شود و مشمول جریمه خواهد بود.",
      ],
      w - 35,
      239,
      23,
      "#353530",
    );
  } else if (kind === "sideGuide") {
    ctx.fillStyle = "#eee9cd";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e7c62e";
    ctx.fillRect(0, 0, w, 70);
    text(ctx, ["دستورالعمل"], w - 25, 40, 34, "#24272a");
    [
      "دوشاخه را از جایگاه بردارید",
      "به سوکت خودرو متصل کنید",
      "کارت را روی کارت‌خوان بکشید",
      "پس از پایان شارژ جدا کنید",
      "دوشاخه را در جایگاه بگذارید",
    ].forEach((line, i) => {
      const y = 155 + i * 149;
      connector(ctx, w * 0.52, y, 0.9, "#45494b");
      ctx.fillStyle = "#e5c530";
      ctx.beginPath();
      ctx.arc(w - 35, y, 10, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, [line], w - 20, y + 63, 22, "#24272a");
    });
  } else if (kind === "holster") {
    connector(ctx, w * 0.27, h * 0.4, 1.1, "#e4e1d3");
    connector(ctx, w * 0.76, h * 0.4, 1.1, "#e4e1d3");
    ctx.fillStyle = "#e4e1d3";
    ctx.textAlign = "center";
    ctx.font = "bold 21px sans-serif";
    ctx.fillText("OR", w / 2, h * 0.5);
    ctx.strokeStyle = "#e4e1d3";
    ctx.lineWidth = 4;
    for (const x of [w * 0.27, w * 0.76]) {
      ctx.beginPath();
      ctx.moveTo(x - 12, 16);
      ctx.lineTo(x + 15, 16);
      ctx.lineTo(x + 8, 27);
      ctx.stroke();
    }
  } else if (kind === "badgeA" || kind === "badgeB") {
    ctx.fillStyle = "#e7e5d8";
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#317b9c";
    ctx.font = `bold ${w * 0.74}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(kind === "badgeA" ? "A" : "B", w / 2, h * 0.54);
  } else {
    const labels = [
      "۱. به خودرو متصل کنید",
      "۲. کارت را بکشید",
      "۳. در حال شارژ",
      "۴. پرداخت با کارت",
      "۵. دوشاخه را در جایگاه بگذارید",
    ];
    labels.forEach((line, i) => {
      const x = w - ((i + 0.5) * w) / 5;
      connector(ctx, x, 37, 0.4, "#e4e1d3");
      text(ctx, [line], x + w / 11, 94, 18);
    });
  }
}

const SIZES: Record<Artwork, [number, number]> = {
  instructions: [1024, 1008],
  emergency: [640, 320],
  sideGuide: [384, 900],
  holster: [384, 150],
  steps: [1280, 130],
  badgeA: [256, 256],
  badgeB: [256, 256],
};

/** Printed labels are actual model surfaces: they rotate and occlude with the cabinet. */
export function PrintedDecal({
  kind,
  width,
  height,
  position,
  rotation = [0, 0, 0],
}: {
  kind: Artwork;
  width: number;
  height: number;
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    let disposed = false;
    let map: THREE.CanvasTexture | undefined;
    loadPrintFont()
      .catch(() => undefined)
      .then(() => {
        if (disposed) return;
        const canvas = document.createElement("canvas");
        [canvas.width, canvas.height] = SIZES[kind];
        drawArtwork(
          kind,
          canvas.getContext("2d")!,
          canvas.width,
          canvas.height,
        );
        map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 8;
        setTexture(map);
      });
    return () => {
      disposed = true;
      map?.dispose();
    };
  }, [kind]);
  if (!texture) return null;
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
