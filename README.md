# TSC Barcode Print

A custom Frappe/ERPNext app designed for batch barcode label printing directly from inward/outward stock documents (Purchase Receipt, Stock Entry). It uses **QZ Tray** as a browser-to-printer bridge to send raw **TSPL** commands to locally connected TSC thermal printers.

## Features
- **Print Dialog Integration**: Injects a "Print Barcodes" button into submitted Purchase Receipts and Stock Entries.
- **Barcode Generation Tool**: A custom doctype to pre-generate batches and print labels on demand.
- **Dynamic TSPL Templates**: Uses a "Barcode Template" doctype to store raw TSPL strings with Jinja templating, allowing layout changes without touching the code.
- **Multi-user RDP Support**: Configured to work with QZ Tray in shared environments, with cryptographically secure, silent printing across multiple user profiles.

## Setup Instructions
1. Install QZ Tray (2.2.x) on the Windows Server.
2. Ensure the X.509 Certificate (`qz_cert.pem`) is added to QZ Tray's Site Manager to suppress the "Untrusted Website" popup.
3. Install the TSC printer driver and ensure printers are shared/redirected appropriately for RDP sessions.
4. Create a **Barcode Template** with your TSPL string.

---

# Technical Documentation

## 1. System Overview
The **TSC Barcode Print** application is a highly scalable, Frappe-based extension designed to manage and execute direct-to-printer thermal barcode jobs. By bypassing native browser print dialogs and generating raw TSPL (TSC Printer Command Language), the application ensures rapid, pixel-perfect label printing. 

The architecture bridges the cloud-based ERP ecosystem with local hardware using **QZ Tray** as a hardware bridge, optimized specifically for complex, multi-tenant Remote Desktop (RDP) environments on Windows Server.

## 2. Core Architecture & Logic

### 2.1 Direct TSPL Engine
Unlike standard web printing that relies on HTML/Canvas-to-image conversion, this application compiles dynamic TSPL commands on the backend.
- **Logic:** The `api.py` endpoint (`render_barcode_template`) accepts context variables (Item Code, Batch No, Label Qty, Manufacturing Date) and injects them into the stored TSPL template.
- **Output:** It appends mandatory configuration headers (`SIZE`, `GAP`, `DIRECTION`, `CLS`) and print footers (`PRINT`), returning a raw command string array that the printer interprets natively.

### 2.2 DocType Data Models
- **Barcode Template:** Stores the raw TSPL syntax and label dimensions. Supports Jinja-like variable substitution (e.g., `{{ item_code }}`).
- **Barcode Generation Tool:** A transient, single-doctype controller acting as the manual generation hub. Features a clean 3-column UI structure isolating Item details from Template/Printer configuration.
- **Barcode Print Log:** An immutable audit ledger. Every successful print job asynchronously writes a log entry tracking the `print_datetime`, `printed_by` (Session User), target printer, and document source.

### 2.3 Transactional Integration
Integration points are injected into standard ERPNext workflows (`Purchase Receipt`, `Stock Entry`).
- **Data Parsing Logic:** The backend iterates through document items. If an item is serialized or batched (via `serial_and_batch_bundle`), the logic aggregates quantities per batch number to determine the exact number of unique labels required.
- **UI Logic:** A dynamically populated dialog fetches available local printers asynchronously (`prefetch_printers()`) to eliminate loading latency when a user clicks "Print Barcodes".

## 3. Multi-User Windows Server (RDP) Handling

Deploying local hardware bridges (QZ Tray) in a shared Windows Server environment accessed by multiple RDP clients presents significant concurrency and conflict challenges. The application handles this through strict architectural isolation.

### 3.1 Printer Conflict Resolution & Job Queuing
- **Challenge:** Multiple users printing simultaneously from the same host machine could result in job crossover or printer lockups.
- **Approach:** 
  - QZ Tray runs as a background service listening on `localhost:8181`. In an RDP environment, Windows isolates localhost per session.
  - The client-side JS explicitly commands QZ Tray to target a specific printer by its string name (e.g., `TSC TTP-345 (redirected 2)`). 
  - QZ Tray internally queues jobs specific to that printer spooler. Because the target is explicitly defined per job (rather than relying on a global "Default Printer"), overlapping print requests from User A and User B are queued cleanly by the Windows Spooler without conflict.

### 3.2 Double-Submit & Concurrency Locks
- **Logic:** In high-speed warehouse operations, users often double-click print buttons. The `qz_print.js` controller implements a Javascript-level `_printing` boolean lock. 
- **Result:** If a user initiates a print, subsequent clicks are rejected with a UI warning until the WebSocket promise resolves the first job, preventing duplicate labels.

## 4. Security & Certificate Authentication

### 4.1 Bypassing the "Untrusted Website" Prompt
By default, QZ Tray intercepts anonymous WebSocket connections and forces a manual UI prompt ("Action Required: Allow connection"). In a multi-user RDP environment, this popup blocks automation and disrupts workflow.

- **The Solution:** Implementation of Asymmetric Cryptography (RSA).
- **Backend Setup (`api.py`):** 
  - A 2048-bit RSA private key (`qz_private.pem`) is securely stored on the Frappe server.
  - A self-signed X.509 Digital Certificate (`qz_cert.pem`) is generated against the server's IP/Domain.
  - Two whitelisted endpoints were created:
    1. `get_qz_certificate()`: Serves the public X.509 certificate to the frontend.
    2. `sign_qz_message()`: Receives an authentication challenge string from QZ Tray, signs it using the backend Private Key (SHA-512), and returns the Base64 signature.
- **Frontend Execution (`qz_print.js`):** 
  - Before attempting a WebSocket connection, `qz.security.setCertificatePromise` and `qz.security.setSignaturePromise` intercept the connection flow, routing the cryptographic challenge to the Frappe backend.
- **Windows Server Setup:** The X.509 certificate is imported into QZ Tray's Site Manager (`override.crt`) on the host server. 
- **Result:** When any RDP user loads the application, QZ Tray cryptographically verifies the backend signature against the trusted certificate, silently authorizing the connection for all users without any manual intervention.

## 5. Summary
The TSC Barcode Print application provides a robust, enterprise-grade printing solution. By combining raw TSPL processing for speed, strict session handling for multi-tenant RDP environments, and cryptographic signatures for seamless security, it ensures highly reliable warehouse operations at scale.

## License
MIT
