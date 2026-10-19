"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { CAR_HALF_W, CAR_PORT } from "./Car";
import type { TwinPlug } from "./useTwinData";

export const STATION_W = 0.76;
export const STATION_H = 1.95;
export const STATION_D = 0.6;
/** Narrow black fascia right of centre, as on the catalog photo. */
export const FASCIA_X = 0.12;
export const FASCIA_W = 0.38;
/** Monitor plane, world units. 536:314 is the real screen's aspect ratio. */
export const SCREEN_W = 0.3;
export const SCREEN_H = SCREEN_W * (314 / 536);
export const SCREEN_Y = 1.52;
/** Front face z; everything on the fascia sits just proud of it. */
export const FRONT_Z = STATION_D / 2;
const IFRAME_W = 1072;
const IFRAME_H = 628;
/** drei's Html in `transform` mode maps world units to CSS px at 400/distanceFactor px per unit. */
const DISTANCE_FACTOR = 10;
const PX_PER_UNIT = 400 / DISTANCE_FACTOR;
const HTML_SCALE = (SCREEN_W * PX_PER_UNIT) / IFRAME_W;

export const STATE_COLOR: Record<string, string> = {
  Available: "#22c55e",
  Preparing: "#f59e0b",
  Charging: "#3b82f6",
  Finishing: "#a78bfa",
  Faulted: "#ef4444",
  Unavailable: "#6b7280",
};

/** World position of a plug's cable outlet / holster on the station's flank. Plug 1 = left, plug 2 = right. */
const HOLSTER_Y = 1.28;
export function holsterPos(index: number): THREE.Vector3 {
  const s = index === 0 ? -1 : 1;
  return new THREE.Vector3(s * (STATION_W / 2 + 0.12), HOLSTER_Y, 0.14);
}
/** World position of a car's charge port: front fender, on the flank the camera sees (+z). */
export function carPortPos(index: number, parkX: number): THREE.Vector3 {
  const s = index === 0 ? 1 : -1; // car A faces +x (port ahead of centre), car B faces -x
  return new THREE.Vector3(parkX + s * CAR_PORT.x, CAR_PORT.y, CAR_HALF_W + 0.012);
}

function labelTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 256) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const GUN_LEN = 0.36;
/** Keep cable/gun at least this far outside the car's flank (and ahead of its nose) so they can never pass through the body. */
const CLEAR_Z = CAR_HALF_W + 0.17;
const smooth = (x: number) => x * x * (3 - 2 * x);

function Cable({ index, parkX, connected, charging }: { index: number; parkX: number; connected: boolean; charging: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const gun = useRef<THREE.Group>(null);
  const flow = useRef<THREE.InstancedMesh>(null);
  const curve = useRef<THREE.CatmullRomCurve3 | null>(null);
  const k = useRef(connected ? 1 : 0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const start = useMemo(() => holsterPos(index), [index]);
  const sx = Math.sign(start.x);
  const port = useMemo(() => carPortPos(index, parkX), [index, parkX]);
  // gun tip waypoints: parked in its holster -> out in front of the cabinet -> alongside the car, outside the flank -> onto the port
  const way = useMemo(() => {
    const rest = new THREE.Vector3(sx * (STATION_W / 2 + 0.05), HOLSTER_Y - 0.02, 0.2);
    const out1 = new THREE.Vector3(start.x + sx * 0.12, HOLSTER_Y - 0.1, CLEAR_Z + GUN_LEN);
    const out2 = new THREE.Vector3(port.x, port.y + 0.04, CLEAR_Z + GUN_LEN);
    const dock = new THREE.Vector3(port.x, port.y, port.z + 0.01);
    const pts = [rest, out1, out2, dock];
    const len = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
    return { pts, len, total: len.reduce((a, b) => a + b, 0) };
  }, [start, sx, port]);
  const initGeo = useMemo(() => new THREE.TubeGeometry(new THREE.LineCurve3(start, way.pts[0]), 2, 0.026, 8), [start, way]);

  useFrame((state, dt) => {
    const target = connected ? 1 : 0;
    const moving = Math.abs(k.current - target) > 0.0005;
    if (moving) k.current += (target - k.current) * Math.min(1, dt * 1.6);
    if (moving || !curve.current) {
      // position along the waypoint polyline
      let d = smooth(k.current) * way.total;
      const tip = way.pts[0].clone();
      for (let i = 0; i < way.len.length; i++) {
        if (d <= way.len[i] || i === way.len.length - 1) {
          tip.lerpVectors(way.pts[i], way.pts[i + 1], Math.min(1, d / way.len[i]));
          break;
        }
        d -= way.len[i];
      }
      // the gun always points its nose along -z (into the station's holster / into the car's flank)
      const rear = tip.clone().add(new THREE.Vector3(0, 0, GUN_LEN));
      const out = Math.min(1, Math.max(0, (tip.z - 0.6) / 0.6)); // 0 = at the holster, 1 = out beside the car
      const pts: THREE.Vector3[] = [
        start,
        start.clone().add(new THREE.Vector3(sx * 0.1, -0.14, 0.22)),
        new THREE.Vector3(start.x + sx * 0.2, THREE.MathUtils.lerp(0.5, 0.95, out), THREE.MathUtils.lerp(0.5, CLEAR_Z + 0.1, out)),
      ];
      // mid-span: sag a little between the cabinet and the gun, but never below the flank clearance near the car
      const mid = pts[2].clone().lerp(rear, 0.5);
      mid.y -= 0.18 * out * (1 - k.current * 0.6);
      if (Math.abs(mid.x - parkX) < 2.6) mid.z = Math.max(mid.z, CLEAR_Z + 0.1);
      pts.push(mid, rear.clone().add(new THREE.Vector3(0, -0.02 - 0.12 * (1 - out), 0.22 * out)), rear);
      const c = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      curve.current = c;
      if (mesh.current) {
        mesh.current.geometry.dispose();
        mesh.current.geometry = new THREE.TubeGeometry(c, 64, 0.026, 10, false);
      }
      if (gun.current) gun.current.position.copy(tip);
    }
    if (flow.current && curve.current) {
      const t = state.clock.elapsedTime;
      for (let i = 0; i < 9; i++) {
        const u = charging ? (t * 0.45 + i / 9) % 1 : 0;
        const p = curve.current.getPointAt(u);
        dummy.position.copy(p);
        dummy.scale.setScalar(charging ? 1 : 0);
        dummy.updateMatrix();
        flow.current.setMatrixAt(i, dummy.matrix);
      }
      flow.current.instanceMatrix.needsUpdate = true;
    }
  });

  useEffect(() => () => mesh.current?.geometry.dispose(), []);

  return (
    <group>
      <mesh ref={mesh} castShadow geometry={initGeo}>
        <meshStandardMaterial color="#0e0f12" roughness={0.55} metalness={0.2} />
      </mesh>
      <instancedMesh ref={flow} args={[undefined, undefined, 9]}>
        <sphereGeometry args={[0.034, 12, 12]} />
        <meshBasicMaterial color="#7dd3fc" toneMapped={false} />
      </instancedMesh>
      {/* CCS2 gun: tip at the group origin, body extends back along +z. Silver nose, grey grip, glowing strip */}
      <group ref={gun}>
        <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.058, 0.064, 0.1, 24]} />
          <meshStandardMaterial color="#d6d9de" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0, 0.1 + 0.13]} castShadow>
          <boxGeometry args={[0.09, 0.11, 0.26]} />
          <meshStandardMaterial color="#2a2d33" roughness={0.45} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.058, 0.23]}>
          <boxGeometry args={[0.03, 0.006, 0.18]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={charging ? 3 : 0.8} />
        </mesh>
      </group>
    </group>
  );
}

/** Big green "A B" window at the top of the fascia: each letter glows in its plug's status colour. */
function AbDisplay({ plugs, y }: { plugs: TwinPlug[]; y: number }) {
  const tex = useMemo(
    () =>
      ["A", "B"].map((ch) =>
        labelTexture(
          (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#ffffff";
            ctx.shadowColor = "#ffffff";
            ctx.shadowBlur = 18;
            ctx.font = "700 150px 'Courier New', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(ch, w / 2, h / 2 + 6);
          },
          128,
          128,
        ),
      ),
    [],
  );
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([null, null]);
  const statuses = plugs.map((p) => p?.status ?? "Unavailable");
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    [0, 1].forEach((i) => {
      const m = mats.current[i];
      if (!m) return;
      const st = statuses[i] ?? "Unavailable";
      m.color.set(STATE_COLOR[st] ?? "#6b7280");
      // Available: steady. Preparing: slow blink. Charging: breathing. Faulted: fast blink. Unavailable: dim.
      const k =
        st === "Preparing" ? (Math.sin(t * 5) > 0 ? 1 : 0.18)
        : st === "Charging" ? 0.65 + 0.35 * Math.sin(t * 3)
        : st === "Faulted" ? (Math.sin(t * 12) > 0 ? 1 : 0.1)
        : st === "Unavailable" ? 0.25
        : 1;
      m.opacity = k;
    });
  });
  return (
    <group position={[FASCIA_X, y, FRONT_Z + 0.014]}>
      <mesh>
        <planeGeometry args={[0.24, 0.13]} />
        <meshBasicMaterial color="#04100a" />
      </mesh>
      {[0, 1].map((i) => (
        <mesh key={i} position={[(i === 0 ? -1 : 1) * 0.056, 0, 0.001]}>
          <planeGeometry args={[0.1, 0.1]} />
          <meshBasicMaterial ref={(m) => { mats.current[i] = m; }} map={tex[i]} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Red emergency stop in a dark ring, on the front below the fascia (as on the product photos). */
function EmergencyStop() {
  const label = useMemo(
    () =>
      labelTexture(
        (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#1f2937";
          ctx.font = "700 34px Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("EMERGENCY", w / 2, h / 2 + 12);
        },
        256,
        64,
      ),
    [],
  );
  return (
    <group position={[FASCIA_X, 0.9, FRONT_Z]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0.006, 0]}>
        <cylinderGeometry args={[0.052, 0.052, 0.012, 32]} />
        <meshStandardMaterial color="#14171c" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.026, 0]}>
        <cylinderGeometry args={[0.034, 0.04, 0.03, 32]} />
        <meshStandardMaterial color="#b91c1c" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.038, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color="#dc2626" roughness={0.18} clearcoat={1} />
      </mesh>
      <mesh position={[0, 0.001, 0.075]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.13, 0.032]} />
        <meshBasicMaterial map={label} transparent toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Dual-gun DC fast-charger cabinet modelled on the PEVC3107E catalog photo: light grey door with a vertical handle, narrow black fascia with the A/B window, screen and instruction icons, louvred flanks, holstered guns, an emergency stop below the fascia. */
export function Station({
  instanceId,
  plugs,
  parkXs,
  screenFocus,
  portal,
}: {
  instanceId: string;
  /** Stable DOM container for the monitor iframe. A changing target makes drei unmount its root mid-render and lose the iframe. */
  portal: React.RefObject<HTMLElement>;
  plugs: TwinPlug[];
  parkXs: [number, number];
  screenFocus: boolean;
}) {
  const guide = useMemo(
    () =>
      labelTexture(
        (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          // down chevron, then four instruction rows: round icon + two text lines
          ctx.strokeStyle = "#cbd5e1";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(w / 2 - 14, 22);
          ctx.lineTo(w / 2, 36);
          ctx.lineTo(w / 2 + 14, 22);
          ctx.stroke();
          for (let i = 0; i < 4; i++) {
            const y = 84 + i * 84;
            ctx.fillStyle = "#cbd5e1";
            ctx.beginPath();
            ctx.arc(64, y, 30, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#0a0e14";
            ctx.fillRect(52, y - 4, 24, 8);
            ctx.fillStyle = "#94a3b8";
            ctx.fillRect(116, y - 14, 170, 8);
            ctx.fillRect(116, y + 2, 140, 8);
          }
        },
        320,
        420,
      ),
    [],
  );

  // The monitor is CSS3D, so WebGL geometry can't hide it: drop it whenever the camera is behind the screen plane,
  // otherwise it would shine through the cabinet when orbiting round the back or sides.
  const screenGroup = useRef<THREE.Group>(null);
  const screenHtml = useRef<HTMLDivElement>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    const g = screenGroup.current;
    const el = screenHtml.current;
    if (!g || !el) return;
    const local = g.worldToLocal(tmp.copy(camera.position));
    el.style.visibility = local.z > 0.03 ? "visible" : "hidden";
  });

  const fasciaShape = useMemo(() => {
    const hw = FASCIA_W / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw, 1.855);
    s.lineTo(hw, 1.855);
    s.lineTo(hw, 0.99);
    s.lineTo(-hw, 1.07);
    s.closePath();
    return s;
  }, []);
  const stripeShape = useMemo(() => {
    const hw = FASCIA_W / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw, 1.07);
    s.lineTo(hw, 0.99);
    s.lineTo(hw, 0.975);
    s.lineTo(-hw, 1.055);
    s.closePath();
    return s;
  }, []);

  const src = `/instances/${instanceId}?embed=1`;
  const flankZ = -0.04;

  return (
    <group>
      {/* recessed plinth */}
      <RoundedBox args={[STATION_W + 0.01, 0.16, STATION_D + 0.01]} radius={0.01} position={[0, 0.08, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#565c65" roughness={0.7} />
      </RoundedBox>
      {/* cabinet: light grey-blue painted steel */}
      <RoundedBox args={[STATION_W, STATION_H - 0.14, STATION_D]} radius={0.012} smoothness={4} position={[0, 0.14 + (STATION_H - 0.14) / 2, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial color="#c3cbd4" roughness={0.5} metalness={0.15} clearcoat={0.3} clearcoatRoughness={0.4} />
      </RoundedBox>
      {/* black fascia with slanted lower edge + blue accent */}
      <mesh position={[FASCIA_X, 0, FRONT_Z]}>
        <extrudeGeometry args={[fasciaShape, { depth: 0.012, bevelEnabled: false }]} />
        <meshPhysicalMaterial color="#07090d" metalness={0.4} roughness={0.12} clearcoat={1} />
      </mesh>
      <mesh position={[FASCIA_X, 0, FRONT_Z + 0.0125]}>
        <shapeGeometry args={[stripeShape]} />
        <meshStandardMaterial color="#1d6fd6" emissive="#1d6fd6" emissiveIntensity={0.6} />
      </mesh>
      <AbDisplay plugs={plugs} y={1.745} />
      {/* monitor bezel + live screen */}
      <RoundedBox args={[SCREEN_W + 0.02, SCREEN_H + 0.02, 0.01]} radius={0.006} position={[FASCIA_X, SCREEN_Y, FRONT_Z + 0.017]}>
        <meshStandardMaterial color="#030405" roughness={0.3} metalness={0.4} />
      </RoundedBox>
      <group ref={screenGroup} position={[FASCIA_X, SCREEN_Y, FRONT_Z + 0.023]}>
        <Html ref={screenHtml} transform portal={portal} distanceFactor={DISTANCE_FACTOR} scale={HTML_SCALE} zIndexRange={[10, 0]} style={{ width: IFRAME_W, height: IFRAME_H, pointerEvents: "auto" }}>
          <iframe
            title="Charger screen"
            src={src}
            width={IFRAME_W}
            height={IFRAME_H}
            style={{ border: 0, display: "block", background: "#f4f6f8", borderRadius: 6 }}
          />
        </Html>
        {/* faint glass sheen over the screen */}
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[SCREEN_W, SCREEN_H]} />
          <meshPhysicalMaterial transparent opacity={screenFocus ? 0 : 0.06} color="#ffffff" roughness={0} clearcoat={1} depthWrite={false} />
        </mesh>
      </group>
      {/* instruction panel: chevron + four icon rows, printed on the fascia */}
      <mesh position={[FASCIA_X, 1.235, FRONT_Z + 0.0135]}>
        <planeGeometry args={[0.3, 0.3 * (420 / 320)]} />
        <meshBasicMaterial map={guide} transparent toneMapped={false} depthWrite={false} />
      </mesh>
      {/* door handle (vertical, black) */}
      <RoundedBox args={[0.028, 0.17, 0.03]} radius={0.008} position={[-STATION_W / 2 + 0.07, 1.05, FRONT_Z + 0.012]} castShadow>
        <meshStandardMaterial color="#0d0f12" roughness={0.4} metalness={0.4} />
      </RoundedBox>
      {/* door seam */}
      <mesh position={[-STATION_W / 2 + 0.015, 1.05, FRONT_Z + 0.001]}>
        <planeGeometry args={[0.004, 1.7]} />
        <meshBasicMaterial color="#8c949e" />
      </mesh>
      {/* darker flank panels with vent louvres and the emergency stop on the right */}
      {[-1, 1].map((sd) => (
        <group key={sd}>
          <mesh position={[sd * (STATION_W / 2 + 0.001), 1.5, flankZ]} rotation={[0, sd * Math.PI * 0.5, 0]}>
            <planeGeometry args={[0.34, 0.74]} />
            <meshStandardMaterial color="#4a5058" roughness={0.6} />
          </mesh>
          {Array.from({ length: 22 }).map((_, i) => (
            <mesh key={i} position={[sd * (STATION_W / 2 + 0.003), 1.15 + i * 0.033, flankZ]} rotation={[0, sd * Math.PI * 0.5, 0]}>
              <planeGeometry args={[0.3, 0.009]} />
              <meshBasicMaterial color="#1b1f24" />
            </mesh>
          ))}
        </group>
      ))}
      <EmergencyStop />
      {/* holster pods + cables */}
      {[0, 1].map((i) => {
        const h = holsterPos(i);
        const sd = Math.sign(h.x);
        return (
          <group key={i}>
            <RoundedBox args={[0.12, 0.22, 0.18]} radius={0.03} position={[sd * (STATION_W / 2 + 0.05), h.y - 0.02, h.z]} castShadow>
              <meshStandardMaterial color="#2a2d33" roughness={0.5} metalness={0.3} />
            </RoundedBox>
            <Cable index={i} parkX={parkXs[i]} connected={!!plugs[i]?.evConnected} charging={!!plugs[i]?.charging} />
          </group>
        );
      })}
    </group>
  );
}
