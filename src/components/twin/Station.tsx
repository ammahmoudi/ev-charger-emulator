"use client";

import { Html, RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { CAR_HALF_W, CAR_PORT } from "./Car";
import { PrintedDecal } from "./PrintedDecals";
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
export const SCREEN_Y = 1.4;
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
const HOLSTER_Y = 0.83;
// The black cover ends at the holstered connector, not at the cabinet base.
const FASCIA_BOTTOM_Y = HOLSTER_Y;
export function holsterPos(index: number): THREE.Vector3 {
  const s = index === 0 ? -1 : 1;
  return new THREE.Vector3(s * (STATION_W / 2 + 0.12), HOLSTER_Y, 0.14);
}
/** World position of a car's charge port: front fender, on the flank the camera sees (+z). */
export function carPortPos(index: number, parkX: number): THREE.Vector3 {
  const s = index === 0 ? 1 : -1; // car A faces +x (port ahead of centre), car B faces -x
  return new THREE.Vector3(
    parkX + s * CAR_PORT.x,
    CAR_PORT.y,
    CAR_HALF_W + 0.012,
  );
}

function labelTexture(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w = 256,
  h = 256,
) {
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

function Cable({
  index,
  parkX,
  connected,
  charging,
}: {
  index: number;
  parkX: number;
  connected: boolean;
  charging: boolean;
}) {
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
    const rest = new THREE.Vector3(
      sx * (STATION_W / 2 + 0.095),
      HOLSTER_Y - 0.02,
      0.18,
    );
    const out1 = new THREE.Vector3(
      start.x + sx * 0.12,
      HOLSTER_Y - 0.1,
      CLEAR_Z + GUN_LEN,
    );
    const out2 = new THREE.Vector3(port.x, port.y + 0.04, CLEAR_Z + GUN_LEN);
    const dock = new THREE.Vector3(port.x, port.y, port.z + 0.01);
    const pts = [rest, out1, out2, dock];
    const len = pts.slice(1).map((p, i) => p.distanceTo(pts[i]));
    return { pts, len, total: len.reduce((a, b) => a + b, 0) };
  }, [start, sx, port]);
  const initGeo = useMemo(
    () =>
      new THREE.TubeGeometry(
        new THREE.LineCurve3(start, way.pts[0]),
        2,
        0.026,
        8,
      ),
    [start, way],
  );

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
          tip.lerpVectors(
            way.pts[i],
            way.pts[i + 1],
            Math.min(1, d / way.len[i]),
          );
          break;
        }
        d -= way.len[i];
      }
      // Dock into the side-facing cradle, then turn toward the car as the gun leaves.
      const gunAngle = ((sx * Math.PI) / 2) * (1 - smooth(k.current));
      const dockTilt = 0.65 * (1 - smooth(k.current));
      const rear = tip
        .clone()
        .add(
          new THREE.Vector3(
            Math.sin(gunAngle) * Math.cos(dockTilt),
            -Math.sin(dockTilt),
            Math.cos(gunAngle) * Math.cos(dockTilt),
          ).multiplyScalar(GUN_LEN),
        );
      const out = Math.min(1, Math.max(0, (tip.z - 0.6) / 0.6)); // 0 = at the holster, 1 = out beside the car
      const pts: THREE.Vector3[] = [
        start,
        start.clone().add(new THREE.Vector3(sx * 0.1, -0.14, 0.22)),
        new THREE.Vector3(
          start.x + sx * 0.2,
          THREE.MathUtils.lerp(0.5, 0.95, out),
          THREE.MathUtils.lerp(0.5, CLEAR_Z + 0.1, out),
        ),
      ];
      // mid-span: sag a little between the cabinet and the gun, but never below the flank clearance near the car
      const mid = pts[2].clone().lerp(rear, 0.5);
      mid.y -= 0.18 * out * (1 - k.current * 0.6);
      if (Math.abs(mid.x - parkX) < 2.6) mid.z = Math.max(mid.z, CLEAR_Z + 0.1);
      pts.push(
        mid,
        rear
          .clone()
          .add(new THREE.Vector3(0, -0.02 - 0.12 * (1 - out), 0.22 * out)),
        rear,
      );
      const c = new THREE.CatmullRomCurve3(pts, false, "centripetal");
      curve.current = c;
      if (mesh.current) {
        mesh.current.geometry.dispose();
        mesh.current.geometry = new THREE.TubeGeometry(c, 64, 0.026, 10, false);
      }
      if (gun.current) {
        gun.current.position.copy(tip);
        gun.current.rotation.set(dockTilt, gunAngle, 0, "YXZ");
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
        <meshStandardMaterial
          color="#0e0f12"
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      <instancedMesh ref={flow} args={[undefined, undefined, 9]}>
        <sphereGeometry args={[0.034, 12, 12]} />
        <meshBasicMaterial color="#7dd3fc" toneMapped={false} />
      </instancedMesh>
      {/* White GB/T gun; tip stays at the cable animation origin. */}
      <group ref={gun}>
        <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.058, 0.064, 0.1, 24]} />
          <meshStandardMaterial
            color="#d6d9de"
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>
        <RoundedBox
          args={[0.09, 0.11, 0.26]}
          radius={0.025}
          smoothness={4}
          position={[0, 0, 0.1 + 0.13]}
          castShadow
        >
          <meshStandardMaterial
            color="#e6e4db"
            roughness={0.5}
            metalness={0.1}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.027, 0.13, 0.035]}
          radius={0.01}
          position={[0.062, -0.045, 0.19]}
        >
          <meshStandardMaterial color="#d9d8d0" roughness={0.6} />
        </RoundedBox>
        <RoundedBox
          args={[0.027, 0.035, 0.17]}
          radius={0.01}
          position={[0.062, -0.1, 0.25]}
        >
          <meshStandardMaterial color="#e6e4db" roughness={0.6} />
        </RoundedBox>
        <RoundedBox
          args={[0.027, 0.13, 0.035]}
          radius={0.01}
          position={[0.062, -0.045, 0.32]}
        >
          <meshStandardMaterial color="#e6e4db" roughness={0.6} />
        </RoundedBox>
        <mesh position={[0, 0.058, 0.23]}>
          <boxGeometry args={[0.03, 0.006, 0.18]} />
          <meshStandardMaterial color="#6e7377" roughness={0.6} />
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
            ctx.font = "700 108px Arial, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(ch, w / 2, h / 2 + 4);
            const mask = ctx.getImageData(0, 0, w, h);
            ctx.clearRect(0, 0, w, h);
            for (let y = 9; y < h - 5; y += 7)
              for (let x = 9; x < w - 5; x += 7) {
                if (mask.data[(y * w + x) * 4 + 3] > 100) {
                  ctx.beginPath();
                  ctx.arc(x, y, 2.25, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
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
        st === "Preparing"
          ? Math.sin(t * 5) > 0
            ? 1
            : 0.18
          : st === "Charging"
            ? 0.65 + 0.35 * Math.sin(t * 3)
            : st === "Faulted"
              ? Math.sin(t * 12) > 0
                ? 1
                : 0.1
              : st === "Unavailable"
                ? 0.25
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
          <meshBasicMaterial
            ref={(m) => {
              mats.current[i] = m;
            }}
            map={tex[i]}
            transparent
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Field photos: mushroom switch on the right side's forward strip, above
 * the holster. This group faces +x, so no part sits on the front screen panel. */
function EmergencyStop() {
  const ringLabel = useMemo(
    () =>
      labelTexture((ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#e7e5d8";
        ctx.textAlign = "center";
        ctx.font = "bold 24px sans-serif";
        const word = "EMERGENCY";
        for (let i = 0; i < word.length; i++) {
          const angle = (0.15 + (i / (word.length - 1)) * 0.7) * Math.PI;
          ctx.save();
          ctx.translate(
            w / 2 + Math.cos(angle) * 105,
            h / 2 + Math.sin(angle) * 105,
          );
          ctx.rotate(angle - Math.PI / 2);
          ctx.fillText(word[i], 0, 0);
          ctx.restore();
        }
      }),
    [],
  );
  useEffect(() => () => ringLabel.dispose(), [ringLabel]);
  return (
    <group
      position={[STATION_W / 2 + 0.012, 1.27, 0.2]}
      rotation={[0, Math.PI / 2, 0]}
    >
      <mesh>
        <circleGeometry args={[0.074, 48]} />
        <meshStandardMaterial color="#141619" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0, 0.01]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.041, 0.045, 0.02, 40]} />
        <meshStandardMaterial color="#131417" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, 0.031]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.032, 0.038, 0.025, 40]} />
        <meshPhysicalMaterial color="#d74332" roughness={0.3} clearcoat={1} />
      </mesh>
      {/* Clear acrylic protective collar, mounting screws and white reset arrows. */}
      <mesh position={[0, 0, 0.025]}>
        <ringGeometry args={[0.051, 0.085, 64]} />
        <meshPhysicalMaterial
          color="#eff5ff"
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
          roughness={0.12}
          depthWrite={false}
        />
      </mesh>
      <mesh position={[0, 0, 0.026]}>
        <torusGeometry args={[0.084, 0.002, 8, 64]} />
        <meshStandardMaterial
          color="#b9bec4"
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>
      {[-1, 1].map((d) => (
        <mesh key={d} position={[0, d * 0.077, 0.029]}>
          <sphereGeometry args={[0.004, 10, 8]} />
          <meshStandardMaterial
            color="#bfc3c5"
            metalness={0.8}
            roughness={0.25}
          />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.045]}>
        <torusGeometry args={[0.022, 0.0015, 6, 36, Math.PI * 1.45]} />
        <meshBasicMaterial color="#eee9da" />
      </mesh>
      <mesh position={[0, 0, 0.028]}>
        <planeGeometry args={[0.22, 0.22]} />
        <meshBasicMaterial
          map={ringLabel}
          transparent
          toneMapped={false}
          depthWrite={false}
        />
      </mesh>
      <PrintedDecal
        kind="emergency"
        position={[0, -0.155, 0.004]}
        width={0.18}
        height={0.09}
      />
    </group>
  );
}

/** Dual-gun DC fast-charger cabinet modelled on the PEVC3107E catalog photo: light grey door with a vertical handle, narrow black fascia with the A/B window, screen and instruction icons, louvred flanks, holstered guns, a guarded emergency stop on the right side above the holster. */
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
    s.lineTo(hw, FASCIA_BOTTOM_Y - 0.04);
    s.lineTo(-hw, FASCIA_BOTTOM_Y + 0.04);
    s.closePath();
    return s;
  }, []);
  const stripeShape = useMemo(() => {
    const hw = FASCIA_W / 2;
    const s = new THREE.Shape();
    s.moveTo(-hw, FASCIA_BOTTOM_Y + 0.04);
    s.lineTo(hw, FASCIA_BOTTOM_Y - 0.04);
    s.lineTo(hw, FASCIA_BOTTOM_Y - 0.055);
    s.lineTo(-hw, FASCIA_BOTTOM_Y + 0.025);
    s.closePath();
    return s;
  }, []);

  const src = `/instances/${instanceId}?embed=1`;

  return (
    <group>
      {/* recessed plinth */}
      <RoundedBox
        args={[STATION_W + 0.01, 0.16, STATION_D + 0.01]}
        radius={0.01}
        position={[0, 0.08, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#565c65" roughness={0.7} />
      </RoundedBox>
      {/* cabinet: light grey-blue painted steel */}
      <RoundedBox
        args={[STATION_W, STATION_H - 0.14, STATION_D]}
        radius={0.012}
        smoothness={4}
        position={[0, 0.14 + (STATION_H - 0.14) / 2, 0]}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color="#e1e2df"
          roughness={0.65}
          metalness={0.15}
          clearcoat={0.3}
          clearcoatRoughness={0.4}
        />
      </RoundedBox>
      {/* black fascia with slanted lower edge + blue accent */}
      <mesh position={[FASCIA_X, 0, FRONT_Z]}>
        <extrudeGeometry
          args={[fasciaShape, { depth: 0.012, bevelEnabled: false }]}
        />
        <meshPhysicalMaterial
          color="#07090d"
          metalness={0.4}
          roughness={0.12}
          clearcoat={1}
        />
      </mesh>
      <mesh position={[FASCIA_X, 0, FRONT_Z + 0.0125]}>
        <shapeGeometry args={[stripeShape]} />
        <meshStandardMaterial
          color="#1d6fd6"
          emissive="#1d6fd6"
          emissiveIntensity={0.6}
        />
      </mesh>
      <AbDisplay plugs={plugs} y={1.745} />
      {/* monitor bezel + live screen */}
      <RoundedBox
        args={[SCREEN_W + 0.02, SCREEN_H + 0.02, 0.01]}
        radius={0.006}
        position={[FASCIA_X, SCREEN_Y, FRONT_Z + 0.017]}
      >
        <meshStandardMaterial color="#030405" roughness={0.3} metalness={0.4} />
      </RoundedBox>
      <group ref={screenGroup} position={[FASCIA_X, SCREEN_Y, FRONT_Z + 0.023]}>
        <Html
          ref={screenHtml}
          transform
          portal={portal}
          distanceFactor={DISTANCE_FACTOR}
          scale={HTML_SCALE}
          zIndexRange={[10, 0]}
          style={{ width: IFRAME_W, height: IFRAME_H, pointerEvents: "auto" }}
        >
          <iframe
            title="Charger screen"
            src={src}
            width={IFRAME_W}
            height={IFRAME_H}
            style={{
              border: 0,
              display: "block",
              background: "#f4f6f8",
              borderRadius: 6,
            }}
          />
        </Html>
        {/* faint glass sheen over the screen */}
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[SCREEN_W, SCREEN_H]} />
          <meshPhysicalMaterial
            transparent
            opacity={screenFocus ? 0 : 0.06}
            color="#ffffff"
            roughness={0}
            clearcoat={1}
            depthWrite={false}
          />
        </mesh>
      </group>
      <PrintedDecal
        kind="steps"
        position={[FASCIA_X, 1.275, FRONT_Z + 0.014]}
        width={0.35}
        height={0.044}
      />
      <PrintedDecal
        kind="instructions"
        position={[
          FASCIA_X,
          (1.235 + FASCIA_BOTTOM_Y + 0.06) / 2,
          FRONT_Z + 0.014,
        ]}
        width={0.35}
        height={1.235 - FASCIA_BOTTOM_Y - 0.06}
      />
      {/* Front service door: recessed handle and ID plate, clear of the black fascia. */}
      <RoundedBox
        args={[0.056, 0.22, 0.006]}
        radius={0.006}
        position={[-0.19, 1.64, FRONT_Z + 0.004]}
      >
        <meshStandardMaterial color="#d3d5d3" roughness={0.65} />
      </RoundedBox>
      <RoundedBox
        args={[0.012, 0.075, 0.012]}
        radius={0.005}
        position={[-0.19, 1.64, FRONT_Z + 0.011]}
      >
        <meshStandardMaterial color="#42464a" roughness={0.45} />
      </RoundedBox>
      <mesh position={[-0.22, 0.99, FRONT_Z + 0.002]}>
        <planeGeometry args={[0.19, 0.065]} />
        <meshStandardMaterial color="#c5c9c8" roughness={0.6} />
      </mesh>
      {/* Full-height dark side door and horizontal louvres. Forward strip carries
          the emergency switch and instructions; the door latch is beside the vent. */}
      {[-1, 1].map((sd) => (
        <group
          key={sd}
          position={[sd * (STATION_W / 2 + 0.003), 0, 0]}
          rotation={[0, (sd * Math.PI) / 2, 0]}
        >
          <mesh position={[0, 1.02, 0]}>
            <planeGeometry args={[0.56, 1.72]} />
            <meshStandardMaterial color="#777b86" roughness={0.7} />
          </mesh>
          <mesh position={[sd * 0.09, 1.01, 0.002]}>
            <planeGeometry args={[0.34, 1.57]} />
            <meshStandardMaterial color="#16191d" roughness={0.8} />
          </mesh>
          {Array.from({ length: 35 }, (_, i) => (
            <mesh
              key={i}
              position={[sd * 0.09, 0.25 + i * 0.044, 0.007]}
              rotation={[0.24, 0, 0]}
              castShadow
            >
              <boxGeometry args={[0.34, 0.025, 0.014]} />
              <meshStandardMaterial
                color="#44474e"
                roughness={0.65}
                metalness={0.15}
              />
            </mesh>
          ))}
          <RoundedBox
            args={[0.029, 0.25, 0.022]}
            radius={0.005}
            position={[-sd * 0.1, 0.98, 0.012]}
          >
            <meshStandardMaterial color="#14171a" roughness={0.45} />
          </RoundedBox>
          <mesh position={[-sd * 0.1, 0.98, 0.026]}>
            <circleGeometry args={[0.008, 16]} />
            <meshStandardMaterial
              color="#c0b38b"
              metalness={0.65}
              roughness={0.3}
            />
          </mesh>
        </group>
      ))}
      <PrintedDecal
        kind="sideGuide"
        position={[STATION_W / 2 + 0.006, 1.746, 0.2]}
        rotation={[0, Math.PI / 2, 0]}
        width={0.14}
        height={0.328}
      />
      <EmergencyStop />
      {/* holster pods + cables */}
      {[0, 1].map((i) => {
        const h = holsterPos(i);
        const sd = Math.sign(h.x);
        return (
          <group key={i}>
            <group
              position={[sd * (STATION_W / 2 + 0.04), h.y, 0.18]}
              rotation={[0, (sd * Math.PI) / 2, 0]}
            >
              <RoundedBox args={[0.18, 0.28, 0.045]} radius={0.018} castShadow>
                <meshStandardMaterial color="#757983" roughness={0.7} />
              </RoundedBox>
              <RoundedBox
                args={[0.13, 0.18, 0.055]}
                radius={0.022}
                position={[0, -0.04, 0.025]}
              >
                <meshStandardMaterial color="#22252a" roughness={0.7} />
              </RoundedBox>
              <PrintedDecal
                kind="holster"
                position={[0, 0.09, 0.025]}
                width={0.16}
                height={0.063}
              />
              <PrintedDecal
                kind={i === 0 ? "badgeA" : "badgeB"}
                position={[0, -0.23, 0.026]}
                width={0.09}
                height={0.09}
              />
            </group>
            <Cable
              index={i}
              parkX={parkXs[i]}
              connected={!!plugs[i]?.evConnected}
              charging={!!plugs[i]?.charging}
            />
          </group>
        );
      })}
    </group>
  );
}
