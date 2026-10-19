"use client";

import { CameraControls, ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { Car } from "./Car";
import { Station, SCREEN_Y } from "./Station";
import type { TwinPlug } from "./useTwinData";

export type CameraPreset = "overview" | "screen" | "plugA" | "plugB";

export const PARK_X: [number, number] = [-3.3, 3.3];
const CAR_COLORS = ["#2563eb", "#e2e8f0"];

/** [camera position, look-at target] */
const PRESETS: Record<CameraPreset, [[number, number, number], [number, number, number]]> = {
  overview: [[1.2, 2.0, 10.2], [0, 0.95, 0]],
  screen: [[0, SCREEN_Y, 1.02], [0, SCREEN_Y, 0.3]],
  plugA: [[-4.6, 1.5, 4.4], [-2.0, 0.85, 0.3]],
  plugB: [[4.6, 1.5, 4.4], [2.0, 0.85, 0.3]],
};

/** Parking bay outline: two side lines and a back stop, in a calm slate, on the shared asphalt. */
function BayMarks({ x }: { x: number }) {
  const outer = x < 0 ? -1 : 1;
  const line = "#475569";
  return (
    <group position={[x, 0.006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {[-1.12, 1.12].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <planeGeometry args={[4.9, 0.04]} />
          <meshBasicMaterial color={line} />
        </mesh>
      ))}
      <mesh position={[outer * 2.45, 0, 0]}>
        <planeGeometry args={[0.07, 2.28]} />
        <meshBasicMaterial color={line} />
      </mesh>
    </group>
  );
}

function CameraRig({ preset }: { preset: CameraPreset }) {
  const ref = useRef<CameraControls>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const [p, t] = PRESETS[preset];
    c.setLookAt(p[0], p[1], p[2], t[0], t[1], t[2], true);
  }, [preset]);
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={0.9}
      maxDistance={14}
      maxPolarAngle={Math.PI * 0.495}
      smoothTime={0.35}
      mouseButtons={{ left: 1, middle: 8, right: 2, wheel: 16 }}
    />
  );
}

export default function TwinScene({
  instanceId,
  plugs,
  preset,
  onToggleEv,
  portal,
  lowQuality = false,
}: {
  instanceId: string;
  portal: React.RefObject<HTMLElement>;
  plugs: TwinPlug[];
  preset: CameraPreset;
  onToggleEv: (connectorId: number, connected: boolean) => void;
  /** Cheaper rendering (no shadow maps, 1x pixel ratio) for weak/software GPUs and automated screenshots. */
  lowQuality?: boolean;
}) {
  return (
    <Canvas
      shadows={lowQuality ? false : "soft"}
      dpr={lowQuality ? 1 : [1, 2]}
      camera={{ fov: 38, near: 0.05, far: 60, position: PRESETS.overview[0] }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#0b1018");
        scene.fog = new THREE.Fog("#0b1018", 11, 26);
      }}
    >
      {/* studio-style reflections built from light panels, no network HDRI */}
      <Environment resolution={lowQuality ? 64 : 256}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 4]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-6, 2, 2]} rotation-y={Math.PI / 2} scale={[6, 2.5, 1]} color="#93c5fd" />
        <Lightformer form="rect" intensity={1.4} position={[6, 2, 2]} rotation-y={-Math.PI / 2} scale={[6, 2.5, 1]} color="#fde68a" />
        <Lightformer form="ring" intensity={1.2} position={[0, 3, -6]} scale={5} color="#38bdf8" />
      </Environment>
      <ambientLight intensity={0.25} />
      <directionalLight
        castShadow
        position={[3.5, 7, 6]}
        intensity={1.9}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0004}
      />
      <spotLight position={[0, 6, 1.5]} angle={0.5} penumbra={1} intensity={60} color="#bfdbfe" distance={14} />

      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[30, 64]} />
        <meshStandardMaterial color="#0f141c" roughness={0.85} metalness={0.1} />
      </mesh>
      <BayMarks x={PARK_X[0]} />
      <BayMarks x={PARK_X[1]} />
      <ContactShadows position={[0, 0.006, 0]} opacity={0.65} scale={18} blur={2.4} far={3} resolution={lowQuality ? 256 : 1024} color="#000" frames={lowQuality ? 1 : Infinity} />

      <Station instanceId={instanceId} plugs={plugs} parkXs={PARK_X} screenFocus={preset === "screen"} portal={portal} />
      {[0, 1].map((i) => (
        <Car
          key={i}
          color={CAR_COLORS[i]}
          parkX={PARK_X[i]}
          facing={i === 0 ? 1 : -1}
          present={!!plugs[i]?.evConnected}
          charging={!!plugs[i]?.charging}
          soc={plugs[i]?.soc ?? 0}
          onClick={plugs[i] ? () => onToggleEv(plugs[i].connectorId, false) : undefined}
        />
      ))}
      <CameraRig preset={preset} />
    </Canvas>
  );
}
