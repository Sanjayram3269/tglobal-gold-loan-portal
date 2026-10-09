import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  QuoteValidationError,
  type LoanScheme,
} from "../src/domain/loan-calculator.js";

const schemes: Record<string, LoanScheme> = {
  PLAN_BULLET_01: {
    id: "PLAN_BULLET_01",
    name: "Bullet Repayment",
    interestRatePercent: "12.00",
    maxLtv: "0.700",
    tenureMonths: 12,
    repaymentType: "BULLET",
  },
  PLAN_EMI_01: {
    id: "PLAN_EMI_01",
    name: "Monthly EMI",
    interestRatePercent: "10.50",
    maxLtv: "0.750",
    tenureMonths: 12,
    repaymentType: "EMI",
  },
};

function quote(
  netWeightGrams: number,
  grossWeightGrams: number,
  karat: 18 | 22 | 24,
  schemeId = "PLAN_EMI_01",
) {
  const scheme = schemes[schemeId];
  if (!scheme) throw new Error(`Unknown test scheme: ${schemeId}`);

  return calculateQuote(
    { netWeightGrams, grossWeightGrams, karat, schemeId },
    scheme,
  );
}

describe("calculateQuote", () => {
  it("calculates a 45g, 22K EMI quote correctly", () => {
    const result = quote(45, 50, 22);
    expect(result.pureGoldGrams).toBe("41.25");
    expect(result.goldValueRupees).toBe(288750);
    expect(result.eligibleLoanRupees).toBe(216562);
  });

  it("calculates a bullet quote with 70% LTV", () => {
    const result = quote(45, 50, 22, "PLAN_BULLET_01");
    expect(result.goldValueRupees).toBe(288750);
    expect(result.eligibleLoanRupees).toBe(202125);
  });

  it("calculates an 18K quote correctly", () => {
    const result = quote(10, 12, 18);
    expect(result.pureGoldGrams).toBe("7.5");
    expect(result.goldValueRupees).toBe(52500);
    expect(result.eligibleLoanRupees).toBe(39375);
  });

  it("rejects net weight greater than gross weight", () => {
    expect(() => quote(52, 50, 22)).toThrowError(QuoteValidationError);
  });

  it("rejects zero net weight", () => {
    expect(() => quote(0, 50, 22)).toThrowError(/greater than zero/);
  });

  it("rejects gross weight above 1000 grams", () => {
    expect(() => quote(1001, 1001, 22)).toThrowError(/1000 grams/);
  });

  it("rejects net weight above 1000 grams", () => {
    expect(() => quote(1001, 1001, 22)).toThrowError(/1000 grams/);
  });

  it("uses the supplied scheme configuration", () => {
    const customScheme: LoanScheme = {
      id: "CUSTOM",
      name: "Custom Plan",
      interestRatePercent: "9.25",
      maxLtv: "0.600",
      tenureMonths: 6,
      repaymentType: "EMI",
    };
    const result = calculateQuote(
      {
        netWeightGrams: 10,
        grossWeightGrams: 12,
        karat: 24,
        schemeId: "CUSTOM",
      },
      customScheme,
    );
    expect(result.schemeName).toBe("Custom Plan");
    expect(result.interestRatePercent).toBe("9.25");
    expect(result.tenureMonths).toBe(6);
    expect(result.eligibleLoanRupees).toBe(42000);
  });
});
