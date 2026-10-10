import { describe, expect, it } from "vitest";
import {
  buildEligibilityCriteriaReply,
  isEligibilityCriteriaQuestion,
} from "../src/services/eligibility-response.js";

const schemes = [
  {
    id: "PLAN_BULLET_01",
    name: "Bullet Repayment",
    interestRatePercent: "12.00",
    maxLtv: "0.700",
    tenureMonths: 12,
    repaymentType: "BULLET",
  },
  {
    id: "PLAN_EMI_01",
    name: "Monthly EMI",
    interestRatePercent: "10.50",
    maxLtv: "0.750",
    tenureMonths: 12,
    repaymentType: "EMI",
  },
];

describe("eligibility criteria responses", () => {
  it.each([
    "What are the eligibility criteria?",
    "Am I eligible for a gold loan?",
    "What documents are required?",
    "What is the minimum income?",
    "Who can apply?",
    "Do I need a credit score?",
  ])("recognizes eligibility question: %s", (message) => {
    expect(isEligibilityCriteriaQuestion(message)).toBe(true);
  });

  it.each([
    "What is the loan amount for 45 grams?",
    "Compare Monthly EMI and Bullet Repayment",
    "Help me apply for a gold loan",
  ])("does not misclassify a general portal request: %s", (message) => {
    expect(isEligibilityCriteriaQuestion(message)).toBe(false);
  });

  it("states only configured scheme terms and explicitly identifies unknown lender rules", () => {
    const reply = buildEligibilityCriteriaReply(schemes);

    expect(reply).toContain("Monthly EMI: 10.50% p.a., up to 75% loan-to-value (LTV), 12 months.");
    expect(reply).toContain("Bullet Repayment: 12.00% p.a., up to 70% loan-to-value (LTV), 12 months.");
    expect(reply).toContain("does not define the lender's full eligibility criteria");
    expect(reply).toContain("not a guarantee of lender eligibility");
    expect(reply).not.toMatch(/minimum age is 18|minimum income of|must have a credit score/i);
  });

  it("handles an empty scheme list without inventing scheme data", () => {
    const reply = buildEligibilityCriteriaReply([]);
    expect(reply).toContain("No active loan schemes are currently configured.");
    expect(reply).not.toContain("Monthly EMI:");
  });
});
