/**
 * Enhanced API Client with Native Messaging Support
 * Supports both HTTP and Native Messaging communication
 */

import { native_messaging } from './native_messaging';

export enum CommunicationMode {
  HTTP = 'http',
  NATIVE_MESSAGING = 'native'
}

export class ApiClientV2 {
  private mode: CommunicationMode;
  private api_base_url: string;
  private use_native_messaging_fallback: boolean;
  
  constructor(
    api_base_url: string,
    mode: CommunicationMode = CommunicationMode.NATIVE_MESSAGING,
    use_fallback: boolean = true
  ) {
    this.api_base_url = api_base_url;
    this.mode = mode;
    this.use_native_messaging_fallback = use_fallback;
  }
  
  /**
   * Send data to the VS Code extension
   */
  async send_to_server(endpoint: string, data: any): Promise<void> {
    console.log(`🚀 Sending to ${endpoint} via ${this.mode}`);
    
    if (this.mode === CommunicationMode.NATIVE_MESSAGING) {
      try {
        // Try native messaging first
        await native_messaging.forward_to_vscode(endpoint, data);
        console.log(`✅ Successfully sent via native messaging`);
        return;
      } catch (error) {
        console.warn('Native messaging failed:', error);
        
        if (this.use_native_messaging_fallback) {
          console.log('Falling back to HTTP...');
          await this.send_via_http(endpoint, data);
        } else {
          throw error;
        }
      }
    } else {
      // Use HTTP directly
      await this.send_via_http(endpoint, data);
    }
  }
  
  /**
   * Send data via HTTP (fallback or primary)
   */
  private async send_via_http(endpoint: string, data: any): Promise<void> {
    console.log(`📡 Sending via HTTP to: ${this.api_base_url}${endpoint}`);
    
    const response = await fetch(`${this.api_base_url}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status}`);
    }
    
    console.log(`✅ Successfully sent via HTTP`);
  }
  
  /**
   * Check if VS Code extension is available
   */
  async check_connection(): Promise<boolean> {
    if (this.mode === CommunicationMode.NATIVE_MESSAGING) {
      try {
        const is_running = await native_messaging.check_vscode_status();
        if (is_running) {
          console.log('✅ VS Code extension is running (via native messaging)');
          return true;
        }
      } catch (error) {
        console.warn('Native messaging check failed:', error);
      }
      
      if (this.use_native_messaging_fallback) {
        return this.check_http_connection();
      }
      return false;
    } else {
      return this.check_http_connection();
    }
  }
  
  /**
   * Check HTTP connection
   */
  private async check_http_connection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.api_base_url}/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        console.log('✅ VS Code extension is running (via HTTP)');
        return true;
      }
    } catch (error) {
      console.warn('HTTP connection check failed:', error);
    }
    
    return false;
  }
  
  /**
   * Get the current communication mode
   */
  get_mode(): CommunicationMode {
    return this.mode;
  }
  
  /**
   * Switch communication mode
   */
  set_mode(mode: CommunicationMode): void {
    this.mode = mode;
    console.log(`Switched to ${mode} mode`);
  }
}

// Factory function for backward compatibility
export function create_api_client(api_base_url: string): ApiClientV2 {
  // Try native messaging by default, with HTTP fallback
  return new ApiClientV2(api_base_url, CommunicationMode.NATIVE_MESSAGING, true);
}