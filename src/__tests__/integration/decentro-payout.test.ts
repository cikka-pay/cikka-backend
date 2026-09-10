import { initiateDecentroPayout } from "../../services/decentro.service";

describe("Decentro Payout Integration Test", () => {
  it("should attempt Decentro payout API call with credentials", async () => {
    const result = await initiateDecentroPayout({
      referenceId: `TEST_REF_${Date.now()}`,
      toAccount: "918273645012",
      ifscCode: "HDFC0001234",
      beneficiaryName: "Test Merchant Store",
      amount: 10.00,
      transferType: "IMPS",
      purposeMessage: "Integration Test Payout",
    });

    console.log("Decentro Test Result:", result);
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("success");
  });
});
