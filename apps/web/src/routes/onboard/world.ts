// W6: thin client for the API's World ID routes (apps/api/src/world.ts) plus user-facing copy.
// Kept free of React so it can be unit-tested.
import type { IDKitResult, RpContext } from "@worldcoin/idkit";
import { api, ApiError } from "../../lib/api";

export interface WorldPublicConfig {
  configured: boolean;
  missing: string[];
  app_id: `app_${string}` | null;
  action: string;
  environment: "production" | "staging";
  allow_legacy_proofs: boolean;
  credential: "proof_of_human";
  simulatorUrl: string | null;
}

export interface WorldRequest {
  app_id: `app_${string}`;
  action: string;
  environment: "production" | "staging";
  allow_legacy_proofs: boolean;
  credential: "proof_of_human";
  signal: string;
  rp_context: RpContext;
}

export interface VerifyOutcome { verified: true; wallet: string; alreadyVerified?: boolean; resumed?: boolean; environment: string }

export const SIMULATOR_URL = "https://simulator.worldcoin.org/id/0x18310f83";

export const worldApi = {
  config: () => api.get<WorldPublicConfig>("/world/config"),
  request: (wallet: string) => api.get<WorldRequest>(`/world/request?wallet=${encodeURIComponent(wallet)}`),
  verify: (wallet: string, result: IDKitResult) => api.post<VerifyOutcome>("/world/verify", { wallet, result }),
};

/** The one-sentence reason shown at the top of /onboard. */
export const WHY_ONE_LINER =
  "PaisaLink pays the network fee for your customers, so each merchant account must belong to a different real person; otherwise one person could open thousands of accounts and drain the shared gas budget.";

export const LOCKED_TITLE = "Gas-sponsored checkout locked: verification not completed";
export const VERIFIED_TITLE = "Verified human: gas-sponsored checkout on";

/** Plain-language reason for a failed or cancelled verification (API codes and IDKit error codes). */
export function failureReason(code: string | null | undefined, fallback?: string): string {
  switch (code) {
    case "cancelled":
    case "user_rejected": return "You closed the World ID check before it finished.";
    case "verification_rejected": return "The World ID check was declined in World App.";
    case "credential_unavailable": return "This World ID has no Proof of Human (Orb) credential, which is the one PaisaLink needs.";
    case "timeout": return "The World ID check timed out. Please try again.";
    case "connection_failed": return "Couldn't connect to World App. Check your connection and try again.";
    case "max_verifications_reached":
    case "nullifier_replayed":
    case "NULLIFIER_REUSED": return "This World ID has already verified another PaisaLink merchant account. One person gets one sponsored gas budget.";
    case "WORLD_SIGNAL_MISMATCH": return "That proof was made for a different wallet. Start the check again from this page.";
    case "WORLD_WRONG_CREDENTIAL": return "Gas sponsorship needs Proof of Human (Orb). Other World ID credentials aren't accepted here.";
    case "WORLD_ENV_MISMATCH": return "That proof came from a different World ID environment (simulator vs. real app).";
    case "WORLD_ACTION_MISMATCH": return "That proof was made for a different action.";
    case "WORLD_VERIFICATION_FAILED": return "World ID couldn't confirm the proof, so nothing was changed.";
    case "WORLD_UNAVAILABLE": return "World ID's verification service didn't answer. Nothing was changed; please try again.";
    case "STORE_UNAVAILABLE": return "World ID confirmed you, but saving your verification failed. Press \"Finish saving\" to retry.";
    case "WORLD_NOT_CONFIGURED": return "World ID isn't connected on this server yet.";
    case "MERCHANT_NOT_FOUND": return "Create your merchant profile first, then verify.";
    case "rp_signature_expired":
    case "timestamp_too_old":
    case "duplicate_nonce": return "The verification request expired. Press Try again for a fresh one.";
  }
  return fallback || "Verification didn't complete.";
}

export function codeOf(e: unknown): string | undefined {
  return e instanceof ApiError ? e.code : undefined;
}
