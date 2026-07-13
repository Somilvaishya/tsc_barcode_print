# TSC Barcode Print

A custom Frappe/ERPNext app designed for batch barcode label printing directly from inward/outward stock documents (Purchase Receipt, Stock Entry). It uses **QZ Tray** as a browser-to-printer bridge to send raw **TSPL** commands to locally connected TSC thermal printers.

## Features
- **Print Dialog Integration**: Injects a "Print Barcodes" button into submitted Purchase Receipts and Stock Entries.
- **Barcode Generation Tool**: A custom doctype to pre-generate batches and print labels on demand.
- **Dynamic TSPL Templates**: Uses a "Barcode Template" doctype to store raw TSPL strings with Jinja templating, allowing layout changes without touching the code.
- **Multi-user RDP Support**: Configured to work with QZ Tray running as a Windows Service, ensuring seamless printing across multiple user profiles.

## Setup Instructions
1. Install QZ Tray (2.2.x) on the Windows Server and check **"Install as a Windows Service"**.
2. Install the TSC printer driver and note the exact printer name.
3. Configure the printer name in **Barcode Settings** inside ERPNext.
4. Create a **Barcode Template** with your TSPL string.

## License
MIT
