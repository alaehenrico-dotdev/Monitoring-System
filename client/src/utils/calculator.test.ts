import { describe, expect, it } from "vitest";
import { evaluate, formatResult, plainResult, prettyExpression } from "./calculator";

const val = (s: string) => {
  const r = evaluate(s);
  if (!r.ok) throw new Error(`"${s}" failed: ${r.error}`);
  return r.value;
};
const err = (s: string) => {
  const r = evaluate(s);
  return r.ok ? null : r.error;
};

describe("evaluate", () => {
  it("does the four operations with the usual precedence", () => {
    expect(val("2+3*4")).toBe(14);
    expect(val("(2+3)*4")).toBe(20);
    expect(val("10-4-3")).toBe(3);
    expect(val("100/5/2")).toBe(10);
    expect(val("2*3+4*5")).toBe(26);
  });

  it("accepts the typed symbols and a keyboard's", () => {
    expect(val("6×7")).toBe(42);
    expect(val("6÷3")).toBe(2);
    expect(val("9−4")).toBe(5);
    expect(val("6x7")).toBe(42);
    expect(val("6*7")).toBe(42);
  });

  it("handles decimals and removes floating-point noise", () => {
    expect(val("0.1+0.2")).toBe(0.3);
    expect(val(".5+.5")).toBe(1);
    expect(val("1.1*3")).toBe(3.3);
    expect(val("1/3*3")).toBe(1);
  });

  it("takes a leading or stacked sign", () => {
    expect(val("-5+2")).toBe(-3);
    expect(val("5*-2")).toBe(-10);
    expect(val("--5")).toBe(5);
    expect(val("-(2+3)")).toBe(-5);
  });

  it("treats a percentage alone as /100 and a percentage after + or - as a share of the left side", () => {
    expect(val("50%")).toBe(0.5);
    expect(val("200*10%")).toBe(20);
    expect(val("200+10%")).toBe(220);
    expect(val("200-10%")).toBe(180);
    expect(val("(100+100)+50%")).toBe(300);
  });

  it("ignores spaces and thousands commas", () => {
    expect(val(" 1,000 + 2,500 ")).toBe(3500);
  });

  it("reports division by zero, not Infinity", () => {
    expect(err("5/0")).toBe("Cannot divide by zero");
    expect(err("5/(3-3)")).toBe("Cannot divide by zero");
  });

  it("rejects anything that is not arithmetic", () => {
    expect(err("2+")).not.toBeNull();
    expect(err("*3")).not.toBeNull();
    expect(err("2..3")).not.toBeNull();
    expect(err("(2+3")).toBe("Missing closing bracket");
    expect(err("2+3)")).toBe("Extra closing bracket");
    expect(err("alert(1)")).not.toBeNull();
    expect(err("1;2")).not.toBeNull();
    expect(err("2 3")).not.toBeNull();
    expect(err("")).toBe("Empty");
  });

  it("reports an overflow", () => {
    expect(err("9".repeat(200) + "*" + "9".repeat(200))).toBe("Too large");
  });
});

describe("formatting", () => {
  it("groups thousands and trims decimals", () => {
    expect(formatResult(1234567.5)).toBe("1,234,567.5");
    expect(formatResult(0.30000000000000004)).toBe("0.3");
    expect(formatResult(-0)).toBe("0");
  });

  it("gives plain text for pasting", () => {
    expect(plainResult(1234.5)).toBe("1234.5");
    expect(plainResult(-0)).toBe("0");
  });

  it("never writes an answer in exponent form, so it can be used in the next sum", () => {
    // String(1e-7) is "1e-7" and String(1e21) is "1e+21": the calculator could not read them back.
    for (const n of [1e-7, 1e21, 2.5e-9, -3e22, 123456789012345680000]) {
      const text = plainResult(n);
      expect(text).not.toMatch(/e/i);
      // 12 significant digits are kept on purpose (see tidy), so compare relatively.
      expect(Math.abs(val(text) - n) / Math.abs(n)).toBeLessThan(1e-11);
    }
    expect(plainResult(1e-7)).toBe("0.0000001");
    expect(plainResult(1e21)).toBe("1000000000000000000000");
  });

  it("shows the symbols a person expects, and keeps a leading minus as one", () => {
    expect(prettyExpression("6*7/2-1")).toBe("6×7÷2−1");
    expect(prettyExpression("-5+2")).toBe("−5+2");
  });
});
