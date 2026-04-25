export type DelhiveryCapabilityState = {
  configured: boolean;
  reason: string;
};

function hasEnv(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

export function getDelhiveryCapabilityState(): DelhiveryCapabilityState {
  const configured = hasEnv("DELHIVERY_API_TOKEN") && hasEnv("DELHIVERY_BASE_URL");
  return {
    configured,
    reason: configured
      ? "ready"
      : "Delhivery credentials/API wrapper are not configured in this environment.",
  };
}
