/// <reference types="vite/client" />

import type { SogPlanBridge } from './shared/types';

declare global {
  interface Window {
    sogplan?: SogPlanBridge;
    sogplanClient?: {
      appName: string;
      platform: string;
    };
  }
}

export {};
