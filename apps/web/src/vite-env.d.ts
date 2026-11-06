/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_EXPLORER_URL?: string;
  readonly VITE_PAYMENT_ROUTER_ADDRESS?: string;
  readonly VITE_STORE_MERCHANT?: string;
  readonly VITE_INR_PER_USDT?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_SWARM_GATEWAY?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
