import { describe, expect, it } from "vitest";
import { installationDemoMode, tutorialInstallGif, tutorialSteps } from "./TutorialStart";

describe("Tutorial Start content", () => {
  it("provides four practical installation and verification steps in both supported languages", () => {
    for (const language of ["en", "ar"] as const) {
      expect(tutorialSteps[language]).toHaveLength(4);
      expect(tutorialSteps[language].map(step => step.id)).toEqual(["download", "install", "policy", "verify"]);
      expect(tutorialSteps[language].flatMap(step => step.checklist).join(" ")).toContain("chrome://extensions");
    }
  });

  it("uses the corrected extension ZIP for the download step", () => {
    expect(tutorialSteps.en[0].actions?.[0].href).toBe("/storage/content-firewall-chrome-extension_db504c16.zip");
  });

  it("ships an accessible animated installation demo from permanent project storage", () => {
    expect(tutorialInstallGif).toBe("/storage/content-firewall-load-unpacked_a4ea7cf4.gif");
  });

  it("uses the non-animated installation fallback when reduced motion is requested", () => {
    expect(installationDemoMode(false)).toBe("animated");
    expect(installationDemoMode(true)).toBe("paused");
  });
});
