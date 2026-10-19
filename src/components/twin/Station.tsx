"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { TwinPlug } from "./useTwinData";

export const STATION_W = 0.92;
export const STATION_H = 1.95;
export const STATION_D = 0.52;
/** Monitor plane, world units. 536:314 is the real screen's aspect ratio. */
export const SCREEN_W = 0.5;
export const SCREEN_H = SCREEN_W * (314 / 536);
export const SCREEN_Y = 1.5;
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
export function holsterPos(index: number): THREE.Vector3 {
  const s = index === 0 ? -1 : 1;
  return new THREE.Vector3(s * (STATION_W / 2 + 0.14), 0.98, 0.1);
}
/** World position of a car's charge port: front-right fender, on the flank the camera sees. */
export function carPortPos(index: number, parkX: number): THREE.Vector3 {
  const s = index === 0 ? 1 : -1; // car A faces +x (port is 1.52 ahead of centre), car B faces -x
  return new THREE.Vector3(parkX + s * 1.52, 0.88, 0.915);
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

function Cable({ index, parkX, connected, charging }: { index: number; parkX: number; connected: boolean; charging: boolean }) {
  const mesh = useRef<THREE.Mesh>(null);
  const gun = useRef<THREE.Group>(null);
  const flow = useRef<THREE.InstancedMesh>(null);
  const curve = useRef<THREE.CatmullRomCurve3 | null>(null);
  const k = useRef(connected ? 1 : 0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const start = useMemo(() => holsterPos(index), [index]);
  const rest = useMemo(() => start.clone().add(new THREE.Vector3(Math.sign(start.x) * 0.06, -0.05, 0.1)), [start]);
  const port = useMemo(() => carPortPos(index, parkX), [index, parkX]);
  const initGeo = useMemo(() => new THREE.TubeGeometry(new THREE.LineCurve3(start, rest), 2, 0.026, 8), [start, rest]);

  useFrame((state, dt) => {
    const target = connected ? 1 : 0;
    const moving = Math.abs(k.current - target) > 0.0005;
    if (moving) k.current += (target - k.current) * Math.min(1, dt * 2.2);
    if (moving || !curve.current) {
      const end = rest.clone().lerp(port, k.current);
      // the free end arcs up and out while it travels, instead of cutting straight across
      end.y += Math.sin(k.current * Math.PI) * 0.18;
      const mid = start.clone().lerp(end, 0.5);
      const slack = connected ? 0.28 : 0.5;
      mid.y -= slack;
      mid.z += 0.25 + Math.sin(k.current * Math.PI) * 0.15;
      const a = start.clone().lerp(mid, 0.5);
      a.y -= 0.12;
      const b = mid.clone().lerp(end, 0.5);
      b.y -= 0.1;
      const c = new THREE.CatmullRomCurve3([start, a, mid, b, end], false, "catmullrom", 0.5);
      curve.current = c;
      if (mesh.current) {
        mesh.current.geometry.dispose();
        mesh.current.geometry = new THREE.TubeGeometry(c, 48, 0.026, 10, false);
      }
      if (gun.current) {
        gun.current.position.copy(end);
        const tan = c.getTangentAt(1);
        gun.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tan.clone().negate());
      }
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
      {/* CCS2 gun: grey grip, dark nose, glowing trigger strip */}
      <group ref={gun}>
        <mesh position={[0, 0, 0.12]} castShadow>
          <boxGeometry args={[0.085, 0.1, 0.3]} />
          <meshStandardMaterial color="#2a2d33" roughness={0.45} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.0, -0.06]}>
          <cylinderGeometry args={[0.052, 0.062, 0.1, 24]} />
          <meshStandardMaterial color="#d6d9de" roughness={0.3} metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.054, 0.12]}>
          <boxGeometry args={[0.03, 0.006, 0.18]} />
          <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={charging ? 3 : 0.8} />
        </mesh>
      </group>
    </group>
  );
}

function StatusLight({ index, plug }: { index: number; plug: TwinPlug | undefined }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const color = STATE_COLOR[plug?.status ?? "Unavailable"] ?? "#6b7280";
  const s = index === 0 ? -1 : 1;
  useFrame((state) => {
    if (!mat.current) return;
    const pulse = plug?.status === "Charging" ? 0.6 + 0.4 * Math.sin(state.clock.elapsedTime * 3) : 1;
    mat.current.emissiveIntensity = 2.2 * pulse;
    mat.current.color.set(color);
    mat.current.emissive.set(color);
  });
  return (
    <mesh position={[s * (STATION_W / 2 + 0.005), 1.26, 0.0]} rotation={[0, s * Math.PI * 0.5, 0]}>
      <capsuleGeometry args={[0.02, 0.34, 6, 12]} />
      <meshStandardMaterial ref={mat} color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
    </mesh>
  );
}

/** Dual-gun DC fast-charger cabinet modelled on the PEVC3107E (light grey body, dark glass fascia with the touchscreen). */
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
  const logo = useMemo(
    () =>
      labelTexture(
        (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#e8f1fb";
          ctx.font = "700 62px Arial, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("PEVC", w / 2, 92);
          ctx.fillStyle = "#38bdf8";
          ctx.font = "700 30px Arial, sans-serif";
          ctx.fillText("3107E · 2×CCS2", w / 2, 150);
        },
        256,
        180,
      ),
    [],
  );
  const ab = useMemo(
    () =>
      labelTexture(
        (ctx, w, h) => {
          ctx.fillStyle = "#04140a";
          ctx.fillRect(0, 0, w, h);
          ctx.fillStyle = "#4ade80";
          ctx.shadowColor = "#4ade80";
          ctx.shadowBlur = 14;
          ctx.font = "700 92px 'Courier New', monospace";
          ctx.textAlign = "center";
          ctx.fillText("A", w * 0.27, h * 0.76);
          ctx.fillText("B", w * 0.73, h * 0.76);
        },
        256,
        128,
      ),
    [],
  );

  const bodyMat = { color: "#dfe3e8", roughness: 0.38, metalness: 0.35 } as const;
  const src = `/instances/${instanceId}?embed=1`;

  return (
    <group>
      {/* plinth */}
      <RoundedBox args={[STATION_W + 0.1, 0.14, STATION_D + 0.1]} radius={0.02} position={[0, 0.07, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#2c3036" roughness={0.7} />
      </RoundedBox>
      {/* cabinet */}
      <RoundedBox args={[STATION_W, STATION_H - 0.14, STATION_D]} radius={0.035} smoothness={5} position={[0, 0.14 + (STATION_H - 0.14) / 2, 0]} castShadow receiveShadow>
        <meshPhysicalMaterial {...bodyMat} clearcoat={0.6} clearcoatRoughness={0.25} />
      </RoundedBox>
      {/* blue accent stripe under the fascia, as on the product render */}
      <mesh position={[0, 1.02, STATION_D / 2 + 0.002]}>
        <planeGeometry args={[0.7, 0.012]} />
        <meshStandardMaterial color="#1d6fd6" emissive="#1d6fd6" emissiveIntensity={0.8} />
      </mesh>
      {/* dark glass fascia */}
      <RoundedBox args={[0.62, 1.0, 0.03]} radius={0.015} position={[0, 1.42, STATION_D / 2 + 0.004]}>
        <meshPhysicalMaterial color="#0a0e14" metalness={0.5} roughness={0.08} clearcoat={1} envMapIntensity={1.5} />
      </RoundedBox>
      {/* A/B indicator window */}
      <mesh position={[0, 1.86, STATION_D / 2 + 0.021]}>
        <planeGeometry args={[0.3, 0.15]} />
        <meshBasicMaterial map={ab} toneMapped={false} />
      </mesh>
      {/* monitor bezel + live screen */}
      <RoundedBox args={[SCREEN_W + 0.04, SCREEN_H + 0.04, 0.012]} radius={0.008} position={[0, SCREEN_Y, STATION_D / 2 + 0.021]}>
        <meshStandardMaterial color="#030405" roughness={0.3} metalness={0.4} />
      </RoundedBox>
      <group position={[0, SCREEN_Y, STATION_D / 2 + 0.0275]}>
        <Html transform portal={portal} distanceFactor={DISTANCE_FACTOR} scale={HTML_SCALE} zIndexRange={[10, 0]} style={{ width: IFRAME_W, height: IFRAME_H, pointerEvents: "auto" }}>
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
      {/* instruction icon tiles + RFID reader below the screen */}
      {[-0.17, -0.057, 0.057, 0.17].map((x) => (
        <RoundedBox key={x} args={[0.085, 0.085, 0.006]} radius={0.015} position={[x, 1.28, STATION_D / 2 + 0.021]}>
          <meshStandardMaterial color="#cfd5dc" metalness={0.6} roughness={0.35} />
        </RoundedBox>
      ))}
      <mesh position={[0, 1.13, STATION_D / 2 + 0.021]}>
        <planeGeometry args={[0.22, 0.1]} />
        <meshStandardMaterial color="#0b3a73" emissive="#1d6fd6" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 0.62, STATION_D / 2 + 0.003]}>
        <planeGeometry args={[0.5, 0.36]} />
        <meshBasicMaterial map={logo} transparent toneMapped={false} />
      </mesh>
      {/* door seam + handle on the front */}
      <mesh position={[-0.41, 0.72, STATION_D / 2 + 0.004]}>
        <boxGeometry args={[0.012, 0.16, 0.02]} />
        <meshStandardMaterial color="#8a919b" metalness={1} roughness={0.25} />
      </mesh>
      {/* side vent louvres */}
      {[-1, 1].map((s) =>
        Array.from({ length: 14 }).map((_, i) => (
          <mesh key={`${s}${i}`} position={[s * (STATION_W / 2 + 0.002), 1.5 + i * 0.026 - 0.2, -0.05]} rotation={[0, s * Math.PI * 0.5, 0]}>
            <planeGeometry args={[0.28, 0.008]} />
            <meshBasicMaterial color="#5b626c" />
          </mesh>
        )),
      )}
      {/* holster pods + status lights + cables */}
      {[0, 1].map((i) => {
        const h = holsterPos(i);
        const s = Math.sign(h.x);
        return (
          <group key={i}>
            <RoundedBox args={[0.12, 0.2, 0.16]} radius={0.03} position={[s * (STATION_W / 2 + 0.05), h.y - 0.02, h.z]} castShadow>
              <meshStandardMaterial color="#2a2d33" roughness={0.5} metalness={0.3} />
            </RoundedBox>
            <StatusLight index={i} plug={plugs[i]} />
            <Cable index={i} parkX={parkXs[i]} connected={!!plugs[i]?.evConnected} charging={!!plugs[i]?.charging} />
          </group>
        );
      })}
    </group>
  );
}
