#!/usr/bin/env python3
"""
Bergamot Native Messaging Host
Bridges communication between browser extension and VS Code extension
"""

import sys
import json
import os
import struct
import requests
import logging
from pathlib import Path

# Configure logging
log_dir = Path.home() / '.bergamot'
log_dir.mkdir(exist_ok=True)
logging.basicConfig(
    filename=str(log_dir / 'native-host.log'),
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def read_message():
    """Read a message from stdin using Chrome native messaging protocol"""
    try:
        # Read the message length (first 4 bytes)
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            logging.debug("No message length received, exiting")
            sys.exit(0)
        
        message_length = struct.unpack('@I', raw_length)[0]
        logging.debug(f"Message length: {message_length}")
        
        # Read the message itself
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        logging.debug(f"Received message: {message}")
        
        return json.loads(message)
    except Exception as e:
        logging.error(f"Error reading message: {e}")
        return None

def send_message(message):
    """Send a message to stdout using Chrome native messaging protocol"""
    try:
        encoded = json.dumps(message).encode('utf-8')
        
        # Write message length
        sys.stdout.buffer.write(struct.pack('@I', len(encoded)))
        
        # Write the message
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        
        logging.debug(f"Sent message: {message}")
    except Exception as e:
        logging.error(f"Error sending message: {e}")

def get_vscode_port():
    """Read the VS Code extension port from the port file"""
    port_file = Path.home() / '.bergamot' / 'port.json'
    
    try:
        if port_file.exists():
            with open(port_file, 'r') as f:
                data = json.load(f)
                return data.get('port', 5000)
    except Exception as e:
        logging.error(f"Error reading port file: {e}")
    
    # Default to port 5000 if file doesn't exist
    return 5000

def forward_to_vscode(message):
    """Forward a message to the VS Code extension HTTP server"""
    port = get_vscode_port()
    
    try:
        # Extract the endpoint and data from the message
        endpoint = message.get('endpoint', '/visit')
        data = message.get('data', {})
        
        # Make HTTP request to VS Code extension
        url = f'http://localhost:{port}{endpoint}'
        logging.info(f"Forwarding to VS Code: {url}")
        
        response = requests.post(
            url,
            json=data,
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
        
        if response.ok:
            logging.info(f"Successfully forwarded to VS Code")
            return {
                'success': True,
                'status': response.status_code,
                'data': response.json() if response.text else None
            }
        else:
            logging.error(f"VS Code returned error: {response.status_code}")
            return {
                'success': False,
                'error': f'VS Code returned status {response.status_code}'
            }
            
    except requests.exceptions.ConnectionError:
        logging.error("Cannot connect to VS Code extension")
        return {
            'success': False,
            'error': 'Cannot connect to VS Code extension. Is it running?'
        }
    except requests.exceptions.Timeout:
        logging.error("Request to VS Code timed out")
        return {
            'success': False,
            'error': 'Request to VS Code extension timed out'
        }
    except Exception as e:
        logging.error(f"Error forwarding to VS Code: {e}")
        return {
            'success': False,
            'error': str(e)
        }

def main():
    """Main message loop"""
    logging.info("Native host started")
    
    while True:
        message = read_message()
        
        if not message:
            logging.error("Invalid message received")
            continue
        
        # Handle different message types
        msg_type = message.get('type')
        
        if msg_type == 'ping':
            # Simple ping/pong for testing
            send_message({'type': 'pong', 'echo': message.get('data')})
            
        elif msg_type == 'get_port':
            # Return the current VS Code port
            port = get_vscode_port()
            send_message({'type': 'port', 'port': port})
            
        elif msg_type == 'forward':
            # Forward message to VS Code extension
            result = forward_to_vscode(message)
            send_message({'type': 'forward_result', **result})
            
        elif msg_type == 'check_status':
            # Check if VS Code extension is running
            port = get_vscode_port()
            try:
                response = requests.get(f'http://localhost:{port}/status', timeout=2)
                is_running = response.ok
            except:
                is_running = False
            
            send_message({
                'type': 'status',
                'vscode_running': is_running,
                'port': port
            })
        else:
            logging.warning(f"Unknown message type: {msg_type}")
            send_message({
                'type': 'error',
                'error': f'Unknown message type: {msg_type}'
            })

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        logging.error(f"Fatal error in native host: {e}")
        sys.exit(1)