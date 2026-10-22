import React, { useState } from "react";
import { X, ChevronRight, ChevronLeft } from "lucide-react";
import { useTranslation } from "../i18n";
import { readVersionedItem, writeVersionedItem } from "../lib/versionedStorage";

const LOCAL_STORAGE_KEY = "hasSeenWalkthrough";
const STORAGE_VERSION = 1;

// Legacy format: the string "true"; any pre-envelope value counted as seen.
const toSeen = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : value === "true" || value === true ? true : null;

const hasSeenWalkthrough = (): boolean =>
  readVersionedItem<boolean>(LOCAL_STORAGE_KEY, {
    version: STORAGE_VERSION,
    parseData: toSeen,
    migrateLegacy: () => true,
  }) === true;

const OnboardingWalkthrough: React.FC = () => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(
    () => !hasSeenWalkthrough(),
  );
  const [currentStep, setCurrentStep] = useState(0);

  const STEPS = [
    { title: t("walkthrough.steps.welcome.title"), copy: t("walkthrough.steps.welcome.copy") },
    { title: t("walkthrough.steps.connectWallet.title"), copy: t("walkthrough.steps.connectWallet.copy") },
    { title: t("walkthrough.steps.inputAmount.title"), copy: t("walkthrough.steps.inputAmount.copy") },
    { title: t("walkthrough.steps.depositEarn.title"), copy: t("walkthrough.steps.depositEarn.copy") },
  ];

  const handleDismiss = () => {
    writeVersionedItem(LOCAL_STORAGE_KEY, STORAGE_VERSION, true);
    setIsVisible(false);
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleDismiss();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
        backdropFilter: "blur(4px)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        className="glass-panel"
        style={{
          backgroundColor: "var(--bg-card, #1a1a1a)",
          borderRadius: "16px",
          padding: "24px",
          maxWidth: "400px",
          width: "100%",
          position: "relative",
          border: "1px solid var(--border-glass, rgba(255, 255, 255, 0.1))",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        }}
      >
        <button
          onClick={handleDismiss}
          style={{
            position: "absolute",
            top: "16px",
            right: "16px",
            background: "transparent",
            border: "none",
            color: "var(--text-secondary, #a0a0a0)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          aria-label={t("walkthrough.closeAria")}
        >
          <X size={20} />
        </button>

        <div style={{ marginBottom: "24px", paddingTop: "8px" }}>
          <h2
            style={{
              fontSize: "1.25rem",
              fontWeight: 600,
              marginBottom: "12px",
              color: "var(--text-primary, #ffffff)",
            }}
          >
            {STEPS[currentStep].title}
          </h2>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: "1.5",
              color: "var(--text-secondary, #a0a0a0)",
            }}
          >
            {STEPS[currentStep].copy}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid var(--border-glass, rgba(255, 255, 255, 0.1))",
            paddingTop: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            {STEPS.map((_, index) => (
              <div
                key={index}
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor:
                    index === currentStep
                      ? "var(--accent-cyan, #00f0ff)"
                      : "rgba(255, 255, 255, 0.2)",
                  transition: "background-color 0.2s ease",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: "12px" }}>
            {currentStep > 0 && (
              <button
                onClick={handlePrevious}
                className="btn btn-outline"
                style={{
                  padding: "8px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <ChevronLeft size={16} /> {t("walkthrough.back")}
              </button>
            )}
            <button
              onClick={handleNext}
              className="btn btn-primary"
              style={{
                padding: "8px 16px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: "var(--accent-cyan, #00f0ff)",
                color: "#000",
                border: "none",
                fontWeight: 600,
              }}
            >
              {currentStep === STEPS.length - 1 ? t("walkthrough.finish") : t("walkthrough.next")}
              {currentStep < STEPS.length - 1 && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingWalkthrough;
