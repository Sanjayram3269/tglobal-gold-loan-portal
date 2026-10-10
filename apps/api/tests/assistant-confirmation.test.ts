
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockRandomUUID } = vi.hoisted(() => ({
  mockPrisma: {
    loanScheme: {
      findUnique: vi.fn(),
    },
    lead: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockRandomUUID: vi.fn(),
}));

vi.mock("../src/lib/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("node:crypto", () => ({
  randomUUID: mockRandomUUID,
}));

import {
  confirmApplication,
  prepareApplication,
} from "../src/services/assistant-confirmation.js";

type MockTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  lead: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

const tx: MockTx = {
  $queryRaw: vi.fn(),
  lead: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
};

const validDraft = {
  name: "Test Applicant",
  mobile: "9876543210",
  netWeightGrams: 45,
  grossWeightGrams: 50,
  karat: 22,
  schemeId: "PLAN_EMI_01",
};

const mockScheme = {
  id: "PLAN_EMI_01",
  name: "Monthly EMI",
  interestRatePercent: { toString: () => "10.5" },
  maxLtv: { toString: () => "0.75" },
  tenureMonths: 12,
  repaymentType: "EMI",
};

const mockCreatedLead = {
  id: "lead-test-001",
  name: "Test Applicant",
  mobile: "9876543210",
  netWeightGrams: { toString: () => "45" },
  grossWeightGrams: { toString: () => "50" },
  karat: 22,
  schemeId: "PLAN_EMI_01",
  eligibleLoanRupees: 216562n,
  status: "SUBMITTED",
  createdAt: new Date("2026-10-09T12:00:00.000Z"),
};

describe("assistant confirmation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRandomUUID.mockReturnValue(
      "123e4567-e89b-42d3-a456-426614174000",
    );

    mockPrisma.loanScheme.findUnique.mockResolvedValue(mockScheme);
    mockPrisma.lead.findFirst.mockResolvedValue(null);
    mockPrisma.lead.create.mockResolvedValue(mockCreatedLead);

    tx.$queryRaw.mockResolvedValue([{ lock_acquired: 1 }]);
    tx.lead.findFirst.mockResolvedValue(null);
    tx.lead.create.mockResolvedValue(mockCreatedLead);

    mockPrisma.$transaction.mockImplementation(
      async (callback: (tx: MockTx) => Promise<unknown>) =>
        callback(tx),
    );
  });

  it("prepares a confirmation token without creating a lead", () => {
    const result = prepareApplication(validDraft);

    expect(result.confirmationToken).toBe(
      "123e4567-e89b-42d3-a456-426614174000",
    );
    expect(result.expiresInSeconds).toBe(600);
    expect(result.application.mobile).toBe("9876XXXX10");

    expect(mockPrisma.lead.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not submit when confirmation is declined", async () => {
    const prepared = prepareApplication(validDraft);

    const result = await confirmApplication(
      prepared.confirmationToken,
      false,
    );

    expect(result).toEqual({ kind: "NOT_CONFIRMED" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("creates a lead only after explicit confirmation", async () => {
    const prepared = prepareApplication(validDraft);

    const result = await confirmApplication(
      prepared.confirmationToken,
      true,
    );

    expect(result.kind).toBe("CREATED");

    if (result.kind !== "CREATED") {
      throw new Error("Expected the application to be created");
    }

    expect(result.application).toMatchObject({
      id: "lead-test-001",
      name: "Test Applicant",
      mobile: "9876XXXX10",
      schemeId: "PLAN_EMI_01",
      eligibleLoanRupees: 216562,
      status: "SUBMITTED",
    });

    expect(mockPrisma.loanScheme.findUnique).toHaveBeenCalledWith({
      where: { id: "PLAN_EMI_01" },
    });

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.lead.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.lead.create).toHaveBeenCalledTimes(1);

    expect(tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test Applicant",
          mobile: "9876543210",
          schemeId: "PLAN_EMI_01",
          eligibleLoanRupees: 216562n,
          status: "SUBMITTED",
        }),
      }),
    );
  });

  it("rejects replaying a confirmation token", async () => {
    const prepared = prepareApplication(validDraft);

    const firstResult = await confirmApplication(
      prepared.confirmationToken,
      true,
    );

    const secondResult = await confirmApplication(
      prepared.confirmationToken,
      true,
    );

    expect(firstResult.kind).toBe("CREATED");
    expect(secondResult).toEqual({
      kind: "EXPIRED_OR_INVALID",
    });

    expect(tx.lead.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate application without creating another lead", async () => {
    const prepared = prepareApplication(validDraft);

    tx.lead.findFirst.mockResolvedValueOnce({
      id: "existing-lead-001",
    });

    const result = await confirmApplication(
      prepared.confirmationToken,
      true,
    );

    expect(result).toEqual({
      kind: "DUPLICATE",
      existingApplicationId: "existing-lead-001",
    });

    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown loan scheme", async () => {
    const prepared = prepareApplication(validDraft);

    mockPrisma.loanScheme.findUnique.mockResolvedValueOnce(null);

    const result = await confirmApplication(
      prepared.confirmationToken,
      true,
    );

    expect(result).toEqual({
      kind: "SCHEME_NOT_FOUND",
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(tx.lead.create).not.toHaveBeenCalled();
  });

  it("rejects an expired confirmation token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00.000Z"));

    try {
      const prepared = prepareApplication(validDraft);
      vi.advanceTimersByTime(600_001);

      const result = await confirmApplication(
        prepared.confirmationToken,
        true,
      );

      expect(result).toEqual({ kind: "EXPIRED_OR_INVALID" });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(tx.lead.create).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows only one concurrent confirmation for the same token", async () => {
    const prepared = prepareApplication(validDraft);

    const results = await Promise.all([
      confirmApplication(prepared.confirmationToken, true),
      confirmApplication(prepared.confirmationToken, true),
    ]);

    expect(results.filter((result) => result.kind === "CREATED")).toHaveLength(1);
    expect(results.filter((result) => result.kind === "EXPIRED_OR_INVALID")).toHaveLength(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.lead.create).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid application weights", () => {
    expect(() =>
      prepareApplication({
        ...validDraft,
        netWeightGrams: 60,
        grossWeightGrams: 50,
      }),
    ).toThrow();

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.lead.create).not.toHaveBeenCalled();
  });
});
