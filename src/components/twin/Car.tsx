"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export interface CarProps {
  /** Paint colour. */
  color: string;
  /** World x the car parks at. */
  parkX: number;
  /** +1 faces +x (parks left of the station, nose toward it), -1 faces -x. */
  facing: 1 | -1;
  present: boolean;
  charging: boolean;
  soc: number;
  onClick?: () => void;
}

/** Half of the body width: the flank plane every cable/gun must stay outside of. */
export const CAR_HALF_W = 0.95;
/** Overall half-length incl. bumpers; nothing of the car goes beyond this from its centre. */
export const CAR_HALF_L = 2.26;
/** Charge port on the front fender, in the car's own space (+x = nose). */
export const CAR_PORT = { x: 1.2, y: 1.0 } as const;

const WHEEL_R = 0.37;
const WHEEL_X = [1.44, -1.51];
const S = 0.0035;
/** Tracing helper: pixel coords of a side-on VW ID.4 reference photo (nose to the right) -> car space. */
const P = (px: number, py: number): [number, number] => [(px - 643) * S, (485 - py) * S];

/**
 * Side silhouette traced from a Volkswagen ID.4 side-on photo: short nose, long raked roofline that
 * peaks over the front seats and drops to a small roof spoiler. The underside is flat between the arches.
 */
const TOP: [number, number][] = [
  [40, 402], [24, 350], [22, 262], [30, 192], [54, 150], [112, 100], [182, 66], [262, 42], [450, 26], [640, 26],
  [760, 62], [880, 118], [1000, 138], [1120, 160], [1200, 190], [1250, 225], [1264, 300], [1262, 380], [1240, 408],
];

function bodyProfile() {
  const pts = new THREE.SplineCurve(TOP.map(([x, y]) => new THREE.Vector2(...P(x, y)))).getPoints(160);
  const s = new THREE.Shape(pts);
  s.closePath();
  return s;
}

function glassShape(poly: [number, number][]) {
  return new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(...P(x, y))));
}

const WINDOWS: [number, number][][] = [
  [[196, 126], [282, 70], [336, 58], [338, 142], [262, 138]],
  [[346, 58], [520, 48], [528, 150], [346, 146]],
  [[548, 46], [700, 56], [850, 106], [880, 128], [792, 146], [548, 150]],
];

function Wheel({ x, z, spin }: { x: number; z: number; spin: React.RefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.z = -(spin.current ?? 0) / WHEEL_R;
  });
  const out = Math.sign(z);
  return (
    <group position={[x, WHEEL_R, z]}>
      <group ref={ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[WHEEL_R, WHEEL_R, 0.24, 40]} />
          <meshStandardMaterial color="#111214" roughness={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, out * 0.121]}>
          <cylinderGeometry args={[0.27, 0.27, 0.014, 40]} />
          <meshStandardMaterial color="#c9ced6" metalness={1} roughness={0.22} />
        </mesh>
        {/* aero-turbine spokes, in the ID.4's style */}
        {Array.from({ length: 10 }).map((_, i) => (
          <mesh key={i} position={[0, 0, out * 0.131]} rotation={[0, 0, (i / 10) * Math.PI * 2]}>
            <boxGeometry args={[0.035, 0.5, 0.008]} />
            <meshStandardMaterial color={i % 2 ? "#2b2e34" : "#9aa1ab"} metalness={1} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 0, out * 0.14]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.01, 20]} />
          <meshStandardMaterial color="#1d4ed8" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * A procedural EV crossover shaped from a VW ID.4 side photo. Faces +x locally; the charge port is on the
 * front fender on the flank the camera sees (the whole car is turned around for the right-hand bay, so
 * the port side flips with `facing`). Drives in from off-screen when `present`.
 */
export function Car({ color, parkX, facing, present, charging, soc, onClick }: CarProps) {
  const group = useRef<THREE.Group>(null);
  const portRing = useRef<THREE.MeshStandardMaterial>(null);
  const underglow = useRef<THREE.PointLight>(null);
  const travel = useRef(present ? 0 : 1); // 1 = off-screen, 0 = parked
  const spin = useRef(0);

  const bodyGeo = useMemo(() => {
    const depth = CAR_HALF_W * 2 - 0.2;
    const g = new THREE.ExtrudeGeometry(bodyProfile(), { depth, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 6, curveSegments: 24 });
    g.translate(0, 0, -depth / 2);
    return g;
  }, []);
  const glassGeos = useMemo(() => WINDOWS.map((w) => new THREE.ShapeGeometry(glassShape(w))), []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const target = present ? 0 : 1;
    const prev = travel.current;
    // Ease toward the target; fast at first, settling softly (like braking into a bay).
    travel.current += (target - prev) * Math.min(1, dt * 1.6);
    if (Math.abs(travel.current - target) < 0.0005) travel.current = target;
    const dx = (travel.current - prev) * 11;
    spin.current += -dx;
    g.position.x = parkX + facing * -1 * travel.current * 11;
    g.visible = travel.current < 0.995;
    g.position.y = charging ? Math.sin(state.clock.elapsedTime * 2) * 0.004 : 0;
    const t = state.clock.elapsedTime;
    if (portRing.current) {
      const k = charging ? 0.55 + 0.45 * Math.sin(t * 4) : present ? 0.25 : 0;
      portRing.current.emissiveIntensity = 1.5 * k;
      portRing.current.color.set(charging ? "#22c55e" : "#38bdf8");
      portRing.current.emissive.set(charging ? "#22c55e" : "#38bdf8");
    }
    if (underglow.current) underglow.current.intensity = charging ? 2.2 + Math.sin(t * 3) * 0.6 : 0;
  });

  // The car group is turned half a revolution for facing = -1, which also flips local z, so the port's
  // local side flips with it and always ends up on the world +z flank (toward the camera and the station's cables).
  const side = facing;
  const paint = <meshPhysicalMaterial color={color} metalness={0.7} roughness={0.3} clearcoat={1} clearcoatRoughness={0.06} />;
  const glass = { color: "#0f1a2b", metalness: 0.4, roughness: 0.05, clearcoat: 1, envMapIntensity: 2.4 } as const;
  const [wx, wy] = P(765, 73);
  const flank = CAR_HALF_W + 0.004;

  return (
    <group ref={group} position={[parkX, 0, 0]} rotation={[0, facing === 1 ? 0 : Math.PI, 0]} onClick={onClick}>
      {/* body shell */}
      <mesh geometry={bodyGeo} castShadow>
        {paint}
      </mesh>
      {/* side glass, both flanks */}
      {glassGeos.map((geo, i) =>
        [1, -1].map((s) => (
          <mesh key={`${i}${s}`} geometry={geo} position={[0, 0, s * flank]}>
            <meshPhysicalMaterial {...glass} side={THREE.DoubleSide} />
          </mesh>
        )),
      )}
      {/* windscreen + rear glass */}
      <mesh position={[wx + 0.003, wy + 0.007, 0]} rotation={[0, 0, -Math.atan2(90, 230)]}>
        <boxGeometry args={[0.86, 0.008, 1.5]} />
        <meshPhysicalMaterial {...glass} />
      </mesh>
      <mesh position={[...P(92, 106), 0]} rotation={[0, 0, Math.atan2(68, 70)]}>
        <boxGeometry args={[0.34, 0.008, 1.4]} />
        <meshPhysicalMaterial {...glass} />
      </mesh>
      {/* black lower cladding + sills */}
      <mesh position={[0, 0.34, 0]}>
        <boxGeometry args={[4.3, 0.14, CAR_HALF_W * 2 + 0.006]} />
        <meshStandardMaterial color="#15171b" roughness={0.7} />
      </mesh>
      {/* wheel arches + wheels (arch discs sit on the flank plane; the wheels stay inside the flank) */}
      {WHEEL_X.map((x) =>
        [1, -1].map((s) => (
          <mesh key={`${x}${s}`} position={[x, WHEEL_R, s * (flank + 0.002)]} rotation={[0, s === 1 ? 0 : Math.PI, 0]}>
            <circleGeometry args={[0.46, 40]} />
            <meshBasicMaterial color="#050506" />
          </mesh>
        )),
      )}
      {WHEEL_X.map((x) => [0.85, -0.85].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} spin={spin} />))}
      {/* the small cues that make the shell read as a car: shut lines, door handles, mirrors, roof line, plates, lights */}
      {[1, -1].map((s) => (
        <group key={`d${s}`}>
          {[-0.1, 0.62].map((x) => (
            <mesh key={x} position={[x, 0.78, s * flank]}>
              <boxGeometry args={[0.012, 0.62, 0.004]} />
              <meshBasicMaterial color="#0a0c10" />
            </mesh>
          ))}
          {[-0.62, 0.15].map((x) => (
            <mesh key={x} position={[x, 0.98, s * (flank + 0.006)]}>
              <boxGeometry args={[0.16, 0.022, 0.012]} />
              <meshStandardMaterial color="#cbd5e1" metalness={1} roughness={0.2} />
            </mesh>
          ))}
          <mesh position={[0.55, 1.25, s * (flank + 0.07)]}>
            <boxGeometry args={[0.15, 0.09, 0.12]} />
            <meshPhysicalMaterial color={color} metalness={0.7} roughness={0.3} clearcoat={1} />
          </mesh>
        </group>
      ))}
      {/* front + rear fascia */}
      <mesh position={[2.255, 0.78, 0]}>
        <boxGeometry args={[0.02, 0.05, 1.3]} />
        <meshStandardMaterial color="#f8fafc" emissive="#dbeafe" emissiveIntensity={present ? 2.4 : 0.2} />
      </mesh>
      <mesh position={[-2.17, 0.95, 0]}>
        <boxGeometry args={[0.03, 0.05, 1.5]} />
        <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={present ? 1.6 : 0.1} />
      </mesh>
      <mesh position={[2.262, 0.52, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[0.36, 0.1]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
      </mesh>
      {/* charge port: dark socket + glowing ring on the front fender, flush with the flank */}
      <group position={[CAR_PORT.x, CAR_PORT.y, side * (flank + 0.004)]} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
        <mesh>
          <circleGeometry args={[0.09, 32]} />
          <meshStandardMaterial color="#0a0a0c" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, 0.001]}>
          <ringGeometry args={[0.092, 0.115, 40]} />
          <meshStandardMaterial ref={portRing} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0} />
        </mesh>
      </group>
      <pointLight ref={underglow} position={[0, 0.15, 0]} color="#22c55e" distance={4} intensity={0} />
      {/* invisible, generous click target — the car is the plug/unplug control */}
      <mesh position={[0, 0.8, 0]} visible={false}>
        <boxGeometry args={[4.6, 1.6, 1.9]} />
        <meshBasicMaterial />
      </mesh>
      <mesh visible={false} userData={{ soc }} />
    </group>
  );
}
