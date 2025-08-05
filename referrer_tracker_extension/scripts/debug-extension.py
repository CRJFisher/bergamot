#!/usr/bin/env python3
"""
Chrome Extension Debugger (Python) - Advanced debugging utilities and automation

PURPOSE:
- Advanced debugging features not available in simpler scripts
- Cross-platform support with Python's robust platform detection
- Extensible framework for adding automated tests
- More sophisticated error handling and cleanup

FEATURES:
- Automatic Chrome detection across Windows, Mac, and Linux
- Automatic extension building if not already built
- Advanced command-line options (headless, verbose logging, auto-devtools)
- VS Code extension server detection
- Framework for automated testing
- Proper signal handling and cleanup

USAGE:
  python scripts/debug-extension.py                    # Open chrome://extensions
  python scripts/debug-extension.py https://google.com # Open specific URL
  python scripts/debug-extension.py --auto-devtools    # Auto-open DevTools
  python scripts/debug-extension.py --keep-profile     # Keep profile for next run
  python scripts/debug-extension.py --wait-server      # Wait for VS Code extension
  python scripts/debug-extension.py --test             # Run automated tests

WHEN TO USE:
- When you need advanced debugging features (verbose logging, headless mode)
- When running automated tests against the extension
- When you need better error handling and cleanup
- When debugging complex extension issues
"""

import os
import sys
import json
import time
import tempfile
import shutil
import subprocess
import platform
import argparse
from pathlib import Path

class ChromeExtensionDebugger:
    def __init__(self):
        # Adjusted for new location in scripts/
        self.extension_dir = Path(__file__).parent.parent / "chrome"
        self.temp_profile = None
        self.chrome_process = None
        
    def find_chrome(self):
        """Find Chrome executable based on platform"""
        system = platform.system()
        
        chrome_paths = {
            'Darwin': [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                '/Applications/Chromium.app/Contents/MacOS/Chromium'
            ],
            'Windows': [
                r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
                os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe')
            ],
            'Linux': [
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium',
                '/usr/bin/chromium-browser'
            ]
        }
        
        for path in chrome_paths.get(system, []):
            if os.path.exists(path):
                return path
                
        # Try to find in PATH
        for cmd in ['google-chrome', 'google-chrome-stable', 'chromium', 'chrome']:
            if shutil.which(cmd):
                return cmd
                
        raise Exception("Chrome not found. Please install Google Chrome.")
        
    def build_extension(self):
        """Build the extension if needed"""
        background_js = self.extension_dir / "dist" / "background.bundle.js"
        if not background_js.exists():
            print("📦 Building extension...")
            subprocess.run(["npm", "run", "build"], 
                         cwd=self.extension_dir.parent, 
                         check=True)
            
    def create_debug_profile(self, keep_profile=False):
        """Create a temporary Chrome profile for debugging"""
        if keep_profile:
            profile_dir = Path.home() / ".pkm-chrome-debug"
            profile_dir.mkdir(exist_ok=True)
            return str(profile_dir)
        else:
            self.temp_profile = tempfile.mkdtemp(prefix="pkm-chrome-debug-")
            return self.temp_profile
            
    def launch_chrome(self, args):
        """Launch Chrome with debugging options"""
        chrome_path = self.find_chrome()
        profile_dir = self.create_debug_profile(args.keep_profile)
        
        chrome_args = [
            chrome_path,
            f'--user-data-dir={profile_dir}',
            f'--load-extension={self.extension_dir}',
            '--no-first-run',
            '--no-default-browser-check',
        ]
        
        if args.auto_devtools:
            chrome_args.append('--auto-open-devtools-for-tabs')
            
        if args.headless:
            chrome_args.append('--headless=new')
            
        if args.verbose:
            chrome_args.extend([
                '--enable-logging',
                '--v=1'
            ])
            
        # Add starting URL
        chrome_args.append(args.url or 'chrome://extensions')
        
        print(f"🚀 Launching Chrome...")
        print(f"📁 Extension: {self.extension_dir}")
        print(f"🔧 Profile: {profile_dir}")
        print(f"🌐 Opening: {args.url or 'chrome://extensions'}")
        print()
        
        if not args.headless:
            print("📝 Debugging instructions:")
            print("  • Extension page: chrome://extensions")
            print("  • Background: Click 'service worker' link")
            print("  • Content: Press F12 on any webpage")
            print("  • Network: Check DevTools Network tab")
            print()
            print("🛑 Press Ctrl+C to stop")
            print()
        
        self.chrome_process = subprocess.Popen(chrome_args)
        return self.chrome_process
        
    def check_server(self, port=5000):
        """Check if VS Code extension server is running"""
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result = sock.connect_ex(('localhost', port))
            sock.close()
            
            if result == 0:
                print("✅ VS Code extension detected on port 5000")
                return True
        except:
            pass
            
        print("⚠️  VS Code extension not detected on port 5000")
        print("   Make sure to run the VS Code extension from your IDE")
        return False
        
    def cleanup(self):
        """Clean up temporary profile"""
        if self.temp_profile and os.path.exists(self.temp_profile):
            try:
                shutil.rmtree(self.temp_profile)
            except:
                pass
                
    def run_tests(self):
        """Run automated tests"""
        print("🧪 Running extension tests...")
        # Add test URLs
        test_urls = [
            'https://www.google.com',
            'https://www.github.com',
            'https://stackoverflow.com'
        ]
        
        for url in test_urls:
            print(f"  Testing: {url}")
            # You could add selenium or puppeteer tests here
            
def main():
    parser = argparse.ArgumentParser(
        description='Debug PKM Navigation Tracker Chrome Extension',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/debug-extension.py                    # Open chrome://extensions
  python scripts/debug-extension.py https://google.com # Open specific URL
  python scripts/debug-extension.py --auto-devtools    # Auto-open DevTools
  python scripts/debug-extension.py --keep-profile     # Keep profile for next run
  python scripts/debug-extension.py --wait-server      # Wait for VS Code extension
        """
    )
    
    parser.add_argument('url', nargs='?', help='URL to open (default: chrome://extensions)')
    parser.add_argument('--auto-devtools', action='store_true', help='Auto-open DevTools for tabs')
    parser.add_argument('--keep-profile', action='store_true', help='Keep Chrome profile after exit')
    parser.add_argument('--headless', action='store_true', help='Run in headless mode')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose logging')
    parser.add_argument('--test', action='store_true', help='Run automated tests')
    
    args = parser.parse_args()
    
    debugger = ChromeExtensionDebugger()
    
    try:
        # Build extension
        debugger.build_extension()
        
        # Check for server
        debugger.check_server()
            
        # Launch Chrome
        process = debugger.launch_chrome(args)
        
        # Run tests if requested
        if args.test:
            time.sleep(2)  # Wait for Chrome to start
            debugger.run_tests()
            
        # Wait for Chrome to close
        process.wait()
        
    except KeyboardInterrupt:
        print("\n🧹 Shutting down...")
        if debugger.chrome_process:
            debugger.chrome_process.terminate()
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)
    finally:
        debugger.cleanup()

if __name__ == '__main__':
    main()