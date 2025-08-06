import { NativeMessagingService } from '../src/core/native_messaging';
import { ApiClientV2, CommunicationMode } from '../src/core/api_client_v2';

// Mock chrome/browser runtime APIs
const mock_port = {
  postMessage: jest.fn(),
  onMessage: {
    addListener: jest.fn()
  },
  onDisconnect: {
    addListener: jest.fn()
  }
};

const mock_runtime = {
  connectNative: jest.fn(() => mock_port),
  lastError: null
};

// Setup globals
(global as any).chrome = { runtime: mock_runtime };
(global as any).browser = { runtime: mock_runtime };

describe('NativeMessagingService', () => {
  let service: NativeMessagingService;
  let message_handler: (message: any) => void;
  let disconnect_handler: () => void;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Reset singleton
    (NativeMessagingService as any).instance = null;
    service = NativeMessagingService.get_instance();
    
    // Capture message and disconnect handlers
    mock_port.onMessage.addListener.mockImplementation((handler) => {
      message_handler = handler;
    });
    
    mock_port.onDisconnect.addListener.mockImplementation((handler) => {
      disconnect_handler = handler;
    });
  });

  describe('Connection Management', () => {
    it('should connect to native host successfully', async () => {
      // Simulate successful ping response
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'ping') {
          setTimeout(() => {
            message_handler({ type: 'pong', data: msg.data, id: msg.id });
          }, 10);
        }
      });

      const connected = await service.connect();
      
      expect(connected).toBe(true);
      expect(mock_runtime.connectNative).toHaveBeenCalledWith('com.pkm_assistant.native');
      expect(mock_port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ping' })
      );
    });

    it('should handle connection failure', async () => {
      // Simulate connection error
      mock_runtime.connectNative.mockImplementationOnce(() => {
        throw new Error('Failed to connect');
      });

      const connected = await service.connect();
      
      expect(connected).toBe(false);
    });

    it('should handle disconnect and attempt reconnection', async () => {
      // First connect successfully
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'ping') {
          setTimeout(() => {
            message_handler({ type: 'pong', data: msg.data, id: msg.id });
          }, 10);
        }
      });

      await service.connect();
      
      // Simulate disconnect
      disconnect_handler();
      
      // Verify reconnection attempt after delay
      await new Promise(resolve => setTimeout(resolve, 2100));
      
      expect(mock_runtime.connectNative).toHaveBeenCalledTimes(2);
    });

    it('should not reconnect if already connected', async () => {
      // Simulate successful connection
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'ping') {
          setTimeout(() => {
            message_handler({ type: 'pong', data: msg.data, id: msg.id });
          }, 10);
        }
      });

      await service.connect();
      await service.connect(); // Second call
      
      expect(mock_runtime.connectNative).toHaveBeenCalledTimes(1);
    });
  });

  describe('Message Forwarding', () => {
    beforeEach(async () => {
      // Setup successful connection
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'ping') {
          setTimeout(() => {
            message_handler({ type: 'pong', data: msg.data, id: msg.id });
          }, 10);
        } else if (msg.type === 'forward') {
          setTimeout(() => {
            message_handler({
              type: 'forward_result',
              success: true,
              data: { result: 'ok' },
              id: msg.id
            });
          }, 10);
        }
      });
      
      await service.connect();
    });

    it('should forward messages to VS Code successfully', async () => {
      const result = await service.forward_to_vscode('/visit', {
        url: 'https://example.com',
        title: 'Test Page'
      });
      
      expect(result).toEqual({ result: 'ok' });
      expect(mock_port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'forward',
          endpoint: '/visit',
          data: {
            url: 'https://example.com',
            title: 'Test Page'
          }
        })
      );
    });

    it('should handle forward errors', async () => {
      mock_port.postMessage.mockImplementationOnce((msg) => {
        if (msg.type === 'forward') {
          setTimeout(() => {
            message_handler({
              type: 'forward_result',
              success: false,
              error: 'VS Code not running',
              id: msg.id
            });
          }, 10);
        }
      });

      await expect(
        service.forward_to_vscode('/visit', {})
      ).rejects.toThrow('VS Code not running');
    });

    it('should timeout if no response received', async () => {
      mock_port.postMessage.mockImplementationOnce((msg) => {
        // Don't send any response
      });

      await expect(
        service.forward_to_vscode('/visit', {})
      ).rejects.toThrow('Message timeout');
    }, 6000);
  });

  describe('Status Checks', () => {
    beforeEach(async () => {
      // Setup successful connection
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'ping') {
          setTimeout(() => {
            message_handler({ type: 'pong', data: msg.data, id: msg.id });
          }, 10);
        }
      });
      
      await service.connect();
    });

    it('should check VS Code status successfully', async () => {
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'check_status') {
          setTimeout(() => {
            message_handler({
              type: 'status',
              vscode_running: true,
              port: 5000,
              id: msg.id
            });
          }, 10);
        }
      });

      const is_running = await service.check_vscode_status();
      
      expect(is_running).toBe(true);
      expect(mock_port.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'check_status' })
      );
    });

    it('should return false if VS Code is not running', async () => {
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'check_status') {
          setTimeout(() => {
            message_handler({
              type: 'status',
              vscode_running: false,
              port: 5000,
              id: msg.id
            });
          }, 10);
        }
      });

      const is_running = await service.check_vscode_status();
      
      expect(is_running).toBe(false);
    });

    it('should get VS Code port', async () => {
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'get_port') {
          setTimeout(() => {
            message_handler({
              type: 'port',
              port: 5432,
              id: msg.id
            });
          }, 10);
        }
      });

      const port = await service.get_vscode_port();
      
      expect(port).toBe(5432);
    });

    it('should return default port on error', async () => {
      mock_port.postMessage.mockImplementation((msg) => {
        if (msg.type === 'get_port') {
          setTimeout(() => {
            message_handler({
              type: 'error',
              error: 'Port file not found',
              id: msg.id
            });
          }, 10);
        }
      });

      const port = await service.get_vscode_port();
      
      expect(port).toBe(5000); // Default port
    });
  });
});

describe('ApiClientV2', () => {
  let client: ApiClientV2;
  let fetch_mock: jest.Mock;
  
  beforeEach(() => {
    // Mock fetch
    fetch_mock = jest.fn();
    (global as any).fetch = fetch_mock;
    
    // Reset native messaging service
    (NativeMessagingService as any).instance = null;
  });

  describe('Native Messaging Mode', () => {
    beforeEach(() => {
      client = new ApiClientV2('http://localhost:5000', CommunicationMode.NATIVE_MESSAGING, true);
      
      // Mock native messaging methods
      jest.spyOn(NativeMessagingService.get_instance(), 'forward_to_vscode')
        .mockResolvedValue({ success: true });
      jest.spyOn(NativeMessagingService.get_instance(), 'check_vscode_status')
        .mockResolvedValue(true);
    });

    it('should send data via native messaging', async () => {
      await client.send_to_server('/visit', { url: 'https://example.com' });
      
      expect(NativeMessagingService.get_instance().forward_to_vscode)
        .toHaveBeenCalledWith('/visit', { url: 'https://example.com' });
      expect(fetch_mock).not.toHaveBeenCalled();
    });

    it('should fallback to HTTP on native messaging failure', async () => {
      jest.spyOn(NativeMessagingService.get_instance(), 'forward_to_vscode')
        .mockRejectedValueOnce(new Error('Native host not available'));
      
      fetch_mock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      await client.send_to_server('/visit', { url: 'https://example.com' });
      
      expect(fetch_mock).toHaveBeenCalledWith(
        'http://localhost:5000/visit',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com' })
        })
      );
    });

    it('should check connection via native messaging', async () => {
      const is_connected = await client.check_connection();
      
      expect(is_connected).toBe(true);
      expect(NativeMessagingService.get_instance().check_vscode_status)
        .toHaveBeenCalled();
    });
  });

  describe('HTTP Mode', () => {
    beforeEach(() => {
      client = new ApiClientV2('http://localhost:5000', CommunicationMode.HTTP, false);
    });

    it('should send data via HTTP directly', async () => {
      fetch_mock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      await client.send_to_server('/visit', { url: 'https://example.com' });
      
      expect(fetch_mock).toHaveBeenCalledWith(
        'http://localhost:5000/visit',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com' })
        })
      );
    });

    it('should throw on HTTP failure', async () => {
      fetch_mock.mockResolvedValueOnce({
        ok: false,
        status: 500
      });

      await expect(
        client.send_to_server('/visit', { url: 'https://example.com' })
      ).rejects.toThrow('HTTP request failed: 500');
    });

    it('should check connection via HTTP', async () => {
      fetch_mock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'running' })
      });

      const is_connected = await client.check_connection();
      
      expect(is_connected).toBe(true);
      expect(fetch_mock).toHaveBeenCalledWith(
        'http://localhost:5000/status',
        expect.objectContaining({ method: 'GET' })
      );
    });
  });

  describe('Mode Switching', () => {
    beforeEach(() => {
      client = new ApiClientV2('http://localhost:5000', CommunicationMode.NATIVE_MESSAGING, true);
    });

    it('should switch communication modes', () => {
      expect(client.get_mode()).toBe(CommunicationMode.NATIVE_MESSAGING);
      
      client.set_mode(CommunicationMode.HTTP);
      
      expect(client.get_mode()).toBe(CommunicationMode.HTTP);
    });

    it('should use new mode after switching', async () => {
      client.set_mode(CommunicationMode.HTTP);
      
      fetch_mock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      await client.send_to_server('/visit', { url: 'https://example.com' });
      
      expect(fetch_mock).toHaveBeenCalled();
    });
  });
});