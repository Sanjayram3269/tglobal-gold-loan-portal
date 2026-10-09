import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  QuoteValidationError,
} from "../src/domain/loan-calculator.js";

describe("calculateQuote", () => {
  it("calculates a 45g, 22K EMI quote correctly", () => {
    const quote = calculateQuote({
      netWeightGrams: 45,
      grossWeightGrams: 50,
      karat: 22,
      schemeId: "PLAN_EMI_01",
    });

    expect(quote.pureGoldGrams).toBe("41.25");
    expect(quote.goldValueRupees).toBe(288750);
    expect(quote.eligibleLoanRupees).toBe(216562);
  });

  it("calculates a bullet quote with 70% LTV", () => {
    const quote = calculateQuote({
      netWeightGrams: 45,
      grossWeightGrams: 50,
      karat: 22,
      schemeId: "PLAN_BULLET_01",
    });

    expect(quote.goldValueRupees).toBe(288750);
    expect(quote.eligibleLoanRupees).toBe(202125);
  });

  it("calculates an 18K quote correctly", () => {
    const quote = calculateQuote({
      netWeightGrams: 10,
      grossWeightGrams: 12,
      karat: 18,
      schemeId: "PLAN_EMI_01",
    });

    expect(quote.pureGoldGrams).toBe("7.5");
    expect(quote.goldValueRupees).toBe(52500);
    expect(quote.eligibleLoanRupees).toBe(39375);
  });

  it("rejects net weight greater than gross weight", () => {
    expect(() =>
      calculateQuote({
        netWeightGrams: 52,
        grossWeightGrams: 50,
        karat: 22,
        schemeId: "PLAN_EMI_01",
      }),
    ).toThrowError(QuoteValidationError);
  });

  it("rejects zero net weight", () => {
    expect(() =>
      calculateQuote({
        netWeightGrams: 0,
        grossWeightGrams: 50,
        karat: 22,
        schemeId: "PLAN_EMI_01",
      }),
    ).toThrowError(/greater than zero/);
  });

  it("rejects gross weight above 1000 grams", () => {
    expect(() =>
      calculateQuote({
        netWeightGrams: 1001,
        grossWeightGrams: 1001,
        karat: 22,
        schemeId: "PLAN_EMI_01",
      }),
    ).toThrowError(/1000 grams/);
  });

  it("returns 404 for an unknown scheme", () => {
    try {
      calculateQuote({
        netWeightGrams: 10,
        grossWeightGrams: 12,
        karat: 22,
        schemeId: "UNKNOWN",
      });
      throw new Error("Expected an error");
    } catch (error) {
      expect(error).toBeInstanceOf(QuoteValidationError);
      expect((error as QuoteValidationError).statusCode).toBe(404);
    }
  });
});
