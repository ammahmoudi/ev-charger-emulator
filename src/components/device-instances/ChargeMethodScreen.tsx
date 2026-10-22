"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ComputerGlyph, DeviceHeaderChrome, LCD_FONT } from "./DeviceHeaderChrome";

/** Charging-method selection, from screenshots/09-charge-method-fa.png. */
export function ChargeMethodScreen({ instanceId, serialNumber, price, currency, expiresAt, onCard, onVehicleId, onClose }: {
  instanceId: string;
  serialNumber: string;
  price: number;
  currency: string;
  expiresAt: number;
  onCard: () => void;
  onVehicleId: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const seconds = Math.max(0, Math.ceil((expiresAt - now.getTime()) / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (seconds === 0) onClose();
  }, [seconds, onClose]);
  const time = now.toLocaleTimeString("en-GB", { hour12: false });
  const optionClass = "flex min-w-0 flex-1 flex-col items-center justify-end gap-[34px] rounded-[14px] pb-[30px] text-[#555] focus-visible:outline-4 focus-visible:outline-[#0077ce] hover:bg-[#edf5fb]";
  return <>
    <DeviceHeaderChrome instanceId={instanceId} homeTitle="Back to device" onHomeClick={onClose} right={<ComputerGlyph />}>
      <span className="flex min-w-0 items-center gap-2">
        <span lang="fa" dir="rtl" className="whitespace-nowrap text-[24px]">شماره سریال</span>
        <bdi className="truncate text-[32px] tabular-nums text-[#3e6484]" style={{ fontFamily: LCD_FONT }}>{serialNumber}</bdi>
      </span>
      <span className="ml-auto text-[36px] tabular-nums text-[#3e6484]" style={{ fontFamily: LCD_FONT }}>{time}</span>
    </DeviceHeaderChrome>
    <div className="flex min-h-0 flex-1 flex-col bg-[#e9eef4] px-[14px] pt-[12px]">
      <section aria-label="Choose charging method" className="relative flex min-h-0 flex-1 rounded-[18px] bg-[#f8fafb] px-[24px] pb-[10px] pt-[68px] shadow-[inset_0_1px_4px_#d5dee4]">
        <span aria-label="Selection time remaining" role="timer" className="absolute right-[30px] top-[12px] text-[40px] tabular-nums text-[#586d78]" style={{ fontFamily: LCD_FONT }}>{seconds}</span>
        <button type="button" aria-label="Charging card" onClick={onCard} className={optionClass}>
          <svg aria-hidden="true" viewBox="0 0 180 140" className="mb-auto mt-auto h-[154px] w-[190px] text-[#0077ce]" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M30 10a80 80 0 0 0 0 120M150 10a80 80 0 0 1 0 120M52 30a52 52 0 0 0 0 80M128 30a52 52 0 0 1 0 80M74 50a25 25 0 0 0 0 40M106 50a25 25 0 0 1 0 40" />
          </svg>
          <span lang="fa" dir="rtl" className="text-[32px] leading-[1.7]">کارت شارژ</span>
        </button>
        <Link aria-label="Scan QR code" href={`/instances/${instanceId}/qr`} className={optionClass}>
          <svg aria-hidden="true" viewBox="0 0 120 120" className="mb-auto mt-auto h-[132px] w-[132px] text-[#0077ce]" fill="none" stroke="currentColor" strokeWidth="5">
            <path d="M6 35V6h29M85 6h29v29M114 85v29H85M35 114H6V85" />
            <path d="M22 22h27v27H22zM71 22h27v27H71zM22 71h27v27H22zM71 71h11v11H71zM98 71v27H71M57 22v40H22M57 85v13M57 57h41M85 85h13" />
          </svg>
          <span lang="fa" dir="rtl" className="text-[32px] leading-[1.7]">اسکن کد <bdi>QR</bdi></span>
        </Link>
        <button type="button" aria-label="Autocharge with EV ID" onClick={onVehicleId} className={optionClass}>
          <svg aria-hidden="true" viewBox="0 0 180 140" className="mb-auto mt-auto h-[154px] w-[190px] text-[#0077ce]" fill="none" stroke="currentColor" strokeWidth="6">
            <path d="M20 50V20h140v30M20 90v30h140V90" strokeLinejoin="round" />
            <text x="90" y="85" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="35">EV ID</text>
          </svg>
          <span lang="fa" dir="rtl" className="rounded-full bg-[linear-gradient(#08b7ff,#0070ce)] px-[24px] text-[32px] leading-[1.7] text-white shadow-[0_5px_0_3px_#b5c0c8,inset_0_-4px_4px_#005caf]">شارژ خودکار</span>
        </button>
      </section>
      <footer className="flex h-[66px] flex-none items-center justify-center gap-[32px] text-[27px] text-[#7b8791]">
        <bdi>{currency}/<span lang="fa" dir="rtl">کیلووات‌ساعت</span></bdi>
        <span className="text-[36px] tabular-nums" style={{ fontFamily: LCD_FONT }}>{price.toFixed(4)}</span>
        <span lang="fa" dir="rtl">هزینه شارژ به ازای هر</span>
      </footer>
    </div>
  </>;
}
