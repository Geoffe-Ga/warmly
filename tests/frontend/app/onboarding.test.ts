import { describe, expect, it } from "vitest";

import { createOnboarding } from "../../../src/app/onboarding";

describe("onboarding state (DEV-006)", () => {
  it("starts empty", () => {
    const onboarding = createOnboarding();

    expect(onboarding.recoveryKey).toBeUndefined();
    expect(onboarding.emailVerified).toBe(false);
  });

  it("holds a recovery key and the verified flag until cleared", () => {
    const onboarding = createOnboarding();

    onboarding.markEmailVerified();
    onboarding.holdRecoveryKey("KEY0-TEST");
    expect(onboarding.recoveryKey).toBe("KEY0-TEST");
    expect(onboarding.emailVerified).toBe(true);

    onboarding.clear();
    expect(onboarding.recoveryKey).toBeUndefined();
    expect(onboarding.emailVerified).toBe(false);
  });

  it("can be cleared repeatedly", () => {
    const onboarding = createOnboarding();

    onboarding.clear();
    onboarding.clear();

    expect(onboarding.recoveryKey).toBeUndefined();
  });
});
