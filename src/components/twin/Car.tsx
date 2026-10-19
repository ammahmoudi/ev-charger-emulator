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

const BODY_DEPTH = 1.78;

function bodyProfile() {
  const s = new THREE.Shape();
  s.moveTo(-2.2, 0.3);
  s.lineTo(-2.26, 0.72);
  s.quadraticCurveTo(-2.22, 0.93, -1.9, 0.97);
  s.lineTo(-0.9, 1.0);
  s.lineTo(1.05, 0.98);
  s.quadraticCurveTo(1.85, 0.94, 2.17, 0.78);
  s.quadraticCurveTo(2.3, 0.6, 2.24, 0.3);
  s.closePath();
  return s;
}

function cabinProfile() {
  const s = new THREE.Shape();
  s.moveTo(-1.7, 0.97);
  s.bezierCurveTo(-1.35, 1.3, -1.0, 1.46, -0.45, 1.48);
  s.lineTo(0.3, 1.46);
  s.bezierCurveTo(0.75, 1.4, 1.1, 1.15, 1.42, 0.97);
  s.closePath();
  return s;
}

function Wheel({ x, z, spin }: { x: number; z: number; spin: React.RefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(() => {
    if (ref.current) ref.current.rotation.z = -(spin.current ?? 0) / 0.36;
  });
  return (
    <group position={[x, 0.36, z]}>
      <group ref={ref}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.36, 0.36, 0.26, 40]} />
          <meshStandardMaterial color="#111214" roughness={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, Math.sign(z) * 0.131]}>
          <cylinderGeometry args={[0.245, 0.245, 0.02, 40]} />
          <meshStandardMaterial color="#c9ced6" metalness={1} roughness={0.22} />
        </mesh>
        {Array.from({ length: 5 }).map((_, i) => (
          <mesh key={i} position={[0, 0, Math.sign(z) * 0.145]} rotation={[0, 0, (i / 5) * Math.PI * 2]}>
            <boxGeometry args={[0.04, 0.46, 0.012]} />
            <meshStandardMaterial color="#9aa1ab" metalness={1} roughness={0.3} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * A procedural EV (fastback crossover) built from an extruded side profile. Faces +x locally; the
 * charge port is on the front-right fender (+z side), which `facing` mirrors for the right-hand bay
 * so the port always ends up on the flank the camera sees. Drives in from off-screen when `present`.
 */
export function Car({ color, parkX, facing, present, charging, soc, onClick }: CarProps) {
  const group = useRef<THREE.Group>(null);
  const portRing = useRef<THREE.MeshStandardMaterial>(null);
  const underglow = useRef<THREE.PointLight>(null);
  const travel = useRef(present ? 0 : 1); // 1 = off-screen, 0 = parked
  const spin = useRef(0);

  const bodyGeo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(bodyProfile(), { depth: BODY_DEPTH - 0.24, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 6, curveSegments: 24 });
    g.translate(0, 0, -(BODY_DEPTH - 0.24) / 2);
    return g;
  }, []);
  const cabinGeo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(cabinProfile(), { depth: BODY_DEPTH - 0.58, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 5, curveSegments: 24 });
    g.translate(0, 0, -(BODY_DEPTH - 0.58) / 2);
    return g;
  }, []);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const target = present ? 0 : 1;
    const prev = travel.current;
    // Ease toward the target; fast at first, settling softly (like braking into a bay).
    travel.current += (target - prev) * Math.min(1, dt * 1.6);
    if (Math.abs(travel.current - target) < 0.0005) travel.current = target;
    const dx = (travel.current - prev) * 11;
    spin.current += -dx; // travel shrinks while driving in, i.e. forward along the car's own +x
    g.position.x = parkX + facing * -1 * travel.current * 11;
    g.visible = travel.current < 0.995;
    // gentle suspension bob while charging
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

  const side = 1; // port on +z in local space; the whole car group is flipped for facing = -1
  return (
    <group ref={group} position={[parkX, 0, 0]} rotation={[0, facing === 1 ? 0 : Math.PI, 0]} onClick={onClick}>
      <group scale={[1, 1, 1]}>
        {/* body shell */}
        <mesh geometry={bodyGeo} castShadow>
          <meshPhysicalMaterial color={color} metalness={0.75} roughness={0.28} clearcoat={1} clearcoatRoughness={0.06} />
        </mesh>
        {/* glasshouse */}
        <mesh geometry={cabinGeo} castShadow>
          <meshPhysicalMaterial color="#16263d" metalness={0.35} roughness={0.04} clearcoat={1} envMapIntensity={2.6} />
        </mesh>
        {/* roof panel, body-coloured, so the glass reads as windows not a bubble */}
        <mesh position={[-0.42, 1.505, 0]}>
          <boxGeometry args={[1.0, 0.035, BODY_DEPTH - 0.62]} />
          <meshPhysicalMaterial color={color} metalness={0.75} roughness={0.28} clearcoat={1} />
        </mesh>
        {/* lower skirt */}
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[4.3, 0.1, BODY_DEPTH - 0.1]} />
          <meshStandardMaterial color="#15171b" roughness={0.7} />
        </mesh>
        {/* wheel arches + wheels */}
        {[1.38, -1.4].map((x) =>
          [1, -1].map((s) => (
            <mesh key={`${x}${s}`} position={[x, 0.36, s * 0.893]} rotation={[0, 0, 0]}>
              <circleGeometry args={[0.43, 40]} />
              <meshBasicMaterial color="#050506" side={THREE.DoubleSide} />
            </mesh>
          )),
        )}
        {[1.38, -1.4].map((x) => [0.78, -0.78].map((z) => <Wheel key={`${x}${z}`} x={x} z={z} spin={spin} />))}
        {/* shut lines, mirrors, belt chrome, bumpers, plates — the small cues that make the shell read as a car */}
        {[1, -1].map((side) => (
          <group key={`d${side}`}>
            {[-0.45, 0.55].map((x) => (
              <mesh key={x} position={[x, 0.7, side * 0.9]}>
                <boxGeometry args={[0.012, 0.52, 0.004]} />
                <meshBasicMaterial color="#0a0c10" />
              </mesh>
            ))}
            <mesh position={[0.25, 0.64, side * 0.91]}>
              <boxGeometry args={[0.16, 0.02, 0.008]} />
              <meshStandardMaterial color="#cbd5e1" metalness={1} roughness={0.2} />
            </mesh>
            <mesh position={[0.62, 1.08, side * 0.99]}>
              <boxGeometry args={[0.16, 0.09, 0.1]} />
              <meshPhysicalMaterial color={color} metalness={0.75} roughness={0.28} clearcoat={1} />
            </mesh>
            <mesh position={[0, 0.97, side * 0.86]}>
              <boxGeometry args={[3.0, 0.014, 0.012]} />
              <meshStandardMaterial color="#d1d5db" metalness={1} roughness={0.15} />
            </mesh>
          </group>
        ))}
        <mesh position={[2.255, 0.42, 0]}>
          <boxGeometry args={[0.05, 0.2, BODY_DEPTH - 0.3]} />
          <meshStandardMaterial color="#14161a" roughness={0.6} />
        </mesh>
        <mesh position={[-2.28, 0.42, 0]}>
          <boxGeometry args={[0.05, 0.2, BODY_DEPTH - 0.3]} />
          <meshStandardMaterial color="#14161a" roughness={0.6} />
        </mesh>
        <mesh position={[2.285, 0.52, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.36, 0.1]} />
          <meshStandardMaterial color="#f1f5f9" roughness={0.5} />
        </mesh>
        {/* lights */}
        <mesh position={[2.27, 0.74, 0]}>
          <boxGeometry args={[0.02, 0.07, BODY_DEPTH - 0.45]} />
          <meshStandardMaterial color="#f8fafc" emissive="#dbeafe" emissiveIntensity={present ? 2.4 : 0.2} />
        </mesh>
        <mesh position={[-2.31, 0.78, 0]}>
          <boxGeometry args={[0.02, 0.06, BODY_DEPTH - 0.4]} />
          <meshStandardMaterial color="#7f1d1d" emissive="#ef4444" emissiveIntensity={present ? 1.6 : 0.1} />
        </mesh>
        {/* charge port: flap + glowing ring on the front fender */}
        <group position={[1.52, 0.88, side * (BODY_DEPTH / 2 + 0.012)]}>
          <mesh>
            <circleGeometry args={[0.09, 32]} />
            <meshStandardMaterial color="#0a0a0c" roughness={0.6} />
          </mesh>
          <mesh>
            <ringGeometry args={[0.092, 0.115, 40]} />
            <meshStandardMaterial ref={portRing} color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0} />
          </mesh>
        </group>
        <pointLight ref={underglow} position={[0, 0.15, 0]} color="#22c55e" distance={4} intensity={0} />
      </group>
      {/* invisible, generous click target — the car is the plug/unplug control */}
      <mesh position={[0, 0.75, 0]} visible={false}>
        <boxGeometry args={[4.6, 1.6, 1.9]} />
        <meshBasicMaterial />
      </mesh>
      <mesh visible={false} userData={{ soc }} />
    </group>
  );
}
