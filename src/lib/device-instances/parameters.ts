import type { ParameterValueType } from "@prisma/client";

/**
 * Shape of a DeviceModelParameter's schema fields — enough to validate/coerce and seed a
 * DeviceInstanceParameter value. Reused for both instance creation (seeding defaults) and
 * parameter edits (validating a new value against the model's schema).
 */
export interface ParameterSchema {
  id: string;
  key: string;
  label: string;
  valueType: ParameterValueType;
  enumOptions: string[];
  minValue: number | null;
  maxValue: number | null;
  defaultValue: string | null;
}

/** Raised when a parameter value fails validation against its model schema. */
export class ParameterValidationError extends Error {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = "ParameterValidationError";
  }
}

/**
 * Validates and normalizes a raw string value against a parameter's schema, returning the
 * value to store (still as text, per the DeviceModelParameter.defaultValue convention).
 * `null`/empty string clear the value (allowed — parameters have no "required" flag).
 */
export function validateParameterValue(schema: ParameterSchema, rawValue: string | null | undefined): string | null {
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return null;
  }

  switch (schema.valueType) {
    case "STRING":
      return rawValue;

    case "INTEGER": {
      if (!/^-?\d+$/.test(rawValue)) {
        throw new ParameterValidationError(schema.key, `"${schema.label}" must be an integer`);
      }
      const parsed = Number(rawValue);
      checkRange(schema, parsed);
      return String(parsed);
    }

    case "FLOAT": {
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed) || rawValue.trim() === "") {
        throw new ParameterValidationError(schema.key, `"${schema.label}" must be a number`);
      }
      checkRange(schema, parsed);
      return String(parsed);
    }

    case "BOOLEAN": {
      if (rawValue !== "true" && rawValue !== "false") {
        throw new ParameterValidationError(schema.key, `"${schema.label}" must be "true" or "false"`);
      }
      return rawValue;
    }

    case "ENUM": {
      if (!schema.enumOptions.includes(rawValue)) {
        throw new ParameterValidationError(
          schema.key,
          `"${schema.label}" must be one of: ${schema.enumOptions.join(", ")}`,
        );
      }
      return rawValue;
    }

    default:
      return rawValue;
  }
}

function checkRange(schema: ParameterSchema, value: number): void {
  if (schema.minValue !== null && value < schema.minValue) {
    throw new ParameterValidationError(schema.key, `"${schema.label}" must be >= ${schema.minValue}`);
  }
  if (schema.maxValue !== null && value > schema.maxValue) {
    throw new ParameterValidationError(schema.key, `"${schema.label}" must be <= ${schema.maxValue}`);
  }
}

/** Seeds initial parameter values for a new instance from the model's parameter defaults. */
export function buildDefaultParameterValues(schemas: ParameterSchema[]): Map<string, string | null> {
  const values = new Map<string, string | null>();
  for (const schema of schemas) {
    values.set(schema.id, validateParameterValue(schema, schema.defaultValue));
  }
  return values;
}
