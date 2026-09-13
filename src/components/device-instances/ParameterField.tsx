"use client";

import type { DeviceInstanceParameterView, DeviceModelParameterSchema } from "@/lib/device-instances/types";

export type FieldSchema = DeviceInstanceParameterView | DeviceModelParameterSchema;

interface ParameterFieldProps {
  schema: FieldSchema;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

const inputClassName =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

export function ParameterField({ schema, value, error, onChange }: ParameterFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {schema.label}
        {schema.unit ? <span className="text-zinc-400"> ({schema.unit})</span> : null}
      </label>
      {renderParameterControl(schema, value, onChange, inputClassName)}
      {schema.description ? <p className="text-xs text-zinc-500">{schema.description}</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

/** Renders just the input/select control for a parameter's value, reusable outside the label/description layout above. */
export function renderParameterControl(
  schema: FieldSchema,
  value: string,
  onChange: (value: string) => void,
  className: string,
) {
  switch (schema.valueType) {
    case "BOOLEAN":
      return (
        <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(unset)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );

    case "ENUM":
      return (
        <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">(unset)</option>
          {schema.enumOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );

    case "INTEGER":
    case "FLOAT":
      return (
        <input
          type="number"
          step={schema.valueType === "FLOAT" ? "any" : "1"}
          min={schema.minValue ?? undefined}
          max={schema.maxValue ?? undefined}
          className={className}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return <input type="text" className={className} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
