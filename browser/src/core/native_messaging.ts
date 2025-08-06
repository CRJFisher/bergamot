/**
 * Native Messaging Communication Module
 * Handles communication with the native host which bridges to VS Code
 */

interface NativeMessage {
  type: string;
  [key: string]: any;
}

interface NativeResponse {
  type: string;
  success?: boolean;
  error?: string;
  [key: string]: any;
}

export class NativeMessagingService {
  private static instance: NativeMessagingService | null = null;
  private port: chrome.runtime.Port | browser.runtime.Port | null = null;
  private pending_messages: Map<string, { resolve: Function, reject: Function }> = new Map();
  private message_counter = 0;
  private connected = false;
  private reconnect_attempts = 0;
  private max_reconnect_attempts = 3;
  
  private constructor() {}
  
  static get_instance(): NativeMessagingService {
    if (!NativeMessagingService.instance) {
      NativeMessagingService.instance = new NativeMessagingService();
    }
    return NativeMessagingService.instance;
  }
  
  /**
   * Connect to the native messaging host
   */
  async connect(): Promise<boolean> {
    if (this.connected) {
      return true;
    }
    
    try {
      console.log('🔌 Connecting to native host...');
      
      // Use browser API if available (Firefox), otherwise Chrome API
      const runtime = typeof browser !== 'undefined' ? browser.runtime : chrome.runtime;
      this.port = runtime.connectNative('com.pkm_assistant.native');
      
      if (!this.port) {
        throw new Error('Failed to create native port');
      }
      
      // Set up message listener
      this.port.onMessage.addListener((message: NativeResponse) => {
        this.handle_message(message);
      });
      
      // Set up disconnect listener
      this.port.onDisconnect.addListener(() => {
        this.handle_disconnect();
      });
      
      // Test connection with ping
      const pong = await this.send_message({ type: 'ping', data: 'test' });
      if (pong.type === 'pong') {
        console.log('✅ Native host connected successfully');
        this.connected = true;
        this.reconnect_attempts = 0;
        return true;
      }
      
      throw new Error('Ping test failed');
      
    } catch (error) {
      console.error('❌ Failed to connect to native host:', error);
      this.connected = false;
      
      // Try to reconnect
      if (this.reconnect_attempts < this.max_reconnect_attempts) {
        this.reconnect_attempts++;
        console.log(`🔄 Retrying connection (${this.reconnect_attempts}/${this.max_reconnect_attempts})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * this.reconnect_attempts));
        return this.connect();
      }
      
      return false;
    }
  }
  
  /**
   * Send a message to the native host
   */
  private send_message(message: NativeMessage): Promise<NativeResponse> {
    return new Promise((resolve, reject) => {
      if (!this.port) {
        reject(new Error('Not connected to native host'));
        return;
      }
      
      // Add message ID for tracking responses
      const message_id = `msg_${++this.message_counter}`;
      const message_with_id = { ...message, id: message_id };
      
      // Store promise handlers
      this.pending_messages.set(message_id, { resolve, reject });
      
      // Set timeout for response
      setTimeout(() => {
        if (this.pending_messages.has(message_id)) {
          this.pending_messages.delete(message_id);
          reject(new Error('Message timeout'));
        }
      }, 5000);
      
      // Send message
      try {
        this.port.postMessage(message_with_id);
      } catch (error) {
        this.pending_messages.delete(message_id);
        reject(error);
      }
    });
  }
  
  /**
   * Handle incoming messages from native host
   */
  private handle_message(message: NativeResponse): void {
    console.log('📨 Received from native host:', message);
    
    // Check if this is a response to a pending message
    const message_id = (message as any).id;
    if (message_id && this.pending_messages.has(message_id)) {
      const { resolve } = this.pending_messages.get(message_id)!;
      this.pending_messages.delete(message_id);
      resolve(message);
    }
  }
  
  /**
   * Handle native host disconnect
   */
  private handle_disconnect(): void {
    console.warn('⚠️ Native host disconnected');
    this.connected = false;
    this.port = null;
    
    // Reject all pending messages
    for (const [id, { reject }] of this.pending_messages) {
      reject(new Error('Native host disconnected'));
    }
    this.pending_messages.clear();
    
    // Try to reconnect after a delay
    if (this.reconnect_attempts < this.max_reconnect_attempts) {
      setTimeout(() => {
        console.log('🔄 Attempting to reconnect...');
        this.connect();
      }, 2000);
    }
  }
  
  /**
   * Forward a request to VS Code extension via native host
   */
  async forward_to_vscode(endpoint: string, data: any): Promise<any> {
    if (!this.connected) {
      const connected = await this.connect();
      if (!connected) {
        throw new Error('Cannot connect to native host');
      }
    }
    
    try {
      const response = await this.send_message({
        type: 'forward',
        endpoint,
        data
      });
      
      if (response.type === 'forward_result') {
        if (response.success) {
          return response.data;
        } else {
          throw new Error(response.error || 'Forward request failed');
        }
      } else {
        throw new Error('Unexpected response type');
      }
      
    } catch (error) {
      console.error('Failed to forward to VS Code:', error);
      throw error;
    }
  }
  
  /**
   * Check if VS Code extension is running
   */
  async check_vscode_status(): Promise<boolean> {
    if (!this.connected) {
      await this.connect();
    }
    
    try {
      const response = await this.send_message({ type: 'check_status' });
      return response.type === 'status' && response.vscode_running === true;
    } catch (error) {
      console.error('Failed to check VS Code status:', error);
      return false;
    }
  }
  
  /**
   * Get the current VS Code port
   */
  async get_vscode_port(): Promise<number> {
    if (!this.connected) {
      await this.connect();
    }
    
    try {
      const response = await this.send_message({ type: 'get_port' });
      if (response.type === 'port' && response.port) {
        return response.port;
      }
      throw new Error('Failed to get port');
    } catch (error) {
      console.error('Failed to get VS Code port:', error);
      return 5000; // Default port
    }
  }
}

// Export singleton instance
export const native_messaging = NativeMessagingService.get_instance();