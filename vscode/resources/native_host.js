#!/usr/bin/env node

/**
 * Native Messaging Host for PKM Assistant
 * 
 * This script acts as a bridge between the browser extension and VS Code extension.
 * It uses the Chrome Native Messaging protocol (stdin/stdout with length-prefixed JSON).
 * 
 * Protocol:
 * - Input: 4-byte length header (little-endian) + JSON message
 * - Output: 4-byte length header (little-endian) + JSON response
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

// Configuration
const PORT_FILE = path.join(os.homedir(), '.pkm-assistant', 'port.json');
const MAX_MESSAGE_SIZE = 1024 * 1024 * 10; // 10MB max message size

/**
 * Reads a message from stdin using Chrome Native Messaging protocol
 * @returns {Promise<Object>} The parsed JSON message
 */
function readMessage() {
  return new Promise((resolve, reject) => {
    // Read 4-byte length header
    const chunks = [];
    let headerRead = false;
    let messageLength = 0;
    let bytesRead = 0;

    process.stdin.on('readable', function onReadable() {
      let chunk;
      
      // Read header if not yet read
      if (!headerRead) {
        chunk = process.stdin.read(4);
        if (!chunk || chunk.length < 4) {
          return; // Wait for more data
        }
        
        messageLength = chunk.readUInt32LE(0);
        
        if (messageLength > MAX_MESSAGE_SIZE) {
          reject(new Error(`Message too large: ${messageLength} bytes`));
          return;
        }
        
        headerRead = true;
      }
      
      // Read message body
      while ((chunk = process.stdin.read()) !== null) {
        chunks.push(chunk);
        bytesRead += chunk.length;
        
        if (bytesRead >= messageLength) {
          // Remove this listener to prevent further reads
          process.stdin.removeListener('readable', onReadable);
          
          // Concatenate chunks and parse JSON
          const buffer = Buffer.concat(chunks);
          const messageBytes = buffer.slice(0, messageLength);
          
          try {
            const message = JSON.parse(messageBytes.toString('utf8'));
            resolve(message);
          } catch (error) {
            reject(new Error(`Failed to parse message: ${error.message}`));
          }
          break;
        }
      }
    });
  });
}

/**
 * Writes a message to stdout using Chrome Native Messaging protocol
 * @param {Object} message - The message object to send
 */
function writeMessage(message) {
  const messageJson = JSON.stringify(message);
  const messageBuffer = Buffer.from(messageJson, 'utf8');
  
  // Create 4-byte length header
  const headerBuffer = Buffer.allocUnsafe(4);
  headerBuffer.writeUInt32LE(messageBuffer.length, 0);
  
  // Write header and message
  process.stdout.write(headerBuffer);
  process.stdout.write(messageBuffer);
}

/**
 * Reads the VS Code server port from the port file
 * @returns {Promise<number>} The port number
 */
async function readServerPort() {
  try {
    const portData = await fs.promises.readFile(PORT_FILE, 'utf8');
    const portInfo = JSON.parse(portData);
    return portInfo.port;
  } catch (error) {
    throw new Error(`Failed to read port file: ${error.message}`);
  }
}

/**
 * Forwards a message to the VS Code extension server
 * @param {Object} message - The message to forward
 * @param {number} port - The server port
 * @returns {Promise<Object>} The server response
 */
function forwardToVSCode(message, port) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(message);
    
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/visit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = http.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(responseData);
          resolve(response);
        } catch (error) {
          // If response is not JSON, return as-is
          resolve({ status: 'success', data: responseData });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * Main message processing loop
 */
async function main() {
  // Log startup for debugging (to stderr to not interfere with stdout protocol)
  console.error('[Native Host] Starting PKM Assistant native messaging host');
  
  // Handle stdin close (browser closed connection)
  process.stdin.on('end', () => {
    console.error('[Native Host] Browser disconnected, exiting');
    process.exit(0);
  });
  
  // Main message loop
  while (true) {
    try {
      // Read message from browser
      const message = await readMessage();
      console.error('[Native Host] Received message:', message.type || 'unknown');
      
      // Handle different message types
      if (message.type === 'ping') {
        // Health check
        writeMessage({ type: 'pong', status: 'healthy' });
      } else if (message.type === 'visit' || !message.type) {
        // Forward webpage visit to VS Code
        const port = await readServerPort();
        const response = await forwardToVSCode(message, port);
        writeMessage({ 
          type: 'response', 
          status: 'success',
          ...response 
        });
      } else {
        // Unknown message type
        writeMessage({ 
          type: 'error', 
          error: `Unknown message type: ${message.type}` 
        });
      }
    } catch (error) {
      console.error('[Native Host] Error:', error.message);
      
      // Send error response to browser
      writeMessage({ 
        type: 'error', 
        status: 'error',
        error: error.message 
      });
      
      // For critical errors, exit
      if (error.message.includes('Failed to read port file')) {
        console.error('[Native Host] VS Code server not running, exiting');
        process.exit(1);
      }
    }
  }
}

// Start the native host
main().catch((error) => {
  console.error('[Native Host] Fatal error:', error);
  process.exit(1);
});