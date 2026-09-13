import { describe, expect, it } from "vitest";

import {
  buildDefaultParameterValues,
  ParameterValidationError,
  validateParameterValue,
  type ParameterSchema,
} from "../parameters";

function schema(overrides: Partial<ParameterSchema>): ParameterSchema {
  return {
    id: "param-1",
    key: "someKey",
    label: "Some field",
    valueType: "STRING",
    enumOptions: [],
    minValue: null,
    maxValue: null,
    defaultValue: null,
    ...overrides,
  };
}

describe("validateParameterValue", () => {
  it("passes through STRING values unchanged", () => {
    expect(validateParameterValue(schema({ valueType: "STRING" }), "hello")).toBe("hello");
  });

  it("returns null for empty/null/undefined input", () => {
    const s = schema({ valueType: "INTEGER" });
    expect(validateParameterValue(s, null)).toBeNull();
    expect(validateParameterValue(s, undefined)).toBeNull();
    expect(validateParameterValue(s, "")).toBeNull();
  });

  it("accepts and normalizes valid INTEGER values", () => {
    expect(validateParameterValue(schema({ valueType: "INTEGER" }), "42")).toBe("42");
    expect(validateParameterValue(schema({ valueType: "INTEGER" }), "-3")).toBe("-3");
  });

  it("rejects non-integer values for INTEGER", () => {
    expect(() => validateParameterValue(schema({ valueType: "INTEGER" }), "4.5")).toThrow(
      ParameterValidationError,
    );
    expect(() => validateParameterValue(schema({ valueType: "INTEGER" }), "abc")).toThrow(
      ParameterValidationError,
    );
  });

  it("accepts valid FLOAT values", () => {
    expect(validateParameterValue(schema({ valueType: "FLOAT" }), "3.14")).toBe("3.14");
  });

  it("rejects non-numeric FLOAT values", () => {
    expect(() => validateParameterValue(schema({ valueType: "FLOAT" }), "not-a-number")).toThrow(
      ParameterValidationError,
    );
  });

  it("enforces min/max range for numeric types", () => {
    const s = schema({ valueType: "FLOAT", minValue: 0, maxValue: 100 });
    expect(validateParameterValue(s, "50")).toBe("50");
    expect(() => validateParameterValue(s, "-1")).toThrow(ParameterValidationError);
    expect(() => validateParameterValue(s, "101")).toThrow(ParameterValidationError);
  });

  it("accepts only 'true'/'false' for BOOLEAN", () => {
    const s = schema({ valueType: "BOOLEAN" });
    expect(validateParameterValue(s, "true")).toBe("true");
    expect(validateParameterValue(s, "false")).toBe("false");
    expect(() => validateParameterValue(s, "yes")).toThrow(ParameterValidationError);
  });

  it("accepts only listed options for ENUM", () => {
    const s = schema({ valueType: "ENUM", enumOptions: ["A", "B"] });
    expect(validateParameterValue(s, "A")).toBe("A");
    expect(() => validateParameterValue(s, "C")).toThrow(ParameterValidationError);
  });

  it("throws ParameterValidationError carrying the offending key", () => {
    try {
      validateParameterValue(schema({ key: "voltage", valueType: "BOOLEAN" }), "nope");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ParameterValidationError);
      expect((err as ParameterValidationError).key).toBe("voltage");
    }
  });
});

describe("buildDefaultParameterValues", () => {
  it("seeds a value per schema, keyed by parameter id, using each parameter's defaultValue", () => {
    const schemas: ParameterSchema[] = [
      schema({ id: "p1", key: "a", valueType: "STRING", defaultValue: "hi" }),
      schema({ id: "p2", key: "b", valueType: "INTEGER", defaultValue: "10" }),
      schema({ id: "p3", key: "c", valueType: "STRING", defaultValue: null }),
    ];

    const values = buildDefaultParameterValues(schemas);

    expect(values.get("p1")).toBe("hi");
    expect(values.get("p2")).toBe("10");
    expect(values.get("p3")).toBeNull();
    expect(values.size).toBe(3);
  });
});
