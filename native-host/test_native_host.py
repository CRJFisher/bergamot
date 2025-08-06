#!/usr/bin/env python3
"""
Test suite for PKM Assistant Native Messaging Host
"""

import unittest
import json
import struct
import sys
import os
import tempfile
from unittest.mock import patch, MagicMock, mock_open
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the native host module
import native_host

class TestNativeHost(unittest.TestCase):
    
    def setUp(self):
        """Set up test fixtures"""
        self.temp_dir = tempfile.mkdtemp()
        self.port_file = Path(self.temp_dir) / 'port.json'
        
    def tearDown(self):
        """Clean up test fixtures"""
        if self.port_file.exists():
            self.port_file.unlink()
        os.rmdir(self.temp_dir)
    
    def encode_message(self, message):
        """Encode a message in native messaging format"""
        encoded = json.dumps(message).encode('utf-8')
        length = struct.pack('@I', len(encoded))
        return length + encoded
    
    def decode_message(self, data):
        """Decode a message from native messaging format"""
        length = struct.unpack('@I', data[:4])[0]
        message = json.loads(data[4:4+length].decode('utf-8'))
        return message
    
    def test_read_message(self):
        """Test reading a message from stdin"""
        test_message = {'type': 'ping', 'data': 'test'}
        encoded = self.encode_message(test_message)
        
        with patch('sys.stdin.buffer.read') as mock_read:
            mock_read.side_effect = [encoded[:4], encoded[4:]]
            
            result = native_host.read_message()
            self.assertEqual(result, test_message)
    
    def test_send_message(self):
        """Test sending a message to stdout"""
        test_message = {'type': 'pong', 'data': 'response'}
        
        with patch('sys.stdout.buffer.write') as mock_write:
            native_host.send_message(test_message)
            
            # Check that message was written correctly
            calls = mock_write.call_args_list
            self.assertEqual(len(calls), 2)  # Length + message
            
            # Verify length header
            length_bytes = calls[0][0][0]
            expected_length = len(json.dumps(test_message).encode('utf-8'))
            actual_length = struct.unpack('@I', length_bytes)[0]
            self.assertEqual(actual_length, expected_length)
    
    def test_get_vscode_port_with_file(self):
        """Test getting VS Code port when port file exists"""
        # Create port file
        self.port_file.write_text(json.dumps({'port': 5432}))
        
        with patch.object(Path, 'home', return_value=Path(self.temp_dir)):
            port = native_host.get_vscode_port()
            self.assertEqual(port, 5432)
    
    def test_get_vscode_port_without_file(self):
        """Test getting VS Code port when port file doesn't exist"""
        with patch.object(Path, 'home', return_value=Path(self.temp_dir)):
            port = native_host.get_vscode_port()
            self.assertEqual(port, 5000)  # Default port
    
    @patch('requests.post')
    def test_forward_to_vscode_success(self, mock_post):
        """Test successful forwarding to VS Code"""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_response.status_code = 200
        mock_response.json.return_value = {'result': 'success'}
        mock_response.text = '{"result": "success"}'
        mock_post.return_value = mock_response
        
        message = {
            'endpoint': '/visit',
            'data': {'url': 'https://example.com'}
        }
        
        result = native_host.forward_to_vscode(message)
        
        self.assertTrue(result['success'])
        self.assertEqual(result['status'], 200)
        self.assertEqual(result['data'], {'result': 'success'})
        
        mock_post.assert_called_once_with(
            'http://localhost:5000/visit',
            json={'url': 'https://example.com'},
            headers={'Content-Type': 'application/json'},
            timeout=5
        )
    
    @patch('requests.post')
    def test_forward_to_vscode_connection_error(self, mock_post):
        """Test forwarding when VS Code is not running"""
        import requests
        mock_post.side_effect = requests.exceptions.ConnectionError()
        
        message = {
            'endpoint': '/visit',
            'data': {'url': 'https://example.com'}
        }
        
        result = native_host.forward_to_vscode(message)
        
        self.assertFalse(result['success'])
        self.assertIn('Cannot connect', result['error'])
    
    @patch('requests.post')
    def test_forward_to_vscode_timeout(self, mock_post):
        """Test forwarding timeout"""
        import requests
        mock_post.side_effect = requests.exceptions.Timeout()
        
        message = {
            'endpoint': '/visit',
            'data': {'url': 'https://example.com'}
        }
        
        result = native_host.forward_to_vscode(message)
        
        self.assertFalse(result['success'])
        self.assertIn('timed out', result['error'])
    
    @patch('native_host.send_message')
    @patch('native_host.read_message')
    def test_main_ping_pong(self, mock_read, mock_send):
        """Test ping/pong message handling"""
        mock_read.side_effect = [
            {'type': 'ping', 'data': 'test'},
            None  # Exit loop
        ]
        
        # Run main loop (will exit on None)
        with self.assertRaises(SystemExit):
            native_host.main()
        
        # Check that pong was sent
        mock_send.assert_called_with({
            'type': 'pong',
            'echo': 'test'
        })
    
    @patch('native_host.send_message')
    @patch('native_host.read_message')
    @patch('native_host.get_vscode_port')
    def test_main_get_port(self, mock_get_port, mock_read, mock_send):
        """Test get_port message handling"""
        mock_get_port.return_value = 5432
        mock_read.side_effect = [
            {'type': 'get_port'},
            None  # Exit loop
        ]
        
        # Run main loop (will exit on None)
        with self.assertRaises(SystemExit):
            native_host.main()
        
        # Check that port was sent
        mock_send.assert_called_with({
            'type': 'port',
            'port': 5432
        })
    
    @patch('native_host.send_message')
    @patch('native_host.read_message')
    @patch('native_host.forward_to_vscode')
    def test_main_forward(self, mock_forward, mock_read, mock_send):
        """Test forward message handling"""
        mock_forward.return_value = {
            'success': True,
            'status': 200,
            'data': {'result': 'ok'}
        }
        
        mock_read.side_effect = [
            {
                'type': 'forward',
                'endpoint': '/visit',
                'data': {'url': 'https://example.com'}
            },
            None  # Exit loop
        ]
        
        # Run main loop (will exit on None)
        with self.assertRaises(SystemExit):
            native_host.main()
        
        # Check that forward was called and result sent
        mock_forward.assert_called_once()
        mock_send.assert_called_with({
            'type': 'forward_result',
            'success': True,
            'status': 200,
            'data': {'result': 'ok'}
        })
    
    @patch('native_host.send_message')
    @patch('native_host.read_message')
    @patch('requests.get')
    def test_main_check_status(self, mock_get, mock_read, mock_send):
        """Test check_status message handling"""
        mock_response = MagicMock()
        mock_response.ok = True
        mock_get.return_value = mock_response
        
        mock_read.side_effect = [
            {'type': 'check_status'},
            None  # Exit loop
        ]
        
        # Run main loop (will exit on None)
        with self.assertRaises(SystemExit):
            native_host.main()
        
        # Check that status was sent
        mock_send.assert_called_with({
            'type': 'status',
            'vscode_running': True,
            'port': 5000  # Default port
        })
    
    @patch('native_host.send_message')
    @patch('native_host.read_message')
    def test_main_unknown_message(self, mock_read, mock_send):
        """Test handling of unknown message type"""
        mock_read.side_effect = [
            {'type': 'unknown_type'},
            None  # Exit loop
        ]
        
        # Run main loop (will exit on None)
        with self.assertRaises(SystemExit):
            native_host.main()
        
        # Check that error was sent
        mock_send.assert_called_with({
            'type': 'error',
            'error': 'Unknown message type: unknown_type'
        })


class TestIntegration(unittest.TestCase):
    """Integration tests for the native host"""
    
    @patch('sys.stdout.buffer')
    @patch('sys.stdin.buffer')
    def test_full_message_flow(self, mock_stdin, mock_stdout):
        """Test complete message flow through the native host"""
        # Prepare input message
        input_message = {'type': 'ping', 'data': 'integration_test'}
        encoded_input = json.dumps(input_message).encode('utf-8')
        length_header = struct.pack('@I', len(encoded_input))
        
        # Setup stdin to provide the message then exit
        mock_stdin.read.side_effect = [
            length_header,
            encoded_input,
            b''  # EOF to exit
        ]
        
        # Capture output
        output_buffer = []
        mock_stdout.write.side_effect = lambda x: output_buffer.append(x)
        mock_stdout.flush.return_value = None
        
        # Run the main loop
        try:
            native_host.main()
        except SystemExit:
            pass  # Expected when stdin returns empty
        
        # Verify output
        self.assertEqual(len(output_buffer), 2)  # Length + message
        
        # Decode output message
        output_length = struct.unpack('@I', output_buffer[0])[0]
        output_message = json.loads(output_buffer[1].decode('utf-8'))
        
        # Verify pong response
        self.assertEqual(output_message['type'], 'pong')
        self.assertEqual(output_message['echo'], 'integration_test')


if __name__ == '__main__':
    # Run tests with verbose output
    unittest.main(verbosity=2)