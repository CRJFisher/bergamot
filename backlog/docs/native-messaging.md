Great. Here’s a **concrete example** of how to implement dynamic port discovery between your **VS Code extension** and **Firefox extension** using a **port file + native messaging host**.

---

## 🧱 Overview

* **VS Code extension** launches a local server on a dynamic port and writes it to a known file (e.g. `~/.mybridge/port.json`)
* A **native messaging host** reads the port file.
* The **Firefox extension** sends a message to the native host to ask “What port is the local server using?”

---

## 1. 🖥️ VS Code Extension – Start Server and Write Port

```ts
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const server = http.createServer((req, res) => {
  res.end('Hello from VS Code extension');
});

server.listen(0, () => {
  const port = (server.address() as any).port;
  const portFilePath = path.join(os.homedir(), '.mybridge', 'port.json');
  fs.mkdirSync(path.dirname(portFilePath), { recursive: true });
  fs.writeFileSync(portFilePath, JSON.stringify({ port }));
  console.log(`Server running on port ${port}`);
});
```

This writes something like:

```json
{ "port": 51703 }
```

---

## 2. 🧩 Native Messaging Host (Python Example)

Create `native_host.py`:

```python
import sys
import json
import os

def read_message():
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        sys.exit(0)
    message_length = int.from_bytes(raw_length, byteorder='little')
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(len(encoded).to_bytes(4, byteorder='little'))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()

def main():
    msg = read_message()
    if msg.get('type') == 'get_port':
        try:
            with open(os.path.expanduser('~/.mybridge/port.json')) as f:
                port_info = json.load(f)
            send_message({ 'port': port_info['port'] })
        except Exception as e:
            send_message({ 'error': str(e) })

if __name__ == '__main__':
    main()
```

---

## 3. 🧾 Native Host Manifest

**macOS/Linux**:
Save this to `~/Library/Application Support/Mozilla/NativeMessagingHosts/com.mybridge.port.json` or `~/.mozilla/native-messaging-hosts/com.mybridge.port.json`

```json
{
  "name": "com.mybridge.port",
  "description": "Bridge for VS Code port discovery",
  "path": "/full/path/to/native_host.py",
  "type": "stdio",
  "allowed_extensions": [ "your-firefox-extension-id@example.com" ]
}
```

Make `native_host.py` executable and ensure `chmod +x` is set.

---

## 4. 🧭 Firefox Extension

In `background.js`:

```js
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get_port") {
    let port = browser.runtime.connectNative("com.mybridge.port");
    port.onMessage.addListener((response) => {
      sendResponse(response);
    });
    port.postMessage({ type: "get_port" });
    return true; // Keep message channel open
  }
});
```

In your popup or content script:

```js
browser.runtime.sendMessage({ type: "get_port" }).then((response) => {
  if (response.port) {
    console.log("Local service running on port:", response.port);
  } else {
    console.error("Failed to get port:", response.error);
  }
});
```

---

## ✅ Summary

| Component         | Purpose                                    |
| ----------------- | ------------------------------------------ |
| VS Code extension | Starts dynamic server, writes port to file |
| Native host       | Reads port file, returns it over stdio     |
| Firefox extension | Queries native host for dynamic port       |

This setup avoids port conflicts, respects Firefox's sandboxing, and works on macOS/Linux/Windows.

---

Would you like a packaged example repo layout or help adapting this for Windows?
