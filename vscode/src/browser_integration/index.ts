/**
 * Browser Integration Setup Module
 * 
 * Provides automated setup for browser extension integration with zero friction.
 * Uses Node.js native host to eliminate security warnings.
 */

export { BrowserIntegrationSetup } from './setup_orchestrator';
export { BrowserDetector } from './browser_detector';
export { ConnectionVerifier } from './connection_verifier';
export { SetupWizard } from './setup_wizard';
export { 
  SetupState,
  SetupResult,
  BrowserInfo,
  InstallationStatus 
} from './models';